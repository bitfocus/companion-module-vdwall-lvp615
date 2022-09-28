var tcp = require('../../tcp')
var instance_skel = require('../../instance_skel')
var debug
var log

function instance(system, id, config) {
	var self = this

	// A promise that's resolved when the socket connects
	self.PromiseConnected = null

	// super-constructor
	instance_skel.apply(this, arguments)

	self.actions()

	return self
}

/**
 * The user updated the config.
 *
 * @param config         The new config object
 */
instance.prototype.updateConfig = function (config) {
	var self = this
	var resetConnection = false

	if (self.config.host != config.host || self.config.port != config.port || self.config.sn != config.sn) {
		resetConnection = true
	}

	self.config = config

	if (resetConnection === true || self.socket === undefined) {
		self.init_connection()
	}
}

/**
 * Initializes the module
 */
instance.prototype.init = function () {
	var self = this

	debug = self.debug
	log = self.log

	self.init_connection()
}

/**
 * Connect to the VDWall LVP.
 */
instance.prototype.init_connection = function () {
	var self = this

	if (self.socket !== undefined) {
		self.socket.destroy()
		delete self.socket
	}

	self.status(self.STATUS_WARNING, 'Connecting')

	if (self.config.host) {
		self.socket = new tcp(self.config.host, self.config.port)

		self.socket.on('status_change', function (status, message) {
			self.status(status, message)
		})

		self.socket.on('error', function (err) {
			self.debug('Network error', err)
			self.log('error', 'Network error: ' + err.message)
			self.status(self.STATUS_ERROR, err)
		})

		self.socket.on('connect', function () {
			self.status(self.STATUS_OK)
			self.debug('Connected')
		})
	}
}

/**
 * Sends the command to the VDWall.
 *
 * @param cmd      The command to send
 * @returns        Success state of writing to the socket
 */
instance.prototype.send = function (cmd) {
	var self = this

	if (self.socket !== undefined && self.socket.connected) {
		debug('sending', cmd, 'to', self.config.host)
		return self.socket.send(cmd)
	} else {
		debug('Socket not connected')
	}

	return false
}

/**
 * Return config fields for web config.
 *
 * @returns      The config fields for the module
 */
instance.prototype.config_fields = function () {
	var self = this
	return [
		{
			type: 'text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'This module controls the VDWall LVP615. Serial number can be 1-255 or 0 for all devices.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Target IP',
			width: 5,
			default: '192.168.1.8',
			regex: self.REGEX_IP,
		},
		{
			type: 'number',
			id: 'port',
			label: 'Target Port',
			width: 4,
			min: 1,
			max: 65535,
			default: 7,
			required: true,
		},
		{
			type: 'number',
			id: 'sn',
			label: 'Serial Number',
			width: 4,
			default: 0,
			min: 0,
			max: 255,
			required: true,
		},
	]
}

/**
 * Cleanup when the module gets deleted.
 */
instance.prototype.destroy = function () {
	var self = this

	if (self.socket !== undefined) {
		self.socket.destroy()
		delete self.socket
	}

	debug('destroy', self.id)
}

/**
 * Creates the actions for this module.
 */
instance.prototype.actions = function (system) {
	var self = this

	// build on/off dropdown
	let onoffdrop = this.buildDropdownExact(['On', 'Off'])

	self.setActions({
		input_switch: {
			label: 'Input Switch',
			options: [
				{
					type: 'dropdown',
					label: 'Input',
					id: 'input',
					default: '0',
					choices: [
						{ id: 0, label: 'V1' },
						{ id: 1, label: 'V2' },
						{ id: 2, label: 'VGA1' },
						{ id: 3, label: 'VGA2' },
						{ id: 4, label: 'HDMI' },
						{ id: 5, label: 'DVI' },
						{ id: 6, label: 'DP' },
						{ id: 7, label: 'EXT' },
						{ id: 8, label: 'YPBPR' },
					],
				},
				{
					type: 'dropdown',
					label: 'Fade',
					id: 'fade',
					default: '0',
					choices: [
						{ id: 0, label: '0.0s' },
						{ id: 1, label: '0.5s' },
						{ id: 2, label: '1.0s' },
						{ id: 3, label: '1.5s' },
					],
				},
			],
		},
		brightness: {
			label: 'Brightness Level',
			options: [
				{
					type: 'textwithvariables',
					label: 'Value',
					id: 'value',
					tooltip: 'Value between 0-64 or 0-100 depending on setting.',
					default: '0',
					regex: self.REGEX_NUMBER,
				},
			],
		},
	})
}

/**
 * Executes the action and sends the TCP packet to the device.
 *
 * @param action      The action to perform
 */
instance.prototype.action = function (action) {
	var self = this
	let cmd = undefined

	// Clone 'action.options', otherwise reassigning the parsed variables directly will push
	//  them back into the config, because that's done by reference.
	let opt = JSON.parse(JSON.stringify(action.options))

	// Loop through each option for this action, and if any appear to be variables, parse them
	//  and reassign the result back into 'opt'.
	for (const key in opt) {
		let v = opt[key]
		if (typeof v === 'string' && v.includes('$(')) {
			self.system.emit('variable_parse', v, (parsed) => (v = parsed.trim()))
			opt[key] = v
		}
	}

	switch (action.action) {
		case 'input_switch':
			cmd = Buffer.from([5, self.config.sn, 0, opt.fade, opt.input, 0, 0, 0, 0, 0, 0, 0, 5])
			break
		case 'brightness':
			cmd = Buffer.from([5, self.config.sn, 16, opt.value, 0, 0, 0, 0, 0, 0, 0, 0, 5])
			break
		// Other cases go here
	}

	if (cmd !== undefined) {
		self.send(cmd)
	}
}

/**
 *
 * Formats a list of drop down strings into an array with matching ids
 *
 * @param droplist      List of dropdown strings
 * @returns             Formatted dropdown list with index values
 */
instance.prototype.buildDropdownExact = function (droplist) {
	let drop = []
	for (let i = 0; i < droplist.length; i++) {
		drop.push({ id: droplist[i], label: droplist[i] })
	}
	return drop
}

instance_skel.extendedBy(instance)
exports = module.exports = instance

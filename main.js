'use strict';

const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const ioBLib = require('@strathcole/iob-lib').ioBLib;

const MyQLib = require('myq-api');

const MyQ = new MyQLib();

const adapterName = require('./package.json').name.split('.').pop();

/*const deviceAttributes = {
	online: {
		sect: 'info',
		name: 'Device is online',
		type: 'boolean',
		role: 'indicator'
	},
	desc: {
		sect: 'info',
		name: 'Device name',
		type: 'string',
		role: 'text'
	},
	doorstate: {
		sect: 'states',
		name: 'Door state',
		type: 'number',
		role: 'value.door',
		states: {
			'1': 'open',
			'2': 'closed',
			'3': 'stopped',
			'4': 'opening',
			'5': 'closing',
			'8': 'moving',
			'9': 'not closed'
		}
	},
	lightstate: {
		sect: 'states',
		name: 'Light state',
		type: 'boolean',
		role: 'indicator.light',
		states: {
			'0': 'off',
			'1': 'on'
		}
	},
	addedtime: {
		sect: 'info',
		name: 'Added at',
		type: 'number',
		role: 'date'
	},
	isunattendedopenallowed: {
		sect: 'info',
		name: 'Allow unattended open',
		type: 'boolean',
		role: 'indicator'
	},
	isunattendedcloseallowed: {
		sect: 'info',
		name: 'Allow unattended close',
		type: 'boolean',
		role: 'indicator'
	},
	name: {
		sect: 'info',
		name: 'DeviceName',
		type: 'string',
		role: 'text'
	},
	is_gdo_lock_connected: {
		sect: 'info',
		name: 'GDO lock connected',
		type: 'boolean',
		role: 'indicator'
	},
	attached_work_light_error_present: {
		sect: 'info',
		name: 'Work light error',
		type: 'boolean',
		role: 'indicator.error'
	},
	learnmodestate: {
		sect: 'states',
		name: 'Learn mode',
		type: 'boolean',
		role: 'indicator'
	},
	numdevices: {
		sect: 'info',
		name: 'Connected devices',
		type: 'number',
		role: 'value.info'
	},
	fwver: {
		sect: 'info',
		name: 'Firmware version',
		type: 'string',
		role: 'text'
	},
	IsFirmwareCurrent: {
		sect: 'states',
		name: 'Firmware up to date',
		type: 'boolean',
		role: 'indicator'
	},
	ishomekitcapable: {
		sect: 'states',
		name: 'Homekit capable',
		type: 'boolean',
		role: 'indicator'
	},
	ishomekitactive: {
		sect: 'states',
		name: 'Homekit active',
		type: 'boolean',
		role: 'indicator'
	}
};*/

let adapter;
var deviceUsername;
var devicePassword;

let polling;
let pollingTime;
let controller;

function startAdapter(options) {
	options = options || {};
	Object.assign(options, {
		name: 'myq'
	});

	adapter = new utils.Adapter(options);
	ioBLib.init(adapter);

	adapter.on('unload', function(callback) {
		if(polling) {
			clearTimeout(polling);
		}
		adapter.setState('info.connection', false, true);
		callback();
	});

	adapter.on('stateChange', function(id, state) {
		// Warning, state can be null if it was deleted
		try {
			adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));

			if(!id) {
				return;
			}

			if(state && id.substr(0, adapter.namespace.length + 1) !== adapter.namespace + '.') {
				return;
			}
			id = id.substring(adapter.namespace.length + 1); // remove instance name and id

			if(state && state.ack) {
				return;
			}

			state = state.val;
			adapter.log.debug("id=" + id);

			if('undefined' !== typeof state && null !== state) {
				processStateChange(id, state);
			}
		} catch(e) {
			adapter.log.info("Error processing stateChange: " + e);
		}
	});

	adapter.on('ready', function() {
		if(!adapter.config.username) {
			adapter.log.warn('[START] Username not set');
		} else if(!adapter.config.password) {
			adapter.log.warn('[START] Password not set');
		} else {
			adapter.log.info('[START] Starting myq adapter');
			adapter.getForeignObject('system.config', (err, obj) => {
				if (obj && obj.native && obj.native.secret) {
					//noinspection JSUnresolvedVariable
					adapter.config.password = ioBLib.decrypt(obj.native.secret, adapter.config.password);
				} else {
					//noinspection JSUnresolvedVariable
					adapter.config.password = ioBLib.decrypt('Zgfr56gFe87jJOM', adapter.config.password);
				}

				main();
			});
		}
	});

	return adapter;
}


function main() {
	deviceUsername = adapter.config.username;
	devicePassword = adapter.config.password;

	pollingTime = adapter.config.pollinterval || 10000;
	if(pollingTime < 5000) {
		pollingTime = 5000;
	}

	adapter.log.info('[INFO] Configured polling interval: ' + pollingTime);
	adapter.log.debug('[START] Started Adapter');

	adapter.subscribeStates('*');

	MyQ.login(deviceUsername, devicePassword).then(function(result) {
		adapter.setState('info.connection', true, true);
		pollStates();
	}).catch(function(error) {
		console.error(error);
	});
}

function pollStates() {
	adapter.log.debug('Starting state polling');
	if(polling) {
		clearTimeout(polling);
		polling = null;
	}

	ioBLib.setOrUpdateObject('devices', 'Devices', 'channel', function() {
		MyQ.getDevices().then(function(result) {
			processDeviceStates(result.devices);
		}).catch(function(error) {
			console.error(error);
			return;
		});
	});

	polling = setTimeout(function() {
		pollStates();
	}, pollingTime);
}

function processDeviceStates(devices) {
	for(let i = 0; i < devices.length; i++) {
		processDeviceState(devices[i]);
	}
}

function getmyqDeviceAttribute(device, key) {
	if(!device || !device.state) {
		return null;
	}

	if(!device.state[key]) {
		return null;
	}

	return {
		value: device.state[key],
		updated: device.state['last_update']
	};
}

function processDeviceState(device) {
	if(!device.serial_number) {
		adapter.log.warn('Serial number of device missing.');
		adapter.log.debug(JSON.stringify(device));
		return;
	}


	let objId = 'devices.' + device.serial_number;
	let objName = getmyqDeviceAttribute(device, 'name');
	if(!objName || !objName.value) {
		objName = {
			value: device.serial_number
		};
	}
	ioBLib.setOrUpdateObject(objId, objName.value, 'device', function() {
		// process attributes
		if(device.created_date) {
			ioBLib.setOrUpdateState(objId + '.info.RegistrationDateTime', 'RegistrationDateTime', (new Date(device.created_date)).getTime(), '', 'number', 'date');
		}
		//ioBLib.setOrUpdateState(objId + '.info.myqDeviceTypeId', 'myq device type', device.myqDeviceTypeId, '', 'string', 'text');
		ioBLib.setOrUpdateState(objId + '.info.myqDeviceTypeName', 'myq device type', device.device_type, '', 'string', 'text');
		ioBLib.setOrUpdateState(objId + '.info.SerialNumber', 'Serial number', device.serial_number, '', 'string', 'text');
		ioBLib.setOrUpdateState(objId + '.info.UpdatedDate', 'Last update time', (new Date(device.last_update)).getTime(), '', 'number', 'date');

		let doorState = getmyqDeviceAttribute(device, 'door_state');
		if(null !== doorState) {
			//ioBLib.setOrUpdateState(objId + '.states.moving', 'Door moving', (doorState.value == '4' || doorState.value == '5' || doorState.value == '8' ? true : false), '', 'boolean', 'indicator.moving');
			ioBLib.setOrUpdateState(objId + '.commands.open', 'Open door', false, '', 'boolean', 'button.open');
			ioBLib.setOrUpdateState(objId + '.commands.close', 'Close door', false, '', 'boolean', 'button.close');
		} else if(null !== getmyqDeviceAttribute(device, 'light_state')) {
			ioBLib.setOrUpdateState(objId + '.commands.on', 'Switch on', false, '', 'boolean', 'button.on');
			ioBLib.setOrUpdateState(objId + '.commands.off', 'Switch off', false, '', 'boolean', 'button.off');
		}

		let attr;
		let attrValue;
		for(let attr in device.state) {
			attrValue = getmyqDeviceAttribute(device, attr);
			if(null !== attrValue) {
				let origvalue = attrValue.value;

				attr = {
					'name': attr,
					'type': typeof origvalue,
					'role': 'text',
					'states': null
				};


				if(attr['type'] === 'number' && attrValue.value.match(/^[1-9][0-9]*(\.[0-9]+)?$/)) {
					if(attrValue.value.indexOf('.') > -1) {
						attrValue.value = parseFloat(attrValue.value);
					} else {
						attrValue.value = parseInt(attrValue.value, 10);
					}
					attr['role'] = 'value';
				} else if(attr['type'] === 'boolean') {
					attr['role'] = 'indicator';
				}

				if(!attrValue.value && attrValue.value !== 0 && attrValue.value !== false) {
					adapter.log.warn('Value of ' + attrId + ' is now empty, but was ' + JSON.stringify(origvalue));
				}

				if(attr['role'] === 'date') {
					attrValue.value = (new Date(attrValue.value)).getTime();
				}

				if(!attr['states']) {
					attr['states'] = null;
				}
				// attribute exists
				ioBLib.setOrUpdateState(objId + '.' + attr['name'], attr['name'], attrValue.value, '', attr['type'], attr['role'], attr['states']);
			}
		}
	});
}

function processStateChange(id, value) {
	adapter.log.debug('StateChange: ' + JSON.stringify([id, value]));

	if(id.match(/\.commands\.(open|close)$/)) {
		let matches = id.match(/^devices\.([^\.]+)\.commands\.(open|close)$/);
		if(!matches) {
			adapter.log.warn('Could not process state id ' + id);
			return;
		}

		let deviceId = matches[1];
		let cmd = matches[2];
		if(!deviceId) {
			adapter.log.warn('Found no valid device id in state ' + id);
			return;
		}

		if(cmd === 'open') {
			cmd = MyQLib.actions.door.OPEN;
		} else {
			cmd = MyQLib.actions.door.CLOSE;
		}

		MyQ.setDoorState(deviceId, cmd).then(function(result) {
			adapter.log.info('Cmd ' + cmd + ' sent to ' + deviceId);
		}).catch(function(error) {
			console.error(error);
		});

		adapter.setState(id, false, true);
		if(polling) {
			clearTimeout(polling);
		}
		polling = setTimeout(function() {
			pollStates();
		}, 2000);
	} else if(id.match(/\.commands\.(on|off)$/)) {
		let matches = id.match(/^devices\.([^\.]+)\.commands\.(on|off)$/);
		if(!matches) {
			adapter.log.warn('Could not process state id ' + id);
			return;
		}

		let deviceId = matches[1];
		let cmd = matches[2];
		if(!deviceId) {
			adapter.log.warn('Found no valid device id in state ' + id);
			return;
		}

		if(cmd === 'on') {
			cmd = MyQLib.actions.light.TURN_ON;
		} else {
			cmd = MyQLib.actions.light.TURN_OFF;
		}

		MyQ.setLightState(deviceId, cmd).then(function(result) {

		}).catch(function(error) {
			adapter.log.warn('Failed switch ' + cmd + ' lamp ' + deviceId + ': ' + JSON.stringify(error));
		});

		adapter.setState(id, false, true);
		if(polling) {
			clearTimeout(polling);
		}
		polling = setTimeout(function() {
			pollStates();
		}, 2000);
	} else {
		adapter.log.warn('Unknown id for StateChange with ack=false: ' + id);
	}

	return;
}

// If started as allInOne/compact mode => return function to create instance
if(module && module.parent) {
	module.exports = startAdapter;
} else {
	// or start the instance directly
	startAdapter();
} // endElse

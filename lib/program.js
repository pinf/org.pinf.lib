
const DESCRIPTOR = require("./descriptor");


exports.fromFile = function (path, callback) {
	return DESCRIPTOR.fromFile(ProgramDescriptor, path, callback);
}


var ProgramDescriptor = function (path, data) {
	DESCRIPTOR.Descriptor.prototype.constructor.call(this, path, data);
}
ProgramDescriptor.prototype = Object.create(DESCRIPTOR.Descriptor.prototype);



ProgramDescriptor.prototype.configForLocator = function (locator) {
	var self = this;
	var configId = locator.getConfigId();
	if (
		!self._data ||
		!self._data.config ||
		!self._data.config[configId]
	) {
		return false;
	}
	return self._data.config[configId];
}

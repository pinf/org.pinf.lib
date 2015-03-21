
const PATH = require("path");
const DESCRIPTOR = require("./descriptor");
const LOCATOR = require("./locator");


exports.fromFile = function (path, callback) {
	return DESCRIPTOR.fromFile(ProgramDescriptor, path, callback);
}


var ProgramDescriptor = function (path, data) {
	DESCRIPTOR.Descriptor.prototype.constructor.call(this, path, data);
}
ProgramDescriptor.prototype = Object.create(DESCRIPTOR.Descriptor.prototype);

ProgramDescriptor.prototype.isBootable = function () {
	return !!this._data.boot;
}

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


ProgramDescriptor.prototype.locatorForDeclaration = function (declaration) {
	var locator = LOCATOR.fromDeclaration(declaration);
	locator.setBasePath(PATH.dirname(this._path));
	return locator;
}


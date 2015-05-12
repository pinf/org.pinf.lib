
const Q = require("q");
const PATH = require("path");
const DESCRIPTOR = require("./descriptor");
const LOCATOR = require("./locator");
const DEEPMERGE = require("deepmerge");
const ESCAPE_REGEXP_COMPONENT = require("escape-regexp-component");


exports.fromFile = function (path, options, callback) {
	return DESCRIPTOR.fromFile(PackageDescriptor, path, options, callback);
}

var PackageDescriptor = function (path, data, options) {
	DESCRIPTOR.Descriptor.prototype.constructor.call(this, PackageDescriptor, path, data, options);
}
PackageDescriptor.type = "PackageDescriptor";
PackageDescriptor.prototype = Object.create(DESCRIPTOR.Descriptor.prototype);



const Q = require("q");
const PATH = require("path");
const DESCRIPTOR = require("./descriptor");
const LOCATOR = require("./locator");
const DEEPMERGE = require("deepmerge");
const ESCAPE_REGEXP_COMPONENT = require("escape-regexp-component");


exports.fromFile = function (path, callback) {
	return DESCRIPTOR.fromFile(PackageDescriptor, path, callback);
}

var PackageDescriptor = function (path, data) {
	DESCRIPTOR.Descriptor.prototype.constructor.call(this, PackageDescriptor, path, data);
}
PackageDescriptor.type = "PackageDescriptor";
PackageDescriptor.prototype = Object.create(DESCRIPTOR.Descriptor.prototype);


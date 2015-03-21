
const PATH = require("path");


exports.fromUri = function (uri) {
	return new Locator({
		location: uri
	});
}

exports.fromDeclaration = function (declaration) {
	if (typeof declaration === "string") {
		declaration = {
			location: declaration
		};
	}
	return new Locator(declaration);
}


var Locator = exports.Locator = function (declaration) {
	this._declaration = declaration;
}

Locator.prototype.getConfigId = function () {
	return this._declaration.location + "/0";
}

Locator.prototype.setBasePath = function (path) {
	this._basePath = path;
}

Locator.prototype.getAbsolutePath = function () {
	return PATH.join(this._basePath, this._declaration.location);
}

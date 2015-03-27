
const PATH = require("path");


exports.fromUid = function (uid) {
	return new Locator({
		location: uid
	});
}

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

exports.fromConfigDepends = function ($to) {
	return new Locator({
		location: "x",
		alias: $to
	});
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

Locator.prototype.getConfig = function () {
	return this._declaration.config || null;
}

Locator.prototype.getAlias = function () {
	return this._declaration.alias || null;
}

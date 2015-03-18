
const FS = require("fs-extra");


exports.fromFile = function (proto, path, callback) {
	return FS.readJson(path, function (err, data) {
		if (err) return callback(err);
		return callback(null, new proto(path, data));
	});
}


var Descriptor = exports.Descriptor = function (path, data) {
	var self = this;
	self._path = path;
	self._data = data;
}




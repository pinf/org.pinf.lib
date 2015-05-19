
const PATH = require("path");
const FS = require("fs-extra");
const WAITFOR = require("waitfor");
const DEEPMERGE = require("deepmerge");
const ESCAPE_REGEXP_COMPONENT = require("escape-regexp-component");


const DEBUG = !!process.env.VERBOSE;


exports.fromFile = function (proto, path, options, callback) {

	if (typeof options === "function" && typeof callback === "undefined") {
		callback = options;
		options = null;
	}

	options = options || {};
	options.env = options.env || process.env;

	if (DEBUG) console.log("Load from file: " + path);

	var loadRootPINFConfigOnce = function (callback) {
		if (loadRootPINFConfigOnce.loaded) {
			return callback(null, {});
		}

		if (!options.env.PGS_WORKSPACE_ROOT) {
			return callback(new Error("'PGS_WORKSPACE_ROOT' environment variable must be set!"));
		}

		return loadFromFile(PATH.join(options.env.PGS_WORKSPACE_ROOT, "PINF.json"), function (err, pinfConfig) {
			if (err) return callback(err);

			var descriptor = new proto(
				PATH.join(options.env.PGS_WORKSPACE_ROOT, "PINF.json"),
				pinfConfig,
				options
			);
			return descriptor.init(function (err) {
				if (err) return callback(err);

				loadRootPINFConfigOnce.loaded = true;
				return callback(null, pinfConfig._data);
			});
		});
	}

	function loadFromFile (path, callback) {
		return FS.exists(path, function (exists) {
			if (!exists) return callback(null, {});
			return FS.readFile(path, "utf8", function (err, data) {
				try {
					data = JSON.parse(data);
				} catch (err) {
					err.message += " (while parsing '" + path + "')";
					err.stack += "\n(while parsing '" + path + "')";
					return callback(err);
				}
				return callback(null, data);
			});
		});
	}

	function loadFromFiles (callback) {
		return loadFromFile(path, function (err, data) {
			if (err) return callback(err);
/*			
			if (proto.type === "ProgramDescriptor") {

console.log("PROCESS", PATH.join(process.env.PGS_WORKSPACE_ROOT, "PINF.json"));

				return loadRootPINFConfigOnce(function (err, pinfConfig) {
					if (err) return callback(err);

console.log("CONFIG pinfConfig", pinfConfig);

					data.config = DEEPMERGE(data.config || {}, pinfConfig || {});
					return callback(null, data);
				});
			}
*/			
			return callback(null, data);
		});
	}

	return loadFromFiles(function (err, data) {
		if (err) return callback(err);
		var descriptor = new proto(path, data, options);
		return descriptor.init(function (err) {
			if (err) return callback(err);
			return callback(null, descriptor);
		});
	});
}


var Descriptor = exports.Descriptor = function (proto, path, data, options) {
	var self = this;
	self._proto = proto;
	self._path = path;
	self._data = data;
	self._options = options;

//console.log("DATA", self._data);


	function getEnvironmentVariables (configString) {
		var vars = {};
        var re = /\{\{(!)?env\.([^\}]+)\}\}/g;
        var m = null;
        while (m = re.exec(configString)) {
        	vars[m[2]] = {
        		optional: (m[1] === "!"),
        		matched: m[0]
        	};
        }
        return vars;
	}

	function resolveVariables () {
		var configString = JSON.stringify(self._data);
		configString = configString.replace(/\{\{__FILENAME__\}\}/g, self._path);
		configString = configString.replace(/\{\{__DIRNAME__\}\}/g, PATH.dirname(self._path));

		var envVars = getEnvironmentVariables(configString);
		for (var name in envVars) {
			// TODO: Fire event to handlers to promt for variable or load it from profile/credentials.
			if (!self._options.env[name]) {
				if (envVars[name].optional) {
					configString = configString.replace(new RegExp(ESCAPE_REGEXP_COMPONENT(envVars[name].matched), "g"), "");
					continue;
				}
				if (self._options.ignoreMissingEnvironmentVariables !== true) {
					throw new Error("Environment variable '" + name + "' is not set! Used in: " + self._path);
				}
			} else {
				configString = configString.replace(new RegExp(ESCAPE_REGEXP_COMPONENT(envVars[name].matched), "g"), self._options.env[name]);
			}
		}

		self._data = JSON.parse(configString);
	}

	resolveVariables();
}

Descriptor.prototype.getProtoBasename = function () {
	return PATH.basename(this._path).replace(/\.json$/, "");
}

Descriptor.prototype.init = function (callback) {
	var self = this;

	function resolveExtends (callback) {
		if (!self._data['@extends']) {
			return callback(null);
		}

		var locators = self._data['@extends'];
		var locatorKeys = Object.keys(locators);
		locatorKeys.reverse();
		delete self._data['@extends'];

		var waitfor = WAITFOR.serial(function(err) {
			if (err) return callback(err);
			return callback(null);
		});
		locatorKeys.forEach(function(locatorKey, i) {
			return waitfor(function(callback) {
				var locator = locators[locatorKey];
				if (!locator) {
					return callback(null);
				}
				var optional = /^!/.test(locator);
				if (optional) locator = locator.substring(1);
				if (/^\./.test(locator)) {
					locator = PATH.join(self._path, "..", locator);
				}
				if (/^\//.test(locator)) {
					var path = locator.replace(/(\/)\*(\.proto\.json)$/, "$1" + self.getProtoBasename() + "$2");
					return FS.exists(path, function(exists) {
						if (!exists) {
							if (optional) {
								return callback(null);
							}
							return callback(new Error("Extends path '" + path + "' does not exist!"));
						}
						return exports.fromFile(self._proto, path, self._options, function (err, descriptor) {
							if (err) return callback(err);
							// NOTE: We override everything the extends sets.
							self._data = DEEPMERGE(descriptor._data, self._data);
							return callback(null);
						});
					});
				} else {
					return callback(new Error("Locator with pattern '" + locator + "' not yet supported!"));
				}
			});
		});
		return waitfor();
	}

	// TODO: Use commmon implementation from 'org.pinf.genesis.lib'.
	function resolveTranslocations (callback) {
		if (!self._data.config) return callback(null);

		function resolveEnvironmentVariables (str) {
			var vars = {};
	        var re = /\{\{env\.([^\}]+)\}\}/g;
	        var m = null;
	        while (m = re.exec(str)) {
	        	if (typeof self._options.env[m[1]] !== "undefined") {
					str = str.replace(new RegExp(ESCAPE_REGEXP_COMPONENT(m[0]), "g"), self._options.env[m[1]]);
				}
	        }
	        return str;
		}

		var waitfor = WAITFOR.serial(callback);

		// TODO: Make this more generic.
		var uri = null;
		for (var configId in self._data.config) {
			uri = self._data.config[configId]['@translocate'] || null;
			if (!uri) continue;
			var optional = /^!/.test(uri);
			if (optional) uri = uri.substring(1);
			waitfor(configId, uri, function (configId, uri, callback) {
				uri = resolveEnvironmentVariables(uri);
				if (!/\//.test(uri)) {
					return callback(new Error("Translocation uri '" + uri + "' for config id '" + configId + "' not supported."));
				}
				return FS.exists(uri, function (exists) {
					if (!exists) {
						if (optional) {
							return callback(null);
						}
						return callback(new Error("Translocation uri '" + uri + "' for config id '" + configId + "' not found! To ignore missing file use '@translocate: !<path>'"));
					}
					var opts = {};
					for (var name in self._options) {
						opts[name] = self._options[name];
					}

					// We assume that all variables in the translocated section
					// could be resolved.
					// TODO: Specify which section we are interested in and throw if
					//       an ENV variable is missing.
					opts.ignoreMissingEnvironmentVariables = true;

					return exports.fromFile(self._proto, uri, opts, function (err, descriptor) {
						if (err) return callback(err);
						// This is always optional. i.e. we fail silently if nothing is found.
						if (
							descriptor._data.config &&
							descriptor._data.config[configId]
						) {
							// NOTE: The external descriptor always overrides our values!
							// TODO: Make this positional based on line in file.
							self._data.config[configId] = DEEPMERGE(self._data.config[configId], descriptor._data.config[configId]);
						}
						return callback(null);
					});
				});
			});
		}

		return waitfor();
	}

	function applyOverlays (callback) {
		if (!self._data['@overlays']) {
			return callback(null);
		}

		var locators = self._data['@overlays'];
		delete self._data['@overlays'];

		var waitfor = WAITFOR.serial(function(err) {
			if (err) return callback(err);
			return callback(null);
		});
		locators.forEach(function(locator, i) {
			return waitfor(function(callback) {
				var optional = /^!/.test(locator);
				if (optional) locator = locator.substring(1);
				if (/^\./.test(locator)) {
					locator = PATH.join(self._path, "..", locator);
				}

				if (/^\//.test(locator)) {
					var path = locator.replace(/(\/)\*(\.proto\.json)$/, "$1" + self.getProtoBasename() + "$2");
					return FS.exists(path, function(exists) {
						if (!exists) {
							if (optional) {
								return callback(null);
							}
							return callback(new Error("Extends path '" + path + "' does not exist!"));
						}
						return exports.fromFile(self._proto, path, self._options, function (err, descriptor) {
							if (err) return callback(err);

							// NOTE: The overlay overrides everything we have.
							self._data = DEEPMERGE(self._data, descriptor._data);

							return callback(null);
						});
					});
				} else {
					return callback(new Error("Locator with pattern '" + locator + "' not yet supported!"));
				}
			});
		});
		return waitfor();
	}

	return resolveExtends(function (err) {
		if (err) return callback(err);
		return resolveTranslocations(function (err) {
			if (err) return callback(err);
			return applyOverlays(callback);
		});
	});
}



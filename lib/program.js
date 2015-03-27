
const Q = require("q");
const PATH = require("path");
const DESCRIPTOR = require("./descriptor");
const LOCATOR = require("./locator");
const DEEPMERGE = require("deepmerge");
const ESCAPE_REGEXP_COMPONENT = require("escape-regexp-component");


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

ProgramDescriptor.prototype.configForLocator = function (locator, options) {
	var self = this;
	options = options || {};
	function finalize (configId) {
		var config = null;
		if (options.includeId) {
			config = Object.create({
				$id: configId
			});
			for (var name in self._data.config[configId]) {
				config[name] = self._data.config[configId][name];
			}
		} else {
			config = self._data.config[configId];
		}
		return config;
	}
	var configId = locator.getConfigId();
	if (
		!self._data ||
		!self._data.config ||
		!self._data.config[configId]
	) {
		if (!/^x/.test(configId)) {
			return false;
		}
		var alias = locator.getAlias();
		if (alias) {
			for (var id in self._data.config) {
				// TODO: Match trailing version as well.
				if (self._data.config[id].$to === alias) {
					return finalize(id);
				}
			}
		}
		return false;
	}
	return finalize(configId);
}

ProgramDescriptor.prototype.locatorForDeclaration = function (declaration) {
	var locator = LOCATOR.fromDeclaration(declaration);
	locator.setBasePath(PATH.dirname(this._path));
	return locator;
}

ProgramDescriptor.prototype.overlayConfig = function (config) {
	// TODO: Track different config layers separately.
	if (!config) {
		return;
	}
	this._data.config = DEEPMERGE(this._data.config, config);
}

ProgramDescriptor.prototype.parsedConfigForLocator = function (locator) {
	var self = this;
	var config = self.configForLocator(locator, {
		includeId: true
	});
	if (!config) return null;

	function getUsingFrom (config) {
		var from = {};
        var re = /\{\{\$from\.([^\.]+)\.([^\}]+)\}\}/g;
        var m = null;
        while (m = re.exec(JSON.stringify(config))) {
        	if (!from[m[1]]) {
        		from[m[1]] = {};
        	}
        	from[m[1]][m[2]] = m[0];
        }
        return from;
	}

	function getFunctions (config) {
		var functions = {};
        var re = /\{\{([^\}\)]+)\(\)\}\}/g;
        var m = null;
        while (m = re.exec(JSON.stringify(config))) {
        	functions[m[1]] = m[0];
        }
        return functions;
	}

	var Config = function (id, config) {		
		this.id = id;
		this.depends = getUsingFrom(config);
		this.functions = getFunctions(config);
		this.config = config;
		if (!this.config.$to) {
			throw new Error("Config variable '$to' must be declared for config context '" + this.id + "'");
		}
	}
	Config.prototype.setResolved = function (resolvedConfig) {
		this._resolvedConfig = resolvedConfig;
	}
	Config.prototype.resolve = function (api) {
		var self = this;

		var configString = JSON.stringify(self.config);

		function resolveVariables () {
			for (var from in self.depends) {
				for (var name in self.depends[from]) {
					if (
						!self._resolvedConfig ||
						!self._resolvedConfig[from]
					) {
						return Q.reject(new Error("Config variable '" + from + "' group not exported prior to using it!"));
					}
					function findValue (values, pointer) {
						var pointerParts = pointer.split(".");
						var segment = null;
						while (pointerParts.length > 0) {
							segment = pointerParts.shift();
							if (!values[segment]) {
								return;
							}
							values = values[segment];
						}
						return values;
					}
					var value = findValue(self._resolvedConfig[from], name);

					if (typeof value === "undefined") {
						return Q.reject(new Error("Config variable " + self.depends[from][name] + " not exported prior to using it!"));
					}

					configString = configString.replace(new RegExp(ESCAPE_REGEXP_COMPONENT(self.depends[from][name]), "g"), value);
				}
			}
			return Q.resolve();
		}

		function resolveFunctions () {
			return Q.all(Object.keys(self.functions).map(function (func) {
				if (!api[func]) {
					throw new Error("Function '" + func + "' is not declared in api! Plugin '" + self.id + "' must provide this function when calling `config.resolve(api)`.");
				}
				return Q.when(api[func]()).then(function (value) {
					configString = configString.replace(new RegExp(ESCAPE_REGEXP_COMPONENT(self.functions[func]), "g"), value);
				});
			}));
		}

		return resolveVariables().then(function () {
			return resolveFunctions();
		}).then(function () {
			return JSON.parse(configString);
		});
	}

	return new Config(config.$id, config);
}

ProgramDescriptor.prototype.resolvePath = function () {
	return PATH.join.apply(null, [this._path, ".."].concat(Array.prototype.slice.call(arguments)));
}

ProgramDescriptor.prototype.getBootPackageDescriptor = function () {
	if (
		!this._data.boot ||
		!this._data.boot.package
	) {
		throw new Error("No 'boot.package' declared in program descriptor '" + this._path + "'!");
	}
	// TODO: Use pinf-it-package-insight to load descriptor.
	var descriptorPath = this.resolvePath(this._data.boot.package);
	var descriptor = require(descriptorPath);

	return descriptor;
}



const Q = require("q");
const PATH = require("path");
const DESCRIPTOR = require("./descriptor");
const LOCATOR = require("./locator");
const DEEPMERGE = require("deepmerge");
const ESCAPE_REGEXP_COMPONENT = require("escape-regexp-component");
const PACKAGE = require("./package");


exports.fromFile = function (API, path, callback) {
	return DESCRIPTOR.fromFile(forAPI(API).ProgramDescriptor, path, callback);
}


function forAPI (API) {

	var ProgramDescriptor = function (path, data) {
		DESCRIPTOR.Descriptor.prototype.constructor.call(this, ProgramDescriptor, path, data);
	}
	ProgramDescriptor.type = "ProgramDescriptor";
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
		var programDescriptorSelf = self;
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
	        if (
	        	config.$depends &&
	        	Array.isArray(config.$depends)
	       	) {
	       		config.$depends.forEach(function (name) {
	       			if (!from[name]) {
			        	from[name] = {};
	       			}
	       		});
	        }
	        return from;
		}

		function getFunctions (config) {
			var functions = {};
	        var re = /\{\{([^\}\)]+)\(([^\)]*)\)\}\}/g;
	        var m = null;
	        while (m = re.exec(JSON.stringify(config))) {
	        	functions[m[1]] = {
	        		arg: m[2] || null,
	        		matched: m[0]
	        	};
	        }
	        return functions;
		}
	/*
		function getEnvironmentVariables (config) {
			var vars = {};
	        var re = /\{\{env\.([^\}]+)\}\}/g;
	        var m = null;
	        while (m = re.exec(JSON.stringify(config))) {
	        	vars[m[1]] = m[0];
	        }
	        return vars;
		}
	*/
		var Config = function (id, config) {		
			this.id = id;
			this.depends = getUsingFrom(config);
			this.functions = getFunctions(config);
	//		this.envs = getEnvironmentVariables(config);
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

	//console.log("original", self.config);

			var configString = JSON.stringify(self.config);

			function resolveVariables () {
	/*
				for (var name in self.envs) {
					// TODO: Fire event to handlers to promt for variable or load it from profile/credentials.
					if (!process.env[name]) {
						throw new Error("Environment variable '" + name + "' is not set!");
					}
					configString = configString.replace(new RegExp(ESCAPE_REGEXP_COMPONENT(self.envs[name]), "g"), process.env[name]);
				}
	*/
				var done = Q.resolve();
				for (var from in self.depends) {
					for (var name in self.depends[from]) {
						function resolveVariable (from, name) {
							if (
								!self._resolvedConfig ||
								!self._resolvedConfig[from]
							) {
								return Q.reject(new Error("Config variable '" + from + "' group not exported prior to using it!"));
							}
							function findValue (values, pointer) {
								// TODO: Use JSON PATH to find vars.
								var pointerParts = pointer.split(".");
								var segment = null;
								while (pointerParts.length > 0) {
									segment = pointerParts.shift();

									// Deal with path segment containing ".". e.g. 'programs['.pgs'].getRuntimeConfigFor'
									// Also "profile.credentials['dnsimple.com']"
									var index = 0;
									if ((index = segment.indexOf("[")) > 0) {
										pointerParts[0] = segment.substring(index) + "." + pointerParts[0];
										segment = segment.substring(0, index);
									} else
									if ((index = segment.indexOf("]")) > -1) {
										if (pointerParts.lenth > 0) {
											pointerParts[0] = segment.substring(index + 1) + pointerParts[0];
										}
										segment = segment.substring(0, index + 1);
									}

									var m = segment.match(/^\[(["'])([^'"]+)(["'])\]$/);
									if (m && m[1] === m[3]) {
										segment = m[2];
									}

									// Deal with funcitons. e.g 'getRuntimeConfigFor(pgs-expand)'
									m = segment.match(/^([^\(]+)\(([^\)]+)\)$/);
									if (m) {
										if (typeof values[m[1]] !== "function") {
											throw new Error("Property in config for name '" + m[1] + "' is not a function! Don't reference it as a funciton using '" + pointer + "' or declare a function.");
										}
										function findInSub (m, segment, subPointer) {
											return Q.when(values[m[1]](m[2])).then(function (values) {
												return Q.when(findValue(values, subPointer));
											});
										};

										return findInSub(m, segment, pointerParts.join("."));
									} else {
										if (!values[segment]) {
											return;
										}
										values = values[segment];
									}
								}
								return values;
							}

							var value = findValue(self._resolvedConfig[from], name);

							if (typeof value === "undefined") {
								return Q.reject(new Error("Config variable " + self.depends[from][name] + " not exported by '" + from + "' prior to using it!"));
							}

							function replaceValue (value) {
								var lookup = self.depends[from][name];
								if (
									typeof value === "object" ||
									Array.isArray(value)
								) {
									lookup = '"' + lookup + '"';
									value = JSON.stringify(value);
								}
								configString = configString.replace(new RegExp(ESCAPE_REGEXP_COMPONENT(lookup), "g"), value);
							}

							if (Q.isPromise(value)) {
								done = Q.when(done, function () {
									return value.then(replaceValue);
								});
							} else {
								replaceValue(value);
							}
						}

						resolveVariable(from, name);
					}
				}
				return done;
			}

			function resolveFunctions () {
				if (!api) return Q.resolve();

				var partiallyResolvedConfig = JSON.parse(configString);

				return Q.all(Object.keys(self.functions).map(function (func) {
					if (!api[func]) {
						throw new Error("Function '" + func + "' is not declared in api! Plugin '" + self.id + "' must provide this function when calling `config.resolve(api)`.");
					}
					return Q.when(api[func](partiallyResolvedConfig, self.functions[func].arg || null)).then(function (value) {

						var lookup = self.functions[func].matched;
						if (
							typeof value === "object" ||
							Array.isArray(value)
						) {
							lookup = '"' + lookup + '"';
							value = JSON.stringify(value);
						}

						configString = configString.replace(new RegExp(ESCAPE_REGEXP_COMPONENT(lookup), "g"), value);
					});
				}));
			}

			function resolveNamespaces (config) {
				function resolveNamespace (name) {

					var deferred = Q.defer();

					var packageSourcePath = API.PATH.join(API.getPackagesDirpath(), name.replace(/\//g, "~") + "/source/installed/master");

					API.FS.exists(packageSourcePath, function (exists) {
						if (!exists) {

							// TODO: Dynamically download plugins.

							var err = new Error("Plugin '" + name + "' could not be found at '" + packageSourcePath + "'!");
							err.code = 404;
							return deferred.reject(err);
						}
						return API.PACKAGE.fromFile(API.PATH.join(packageSourcePath, "package.json"), function (err, pluginDescriptor) {
							if (err) return deferred.reject(err);
							pluginDescriptor = pluginDescriptor._data;
							var mainPath = API.PATH.join(packageSourcePath, pluginDescriptor.main || "");
							return Q.when(require(mainPath).for(API).normalize(config[name])).then(function (_config) {
								for (var _name in _config) {
									config[_name] = _config[_name];
								}
								delete config[name];
							}).then(deferred.resolve, deferred.reject);
						});
					});
					return deferred.promise;
				}
				var all = [];
				for (var name in config) {
					if (/^[^\.]+\.[^\/]+\//.test(name)) {
						all.push(resolveNamespace(name));
					}
				}
				return Q.all(all).then(function () {
					return config;
				});
			}

			return resolveVariables().then(function () {
				return resolveFunctions();
			}).then(function () {

	//console.log("resolved", JSON.parse(configString));

				return JSON.parse(configString);
			}).then(function (config) {
				return resolveNamespaces(config);
			});
		}

		return new Config(config.$id, config);
	}

	ProgramDescriptor.prototype.resolvePath = function () {
		return PATH.join.apply(null, [this._path, ".."].concat(Array.prototype.slice.call(arguments)));
	}

	ProgramDescriptor.prototype.getBootPackagePath = function () {
		if (
			!this._data.boot ||
			!this._data.boot.package
		) {
	//		console.error("this._data", this._data);
			throw new Error("No 'boot.package' declared in program descriptor '" + this._path + "'!");
		}
		var descriptorPath = this.resolvePath(this._data.boot.package);
		return PATH.dirname(descriptorPath);
	}

	ProgramDescriptor.prototype.getBootPackageDescriptor = function () {
		var self = this;
		return Q.fcall(function () {
			return Q.denodeify(PACKAGE.fromFile)(PATH.join(self.getBootPackagePath(), "package.json"));
		});
	}

	return {
		ProgramDescriptor: ProgramDescriptor
	};
}


const Q = require("q");
const JSONPATH = require("JSONPath");


exports.for = function (API) {

	var exports = {};

	exports.findImplementationForNamespace = function (name) {

		function findPackageSourceInfo (name) {
			var nameParts = name.split("/");
			var packageSourceInfo = null;
			var path = null;
			if (
				nameParts.length === 3 &&
				// TODO: Try and match major versioned package using 'nameParts[2]'.
				(path = API.PATH.join(API.getRootPath(), "../node_modules", nameParts[0])) && 
				API.FS.existsSync(path)
			) {
				packageSourceInfo = {
					path: path,
					api: nameParts[1]
				};
			} else
			if (
				(path = API.PATH.join(API.getPackagesDirpath(), name.replace(/\//g, "~") + "/source/installed/master")) &&
				API.FS.existsSync(path)
			) {
				packageSourceInfo = {
					path: path
				};
			}
			return packageSourceInfo;
		}

		var packageSourceInfo = findPackageSourceInfo(name);
		if (!packageSourceInfo) {
			// TODO: Dynamically download plugins.
			console.error("name", name);
			var err = new Error("Plugin '" + name + "' could not be found!");
			err.code = 404;
			return Q.reject(err);
		}

		var deferred = Q.defer();

		API.PACKAGE.fromFile(API.PATH.join(packageSourceInfo.path, "package.json"), function (err, pluginDescriptor) {
			if (err) return deferred.reject(err);
			pluginDescriptor = pluginDescriptor._data;

			var implPath = null;
			if (packageSourceInfo.api) {
				if (
					!pluginDescriptor.config ||
					!pluginDescriptor.config['org.pinf.genesis.lib/0'] ||
					!pluginDescriptor.config['org.pinf.genesis.lib/0'].api ||
					!pluginDescriptor.config['org.pinf.genesis.lib/0'].api.provides ||
					!pluginDescriptor.config['org.pinf.genesis.lib/0'].api.provides[packageSourceInfo.api]
				) {
					return deferred.reject(new Error("API '" + packageSourceInfo.api + "' not declared at 'config[org.pinf.genesis.lib/0].api[" + packageSourceInfo.api + "]' in package descriptor: " + API.PATH.join(packageSourceInfo.path, "package.json")));
				}
				implPath = API.PATH.join(packageSourceInfo.path, pluginDescriptor.config['org.pinf.genesis.lib/0'].api.provides[packageSourceInfo.api]);
			} else {
				implPath = API.PATH.join(packageSourceInfo.path, pluginDescriptor.main || "");
			}

			return deferred.resolve(implPath);
		});
		return deferred.promise;
	}

	exports.instanciateImplementations = function (restingConfig, groupConfig) {

		var liveConfig = API.EXTEND(false, {}, restingConfig);

		var match = JSONPATH({
			json: liveConfig,
			path: "$..@impl",
			resultType: 'all'
		});

		if (match.length === 0) {
			return Q.resolve(restingConfig);
		}

		return Q.all(match.map(function(match) {

			return Q.fcall(function () {

				if (typeof match.parent[match.parentProperty] !== "string") {
					return exports.unfreezeConfig(match.parent[match.parentProperty]).then(function (config) {
						API.EXTEND(false, match.parent[match.parentProperty], config);
					});
				}

				match.parent[match.parentProperty] = {};

				var config = {};
				config[match.value] = {};

				return exports.instanciateConfig(config, groupConfig).then(function (config) {

					API.EXTEND(false, match.parent[match.parentProperty], config);

				});

			}).fail(function (err) {
				if (err.code === 404) {
					API.console.warn("WARNING: " + err.stack);
					return;
				}
				throw err;
			});

		})).then(function () {
			return liveConfig;
		});
	}

	exports.instanciateComponentAt = function (config, name, implPath, groupConfig) {
		return Q.fcall(function () {

			// POLICY: An 'Implementation' is executable 'Source Logic'
			var impl = require(implPath);

			if (typeof impl.for !== "function") {
				// POLICY: A 'Module' is an instanciated 'Implementation'.
				throw new Error("Module for '" + implPath + "' must export 'for' function!");
			}

			return Q.when(impl.for(API)).then(function (component) {

				// TODO: Use schema to optionally validate 'component' api.
				if (typeof component.PLComponent !== "function") {
					// POLICY: A 'Component' is a contextualized 'Module'.
					throw new Error("Component at '" + implPath + "' must export 'PLComponent' function!");
				}

				return exports.instanciateImplementations(config[name], groupConfig).then(function (liveConfig) {

					return Q.when(component.PLComponent(liveConfig, groupConfig)).then(function (components) {

						API.EXTEND(false, config, components);

						// Only delete declared config, not instanciated object.
						if (!/^\$/.test(name)) {
							delete config[name];
						}
					});
				});
			});

		}).then(function () {
			return config;
		});
	}

	exports.instanciateConfig = function (config, groupConfig) {
		var done = Q.resolve();
		// TODO: Load dependency rules from descriptors and resolve in correct order
		//       vs relying on declared JSON object order.
		Object.keys(config).forEach(function (name) {
			if (!/^[^\.\$]+\.[^\/]+\//.test(name)) return;
			done = Q.when(done, function () {
				return exports.findImplementationForNamespace(name).then(function (implPath) {
					return exports.instanciateComponentAt(config, name, implPath, groupConfig || config).then(function (_config) {
						config = _config;
					});
				});
			});
		});
		return done.then(function () {
			return config;
		});
	}

	exports.unfreezeConfig = function (config) {
		var done = Q.resolve();
		Object.keys(config).forEach(function (name) {
			if (!config[name].$PLComponent) return;
			done = Q.when(done, function () {
				return exports.findImplementationForNamespace(config[name].$PLComponent).then(function (implPath) {
					return exports.instanciateComponentAt(config, name, implPath, config).then(function (_config) {
						config = _config;
					});
				});
			});
		});
		return done.then(function () {
			return config;
		});

	}

	return exports;
}


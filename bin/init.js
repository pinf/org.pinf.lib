
require("require.async")(require);

const Q = require("q");


exports.for = function (module, init, implementation) {

	if (Array.isArray(module) && module[0] === module[1]) {
		module = module[0];
	}

    function augmentAPI (API, api) {
    	var _api = {};
    	Object.keys(api).forEach(function (name) {
    		var impl = api[name];
    		_api[name] = function () {
    			var pluginId = (API.getPluginUid && API.getPluginUid()) || API.PATH.basename(API.___program_root_path);
            	API.console.verbose("Call '" + name + "' on '" + pluginId + "' for:", API.getRootPath());
    			return impl.apply(api, Array.prototype.slice.call(arguments));
    		}
    	});
    	return _api;
    }

	return Q.when(require("../lib/_common").for(module, function (API, callback) {

		API.ASSERT.equal(typeof implementation.turn, "object", "'implementation.turn' must be set to a funciton!");
		API.ASSERT.equal(typeof implementation.spin, "object", "'implementation.spin' must be set to a funciton!");

		return init(API, function (err) {
			if (err) return callback(err);

			// Only run command parser if `module` is the only argument. i.e. when calling script
			// is the `require.main` module.
			if (Array.isArray(module)) {
				return callback();
			}

		    var program = new (API.COMMANDER.Command)();

		    program
		        .option("-v, --verbose", "Show verbose progress")
		        .option("-d, --debug", "Show debug output")
		        .option("--for <path>", "The program config context/id to turn towards")
		        .version(JSON.parse(API.FS.readFileSync(API.PATH.join(__dirname, "../package.json"))).version);

			function ensureProgramLoaded (API) {
				if (API.programDescriptor) {
					return API.Q.resolve(API);
				}
				return API.Q.denodeify(function (callback) {
					return API.loadProgramDescriptor(function (err, programDescriptor) {
						if (err) return callback(err);						
						API.programDescriptor = programDescriptor;
						return callback(null);
					});
				})().then(function () {
					return API;
				});
			}

			function forEachProgram (API, handler) {
				// TODO: Assemble promise chain based on depends order.
	        	return ensureProgramLoaded(API).then(function (api) {
					var done = API.Q.resolve();
	        		var config = api.programDescriptor.configForLocator(API.LOCATOR.fromUri("genesis.pinf.org"));
					API.console.debug("Using 'genesis.pinf.org' config from '" + api.programDescriptor._path + "':", config);
	        		if (config.programs) {
	        			Object.keys(config.programs).forEach(function (programId) {
	        				done = API.Q.when(done, function () {
	        					var locator = api.programDescriptor.locatorForDeclaration(config.programs[programId]);
        						return forEachProgram(api.sub(locator.getAbsolutePath(), {
									getDeclaringPathId: function () {
										return programId;
									},
									getDeclaringConfig: function () {
										return locator.getConfig();
									},
			                    	getRuntimeDescriptorPath: function () {
										return this.PATH.join(this.getDeclaringRootPath(), "..", this.getDeclaringPathId() || "", "program.rt.json");
			                    	}
        						}), handler);
	        				});
	        			});
	        		}
	        		return API.Q.when(done, function () {
	        			if (!api.programDescriptor.isBootable()) {
	        				return;
	        			}
				        return API.Q.when(handler(api));
	        		});
	        	});
			}

		    function init (api, impl) {
		    	try {
			        return API.Q.when(impl.for(api));
			    } catch (err) {
			    	console.error("Error", err.stack);
			    	return API.Q.reject(err);
			    }
		    }

		    function actor (action, impl, wire, callback) {
		        return function () {
		        	API.VERBOSE = program.debug || program.verbose || false;
		        	API.DEBUG = program.debug || false;
		            if (!program.for) {
		                return callback("ERROR: '--for <path>' not set!");
		            }
                	var forPath = API.PATH.normalize(program.for);
		            if (!API.FS.existsSync(forPath)) {
		                return callback("ERROR: '--for " + forPath + "' path not found!");
		            }

            		// TODO: Load and parse plugin descriptor using pinf-it-package-insight.
                	var pluginDescriptor = require(API.PATH.join(forPath, "package.json"));

		            API.runPlugin = function () {
		            	var self = this;

	                	var resolvedConfig = {};

		                return self.Q.denodeify(function (callback) {

							function locate (uri, callback) {

								// TODO: Use configurable lookup path.
								// TODO: Dynamically download plugins.

								var uriParts = uri.split("/");
								var path = forPath.replace(pluginDescriptor.name, uriParts[uriParts.length-2]);
								return API.FS.exists(path, function (exists) {
									if (!exists) {
										return callback(new Error("Plugin not found at located path '" + path + "'!"));
									}
									return callback(null, path);
								});
							}

		                	var plugins = {};
		                	function loadAndRunPlugins (locator, callback) {
			                	var parsedConfig = self.programDescriptor.parsedConfigForLocator(locator);
								
								if (plugins[parsedConfig.id]) {
									return callback(new Error("Plugin '" + parsedConfig.id + "' is already loaded! There must be a circular dependency!"));
								}
								plugins[parsedConfig.id] = true;

								function load (callback) {
									return locate(parsedConfig.id, function (err, path) {
										if (err) return callback(err);

					                	self.console.verbose("Load plugin:", path);

			                    		// TODO: Load and parse plugin descriptor using pinf-it-package-insight.
					                	var pluginDescriptor = require(self.PATH.join(path, "package.json"));

					                    return require.async(path, function (plugin) {
						                	self.console.debug("Plugin loaded:", path);
									    	try {
									    		var API = self.sub(null, {
							                    	getPluginUid: function () {
							                    		if (!pluginDescriptor.uid) {
							                    			throw new Error("Plugin descriptor '" + self.PATH.join(path, "package.json") + "' does not declare 'uid'!");
							                    		}
							                    		return pluginDescriptor.uid;
							                    	}
							                    });
												var api = plugin.for(API);
							                	api = augmentAPI(API, api);

												function run (api, callback) {

													parsedConfig.setResolved(resolvedConfig);

													function prepare (config) {
														function makeConfigHash (config) {
															// TODO: Use sorted JSON.
															var configHash = JSON.stringify(config);//API.CRYPTO.createHash("sha1").update(JSON.stringify(config)).digest("hex");
															return configHash;
														}
														var configHashPath = API.PATH.join(API.getTargetPath(), ".pinf.config.hash");
														var configHash = makeConfigHash(config);

														return Q.denodeify(function (callback) {

															function remove (reason, callback) {
																return API.FS.exists(API.getTargetPath(), function (exists) {
																	if (!exists) {
																		// Nothing to remove because it does not yet exit.
																		return callback(null);
																	}
																	API.console.verbose("Removing '" + API.getTargetPath() + "' due to " + reason + "!");
																	return API.FS.remove(API.getTargetPath(), callback);
																});
															}

															return API.FS.exists(configHashPath, function (exists) {
																if (!exists) {
																	if (action !== "turn") {
																		return callback(new Error("Must turn '" + API.getTargetPath() + "' before you can '" + action + "' it!"));
																	}
																	return remove("previous config hash not found", callback);
																}
																return API.FS.readFile(configHashPath, "utf8", function (err, previousConfigHash) {
																	if (err) return callback(err);
																	if (configHash === previousConfigHash) {
																		return callback(null);
																	}
																	return remove("config hash having changed from '" + previousConfigHash + "' to '" + configHash, callback);
																});
															});
														})().then(function () {
															return function (config, callback) {
																return API.FS.outputFile(configHashPath, makeConfigHash(config), "utf8", callback);
															};
														});
													}

													// Call `turn`, `spin` and others (determined by `action`) on
													// plugin that has already been initialized with `for(API)`.

													var worker = null;
													var alias = null;
													var config = parsedConfig;
													if (action !== "turn") {
														var runtimeDescriptor = require(API.getRuntimeDescriptorPath());
														config = null;
														for (alias in runtimeDescriptor) {
															if (runtimeDescriptor[alias].$context === pluginDescriptor.uid) {
																config = runtimeDescriptor[alias];
																break;			
															}
														}
														if (!config) {
															return callback(new Error("Runtime config for context/id '" + pluginDescriptor.uid + "' not found!"));
														}
													}
													return prepare(config).then(function (writeHash) {
														return Q.when(api[action](config)).then(function (result) {
															if (action === "turn") {
																if (result) {
																	config = result;
																	resolvedConfig[result.$to] = result;
																	// TODO: Make this a proper JSON-LD context.
																	result.$context = pluginDescriptor.uid;

																	self.console.debug("Plugin result for '" + path + "':", JSON.stringify(result, null, 4));
																} else {
																	throw new Error("Plugin '" + path + "' did not return its resolved configuration!");
																}
															} else {
																resolvedConfig[alias] = config;
															}
															return writeHash(config, function (err) {
																if (err) return callback(err);
										                        return callback(null, api);
															});
														});
													}).fail(callback);
												}

												return run(api, callback);

						                    } catch (err) {
						                    	return callback(err);
						                    }
					                    }, callback);
									});
								}

			                	if (Object.keys(parsedConfig.depends).length === 0) {
			                		return load(callback);
			                	}
			                	var waitfor = self.WAITFOR.serial(function (err) {
			                		if (err) return callback(err);
			                		return load(callback);
			                	});
			                	for (var name in parsedConfig.depends) {
			                		waitfor(self.LOCATOR.fromConfigDepends(name), function (locator, callback) {
			                			return loadAndRunPlugins(locator, callback);
			                		});
			                	}
			                	return waitfor();
		                	}
							return loadAndRunPlugins(self.LOCATOR.fromUid(pluginDescriptor.uid), callback);
		                })().then(function () {

							function writeRuntimeConfig () {
								var path = self.getRuntimeDescriptorPath();
								self.console.verbose("Writing runtime configuration to:", path);
								return self.Q.denodeify(self.FS.outputFile)(path, JSON.stringify(resolvedConfig, null, 4), "utf8");
							}

							return writeRuntimeConfig();
		                });
		            }
		            actor.acted = true;
		            return forEachProgram(API, function (api) {
			            return init(api, impl).then(function (_api) {
		                	API.console.verbose("Turn towards:", pluginDescriptor.uid);
		                	api = augmentAPI(api, _api);
			                return wire(_api).then(function () {
			                    return callback();
			                });
			            });
		            }).fail(callback);
		        };
		    }

		    program
		        .command("turn")
		        .description("Take a PINF-compatible program and transform it to a PINF distribution bundle.")
		        .action(actor("turn", implementation.turn, function (TURN) {
		            return TURN.turn();
		        }, callback));

		    program
		        .command("spin")
		        .description("Continuously turn on source change.")
		        .action(actor("spin", implementation.spin, function (SPIN) {
		            var deferred = API.Q.defer();
		            SPIN.on("error", function (err) {
		                return deferred.reject(err);
		            });
		            var turning = 0;
		            function triggerTurn () {
		            	var doTurn = (turning === 0);
		            	turning += 1;
		            	if (!doTurn) {
		            		console.log("Already turning! Schedule one more for when the current one is done.");
		            		return;
		            	}
		            	return actor("turn", implementation.turn, function (TURN) {
			                return TURN.turn();
			            }, function (err) {
			            	turning -= 1;
			            	if (err) {
			            		console.error("Error turning:", err.stack);
			            	} else {
			            		console.log("Done turning");
			            	}
			            	// If there are more turn triggers we reset them and trigger one more turn.
			            	if (turning > 0) {
			            		turning = 0;
			            		triggerTurn();
			            	}
			            })();
		            }
		            SPIN.on("turn", triggerTurn);
		            SPIN.on("end", function () {
		                return deferred.resolve();
		            });
		            return SPIN.spin().then(function () {
		                return deferred.promise;
		            });
		        }, callback));

		    program.parse(process.argv);

		    if (!actor.acted) {
		        var command = process.argv.slice(2).join(" ");
		        if (command) {
		            console.error(("ERROR: Command '" + process.argv.slice(2).join(" ") + "' not found!").error);
		        }
		        program.outputHelp();
		        return callback(null);
		    }
		});

	})).then(function (API) {
		var api = {};
		for (var name in implementation) {
			api[name] = implementation[name].for(API)[name];
		}
    	api = augmentAPI(API, api);
		return api;
	});

}


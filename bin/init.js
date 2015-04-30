
require("require.async")(require);

const Q = require("q");

//const DEBUG = !!process.env.VERBOSE;
const DEBUG = false;


exports.for = function (module, init, implementation) {

	if (Array.isArray(module) && module[0] === module[1]) {
		module = module[0];
	}

    function augmentAPI (API, api) {
    	Object.keys(api).forEach(function (name) {
    		if (name !== "spin" && name !== "turn") {
    			return;
    		}
    		var impl = api[name];
    		api[name] = function () {
    			var pluginId = (API.getPluginName && API.getPluginName()) || API.PATH.basename(API.getRootPath());
            	API.console.verbose("Call '" + name + "' on '" + pluginId + "' for:", API.getRootPath());
    			return impl.apply(api, Array.prototype.slice.call(arguments));
    		}
    	});
    	return api;
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

		    	if (DEBUG) console.log("forEachProgram");

				// TODO: Assemble promise chain based on depends order.
	        	return ensureProgramLoaded(API).then(function (api) {

			    	if (DEBUG) console.log("forEachProgram - program loaded");

					var done = API.Q.resolve();
	        		var config = api.programDescriptor.configForLocator(API.LOCATOR.fromUid("genesis.pinf.org"));
					API.console.debug("Using program config from '" + api.programDescriptor._path + "'");
	        		if (config.programs) {
	        			Object.keys(config.programs).forEach(function (programId) {
	        				done = API.Q.when(done, function () {
	        					var locator = api.programDescriptor.locatorForDeclaration(config.programs[programId]);

				            	API.console.debug("#########################");
				            	API.console.debug("######################### SUB PROGRAM FOR: ", locator.getAbsolutePath());
				            	API.console.debug("#########################");

        						return forEachProgram(api.sub(locator.getAbsolutePath(), {
									getDeclaringPathId: function () {
										return programId;
									},
									getDeclaringConfig: function () {
										return locator.getConfig();
									},
			                    	getRuntimeDescriptorPath: function () {
										return this.PATH.join(this.getDeclaringRootPath(), "..", this.getDeclaringPathId() || "", "program.rt.json");
			                    	},
			                    	getBootConfigId: function () {
			                    		if (
			                    			!this.programDescriptor._data.boot ||
			                    			!this.programDescriptor._data.boot.config
			                    		) {
			                    			throw new Error("Property 'boot.config' not set in descriptor: " + API.getRootPath());
			                    		}
			                    		return this.programDescriptor._data.boot.config;
			                    	},
			                    	getPluginUid: function () {
/*
if (!descriptor || !descriptor.uid) {
throw new Error("getPluginUid - no descriptor");			                    		

}	
*/
throw new Error("getPluginUid STOP");
			                    		return (
			                    			locator.getConfig() &&
			                    			locator.getConfig()["genesis.pinf.org/0"] &&
			                    			locator.getConfig()["genesis.pinf.org/0"].for
			                    		) || API.getPluginUid();
			                    	}
        						}), handler).then(function () {

					            	API.console.debug("#########################");
					            	API.console.debug("######################### SUB PROGRAM DONE FOR: ", locator.getAbsolutePath());
					            	API.console.debug("#########################");

        						});
	        				});
	        			});
	        		}
	        		return API.Q.when(done, function () {
	        			if (!api.programDescriptor.isBootable()) {

			            	API.console.debug("Skip execute of '" + api.getRootPath() + "' as it is not bootable!");

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

			    	if (DEBUG) console.log("VERBOSE: " + API.VERBOSE);
			    	if (DEBUG) console.log("DEBUG: " + API.DEBUG);

			    			if (API.DEBUG) {
			    				Q.longStackSupport = true;
			    			}

		            if (!program.for) {
		                return callback("ERROR: '--for <path>' not set!");
		            }
                	var forPath = API.PATH.normalize(program.for);
		            if (!API.FS.existsSync(forPath)) {
		                return callback("ERROR: '--for " + forPath + "' path not found!");
		            }

		            actor.acted = true;

                	return API.PACKAGE.fromFile(API.PATH.join(forPath, "package.json"), function (err, _pluginDescriptor) {
                		if (err) return callback(err);

                		var pluginDescriptor = _pluginDescriptor._data;

				    	if (DEBUG) console.log("UID: " + pluginDescriptor.uid);

	                	if (!pluginDescriptor.uid) {
			                return callback(new Error("'uid' property not set for plugin descriptor: " + API.PATH.join(forPath, "package.json")));
	                	}

	                	pluginDescriptor.name = pluginDescriptor.name || API.PATH.basename(API.PATH.dirname(_pluginDescriptor._path));

										API.getBootConfigId = function () {
											if (
												!this.programDescriptor._data ||
												!this.programDescriptor._data.boot ||
												!this.programDescriptor._data.boot.config
											) {
												throw new Error("No 'boot.config' property set in '" + this.getRootPath() + "'!");
											}
											return this.programDescriptor._data.boot.config;
										}

	                	API.getPluginName = function () {
	                		return pluginDescriptor.name || pluginDescriptor.uid.replace(/\//, "~");
	                	}

	                	API.getPluginUid = function () {
	                		return pluginDescriptor.uid;
	                	}

			            API.runFor = function () {
			            	var self = this;

					    			if (DEBUG) console.log("FOR");

	                	var resolvedConfig = {};

		                return self.Q.denodeify(function (callback) {

		                	function loadRuntimeDescriptor (callback) {
		                		var runtimeDescriptorPath = self.getRuntimeDescriptorPath();
		                		return API.FS.exists(runtimeDescriptorPath, function (exists) {
		                			if (!exists) return callback(null, {});
													API.console.debug("Load runtime descriptor from '" + runtimeDescriptorPath + "'");
		                			return API.FS.readJson(runtimeDescriptorPath, callback);
		                		});
		                	}

		                	return loadRuntimeDescriptor(function (err, runtimeDescriptor) {
		                		if (err) return callback(err);

                	var plugins = {};
                	function loadAndRunPlugins (locator, history, callback) {

									  // TODO: Move this into 'org.pinf.to/lib/vortex-wrapper.js'

	                	var parsedConfig = self.programDescriptor.parsedConfigForLocator(locator);

	                	if (!parsedConfig) {
	                		console.log("self.programDescriptor", self.programDescriptor);
	                		return callback(new Error("Error getting parsed config for locator: " + JSON.stringify(locator)));
	                	}

										parsedConfig.setResolved(resolvedConfig);

										if (plugins[parsedConfig.id]) {
											if (history.length > 50) {
												console.error("history", history);
												return callback(new Error("Plugin '" + parsedConfig.id + "' is already loaded! There must be a circular dependency!"));
											}
											return callback(null);
										}
										plugins[parsedConfig.id] = true;

										function load (_callback) {

		                	var callback = function (err) {
												if (err) {
													err.message += " (at node '" + parsedConfig.id + "')";
													err.stack += "\n(at node '" + parsedConfig.id + "')";
												}
												return _callback.apply(null, arguments);
		                	}

											function initNode (descriptor, exports, callback) {

								    		var API = self.sub(null, {
											    getTargetPath: function () {
														return this.PATH.join(this.getPinfDirpath(), parsedConfig.id.replace(/\//g, "~"));
											    },
		                    	getNodeAlias: function () {
		                    		return parsedConfig.config.$to || null;
		                    	},
		                    	getNodeId: function () {
		                    		return parsedConfig.id;
		                    	},
		                    	getPluginUid: function () {
throw new Error("getPluginUid");			                    		
if (!descriptor || !descriptor.uid) {
console.log("parsedConfig", parsedConfig);
throw new Error("getPluginUid - no descriptor");			                    		
}							                    		
		                    		return descriptor.uid;
		                    	},
		                    	setFileTreeUsedFor: function (resolvedConfig, path, options) {
		                    		var self = this;
														return API.Q.nbind(self.getFileTreeInfoFor, self)(path, options).then(function (info) {
															// TODO: This must follow directory conventions for where aspect files are stored!
															//       Make configurable so it can also point to '.pinf/github.com~pinf~org.pinf.lib~0' etc ...
															if (!resolvedConfig[".pinf.genesis.pinf.org~0"]) {
																resolvedConfig[".pinf.genesis.pinf.org~0"] = {};
															}
															// TODO: Optionally add more info from 'info' to config.
															resolvedConfig[".pinf.genesis.pinf.org~0"]["usedPaths"] = info.paths;
															return resolvedConfig;
														});
		                    	},
		                    	// TODO: Access to these methods must be policed by a security layer
		                    	//       that manages communication and access between components.
		                    	POLICIFY_getUsedPaths: function () {
		                    		return API.Q.fcall(function () {
		                    			var paths = {};
		                    			for (var configId in resolvedConfig) {
		                    				if (
																	resolvedConfig[configId][".pinf.genesis.pinf.org~0"] &&
																	resolvedConfig[configId][".pinf.genesis.pinf.org~0"]["usedPaths"]
		                    				) {
			                    				paths[configId] = resolvedConfig[configId][".pinf.genesis.pinf.org~0"]["usedPaths"];
		                    				}
		                    			}
		                    			return paths;
		                    		});
		                    	}
		                    });

												function contextualizeExports (exports, API, callback) {
													if (!exports) {
														return callback(null, null);
													}
													try {

														if (!(exports.for || exports.main)) {
															throw new Error("Module for '" + parsedConfig.id + "' does not export 'main(API)' nor 'for(API)'!");
														}

														var api = (exports.for || exports.main)(API);
//									        api = augmentAPI(API, api);
					                	return callback(null, api);
			                    } catch (err) {
			                    	return callback(err);
			                    }
												}

												return contextualizeExports(exports, API, function (err, api) {
													if (err) return callback(err);

													// Run the given action on the node.
										    														
													function resolve (config) {

														var configHashPath = API.PATH.join(API.getTargetPath(), ".pinf.config.hash");

														// NOTE: We ALWAYS resolve the config on every turn.
														//       Each module should cache its responses on subsequent
														//       calls if nothing has changed in the input!
														var defaultResolve = function (resolver, config, previousResolvedConfig) {
											        API.console.verbose("Call default resolver for:", API.getRootPath());
															return resolver({});
														}
														var resolver = function (resolverApi) {
								            	API.console.debug("Resolve config using API:", resolverApi);
															return config.resolve(resolverApi).fail(function (err) {
																err.message += " (while resolving parsed config using resolverApi for node '" + parsedConfig.id + "')";
																err.stack += "\n(while resolving parsed config using resolverApi for node '" + parsedConfig.id + "')";
																throw err;
															});
														}
														var previousResolvedSectionConfig = null;
														for (alias in runtimeDescriptor) {
															if (runtimeDescriptor[alias].$context === API.getNodeId()) {
																previousResolvedSectionConfig = runtimeDescriptor[alias];
																break;			
															}
														}

//																	API.console.debug("Previous resolved config for '" + API.getTargetPath() + "':", previousResolvedSectionConfig);

														if (!api) {
															API.console.debug("No plugin code loaded for '" + parsedConfig.id + "'!", parsedConfig);
														}

							            	API.console.verbose("Call resolve() on '" + parsedConfig.id + "' for:", API.getRootPath());

														return API.Q.when((api && api.resolve && api.resolve(resolver, config, previousResolvedSectionConfig)) || defaultResolve(resolver, config, previousResolvedSectionConfig)).then(function (resolvedSectionConfig) {

															var changed = true;

															// TODO: Make this a proper JSON-LD context.
															resolvedSectionConfig.$context = API.getNodeId();

															// TODO: Use sorted JSON.
//															var configHash = API.CRYPTO.createHash("sha1").update(JSON.stringify(config)).digest("hex");
															var previousConfigHash = JSON.stringify(previousResolvedSectionConfig, null, 4);
															var configHash = JSON.stringify(resolvedSectionConfig, null, 4);

//																		API.console.debug("New resolved config for '" + API.getTargetPath() + "':", resolvedSectionConfig);

															return Q.denodeify(function (callback) {

																function remove (reason, callback) {
																	return API.FS.exists(API.getTargetPath(), function (exists) {
																		if (!exists) {
																			// Nothing to remove because it does not yet exit.
																			return callback(null);
																		}
																		API.console.debug("Removing '" + API.getTargetPath() + "' due to " + reason + "!");
																		return API.FS.remove(API.getTargetPath(), callback);
																	});
																}

																if (configHash === previousConfigHash) {
																	changed = false;

																	API.console.debug("Resolved config for '" + API.getTargetPath() + "' has not changed!");
																	return callback(null);
																}
																return remove("config hash having changed from '" + previousConfigHash + "' to '" + configHash, callback);
//																return remove("config hash having changed", callback);

															})().then(function () {

																resolvedConfig[resolvedSectionConfig.$to] = resolvedSectionConfig;

																return API.Q.denodeify(API.FS.outputFile)(configHashPath, configHash, "utf8");
															}).then(function () {

																API.console.debug("Resolved config changed: " + changed);

																if (!changed) {
																	if (action === "turn") {
																		if (!API.FS.existsSync(API.PATH.join(API.getTargetPath(), ".pinf.turn.done"))) {
																			changed = true;
																		}
																	}
																}

																return [resolvedSectionConfig, changed];
															});
														});
													}

													return resolve(parsedConfig).fail(function (err) {
														err.message += " (while resolving parsed config for node '" + parsedConfig.id + "')";
														err.stack += "\n(while resolving parsed config for node '" + parsedConfig.id + "')";
														throw err;
													}).then(function (resolvedInfo) {

														var resolvedSectionConfig = resolvedInfo[0];
														var changed = resolvedInfo[1];

														function runAction (action) {

															function run () {
																return Q.fcall(function () {
																	if (!api) {
																		if (!parsedConfig.config.$impl) {
																			// Method not implemented by node which is ok.
																			API.console.verbose("Skip call " + action + "() on '" + parsedConfig.id + "' as no code loaded! (due to $impl not set)");
																			return;
																		}
												            console.log("locator", locator);
												            console.log("parsedConfig", parsedConfig);
												            console.log("resolvedSectionConfig", resolvedSectionConfig);
												            throw new Error("No code loaded for '" + parsedConfig.id + "'. i.e. source code not found! This must be fixed or set '$impl: null'");
																	}
																	if (!api[action]) {
																		// Method not implemented by node which is ok.
														            	API.console.verbose("Skip call " + action + "() on '" + parsedConfig.id + "' as not implemented in loaded code module");
																		return;
																	}
													            	API.console.verbose("Call " + action + "() on '" + parsedConfig.id + "' for:", API.getRootPath());
																	// Call `turn`, `spin` and others (determined by `action`) on
																	// plugin that has already been initialized with `for(API)`.
																	return api[action](resolvedSectionConfig);
																}).fail(function (err) {

																	console.log("Fail and rename", err.stack);

																	return API.Q.denodeify(API.FS.move)((API.getTargetPath(), API.PATH.join(API.getTargetPath() + ".failed." + Date.now()))).fin(function () {
																		throw err;
																	});
																});
															}

															if (action === "turn") {

																if (!changed) {
																	API.console.debug("Skip running of '" + action + "' on '" + parsedConfig.id + "' as config has not changed!");
																	return;
																}

																function updateRuntimeConfig () {
																	var path = self.getRuntimeDescriptorPath();
																	self.console.verbose("Updating runtime configuration to:", path);
																	runtimeDescriptor[resolvedSectionConfig.$to] = resolvedSectionConfig;
																	return self.Q.denodeify(self.FS.outputFile)(path, JSON.stringify(runtimeDescriptor, null, 4), "utf8");
																}

																return updateRuntimeConfig().then(function () {
																	return run();
																}).then(function () {
																	return self.Q.denodeify(self.FS.outputFile)(API.PATH.join(API.getTargetPath(), ".pinf.turn.done"), "", "utf8");
																});
															} else
															if (action === "spin") {

																function ensureTurned () {
																	if (!changed) return self.Q.resolve();

																	API.console.verbose("Need to call turn before we can spin as config has changed.");

																	return runAction("turn");
																}

																return ensureTurned().then(function () {
																	return run();
																});
															}
														}

														return runAction(action);

													}).then(function () {
														return callback();
													}).fail(callback);
												});
											}

											function locate (uri, callback) {

												function getImpl(callback) {
													// TODO: Only resolve `{{$from.}}` in `$impl` variable. Everything else will get resolved later.
													return parsedConfig.resolve(null).then(function (resolvedConfig) {
														return callback(null, resolvedConfig.$impl);
													}).fail(callback);
												}

												return getImpl(function (err, implUri) {
													if (err) return callback(err);

													// 1) If the module acting as the node is declared we always go by that.
													if (implUri) {
														if (/^\//.test(implUri)) {

															return API.FS.exists(implUri, function (exists) {
																if (!exists) {
																	return callback(new Error("Node implementation $impl: '" + implUri + "' not found!"));
																}
																return callback(null, implUri);
/*
																return API.findPackageRoot(implUri, function (err, implPackageRootPath) {
																	if (err) return callback(err);
																	return callback(null, implPackageRootPath);
																});
*/
															});
														}
														return callback(new Error("'$impl' value of '" + implUri + "' not supported!"));
													}
/*
													function getBootPackageDescriptor (callback) {
														return self.programDescriptor.getBootPackageDescriptor().then(function (bootPackageDescriptor) {
															return callback(null, bootPackageDescriptor._data);
														}).fail(function (err) {
															// If this errors out we ignore and assume there is not boot 
															console.error("parsedConfig", parsedConfig);
															return callback(err);
														});
													} 

													return getBootPackageDescriptor(function (err, bootPackageDescriptor) {
														if (err) return callback(err);

														if (bootPackageDescriptor.uid === self.LOCATOR.fromConfigId(uri).getUid()) {
															return callback(null, self.programDescriptor.getBootPackagePath());
														}
*/

													// 2) Since no implementing module is declared we lookup the package based on the
													//    config uri in our packages and look for the main module in the package.

														var packageSourcePath = self.PATH.join(self.getPackagesDirpath(), uri.replace(/\//g, "~") + "/source/vcs/master");

														return API.FS.exists(packageSourcePath, function (exists) {
															if (!exists) {

																// TODO: Dynamically download plugins.

																var err = new Error("Plugin '" + uri + "' could not be found at '" + packageSourcePath + "'!");
																err.code = 404;
																return callback(err);
															}

						                	return API.PACKAGE.fromFile(self.PATH.join(packageSourcePath, "package.json"), function (err, pluginDescriptor) {
						                		if (err) return callback(err);

					                			pluginDescriptor = pluginDescriptor._data;

//				                    		if (!pluginDescriptor.uid) {
//				                    			return callback(new Error("Plugin descriptor '" + self.PATH.join(packageSourcePath, "package.json") + "' does not declare 'uid'!"));
//				                    		}

																var mainPath = self.PATH.join(packageSourcePath, pluginDescriptor.main || "");

																return callback(null, mainPath);
						                	});
														});

//													}).fail(callback);
												});
											}

											return locate(parsedConfig.id, function (err, implPath) {
												if (err) {
													if (err.code === 404) {
														// We simulate the node as there is no code.
														return initNode(null, null, callback);
													}
													return callback(err);
												}

			                	self.console.verbose("Load node:", implPath);

		                    return require.async(implPath, function (plugin) {
			                	
				                	self.console.debug("Node loaded:", implPath);

				                	return initNode(pluginDescriptor, plugin, callback);
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
	                			return loadAndRunPlugins(locator, history.concat(name), callback);
	                		});
	                	}
	                	return waitfor();
                	}
									return loadAndRunPlugins(self.LOCATOR.fromConfigId(self.getBootConfigId()), [self.getBootConfigId()], function (err) {
										if (err) {
											err.message += " (for locater fromUid '" + self.getBootConfigId() + "')";
											err.stack += "\n(for locater fromUid '" + self.getBootConfigId() + "')";
										}
										return callback(err);
									});
              	});
              })().then(function () {

								function writeRuntimeConfig () {
									var path = self.getRuntimeDescriptorPath();
									self.console.verbose("Writing runtime configuration to:", path);
									return self.Q.denodeify(self.FS.outputFile)(path, JSON.stringify(resolvedConfig, null, 4), "utf8");
								}

								return writeRuntimeConfig();
			                });
			            }
			            return forEachProgram(API, function (API) {

				            return init(API, impl).then(function (api) {

			                	API.console.verbose("Turn towards:", API.getBootConfigId());

			                	api = augmentAPI(API, api);

				                return wire(api).then(function () {

				                	return API.runFor();
				                });
				            }).then(function () {

			                	API.console.verbose("Turned towards:", API.getBootConfigId());
		                	});
			            }).then(function() {
			            	return callback(null);
			            }).fail(callback);
			        });
		        };
		    }

		    program
		        .command("turn")
		        .description("Take a PINF-compatible program and transform it to a PINF distribution bundle.")
		        .action(actor("turn", implementation.turn, function (TURN) {
		            return API.Q.fcall(function () {
		            	return TURN.turn();
		            });
		        }, callback));

            var turning = 0;

		    program
		        .command("spin")
		        .description("Continuously turn on source change.")
		        .action(actor("spin", implementation.spin, function (SPIN) {

		            var deferred = API.Q.defer();
		            SPIN.on("error", function (err) {
		                return deferred.reject(err);
		            });
		            function triggerTurn (changed) {

						// TODO: Instead of turning from beginning, turn from `changed`.

//console.log("TURN FROM CHANGED!", changed, turning);

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

//console.log("DONE TURN FROM CHANGED!", changed, turning);

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
		            API.Q.fcall(function () {
		            	return SPIN.spin();
		            }).then(deferred.resolve).fail(deferred.reject);
			        return deferred.promise;
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


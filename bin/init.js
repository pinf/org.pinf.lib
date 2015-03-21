
require("require.async")(require);

const Q = require("q");


exports.for = function (module, init, implementation) {

	if (Array.isArray(module) && module[0] === module[1]) {
		module = module[0];
	}

    function augmentAPI (API, api) {
    	Object.keys(api).forEach(function (name) {
    		var impl = api[name];
    		api[name] = function () {
            	API.console.verbose("Call '" + name + "' on '" + API.PATH.basename(API.___program_root_path) + "' for:", API.getRootPath());
    			return impl.apply(api, Array.prototype.slice.call(arguments));
    		}
    	});
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
		        .option("--plugin <path>", "The plugin to run to do the actual work")
		        .version(JSON.parse(API.FS.readFileSync(API.PATH.join(__dirname, "../package.json"))).version);

			function ensureProgramLoaded (API) {
				if (API.programDescriptor) {
					return API.Q.resolve();
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
	        				return API.Q.when(done, function () {
	        					var locator = api.programDescriptor.locatorForDeclaration(config.programs[programId]);
        						return forEachProgram(API.sub(locator.getAbsolutePath()), handler);
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
		        return API.Q.when(impl.for(api));
		    }

		    function actor (impl, wire, callback) {
		        return function () {
		        	API.VERBOSE = program.debug || program.verbose || false;
		        	API.DEBUG = program.debug || false;
		            if (!program.plugin) {
		                return callback("ERROR: '--plugin <path>' not set!");
		            }
		            if (!API.FS.existsSync(program.plugin)) {
		                return callback("ERROR: '--plugin " + program.plugin + "' path not found!");
		            }
		            API.loadPlugin = function () {
		                return API.Q.denodeify(function (callback) {
		                	API.console.verbose("Load plugin:", program.plugin);
		                    require.async(program.plugin, function (api) {
		                        return callback(null, api);
		                    });
		                })();
		            }
		            actor.acted = true;
		            return forEachProgram(API, function (api) {
			            return init(api, impl).then(function (_api) {
		                	API.console.verbose("Wire actor:", program.plugin);
		                	augmentAPI(api, _api);
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
		        .action(actor(implementation.turn, function (TURN) {
		            return TURN.turn();
		        }, callback));

		    program
		        .command("spin")
		        .description("Continuously turn on source change.")
		        .action(actor(implementation.spin, function (SPIN) {
		            var deferred = API.Q.defer();
		            SPIN.on("error", function (err) {
		                return deferred.reject(err);
		            });
		            SPIN.on("turn", init(implementation.turn).then(function (TURN) {
		                return TURN.turn();
		            }));
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
    	augmentAPI(API, api);
		return api;
	});

}


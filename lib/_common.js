
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs-extra");
const PINF_MAIN = require("pinf-for-nodejs/lib/main");
const SPAWN = require("child_process").spawn;
const WAITFOR = require("waitfor");
const PROGRAM_INSIGHT = require("pinf-it-program-insight");
const Q = require("q");
const WINSTON = require("winston");

const PROGRAM = require("./program");
const PACKAGE = require("./package");


exports.for = function (module, implementation) {

	function findPackageRoot (path, callback) {
		if (FS.existsSync(PATH.join(path, "package.json"))) {
			return callback(null, path);
		} else
		if (FS.existsSync(PATH.join(path, ".git"))) {
			return callback(null, path);
		}
		var newPath = PATH.dirname(path);
		if (newPath === path) {
			return callback(new Error("No package root found!"));
		}
		return findPackageRoot(newPath, callback);
	}

	if (Array.isArray(module)) {

		var deferred = Q.defer();
		try {
			var API = module[0];
			implementation(API, function (err) {
				if (err) return deferred.reject(err);
				return findPackageRoot(module[1].filename, function(err, ___program_root_path) {
					if (err) return deferred.reject(err);
					API.___program_root_path = ___program_root_path;
					return deferred.resolve(API);
				});
			});
		} catch (err) {
			deferred.reject(err);
		}
		return deferred.promise;

	} else {

		// If we get here it will init the whole environment and
		// not return the `deferred` at all!

		return PINF_MAIN.main(function (options, callback) {

			function initLogger (callback) {
				var logger = new (WINSTON.Logger)({
					transports: [
						// @see https://github.com/winstonjs/winston#console-transport
						new (WINSTON.transports.Console)({
							colorize: true,
							prettyPrint: true,
							depth: 2
						})
					]
				});
				return callback(null, logger);
			}

			return initLogger(function (err, logger) {
				if (err) return callback(err);

				function findProgramRoot (path, callback) {
					if (FS.existsSync(PATH.join(path, "program.json"))) {
						return callback(null, path);
					} else
					if (FS.existsSync(PATH.join(path, ".git"))) {
						return callback(null, path);
					}
					var newPath = PATH.dirname(path);
					if (newPath === path) {
						return callback(new Error("No program root found!"));
					}
					return findProgramRoot(newPath, callback);
				}

				return findProgramRoot(process.cwd(), function (err, rootPath) {
					if (err) return callback(err);

					function runCommands (commands, options, callback) {
						if (typeof options === "function" && typeof callback === "undefined") {
							callback = options;
							options = {};
						}
						options = options || {};
						options.cwd = options.cwd || rootPath;
	                	API.console.verbose("Run commands:", commands, {
	                		cwd: options.cwd
	                	});
					    var proc = SPAWN("bash", [
					        "-s"
					    ], {
					    	cwd: options.cwd
					    });
					    proc.on("error", function(err) {
					    	return callback(err);
					    });
					    var stdout = [];
					    var stderr = [];
					    proc.stdout.on('data', function (data) {
					    	stdout.push(data.toString());
							return process.stdout.write(data);
					    });
					    proc.stderr.on('data', function (data) {
					    	stderr.push(data.toString());
							return process.stderr.write(data);
					    });
					    proc.stdin.write(commands.join("\n"));
					    proc.stdin.end();
					    return proc.on('close', function (code) {
					    	if (code) {
					    		var err = new Error("Commands exited with code: " + code);
					    		err.stdout = stdout;
					    		err.stderr = stderr;
					    		return callback(err);
					    	}
					        return callback(null, stdout.join(""));
					    });
					}

					function getPrograms (callback) {

						var programs = {};

						function forDirectory (directoryPath, callback) {
							var programDescriptorPath = directoryPath;
							if (!/\.json$/.test(programDescriptorPath)) {
								programDescriptorPath = PATH.join(programDescriptorPath, "program.json");
							}

							return PROGRAM_INSIGHT.parse(programDescriptorPath, {}, function(err, programDescriptor) {
								if (err) return callback(err);

								var didHaveProgram = false;
								if (
									programDescriptor.combined.boot &&
									programDescriptor.combined.boot.package
								) {
									programs[programDescriptorPath] = programDescriptor;
									didHaveProgram = true;
								}

								var waitfor = WAITFOR.serial(function (err) {
									if (err) return callback(err);
									return callback(null, programDescriptorPath);
								});

								var config = getConfigFrom(programDescriptor.combined, "github.com/pinf-to/to.pinf.lib/0");
								if (
									config &&
									config.programs
								) {
									for (var programId in config.programs) {
										var program = config.programs[programId];
										if (typeof program === "string") {
											program = {
												path: program
											}
										}
										waitfor(programId, program, function (programId, program, callback) {
											return forDirectory(PATH.join(PATH.dirname(programDescriptorPath), program.path), function (err, programDescriptorPath) {
												if (err) return callback(err);

												programs[programDescriptorPath]._declaringId = programId;
												programs[programDescriptorPath]._declaringDescriptor = program;

												return callback(null);
											});
										});
									}
								} else {
									if (!didHaveProgram) {
										console.log("No programs to publish configured at 'config[\"github.com/pinf-to/to.pinf.lib/0\"].programs' in '" + programDescriptor.descriptorPaths.join(", ") + "'");
									}
								}

								return waitfor();
							});
						}

						return forDirectory(rootPath, function (err) {
							if (err) return callback(err);
							return callback(null, programs);
						});
					}

					return findPackageRoot(module.filename, function(err, ___program_root_path) {
						if (err) return callback(err);

						try {

							var API = {
								___program_root_path: ___program_root_path,
								VERBOSE: false,
								DEBUG: false,
								LOGGER: logger,
								ASSERT: ASSERT,
								PATH: PATH,
								FS: FS,
								Q: Q,
								SPAWN: require("child_process").spawn,
								EXEC: require("child_process").exec,
								COMMANDER: require("commander"),
								WAITFOR: WAITFOR,
								REQUEST: require("request"),					
								runCommands: runCommands,
								getPrograms: getPrograms
							};

							// TODO: Re-use pinf context logic once refined sufficiently.
							var Context = function (API, rootPath) {
								var self = this;
								for (var name in API) {
									self[name] = API[name];
								}
								self.getRootPath = function () {
									return rootPath;
								}
								self.sub = function (rootPath, _api) {
									var api = new Context(self, rootPath || self.getRootPath());
									if (_api) {
										for (var name in _api) {
											api[name] = _api[name];
										}
									}
									return api;
								}
								self.console = {
									error: function () {
										self.LOGGER.log.apply(self.LOGGER, ["error"].concat(Array.prototype.slice.call(arguments)));
									},
									verbose: function () {
										if (!self.VERBOSE) return;
										self.LOGGER.log.apply(self.LOGGER, ["info"].concat(Array.prototype.slice.call(arguments)));
									},
									debug: function () {
										if (!self.DEBUG) return;
										self.LOGGER.log.apply(self.LOGGER, ["log"].concat(Array.prototype.slice.call(arguments)));
									}
								}
								self.loadProgramDescriptor = function (callback) {
									var programDescriptorPath = PATH.join(rootPath, "program.json");
				                	API.console.verbose("Load program descriptor:", programDescriptorPath);
									return FS.exists(programDescriptorPath, function (exists) {
										if (!exists) {
											return callback("ERROR: No program descriptor found at: " + programDescriptorPath);
										}
console.log("programDescriptorPath", programDescriptorPath);
										return PROGRAM.fromFile(programDescriptorPath, function (err, programDescriptor) {
											if (err) return callback(err);

		console.log("programDescriptor", programDescriptor);


		//"genesis.pinf.org/0": {

											return callback(null);
										});
									});
								}
							}

							var api = new Context(API, rootPath);
							return implementation(api, function (err) {
								if (err) return callback(err);
								return callback();
							});

						} catch(err) {
							return callback(err);
						}
					});
				});
			});

		}, module, {
			noContext: true
		});
	}
}

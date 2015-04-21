
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs-extra");
const PINF_MAIN = require("pinf-for-nodejs/lib/main");
const SPAWN = require("child_process").spawn;
const WAITFOR = require("waitfor");
const PROGRAM_INSIGHT = require("pinf-it-program-insight");
const Q = require("q");
const WINSTON = require("winston");

const CONTEXT = require("./context");



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

		return PINF_MAIN.main(function (options, _callback) {

			options = options || {};

			var noExitOnEnd = false;

			var callback = function (err) {
				if (err) return _callback(err);

				if (noExitOnEnd) {
					// TODO: Respect debug/verbose flag.
					if (options.DEBUG) console.log("Don't exit due to 'noExitOnEnd'!");
					return;
				}

				return _callback();
			}

			function initLogger (callback) {
				var logger = new (WINSTON.Logger)({
					transports: [
						// @see https://github.com/winstonjs/winston#console-transport
						new (WINSTON.transports.Console)({
							level: "debug",
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
						return callback(null, PATH.join(path, "program.json"));
					} else
					if (FS.existsSync(PATH.join(path, ".git"))) {
						return callback(null, PATH.join(path, "program.json"));
					}
					var newPath = PATH.dirname(path);
					if (newPath === path) {
						return callback(new Error("No program root found!"));
					}
					return findProgramRoot(newPath, callback);
				}

				return findProgramRoot(process.cwd(), function (err, rootPath) {
					if (err) return callback(err);

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
								getPrograms: getPrograms,
								findPackageRoot: findPackageRoot,
								LOGGER: logger,
								notifyNoExitOnEnd: function () {
									noExitOnEnd = true;
								},

								// TODO: Load these from a config file as well?
								getPinfDirectory: function () {
throw new Error("STOP on getPinfDirectory");
								},
								getPinfDirpath: function () {
									if (!process.env.PGS_PINF_DIRPATH) {
										throw new Error("'PGS_PINF_DIRPATH' environment variable not set!");
									}
									return process.env.PGS_PINF_DIRPATH;
								},
								getPackagesDirectory: function () {
throw new Error("STOP on getPackagesDirectory");
								},
								getPackagesDirpath: function () {
									if (!process.env.PGS_PACKAGES_DIRPATH) {
										throw new Error("'PGS_PACKAGES_DIRPATH' environment variable not set!");
									}
									return process.env.PGS_PACKAGES_DIRPATH;
								}
							};

							var api = new CONTEXT.Context(API, rootPath, rootPath);
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


const ASSERT = require("assert");
const Q = require("q");
const ESCAPE_REGEXP_COMPONENT = require("escape-regexp-component");
const JSONPATH = require("JSONPath");


exports.replaceInObject = function (obj, rules) {

	var objString = JSON.stringify(obj);

	function parseForMatches (objString, match) {
		var vars = {};
        var m = null;
        while (m = match.exec(objString)) {
        	vars[m[2]] = {
        		pointer: m[1] + m[2],
        		matched: m[0]
        	};
        }
        return vars;
	}

	function replaceValue (lookup, value, mode) {
		function replace (value) {
			var lookupRe = null;
			if (mode === "InjectObject") {
				// TODO: Make sure there are no key collisions
				//       in the object we are injecting into. We need a better JSON parser for this.
				value = JSON.stringify(value).replace(/(^\{|\}$)/g, "");
				if (!value || /^\s+$/.test(value)) {
					value = "";
					lookupRe = new RegExp(ESCAPE_REGEXP_COMPONENT(lookup) + "[^,]*,", "g");
				}
			} else
			if (
				typeof value === "object" ||
				Array.isArray(value)
			) {
				lookup = '"' + lookup + '"';
				value = JSON.stringify(value);
			}
			if (!lookupRe) {
				lookupRe = new RegExp(ESCAPE_REGEXP_COMPONENT(lookup), "g");
			}
			objString = objString.replace(
				lookupRe,
				value
			);
		}
		if (Q.isPromise(value)) {
			return value.then(replace);
		} else {
			return Q.resolve(replace(value));
		}
	}

	function replace_Inject (rule) {

		var vars = parseForMatches(
			objString,
			/"@inject"[^\{]+\{\{(\$\.)([^\}]+)\}\}"/g
		);

		var varNames = Object.keys(vars);
		if (varNames.length === 0) {
			return;
		}

		return Q.all(varNames.map(function (varName) {
			var match = JSONPATH({
				json: JSON.parse(objString),
				path: vars[varName].pointer,
				resultType: 'all'
			});
			if (match.length === 0) {
				console.error("obj", obj);
				throw new Error("Could not match '" + vars[varName].pointer + "'!");
			}
			return replaceValue(
				vars[varName].matched,
				match[0].value,
				"InjectObject"
			);
		}));
	}

	function replace_RegExp (rule) {

		ASSERT(typeof rule.match !== "undefined");
		ASSERT(typeof rule.vars, "object");

		var vars = parseForMatches(objString, rule.match);

		var varNames = Object.keys(vars);
		if (varNames.length === 0) {
			return;
		}

		return Q.all(varNames.map(function (varName) {

			if (typeof rule.vars[varName] === "undefined") {
				throw new Error("Argument with name '" + varName + "' not found!");
			}

			return replaceValue(
				vars[varName].matched,
				rule.vars[varName]
			);
		}));	
	}

	var done = Q.resolve();
	rules.forEach(function (rule) {
		done = Q.when(done, function () {
			if (rule.type === "@inject") {
				return replace_Inject(rule);
			} else
			if (rule.type === "RegExp") {
				return replace_RegExp(rule);
			} else {
				throw new Error("Rule with type '" + rule.type + "' not supported!");
			}
		});
	});
	return done.then(function () {
		try {
			return JSON.parse(objString);
		} catch (err) {
			err.message += " (while after replacing variables!)";
			err.stack += "\n(while after replacing variables!)";
			throw err;
		}
	});
}


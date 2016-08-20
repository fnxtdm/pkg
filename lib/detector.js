/* eslint-disable dot-location */
/* eslint-disable guard-for-in */
/* eslint-disable max-depth */
/* eslint-disable operator-linebreak */

"use strict";

var assert = require("assert");
var common = require("./common.js");
var parse = require("esprima").parse;

var ALIAS_AS_RELATIVE = common.ALIAS_AS_RELATIVE;
var ALIAS_AS_RESOLVABLE = common.ALIAS_AS_RESOLVABLE;

function forge(pattern, was) {
  if (was.v2) {
    return pattern.replace("{c1}", ", ")
                  .replace("{v1}", "\"" + was.v1 + "\"")
                  .replace("{c2}", ", ")
                  .replace("{v2}", "\"" + was.v2 + "\"");
  } else {
    return pattern.replace("{c1}", ", ")
                  .replace("{v1}", "\"" + was.v1 + "\"")
                  .replace("{c2}", "")
                  .replace("{v2}", "");
  }
}

function valid2(v2) {
  return (typeof v2 === "undefined") ||
         (v2 === null) ||
         (v2 === "dont-enclose") ||
         (v2 === "can-ignore");
}

function visitor_REQUIRE_RESOLVE(n) { // eslint-disable-line camelcase
  var c = n.callee;
  if (!c) return null;
  var ci = (c.object
         && c.object.type === "Identifier"
         && c.object.name === "require"
         && c.property
         && c.property.type === "Identifier"
         && c.property.name === "resolve");
  if (!ci) return null;
  var f = (n.type === "CallExpression"
        && n.arguments
        && n.arguments[0]
        && n.arguments[0].type === "Literal");
  if (!f) return null;
  var m = (n.arguments[1]
        && n.arguments[1].type === "Literal");
  return { v1: n.arguments[0].value,
           v2: m ? n.arguments[1].value : null };
}

function visitor_REQUIRE(n) { // eslint-disable-line camelcase
  var c = n.callee;
  if (!c) return null;
  var ci = (c.type === "Identifier"
         && c.name === "require");
  if (!ci) return null;
  var f = (n.type === "CallExpression"
        && n.arguments
        && n.arguments[0]
        && n.arguments[0].type === "Literal");
  if (!f) return null;
  var m = (n.arguments[1]
        && n.arguments[1].type === "Literal");
  return { v1: n.arguments[0].value,
           v2: m ? n.arguments[1].value : null };
}

function visitor_PATH_JOIN(n) { // eslint-disable-line camelcase
  var c = n.callee;
  if (!c) return null;
  var ci = (c.object
         && c.object.type === "Identifier"
         && c.object.name === "path"
         && c.property
         && c.property.type === "Identifier"
         && c.property.name === "join");
  if (!ci) return null;
  var f = (n.type === "CallExpression"
        && n.arguments
        && n.arguments[1]
        && n.arguments[1].type === "Literal"
        && n.arguments.length === 2); // TODO concate them
  if (!f) return null;
  var dn = (n.arguments[0]
         && n.arguments[0].type === "Identifier"
         && n.arguments[0].name === "__dirname");
  if (!dn) return null;
  return { v1: n.arguments[1].value };
}

module.exports.visitor_SUCCESSFUL = function(node, test) { // eslint-disable-line camelcase

  var dontEnclose, canIgnore, was;

  was = visitor_REQUIRE_RESOLVE(node);
  if (was) {
    if (test) return forge("require.resolve({v1}{c2}{v2})", was);
    if (!valid2(was.v2)) return null;
    dontEnclose = (was.v2 === "dont-enclose");
    canIgnore = (was.v2 === "can-ignore");
    return { alias: was.v1,
             aliasType: ALIAS_AS_RESOLVABLE,
             dontEnclose: dontEnclose,
             canIgnore: canIgnore };
  }

  was = visitor_REQUIRE(node);
  if (was) {
    if (test) return forge("require({v1}{c2}{v2})", was);
    if (!valid2(was.v2)) return null;
    dontEnclose = (was.v2 === "dont-enclose");
    canIgnore = (was.v2 === "can-ignore");
    return { alias: was.v1,
             aliasType: ALIAS_AS_RESOLVABLE,
             dontEnclose: dontEnclose,
             canIgnore: canIgnore };
  }

  was = visitor_PATH_JOIN(node);
  if (was) {
    if (test) return forge("path.join(__dirname{c1}{v1})", was);
    return { alias: was.v1,
             aliasType: ALIAS_AS_RELATIVE,
             canIgnore: false };
  }

  return null;

};

function visitor_NONLITERAL(node) { // eslint-disable-line camelcase
  assert(node);
}

module.exports.visitor_NONLITERAL = function(node) { // eslint-disable-line camelcase

  var dontEnclose, canIgnore, was;

  was = visitor_NONLITERAL(node);
  if (was) {
    if (!valid2(was.v2)) return null;
    dontEnclose = (was.v2 === "dont-enclose");
    canIgnore = (was.v2 === "can-ignore");
    return { alias: was.v1,
             dontEnclose: dontEnclose,
             canIgnore: canIgnore };
  }

  return null;

};

function visitor_MALFORMED(node) { // eslint-disable-line camelcase
  assert(node);
}

module.exports.visitor_MALFORMED = function(node) { // eslint-disable-line camelcase

  var was;

  was = visitor_MALFORMED(node);
  if (was) return { alias: was.v1 };

  return null;

};

function visitor_USESCWD(node) { // eslint-disable-line camelcase
  assert(node);
}

module.exports.visitor_USESCWD = function(node) { // eslint-disable-line camelcase

  var was;

  was = visitor_USESCWD(node);
  if (was) return { alias: was.v1 };

  return null;

};

function reconstruct() { // eslint-disable-line no-unused-vars
  // TODO escodegen?
}

function traverse(ast, visitor) {
  // modified esprima-walk to support
  // visitor return value and "trying" flag
  var stack = [ [ ast, false ] ], i, j, key;
  var len, item, node, trying, child;
  for (i = 0; i < stack.length; i += 1) {
    item = stack[i];
    node = item[0];
    if (node) {
      trying = item[1] || (node.type === "TryStatement");
      if (visitor(node, trying)) {
        for (key in node) {
          child = node[key];
          if (child instanceof Array) {
            len = child.length;
            for (j = 0; j < len; j += 1) {
              stack.push([ child[j], trying ]);
            }
          } else
          if (child && typeof child.type === "string") {
            stack.push([ child, trying ]);
          }
        }
      }
    }
  }
}

module.exports.parse = function(body) {
  return parse(body);
};

module.exports.detect = function(body, visitor) {

  var json = module.exports.parse(body);
  if (!json) return;
  traverse(json, visitor);

};

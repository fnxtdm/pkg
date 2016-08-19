"use strict";

var fs = require("fs");
var path = require("path");
var assert = require("assert");
var async = require("async");
var globby = require("globby");
var solver = require("resolve").sync;
var minimatch = require("minimatch");
var common = require("./common.js");
var detector = require("./detector.js");
var reporter = require("./reporter.js");

var ROOT_NAME = "root";

var STORE_CODE = common.STORE_CODE;
var STORE_CONTENT = common.STORE_CONTENT;
var STORE_LINKS = common.STORE_LINKS;
var STORE_STAT = common.STORE_STAT;
var ALIAS_AS_RELATIVE = common.ALIAS_AS_RELATIVE;
var ALIAS_AS_RESOLVABLE = common.ALIAS_AS_RESOLVABLE;

var normalizePath = common.normalizePath;
var isPackageJson = common.isPackageJson;
var isDotJS = common.isDotJS;
var isDotNODE = common.isDotNODE;

function hasPermissiveLicense(pack) {
  if (pack.name === ROOT_NAME) return false;
  if (pack.private) return false;
  var license = pack.license;
  if (typeof license === "object") license = license.type;
  license = license || ""; // to work with slice
  if (license.slice(0, 1) === "(") license = license.slice(1);
  if (license.slice(-1) === ")") license = license.slice(0, -1);
  license = license.toLowerCase();
  var licenses = Array.prototype.concat(
    license.split(" or "), license.split(" and "), license.split("/")
  ), free = false;
  var foss = [ "isc", "mit", "apache-2.0", "apache 2.0",
    "public domain", "bsd", "bsd-2-clause", "bsd-3-clause", "wtfpl",
    "cc-by-3.0", "x11", "artistic-2.0", "gplv3", "mplv2.0" ];
  licenses.some(function(c) {
    free = foss.indexOf(c) >= 0;
    return free;
  });
  return free;
}

function Walker() {
}

Walker.prototype.stackSub = function(r, key) {
  this.recordsMap[key] = r;
  this.records.push(r);
};

Walker.prototype.stack = function(r) {
  r.file = normalizePath(r.file);
  var key = JSON.stringify([
    r.file, r.store.toString()
  ]);
  var prev = this.recordsMap[key];
  if (!prev) return this.stackSub(r, key);
  if (r.store === STORE_CONTENT) {
    if (r.parse && !prev.parse) {
      prev.discard = true;
      this.stackSub(r, key);
    }
  } else
  if (r.store === STORE_LINKS) {
    assert(prev.body, "walker: expected body for STORE_LINKS");
    assert(r.body.length === 1, "walker: expected body length 1");
    prev.body.push(r.body[0]);
  }
};

Walker.prototype.addConfigFromObject = function(name, config) {
  if (this.configs[name]) return;
  this.configs[name] = config;
};

Walker.prototype.addConfigFromFile = function(name, file, tolerant) {
  if (!fs.existsSync(file) && tolerant) return;
  if (!fs.statSync(file).isFile() && tolerant) return;
  var config = this.configs[name];
  if (config) return;
  config = require(file);
  this.configs[name] = config;
};

Walker.prototype.addConfigFromDictionary = function(name) {
  var home = path.dirname(process.argv[1]);
  var dictionary = path.join(home, "..", "dictionary", name + ".js");
  this.addConfigFromFile(name, dictionary, true);
};

var relativize = function(p, base) {
  if (typeof p !== "string") {
    throw new Error(
      "Config items must be strings. See examples."
    );
  }
  var negate = false;
  if (p.slice(0, 1) === "!") {
    p = p.slice(1);
    negate = true;
  }
  if (!path.isAbsolute(p)) {
    p = path.join(base, p);
  }
  if (negate) {
    p = "!" + p;
  }
  return p;
};

var globize = function(ps) {
  return globby.sync(
    ps, { dot: true }
  );
};

Walker.prototype.activateConfigAtBase = function(pack) {

  var that = this;

  if (!pack) assert(false);
  var name = pack.name;
  if (!name) assert(false);
  var base = pack.base;
  if (!base) assert(false);
  var config = that.configs[name];
  if (!config) return;

  var scripts = config.scripts;

  if (scripts) {
    if (!Array.isArray(scripts)) {
      scripts = [ scripts ];
    }
    scripts = globize(
      scripts.map(function(p) {
        return relativize(p, base);
      })
    );
    scripts.some(function(script) {
      var stat = fs.statSync(script);
      if (!stat.isFile()) return;
      that.stack({
        file: script,
        pack: pack,
        store: STORE_CODE
      });
    });
  }

  var assets = config.assets;

  if (assets) {
    if (!Array.isArray(assets)) {
      assets = [ assets ];
    }
    assets = globize(
      assets.map(function(p) {
        return relativize(p, base);
      })
    );
    assets.some(function(asset) {
      var stat = fs.statSync(asset);
      if (!stat.isFile()) return;
      that.stack({
        file: asset,
        pack: pack,
        store: STORE_CONTENT
      });
    });
  }

};

Walker.prototype.stepRead = function(record, cb) {

  fs.readFile(record.file, function(error, body) {
    if (error) {
      reporter.report(record.file, "error", [
        "Cannot read file, " + error.code
      ], error);
      return cb(error);
    }
    record.body = body;
    cb();
  });

};

Walker.prototype.stepPatch = function(record, cb) {

  if (isPackageJson(record.file)) return cb(); // package.json is package-neutral
  var pack = record.pack;
  if (!pack) assert(false);
  var name = pack.name;
  if (!name) assert(false);
  var config = this.configs[name];
  if (!config) return cb();

  var relate = path.relative(
    record.pack.base, record.file
  ).replace(/\\/g, "/");

  var patches = config.patches;

  if (patches) {
    Object.keys(patches).some(function(key) {
      if (minimatch(relate, key)) {

        var patch = patches[key];
        var body = record.body.toString("utf8");

        for (var i = 0; i < patch.length; i += 2) {
          if (typeof patch[i] === "object") {
            if (patch[i].do === "erase") {
              body = patch[i + 1];
            } else
            if (patch[i].do === "prepend") {
              body = patch[i + 1] + body;
            } else
            if (patch[i].do === "append") {
              body += patch[i + 1];
            }
          } else
          if (typeof patch[i] === "string") {
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
            // function escapeRegExp
            var esc = patch[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            var regexp = new RegExp(esc, "g");
            body = body.replace(regexp, patch[i + 1]);
          }
        }

        record.body = body;

      }
    });
  }

  cb();

};

Walker.prototype.stepStrip = function(record, cb) {

  var body = record.body.toString("utf8");

  if (/^\ufeff/.test(body)) {
    body = body.replace(/^\ufeff/, "");
  }
  if (/^#!/.test(body)) {
    body = body.replace(/^#![^\n]*\n/, "\n");
  }

  record.body = body;
  cb();

};

Walker.prototype.hasNonRootConfig = function(pack) {
  if (!pack) assert(false);
  var name = pack.name;
  if (name === ROOT_NAME) return false;
  var config = this.configs[name];
  if (!config) return false;
  return true;
};

Walker.prototype.stepDetect = function(record, cb) {

  var that = this;
  var body = record.body;

  var derivatives = [];
  try {
    detector.detect(
      body,
      function(node, trying) {
        var p, level;
        p = detector.visitor_SUCCESSFUL(node);
        if (p) {
          if (p.dontEnclose) return false;
          p.canIgnore = p.canIgnore || trying;
          derivatives.push(p);
          return false;
        }
        p = detector.visitor_NONLITERAL(node);
        if (p) {
          if (p.dontEnclose) return false;
          if (that.hasNonRootConfig(record.pack)) return false;
          level = ((p.canIgnore || trying) ? "info" : "warning");
          reporter.report(record.file, level, [
            "Cannot resolve '" + p.alias + "'",
            "Use a string literal as argument for 'require', or leave it",
            "as is and specify the resolved file name in 'scripts' option."
          ]);
          return false;
        }
        p = detector.visitor_MALFORMED(node);
        if (p) {
          // there is no "dontEnclose"
          if (that.hasNonRootConfig(record.pack)) return false;
          level = (trying ? "info" : "warning"); // there is no "canIgnore"
          reporter.report(record.file, level, [
            "Malformed requirement: " + p.alias
          ]);
          return false;
        }
        p = detector.visitor_USESCWD(node);
        if (p) {
          // there is no "dontEnclose"
          if (that.hasNonRootConfig(record.pack)) return false;
          level = "info"; // there is no "canIgnore"
          reporter.report(record.file, level, [
            "Path.resolve(" + p.alias + ") is ambiguous",
            "It resolves relatively to 'process.cwd' by default, however",
            "you may need to use 'path.dirname(require.main.filename)'"
          ]);
          return false;
        }
        return true; // can i go inside?
      }
    );
  } catch (error) {
    reporter.report(record.file, "error", error.message, error);
    return cb(error);
  }

  cb(null, derivatives);

};

Walker.prototype.stepDerivatives_ALIAS_AS_RELATIVE = function(record, derivative, cb) { // eslint-disable-line camelcase

  var that = this;

  var file = path.join(
    path.dirname(record.file),
    derivative.alias
  );

  fs.stat(file, function(error, stat) {
    if (error) {
      reporter.report(file, "error", [
        "Cannot stat, " + error.code,
        "The file was required from '" + record.file + "'"
      ], error);
      return cb(error);
    }
    if (!stat.isFile()) {
      return cb();
    }
    that.stack({
      file: file,
      pack: record.pack,
      store: STORE_CONTENT
    });
    cb();
  });

};

Walker.prototype.stepDerivatives_ALIAS_AS_RESOLVABLE = function(record, derivative, cb) { // eslint-disable-line camelcase

  var that = this;
  var catcher = {};
  var newPack;

  catcher.readFileSync = function(file) {
    assert(isPackageJson(file), "walker: " +
      file + " must be package.json");
    var r = fs.readFileSync(file);
    that.stack({
      file: file,
      store: STORE_CONTENT
    });
    return r;
  };

  catcher.packageFilter = function(pack, base) {
    if (pack.name) {
      newPack = pack;
      newPack.base = base;
    }
    return pack;
  };

  var file2, failure;

  try {
    file2 = solver(derivative.alias, {
      basedir: path.dirname(record.file),
      // в оригинале только ".js", но
      // этого недостаточно. не срабатывает
      // require("./typos") файл typos.json
      // в normalize-package-data\lib\fixer.js
      extensions: [ ".js", ".json", ".node" ],
      readFileSync: catcher.readFileSync,
      packageFilter: catcher.packageFilter
    });
  } catch (error) {
    failure = error;
  }

  // взял из resolve\lib\sync.js
  var isNear = /^(?:\.\.?(?:\/|$)|\/|([A-Za-z]:)?[\\\/])/;

  if (!isNear.test(derivative.alias)) {

    var short = derivative.alias;
    short = short.split("\\")[0];
    short = short.split("/")[0];

    if (short !== derivative.alias) {

      try {
        solver(short, {
          basedir: path.dirname(record.file),
          extensions: [ ".js", ".json", ".node" ],
          readFileSync: catcher.readFileSync,
          packageFilter: catcher.packageFilter
        });
      } catch (error) {
        // только чтобы сработал packageFilter там,
        // где написали require("npm/bin/npm-cli.js")
        // UPD ну и конечно-же прихватить с собой
        // package.json, потому что иначе resolve его
        // не прихватит (сработает loadAsFileSync)
      }

    }

  }

  if (newPack) {

    try {
      that.addConfigFromDictionary(
        newPack.name
      );
      that.activateConfigAtBase(
        newPack
      );
    } catch (error) {
      var file3 = path.join(newPack.base, "package.json");
      reporter.report(file3, "error", error.message, error);
      return cb(error);
    }

  }

  if (failure) {

    var error2 = failure;

    if (derivative.canIgnore) {
      reporter.report(record.file, "info", error2.message);
      return cb();
    } else {
      reporter.report(record.file, "error", error2.message, error2);
      return cb(error2);
    }

  }

  that.stack({
    file: file2,
    pack: newPack || record.pack,
    store: STORE_CODE
  });

  cb();

};

Walker.prototype.stepDerivatives = function(record, derivatives, cb) {

  var that = this;

  async.map(derivatives, function(derivative, next) {

    if (that.natives[derivative.alias]) {
      return next();
    }

    if (derivative.aliasType === ALIAS_AS_RELATIVE) {
      that.stepDerivatives_ALIAS_AS_RELATIVE(record, derivative, next);
    } else
    if (derivative.aliasType === ALIAS_AS_RESOLVABLE) {
      that.stepDerivatives_ALIAS_AS_RESOLVABLE(record, derivative, next);
    } else {
      assert(false, "walker: unknown aliasType " + derivative.aliasType);
    }

  }, cb);

};

Walker.prototype.step_STORE_ANY = function(record, cb) { // eslint-disable-line camelcase

  var that = this;
  assert(typeof record.body === "undefined",
    "walker: unexpected body " + record.file);

  if (isDotNODE(record.file)) {
    record.discard = true;
    reporter.report(record.file, "warning", [
      "Cannot include native addon into executable.",
      "The addon file must be distributed with executable."
    ]);
    return cb();
  }

  if (record.store === STORE_CODE) {

    if (!isDotJS(record.file)) {
      that.stack({
        file: record.file,
        pack: record.pack,
        store: STORE_CONTENT
      });
      record.discard = true;
      return cb();
    }

    if (hasPermissiveLicense(record.pack) ||
        that.hasNonRootConfig(record.pack)) { // ejs 0.8.8 has no license field
      that.stack({
        file: record.file,
        pack: record.pack,
        store: STORE_CONTENT,
        parse: true
      });
      record.discard = true;
      return cb();
    }

  }

  that.stack({
    file: record.file,
    pack: record.pack,
    store: STORE_STAT
  });

  async.waterfall([

    function(next) {
      that.stepRead(record, next);
    },
    function(next) {
      that.stepPatch(record, next);
    },
    function(next) {
      if (record.store === STORE_CODE) return next();
      if (record.parse) return next();
      cb();
    },
    function(next) {
      that.stepStrip(record, next);
    },
    function(next) {
      that.stepDetect(record, next);
    },
    function(derivatives, next) {
      that.stepDerivatives(record, derivatives, next);
    }

  ], cb);

};

Walker.prototype.step_STORE_LINKS = function(record, cb) { // eslint-disable-line camelcase

  var that = this;
  assert(typeof record.body !== "undefined",
    "walker: expected body " + record.file);

  that.stack({
    file: record.file,
    pack: record.pack,
    store: STORE_STAT
  });

  cb();

};

Walker.prototype.step_STORE_STAT = function(record, cb) { // eslint-disable-line camelcase

  var that = this;
  assert(typeof record.body === "undefined",
    "walker: unexpected body " + record.file);

  fs.stat(record.file, function(error, body) {
    if (error) {
      reporter.report(record.file, "error", [
        "Cannot stat, " + error.code
      ], error);
      return cb(error);
    }
    if (path.dirname(record.file) !== record.file) { // root directory
      that.stack({
        file: path.dirname(record.file),
        pack: record.pack,
        store: STORE_LINKS,
        body: [ path.basename(record.file) ]
      });
    }
    record.body = body;
    cb();
  });

};

Walker.prototype.step = function(record, cb) {

  var that = this;

  if (record.store === STORE_CODE) {
    that.step_STORE_ANY(record, cb);
  } else
  if (record.store === STORE_CONTENT) {
    that.step_STORE_ANY(record, cb);
  } else
  if (record.store === STORE_LINKS) {
    that.step_STORE_LINKS(record, cb);
  } else
  if (record.store === STORE_STAT) {
    that.step_STORE_STAT(record, cb);
  } else {
    assert(false, "walker: unknown store " + record.store);
  }

};

Walker.prototype.walk = function(cb) {

  var that = this;
  var records = that.records;
  var advance = 0;

  function loop() {
    if (advance >= records.length) return cb();
    var record = records[advance];
    that.step(record, function(error) {
      if (error) return cb(error);
      advance += 1;
      loop();
    });
  }

  loop();

};

Walker.prototype.start = function(opts, cb) {

  var that = this;

  that.records = [];
  that.recordsMap = [];
  that.configs = {};

  var input = opts.cli.input;
  that.natives = opts.natives;
  var boot = opts.cli.config || opts.cli.input;

  var root = {
    name: ROOT_NAME,
    base: path.dirname(boot)
  };

  that.stack({
    file: input,
    pack: root,
    store: STORE_CODE,
    entrypoint: true
  });

  try {
    if (opts.cli.config) {
      that.addConfigFromFile(
        root.name, opts.cli.config, false
      );
    } else
    if (opts.config) {
      that.addConfigFromObject(
        root.name, opts.config
      );
    } else {
      that.addConfigFromObject(
        root.name, {}
      );
    }
    that.activateConfigAtBase(
      root
    );
  } catch (error) {
    reporter.report(boot, "error", error.message, error);
    return cb(error);
  }

  that.walk(function(error) {
    if (error) return cb(error);
    cb(null, that.records);
  });

};

module.exports = function(opts, cb) {
  var w = new Walker();
  w.start(opts, cb);
};

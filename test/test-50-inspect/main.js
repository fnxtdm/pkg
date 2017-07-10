#!/usr/bin/env node

'use strict';

const path = require('path');
const assert = require('assert');
const utils = require('../utils.js');

assert(!module.parent);
assert(__dirname === process.cwd());

const target = process.argv[2] || 'host';
const input = './test-x-index.js';
const output = './test-output.exe';

utils.pkg.sync([
  '--target', target,
  '--output', output, input
]);

utils.spawn.sync(
  './' + path.basename(output),
  [ '--pkg-fallback', '--inspect' ],
  { cwd: path.dirname(output),
    stdio: 'pipe', expect: 9 }
);

utils.vacuum.sync(output);

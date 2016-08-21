#!/usr/bin/env node

let path = require('path');
let assert = require('assert');
let utils = require('../../utils.js');
let enclose = require('../../').exec;

assert(!module.parent);
assert(__dirname === process.cwd());

let flags = process.argv.slice(2);
let input = './test-x-index.js';
let output = './test-output.exe';

let left, right;

let versions = utils.exec.sync(
  'npm view enclose versions'
).replace(/'/g, '"');

versions = JSON.parse(versions);
left = versions[versions.length - 1];
left = left.split('.').map(function (entity) {
  return parseInt(entity, 10);
});

enclose.sync(flags.concat([
  '--output', output, input
]));

right = utils.spawn.sync(
  './' + path.basename(output), [],
  { cwd: path.dirname(output) }
);

right = right.split('.').map(function (entity) {
  return parseInt(entity, 10);
});

left = left[0] * 10000 + left[1] * 100 + left[2];
right = right[0] * 10000 + right[1] * 100 + right[2];

assert(left < right, left.toString() + ' < ' + right.toString());
utils.vacuum.sync(output);

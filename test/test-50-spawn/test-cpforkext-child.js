#!/usr/bin/env node

'use strict';

let assert = require('assert');
let cluster = require('cluster');

assert(process.send);
assert(!cluster.worker);

console.log('Hello from cpforkext-child!');
console.log('Args', JSON.stringify(process.argv.slice(2)));

process.on('message', function (value) {
  process.send(value * 2);
  if (value === 128) process.exit();
});

let fs = require('fs');

try {
  console.log(fs.readFileSync('dirty-hack-for-testing-purposes'));
} catch (error) {
  console.log(error.code); // must not patch fs
}

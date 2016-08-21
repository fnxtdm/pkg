#!/usr/bin/env node

'use strict';

let fs = require('fs');
let path = require('path');

require('./plugins-C-int/test-y-require-C.js');

// require(path.join(path.dirname(process.argv[1]), "plugins-D-ext/test-y-require-D.js"));

let myDirectory = path.dirname(process.argv[1]);

process.enclose.mount(
  path.join(__dirname, 'plugins-D-ext'),
  path.join(myDirectory, 'plugins-D-ext')
);

require('./plugins-D-ext/test-y-require-D.js'.slice());

console.log(
  fs.readdirSync(__dirname).join('\n')
);

'use strict';

// only enclosed run supposed
if (!process.enclose) {
  console.log('ok');
  return;
}

let callsites = require('callsites');

try {
  callsites();
} catch (error) {
  if (error.message.indexOf('EncloseJS') >= 0) {
    console.log('ok');
  }
}

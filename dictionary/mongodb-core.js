'use strict';

module.exports = {

  patches: {

    'lib/error.js': [
      'return err;',
      'if (err.message.indexOf("SyntaxError") >= 0) {' +
        'err.message = "EncloseJS: Try to specify your ' +
        'javascript file in \'assets\' in config. " + err.message;' +
      '};\n' +
      'return err;'
    ]

  }

};

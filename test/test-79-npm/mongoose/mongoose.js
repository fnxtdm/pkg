'use strict';

let mongoose = require('mongoose');
mongoose.connect('mongodb://localhost/enclose');

let Cat = mongoose.model('Cat', { name: String });
let name = 'Tuz' + (new Date()).getTime().toString();
let kitty = new Cat({ name: name });

kitty.save(function (error1) {
  if (error1) return;
  Cat.find({}).$where(function () {
    return (this.name.slice(0, 3) === 'Tuz'); // eslint-disable-line no-invalid-this
  }).exec(function (error2, cats) {
    if (process.enclose) {
      if (cats) return;
      if (error2.message.indexOf('EncloseJS') >= 0) {
        console.log('ok');
        mongoose.disconnect();
      }
    } else {
      if (error2) return;
      if (cats.length > 0) {
        console.log('ok');
        mongoose.disconnect();
      }
    }
  });
});

'use strict';

var Mentat = require('mentat');

module.exports = new Mentat.Handler('BasicHTTP', {
  routes: [
    { method: 'GET', auth: false, path: '/BasicHTTP/Test200', handler: 'Test200' }
  ],

  Test200: function (request, reply) {
      reply().code(200);
  }
});

'use strict';

var Mentat = require('../../..');

module.exports = new Mentat.Handler('BasicHTTP', {
  routes: [
    { method: 'GET', auth: false, path: '/BasicHTTP/Test200', handler: 'Test200' },
    { method: 'GET', auth: false, path: '/BasicHTTP/defaultResponderError', handler: 'defaultResponderError' },
  ],

  Test200: function (request, reply) {
      reply().code(200);
  },

  defaultResponderError: function (request, reply) {
        return Mentat.Handler.buildDefaultResponder(reply)('defaultResponderError', null);
  }

});

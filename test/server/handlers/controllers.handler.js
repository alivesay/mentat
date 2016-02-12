'use strict';

var Mentat = require('../../..');

module.exports = new Mentat.Handler('Controllers', {
  routes: [
    { method: 'GET', auth: false, path: '/Controllers/simpleResponse', handler: 'simpleResponse' }
  ],

  simpleResponse: function (request, reply) {
      return Mentat.controllers.ControllersController
               .simpleResponse({}, Mentat.Handler.buildDefaultResponder(reply));
  }

});

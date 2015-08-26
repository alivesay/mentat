'use strict';

var _ = require('lodash');
var util = require('util');
var path = require('path');
var fs = require('fs');
var requireDirectory = require('require-directory');

var NODE_ENV = process.env.NODE_ENV || 'development';
var APP_PATH = path.join(path.dirname(module.parent.filename), 'server');

var Mentat = {
  server: undefined,
  settings: {},
  models: {},
  controllers: {},
  handlers: {},
  io: {},
  transporter: {},

  Handler: Handler,
  Controller: Controller,

  start: function start() {
    var self = this;
    var _plugins = [
      { register: require('inert') }
    ];

    self._loadSettings();
    self._loadServer();
    self._loadTransporter();
    self._loadModels();
    self._loadControllers();
    self._loadMethods();
    self._loadHandlers();

    self.server.register(_plugins, function (err) {
      if (err) {
        throw err;
      }

      self._loadRoutes();

      if (NODE_ENV === 'development') {
        self.server.on('response', function (request) {
        console.log("[%s] %s %s - %s",
                    request.info.remoteAddress,
                    request.method.toUpperCase(),
                    request.url.path,
                    request.response.statusCode);
        });
      }

      self.server.start(function serverStartDone () {
        console.log('server listening: %s', self.server.info.uri);
        self._loadSockets();
      });

    });
  },

  _loadSettings: function _loadSettings () {
    var self = this;
    self.settings = require(path.join(APP_PATH, '/config/settings'));
  },

  _loadServer: function _loadServer() {
    var self = this;
    var Hapi = require('hapi');

    self.server = new Hapi.Server(_.defaults(self.settings.hapi.serverOptions || {},
      NODE_ENV === 'development' ? {
        debug: {
          request: ['error'],
          log: ['error']
        }
      } : {}));

    self.server.connection(_.defaults(self.settings.hapi.connectionOptions || {}, {
      host: NODE_ENV.IP || '0.0.0.0',
      port: NODE_ENV.PORT || '8080'
    }));
  },

  _loadSockets: function _loadSockets () {
    var self = this;
    var io = require('socket.io')(self.server.listener);

    self.server.app.io = io;
    self.io = io;

    self.server.app.io.on('connection', function (socket) {
      var remoteAddress = socket.client.conn.remoteAddress;

      console.log('socket.io: [' + socket.id + '] connected: ' + remoteAddress);

      var socketPluginsPath = path.join(APP_PATH, '/lib/socket_plugins');

      fs.readdirSync(socketPluginsPath).forEach(function (file) {
        require(path.join(socketPluginsPath, file))(socket);
        console.log('socket.io: [' + socket.id + '] loaded module: ' + file.split('.')[0]);
      });
    });
  },

  _loadModels: function _loadModels () {
    var self = this;

    var Sequelize = require('sequelize');
    var config = require(path.join(APP_PATH, '/config/database.json'))[NODE_ENV];
    var sequelize = new Sequelize(config.database, config.username, config.password, config);
    var modelsPath = path.join(APP_PATH, 'db/models');

    fs
      .readdirSync(path.join(modelsPath))
      .filter(function(file) {
        return file.indexOf('.') !== 0;
      })
      .forEach(function (file) {
        var model = sequelize['import'](path.join(modelsPath, file));
        self.models[model.name] = model;
        console.log('model loaded: ' + model.name);
      });

    Object.keys(self.models).forEach(function(modelName) {
      if ('associate' in self.models[modelName]) {
        self.models[modelName].associate(self.models);
      }
    });
  },

  _loadHandlers: function _loadHandlers () {
    var self = this;

    self.handlers = requireDirectory(module, path.join(APP_PATH, 'handlers'), {
      rename: function (name) {
        return name.split('.')[0];
      },
      visit: function (obj) {
        console.log('handler loaded: ' + obj.name);
        if (obj.routes !== undefined) {
         _.each(obj.routes, function (route) {
 
            self.server.route({
              method: route.method,
              path: route.path,
              config: {
                handler: obj[route.method],
                validate: route.validate
              }
            });

            console.log(util.format('routing: %s %s -> %s', route.method, route.path, obj.name));
          });
        }
      }
    });
  },

  _loadControllers: function _loadControllers () {
    var self = this;

    fs
      .readdirSync(path.join(APP_PATH, 'controllers'))
      .filter(function(file) {
        return file.indexOf('.') !== 0;
      })
      .forEach(function (file) {
        var controller = require(path.join(APP_PATH, '/controllers/', file));
        self.controllers[controller.name] = controller;
        console.log('controller loaded: ' + controller.name);
      });
  },

  _loadRoutes: function _loadRoutes () {
    var self = this;
    var routes = require(path.join(APP_PATH, '/config/routes'))(self.handlers);
    self.server.route(routes);
  },

  _loadMethods: function _loadMethods () {
    var self = this;
    self.server.method(require(path.join(APP_PATH, '/config/methods')));
  },

  _loadTransporter: function _loadTransporter() {
    var self = this;
    self.server.app.transporter = require('nodemailer')
      .createTransport(self.settings.nodemailerOptions);

    self.transporter = self.server.app.transporter;
  }

};

function Handler(name, obj) {
  this.name = name + 'Handler';
  _.extend(this, obj);
}

Handler.buildDefaultResponder = function buildDefaultResponder (reply, options) {
  var Boom = require('boom');

  options = _.defaults(options || {}, {
    notFoundOnNull: true
  });

  return function defaultReplyResponder (err, result) {
    if (err) {
      return reply(Boom.badRequest(err));
    }

    if (options.notFoundOnNull && (result === null || result === undefined)) {
      return reply(Boom.notFound());
    }
    
    return reply(result).code(200);
  }
}

function Controller(name, obj) {
  this.name = name + 'Controller';
  _.extend(this, obj);
}

module.exports = Mentat;

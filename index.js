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
  // models: {},
  controllers: {},
  handlers: {},
  io: {},
  transporter: {},

  Handler: Handler,
  Controller: Controller,

  start: function start() {
    var self = this;
    var _plugins = [
      { register: require('inert') },
      { register: require('hapi-auth-jwt2') }
    ];

    self._loadSettings();
    self._loadValidator();
    self._loadServer();
    self._loadTransporter();
    //self._loadModels();
    self._loadControllers();
    self._loadMethods();
    self._loadHandlers();

    self.server.register(_plugins, function (err) {
      if (err) {
        throw err;
      }

      self.server.auth.strategy('jwt', 'jwt', {
        key: self.settings.authKey || '0x123456789',
        validateFunc: self.validator,
        verifyOptions: { algorithms: [ 'HS256' ] }
      });

      self.server.auth.default('jwt');

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
    try {
      self.settings = require(path.join(APP_PATH, 'config/settings'));
    } catch (e) {
      if (e instanceof Error && e.code === 'MODULE_NOT_FOUND') {
        self.settings = { hapi: {} };
        return;
      }
    
      throw e;
    }
  },

  _loadValidator: function _loadValidator () {
    var self = this;
    var validator = requireIfExists(path.join(APP_PATH, 'config/validator'));
    if (validator) {
      self.validator = validator;
    } else {
      self.validator = function (decoded, request, callback) {
        return callback(null, true);
      }
    }
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

      var socketPluginsPath = path.join(APP_PATH, 'sockets');

      fs.readdirSync(socketPluginsPath).forEach(function (file) {
        require(path.join(socketPluginsPath, file))(socket);
        console.log('socket.io: [' + socket.id + '] loaded: ' + file.split('.')[0]);
      });
    });
  },

/*
  _loadModels: function _loadModels () {
    var self = this;

    var Sequelize = require('sequelize');
    var config = require(path.join(APP_PATH, 'config/database.json'))[NODE_ENV];
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
*/
  _loadHandlers: function _loadHandlers () {
    var self = this;
    
    try {
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
                  validate: route.validate,
                  auth: route.auth
                }
              });
  
              console.log(util.format('routing: %s %s -> %s', route.method, route.path, obj.name));
            });
          }
        }
      });
    } catch (e) {
      if (e instanceof Error && e.code === 'ENOENT') {
        return;
      }
      throw e;
    }
  },

  _loadControllers: function _loadControllers () {
    var self = this;

    try {
      fs
        .readdirSync(path.join(APP_PATH, 'controllers'))
        .filter(function(file) {
          return file.indexOf('.') !== 0;
        })
        .forEach(function (file) {
          var controller = require(path.join(APP_PATH, 'controllers/', file));
          self.controllers[controller.name] = controller;
          console.log('controller loaded: ' + controller.name);
        });
    } catch (e) {
      if (e instanceof Error && e.code === 'ENOENT') {
        return;
      }
      throw e;
    }
  },

  _loadRoutes: function _loadRoutes () {
    var self = this;
    var routes = requireIfExists(path.join(APP_PATH, 'config/routes'));
    if (routes) {
      self.server.route(routes(self.handlers));
    }
  },

  _loadMethods: function _loadMethods () {
    var self = this;
    var methods = requireIfExists(path.join(APP_PATH, 'config/methods'))
    if (methods) {
      self.server.method(methods);
    }
  },

  _loadTransporter: function _loadTransporter() {
    var self = this;
    self.server.app.transporter = require('nodemailer')
      .createTransport(self.settings.nodemailerOptions);

    self.transporter = self.server.app.transporter;
  }

};

function requireIfExists(path) {
  try {
     var required = require(path);
  } catch (e) {
    if (e instanceof Error && e.code === 'MODULE_NOT_FOUND') {
      return undefined;
    }
    throw e;
  }
  return required;
}

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

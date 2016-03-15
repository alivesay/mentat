'use strict';

var _ = require('lodash');
var util = require('util');
var path = require('path');
var fs = require('fs');
var requireDirectory = require('require-directory');
var cls = require('continuation-local-storage');

var ns = cls.createNamespace('mentat');

var NODE_ENV = process.env.NODE_ENV || 'development';
var APP_PATH = path.join(path.dirname(module.parent.filename), 'server');

var DEFAULT_SETTINGS = {
    auth: {
        key: undefined,
        tokenTTL: 0,
        validator: function validator (decoded, request, callback) {
            return callback(null, true);
        }
    },
    hapi: {
        serverOptions: {
        },
        connectionOptions: {
            host: NODE_ENV.IP || '0.0.0.0',
            port: NODE_ENV.PORT || 8080
        },
        pluginOptions: {
            'good': {
                opsInterval: 1000,
                reporters: [
                    {   reporter: require('good-console'),
                        events: { response: '*', log: '*' }
                    },
                    {   reporter: require('good-file'),
                        events: { error: '*' },
                        config: {
                            path: '/var/log/mentat',
                            rotate: 'daily' 
                        }
                    }
                ]
            }
        }
    }
};

var Mentat = {
    Handler: Handler,
    Controller: Controller,
    Namespace: ns,

    start: function start() {
        var self = this;

        self._loadSettings();

        var plugins = [
            { register: require('inert') },
            { register: require('hapi-auth-jwt2') },
            {
                register: require('good'),
                options: self.settings.hapi.pluginOptions['good']
            }
        ];

        self._loadValidator();
        self._loadServer();
        self._loadTransporter();
        self._loadModels();
        self._loadControllers();
        self._loadMethods();
        self._loadHandlers();

        self.server.register(plugins, function serverRegisterDone (err) {
            if (err) {
                throw err;
            }

            if (self.settings.auth.key) {

                self.server.auth.strategy('jwt', 'jwt', {
                    key: self.settings.auth.key,
                    validateFunc: self.validator,
                    verifyOptions: { algorithms: [ 'HS256' ] }
                });

                self.server.auth.default('jwt');

            }

            self._loadRoutes();

            self.server.start(function serverStartDone (err) {
                if (err) {
                    console.log(err);
                    return;
                }
                self.server.log(['info'], 'server listening: ' + self.server.info.uri);
                self._loadSockets();
            });

        });
    },

    _loadSettings: function _loadSettings () {
        var self = this;
        try {
            var settings = require(path.join(APP_PATH, 'config/settings'));
            self.settings = _.defaultsDeep(settings, DEFAULT_SETTINGS);
        } catch (e) {
            if (e instanceof Error && e.code === 'MODULE_NOT_FOUND') {
                self.settings = _.cloneDeep(DEFAULT_SETTINGS);
                return;
            }

            throw e;
        }
    },

    _loadValidator: function _loadValidator () {
        var self = this;
        self.validator = requireIfExists(path.join(APP_PATH, 'config/validator')) || self.settings.auth.validator;
    },

    _loadServer: function _loadServer() {
        var self = this;
        var Hapi = require('hapi');

        self.server = new Hapi.Server(self.settings.hapi.serverOptions);

        self.server.connection(self.settings.hapi.connectionOptions);
        
        self.server.ext('onRequest', function (request, reply) {
            ns.bindEmitter(request.raw.req);
            ns.bindEmitter(request.raw.res);
            ns.run(function () {
                ns.set('requestId', request.id);
                reply.continue();
            });
        });
    },

    _loadSockets: function _loadSockets () {
        var self = this;
        var io = require('socket.io')(self.server.listener);
        var socketioJwt = require('socketio-jwt');

        self.server.app.io = io;
        self.io = io;

        self.io.sockets
            .on('connection', socketioJwt.authorize({
                secret: self.settings.auth.key,
                timeout: 15000,
                required: false
            }))
            .on('authenticated', socketAuthenticated)
            .on('error', function (error) {
                console.log(error);
            });
                

        function socketAuthenticated (socket) {
            var remoteAddress = socket.client.conn.remoteAddress;

            console.log('socket.io: [' + socket.id + '] connected: ' + remoteAddress);

            var socketPluginsPath = path.join(APP_PATH, 'sockets');

            try {
                fs
                    .readdirSync(socketPluginsPath)
                    .filter(function (filename) {
                        return filename.indexOf('.') !== 0 && _.endsWith(filename, '.sockets.js')
                    })
                    .forEach(function (file) {
                        var socketsModule = requireIfExists(path.join(socketPluginsPath, file));
                        if (socketsModule) {
                            socketsModule(socket);
                            console.log('socket.io: [' + socket.id + '] loaded: ' + file.split('.')[0]);
                        }
                    });
            } catch (e) {
                if (e instanceof Error && e.code === 'ENOENT') {
                    return;
                }
                throw e;
            }
        }
    },


    _loadModels: function _loadModels () {
        var self = this;

        self.models = {};

        var Sequelize = require('sequelize');
        Sequelize.cls = ns;
        var config = require(path.join(APP_PATH, 'config/database.json'))[NODE_ENV];
        var sequelize = new Sequelize(config.database, config.username, config.password, config);
        var modelsPath = path.join(APP_PATH, 'db/models');

        fs
            .readdirSync(path.join(modelsPath))
            .filter(function(filename) {
                return filename.indexOf('.') !== 0 && _.endsWith(filename, '.js');
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

        try {
            self.handlers = requireDirectory(module, path.join(APP_PATH, 'handlers'), {
                whitelist: /.*\.handler\.js$/,
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
                                    handler: obj[route.handler] || obj[route.method],
                                    validate: route.validate,
                                    auth: route.auth
                                }
                            });

                            console.log(util.format('routing: %s %s -> %s\#%s', route.method, route.path, obj.name, route.handler || route.method));
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

        self.controllers = {};

        try {
            fs
                .readdirSync(path.join(APP_PATH, 'controllers'))
                .filter(function(filename) {
                    return filename.indexOf('.') !== 0 && _.endsWith(filename, '.controller.js');
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
        routes(self.handlers).map(function (route) {
            self.server.route(route);
            console.log(util.format('routing: %s %s', route.method, route.path));
        });
    },

    _loadMethods: function _loadMethods () {
        var self = this;
        var methods = requireIfExists(path.join(APP_PATH, 'config/methods'));
        if (methods) {
            self.server.method(methods);
        }
    },

    _loadTransporter: function _loadTransporter() {
        var self = this;
        self.server.app.transporter = require('nodemailer')
            .createTransport(require('nodemailer-smtp-transport')(self.settings.nodemailerOptions));

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
    };
};

function Controller(name, obj) {
    this.name = name + 'Controller';
    _.extend(this, obj);
}

module.exports = Mentat;

var Mentat = require('../../..');

function simpleResponse(options, callback) {
  return callback(null, 'simpleResponse');
}

function defaultResponderError(options, callback) {
  return callback(true, 'defaultResponderError');
}

module.exports = new Mentat.Controller('Controllers', {
  simpleResponse: simpleResponse,
  defaultResponderError: defaultResponderError
});

var Mentat = require('..');
var mocha = require('mocha');
var chai = require('chai');
var chaiHttp = require('chai-http');
var expect = chai.expect;

chai.use(chaiHttp);

Mentat.start();

var server = Mentat.server.listener;

// BasicHTTP
it('should return 200 on /BasicHTTP/Test200', function(done) {
    chai.request(server)
      .get('/BasicHTTP/Test200')
      .end(function(err, res) {
          expect(err).to.be.null;
          expect(res).to.have.status(200);
          done();
      });
});

it('should return 400  on /BasicHTTP/defaultResponderError', function(done) {
    chai.request(server)
      .get('/BasicHTTP/defaultResponderError')
      .end(function(err, res) {
        expect(err).to.not.be.null;
        expect(res).to.have.status(400);
        expect(res).to.be.json;
        expect(JSON.parse(res.text)).to.deep.equal({
            statusCode: 400,
            error: 'Bad Request',
            message: 'defaultResponderError'
        });
        done();
      });
});

// Controllers
it('should return expected on /Controllers/simpleResponse', function(done) {
    chai.request(server)
      .get('/Controllers/simpleResponse')
      .end(function(err, res) {
        expect(err).to.be.null;
        expect(res).to.have.status(200);
        expect(res.text).to.equal('simpleResponse');
        done();
      });
});



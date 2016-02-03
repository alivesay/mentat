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


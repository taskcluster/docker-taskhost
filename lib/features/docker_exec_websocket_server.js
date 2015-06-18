const MAX_RANDOM_PORT_ATTEMPTS = 20;

var debug = require('debug')('docker-worker:features:docker_exec_websocket_server.js');
var DockerExecServer = require('docker-exec-websocket-server').DockerExecServer;
// var waitForPort = require('../wait_for_port');
var http = require('http');
var slugid = require('slugid');
var Promise = require('promise');
var url = require('url');

export default class WebsocketServer {
  constructor () {
    this.path = '/' + slugid.v4();
    // this.path = '/a';
  }

  async started (task) {
    debug('creating ws server');
    //TODO: add https support
    var httpServ = http.createServer();
    var port;
    //searching for an open port between 32768 and 61000
    var attempts = 0;
    while (true) {
      // port = 40836;
      port = Math.floor((Math.random() * (61000 - 32768)) + 32768); 
      try {
        await (new Promise((resolve, reject) => {
          httpServ.listen(port);
          httpServ.once('listening', () => {
            httpServ.removeListener('error', reject);
            resolve();
          });
          httpServ.once('error', reject)}));
        break;
      } catch (err) {
        // Only handle address in use errors.
        if (err.code !== 'EADDRINUSE') {
          throw err;
        }
        attempts += 1;
        if (attempts >= MAX_RANDOM_PORT_ATTEMPTS) {
          throw err;
        }
      }
    }
    debug('port found', port);
    this.server = new DockerExecServer({
      server: httpServ,
      containerId: task.dockerProcess.id,
      path: this.path,
    });
    this.url = url.format({
      protocol: 'ws',
      slashes: true,
      hostname: task.hostname,
      port: port,
      pathname: this.path,
    });
    debug(this.url);

    var queue = task.runtime.queue;
    var expiration = new Date(Date.now() + 60 * 60 * 24);
    await queue.createArtifact(
      task.status.taskId,
      task.runId,
      'interactive', {
        storageType: 'reference',
        expires: expiration.toJSON(),
        contentType: 'text/plain', //any way to fix this?
        url: this.url
      }
    );
    
  }

  async killed (task) {
    this.server.close();
  }
}

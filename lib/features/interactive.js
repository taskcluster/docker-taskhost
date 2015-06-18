const MAX_RANDOM_PORT_ATTEMPTS = 20;

var debug = require('debug')('docker-worker:features:interactive');
var DockerExecServer = require('docker-exec-websocket-server').DockerExecServer;
var http = require('http');
var https = require('https');
var slugid = require('slugid');
var Promise = require('promise');
var url = require('url');
var fs = require('fs');

export default class WebsocketServer {
  constructor () {
    this.path = '/' + slugid.v4();
  }

  async started (task) {
    debug('creating ws server');
    var httpsOpt = true; //set this somewhere else later
    var httpServ;
    if (httpsOpt) {
      var readFile = Promise.denodeify(fs.readFile);
      var [key, cert] = await Promise.all([
        readFile(task.runtime.ssl.key),
        readFile(task.runtime.ssl.certificate)
      ]);
      httpServ = https.createServer({key, cert});
    } else {
      http.createServer();
    }
    var port;
    //searching for an open port between 32768 and 61000
    var attempts = 0;
    while (true) {
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
      protocol: 'wss',
      slashes: true,
      hostname: task.hostname,
      port: port,
      pathname: this.path,
    });
    debug(this.url);

    var queue = task.runtime.queue;
    debug('time %s',task.task.payload.maxRunTime);
    var expiration = new Date(Date.now() + task.task.payload.maxRunTime * 1000);
    await queue.createArtifact(
      task.status.taskId,
      task.runId,
      'private/mozilla/interactive.sock', {
        storageType: 'reference',
        expires: expiration.toJSON(),
        contentType: 'application/octet-stream',
        url: this.url
      }
    );
    debug('artifact made');
  }

  async killed (task) {
    this.server.close();
  }
}

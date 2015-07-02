import assert from 'assert';
import Debug from 'debug';
import {DockerExecServer} from 'docker-exec-websocket-server';
import fs from 'fs-ext'; //replace with mz/fs post node 0.12.x upgrade
import http from 'http';
import https from 'https';
import path from 'path';
import Promise from 'promise';
import { pullImageStreamTo } from '../pull_image_to_stream';
import slugid from 'slugid';
import url from 'url';
let debug = Debug('docker-worker:features:interactive');

//Number of attempts to find a port before giving up
const MAX_RANDOM_PORT_ATTEMPTS = 20;

class Semaphore {
  constructor(lockFile) {
    this.count = 0;
    this.lockFile = lockFile;
  }

  async acquire() {
    if(this.count === 0) {
      await Promise.denodeify(fs.flock)(this.lockFile, 'shnb', () => {
        debug('couldn\'t acquire lock, this is probably bad');
      });
    }
    this.count += 1;
    debug('acquire; count is %s', this.count);
  }

  async release(delay = 0) {
    if(delay > 0) {
      return(setTimeout(() => {this.release()}, delay));
    }
    debug('release before dec; count is %s', this.count);
    debug(this);
    assert(this.count > 0, "Internal error");
    this.count -= 1;
    debug('release after dec; count is %s', this.count);
    debug(this);
    if(this.count === 0) {
      await Promise.denodeify(fs.flock)(this.lockFile, 'un', () => {
        debug('couldn\'t unlock, this is probably bad');
      });
    }
    debug('release; count is %s', this.count);
  }
}

export default class WebsocketServer {
  constructor () {
    let id = slugid.v4();
    this.path = '/' + id;
    this.lock = path.join('/tmp/', id + '.lock');
  }

  async link(task) {
    debug('whats going on');
    this.lockFile = await Promise.denodeify(fs.open)(this.lock, 'w');

    return {
      binds: [{
        source: path.join(__dirname, '../../bin_utils'),
        target: '/.taskcluster_utils',
        readOnly: true
      }, {
        source: this.lock,
        target: '/tmp/interactive.lock',
        readOnly: false
      }]
    }
  }

  async started(task) {
    debug('creating ws server');
    let httpServ;
    if (task.runtime.interactive.ssl) {
      let readFile = Promise.denodeify(fs.readFile);
      let [key, cert] = await Promise.all([
        readFile(task.runtime.ssl.key),
        readFile(task.runtime.ssl.certificate)
      ]);
      httpServ = https.createServer({key, cert});
    } else {
      httpServ = http.createServer();
    }

    let port;
    //searching for an open port between 32768 and 61000
    let attempts = 0;
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

    //create the websocket server
    this.server = new DockerExecServer({
      server: httpServ,
      containerId: task.dockerProcess.id,
      path: this.path,
      // wrapperCommand: ['flock', '-s' , '/tmp/interactive.lock'],
    });

    //and its corresponding url
    let socketUrl = url.format({
      protocol: task.runtime.interactive.ssl ? 'wss' : 'ws',
      slashes: true,
      hostname: task.hostname,
      port: port,
      pathname: this.path,
    });

    //set expiration stuff
    this.semaphore = new Semaphore(this.lockFile);
    this.semaphore.acquire();
    this.semaphore.release(task.runtime.interactive.maxTime * 1000);
    this.server.on('session added', () => {
      this.semaphore.acquire();
    });
    this.server.on('session removed', () => {
      debug('this hook is working');
      this.semaphore.release(task.runtime.interactive.expirationAfterSession * 1000);
    });

    task.runtime.log('create websocket server ', {socketUrl});

    let expiration = new Date(Date.now() + task.task.payload.maxRunTime * 1000);
    let queue = task.runtime.queue;

    debug('\n\n\nlkjdsaflkeja\n\n\n\n\n\n');

    let artifact1 = queue.createArtifact(
      task.status.taskId,
      task.runId,
      'private/mozilla/interactive.sock', {
        storageType: 'reference',
        expires: expiration.toJSON(),
        contentType: 'application/octet-stream',
        url: socketUrl
      });

    let artifact2 = queue.createArtifact(
      task.status.taskId,
      task.runId,
      'private/mozilla/interactive.html', {
        storageType: 'reference',
        expires: expiration.toJSON(),
        contentType: 'text/html',
        url: url.format({
          protocol: 'https',
          host: 'tools.taskcluster.net',
          pathname: '/interactive',
          query: {
            taskId: task.status.taskId,
            runId: task.runId,
            socket: socketUrl
          }
        })
      });

    await Promise.all([artifact1, artifact2]);
    debug('artifacts made');
  }

  async killed (task) {
    if(this.server) {
      this.server.close();
    }
    fs.unlink(this.lock);
  }
}

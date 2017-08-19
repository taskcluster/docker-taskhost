import {spawn} from 'child_process';
import Debug from 'debug';
import Promise from 'promise';
import http from 'http'
import path from 'path';
import waitForPort from '../wait_for_port';

let debug = Debug('docker-worker-runtime:webhookserver');

const DEFAULT_TARGET_PORT = 61022;

class WebhookServer {
  /**
   * Create a new instance of webhookserver.
   * The whclient binary must be in bin-utils.
   * Default target port is 61022.
   *
   * @param {String} binPath - Location of whclient binary
   * @param {String} clientID - Taskcluster client ID
   * @param {String} accessToken - Taskcluster access token
   * @param {String} targetPort - Port to which connections should
   * forwared
   */
  constructor({clientId, accessToken}, targetPort){
    this.clientId = clientId;
    this.accessToken = accessToken;
    this.targetPort = targetPort;
    if(!clientId || !accessToken){
      throw "clientId and accessToken are required for WebhookServer";
    }
    if(targetPort == null)
      this.targetPort = DEFAULT_TARGET_PORT;

    this.hooks = {}

    // create a server for handling hooks
    this.server = http.createServer(this._handler)
    this.baseURL = '';
    this.path = path.join(__dirname, "../../bin-utils/whclient")
  }

  /**
   * Starts a local server to host hooks and connects to webhooktunnel.
   * Requests on tunnel endpoint are forwarded to local server.
   *
   * @example
   *
   * @return {String} - Tunnel endpoint on which worker is hosted
   */
  async start() {
    // start the whclient binary
    let startClient = new Promise((resolve, reject) => {
      this.proc = spawn(this.path, 
        [this.clientId, this.accessToken, this.targetPort],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

      proc.stdout.on('data', (data) => {
        try{
          let resp = JSON.parse(data);
          // if no url in server response
          if (resp.url === undefined) {
            return reject('no url in response');
          }
          return resolve(resp.url);
        }catch(e){
          return reject(e);
        }
      });

      proc.stderr.on('data', (data) => {
        return reject(data);
      });
    });

    try{
      this.baseURL = await startClient();
      this.server.listen(this.targetPort);
      return this.baseURL;
    }catch(e){
      throw e;
    }
  }

  /**
   * Handles requests to local server
   * 
   * @private
   */
  _handler(req, res) {
    // req url will start with '/'
    if (req.url.length() < 24 || req.url[23] !== '/') {
      //404
      return
    }
    let id = req.url.slice(1, 23);
    let path = req.url.slice(23);
    let hook = this.hooks[id];
    if (hook === undefined) {
      // 404
      return;
    }
    // rewrite url path
    req.url = path;
    return hook(req, res);
  }

  /**
   * Returns the url on which the worker is hosted
   *
   * @return {String}
   */
  url() {
    return this.baseURL;
  }

  /**
   * Adds a hook with a given ID to be handled by the server.
   * Returns a function which can be used to remove the hook.
   *
   * @param {String} id - ID of hook
   * @param {Function} hook - A function which handles http requests
   *
   * @return {Function}
   */
  addHook(id, hook) {
    if (this.hooks[id] !== undefined) {
      throw "hook already present";
    }
    this.hooks[id] = hook;
    return () => {
      this.hooks[id] = undefined;
    }
  }

  /**
   * Shutdown the whclient binary and exit
   */
  kill() {
    // send SIGKILL. Whclient will wait for connections to end
    // for 5 seconds before closing.
    this.proc.kill();
  }
}

module.exports = WebhookServer

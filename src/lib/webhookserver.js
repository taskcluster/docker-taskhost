import {spawn} from 'child_process';
import Debug from 'debug';
import Promise from 'promise';
import http from 'http'
import path from 'path';
import slugid from 'slugid';
import fs from 'mz/fs';
import chokidar from 'chokidar'
import {StringDecoder} from 'string_decoder';

let debug = Debug('docker-worker-runtime:webhookserver');

const DEFAULT_TARGET_PORT = 61022;

class WebhookServer {
  /**
   * Create a new instance of webhookserver.
   * The whclient binary must be in bin-utils.
   * Default target port is 61022.
   *
   * @param {} credentials - Taskcluster credentials
   * @param {String} targetPort - Port to which connections should
   * forwared
   */
  constructor(credentials, targetPort = DEFAULT_TARGET_PORT){
    this.clientId = credentials.clientId;
    this.accessToken = credentials.accessToken;
    this.certificate = credentials.certificate;
    this.targetPort = targetPort;
    if(!this.clientId){
      throw Error("clientId is required for WebhookServer");
    }
    if(!this.accessToken){
      throw Error("accessToken is required for WebhookServer");
    }

    this.hooks = {}

    // create a server for handling hooks
    let handler = this._handler();
    this.server = http.createServer(handler);
    this.baseURL = '';
    this.binPath = path.join(__dirname, "../../bin-utils/whclient")
  }

  /**
   * Starts a local server to host hooks and connects to webhooktunnel.
   * Requests on tunnel endpoint are forwarded to local server.
   *
   * @return {String} - Tunnel endpoint on which worker is hosted
   */
  async start() {
    // start the whclient binary
    let startClient = new Promise((resolve, reject) => {
      let outFile = slugid.nice();
      let args = [
        this.clientId,
        this.accessToken,
        this.targetPort,
        "--out-file",
        outFile
      ]

      if(this.certificate) {
        args.push("--cert", this.certificate);
      }

      let decoder = new StringDecoder('utf-8');

      this.proc = spawn(this.binPath, args);
      this.proc.on('exit', (code, signal) => {
        reject(Error("Webhookclient exited with code " + code))
      });

      let watcher = chokidar.watch('.');
      watcher.on('add', p => {
        if(path.basename(p) == outFile) {
          let url = decoder.write(fs.readFileSync(p));
          fs.unlinkSync(p);
          resolve(url);
        }
      });
    });

    try{
      this.baseURL = await startClient;
      this.server.listen(this.targetPort);
      debug("base url: %s", this.baseURL);
      return this.baseURL;
    }catch(e){
      throw e;
    }
  }

  /**
   * Generates a handler for requests to local server
   * 
   * @private
   */
  _handler() {
    let self = this;
    return (req, res) => {
      // req url will start with '/'
      if (req.url.length < 24 || req.url[23] !== '/') {
        res.statusCode = 404;
        res.write("Not Found\n");
        res.end();
        return
      }
      let id = req.url.slice(1, 23);
      let path = req.url.slice(23);
      let hook = self.hooks[id];
      if (hook === undefined) {
        // 404
        res.statusCode = 404;
        res.write("Not Found\n");
        res.end();
        return;
      }
      // rewrite url path
      req.url = path;
      return hook(req, res);
    }
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
      throw Error("Hook "+id+" is already present. Detach the hook fist.")
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

  static async startServer(credentials, targetPort = DEFAULT_TARGET_PORT) {
    let  webhookServer = null;
    try{
      webhookServer = new WebhookServer(credentials, targetPort);
      let url = await webhookServer.start();
      debug("webhookserver connected. hosted on "+url);
    }catch(e){
      webhookServer = null;
      debug("could not set up webhookserver: %s", e,message);
      // exit program if webhookServer cannot be set up
      process.exit(1);
    } 
    return webhookServer;
  }
}

module.exports = WebhookServer

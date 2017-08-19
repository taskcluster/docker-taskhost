import Debug from 'debug';
import taskcluster from 'taskcluster-client'
import BulkLog from './bulk_log';
import getLogsLocationsFromTask from './logs_location.js';
import slugid from 'slugid'
import temporary from 'temporary'
import fs from 'mz/fs'

const debug = Debug('taskcluster-docker-worker:features:webhooklog')

/**
 * ContinuousReader is a utility class which allows reading a file
 * which is continuously being written to. A single call to `readUntilEOF`
 * will read the file until EOF. Subsequent calls will continue reading 
 * from the point where the previous read ended.
 */
class ContinuousReader {
  constructor(path){
    this._path = path;
    this._offset = 0;
    this._stream = null;
  }

  readUntilEOF() {
    // create a new stream that will read until EOF
    this._stream = fs.createReadStream(this._path, {start: this._offset});
    // await this promise 
    return new Promise((resolve, reject) => {
      let buf = [];
      this._stream.once('error', reject);
      // add any new data to the buffer
      this._stream.on('data', data => buf = buf + data);
      // once EOF is reached, increment offset, close stream, and resolve
      // promise with buffer
      this._stream.on('end', () => {
        this._offset += this._stream.bytesRead;
        this._stream.close();
        return resolve(buf);
      });
    });
  }
}

/**
 * Signal is a utility class which is used for notifying readers when data
 * has been written to the file. It uses a single promise. The constructor
 * initializes the `_promise` and `_resolve` fields. When `send` is called,
 * the previous promise is resolved and the fields are reset. When `recv`
 * is called, the promise is returned. Multiple callers can await the same
 * promise.
 */
class Signal {
  constructor() {
    this._resolve = null;
    this._promise = new Promise(resolve => this._resolve = resolve);
  }

  send() {
    this._resolve();
    this._promise = new Promise(resolve => this._resolve = resolve);
  }

  recv() {
    return this._promise;
  }
}

/**
 * WebhookLogs enables task logs to be served over WebhookTunnel proxy.
 */
class WebhookLogs {
  constructor(){
    this.featureName = 'webhookLog'

    // function for detaching hook
    this._detach = null;
    this._logsLocation = null;
  }

  /**
   * link uses the webhookServer instance from runtime to serve task
   * logs over webhookTunnel.
   */
  async link(task){
    debug('attempting to add hook to webhookserver')
    let webhookServer = task.runtime.webhookServer;
    // if webhookServer could not be set up, fail with
    // proper error message
    if(webhookServer === null) {
      throw "cannot add hook since webhookServer was not set up";
    }

    let signal = new Signal();

    debug('creating temporary log file');
    this._logFile = new temporary.File();
    this._logStream = fs.createWriteStream(this._logFile.path);
    task.stream.pipe(this._logStream);
    task.stream.on('data', () => signal.send());
    task.stream.on('end', () => signal.send());

    // add the bulk log
    this._logsLocation = getLogsLocationsFromTask(task);
    this._bulkLog = new BulkLog(this._logsLocation.backing);
    await this._bulkLog.created(task);

    // create hook ID and hook to add to the WebhookServer
    let hookID = slugid.nice() + slugid.nice();
    let hook = async function(req, res) { 
      let reader = new ContinuousReader(this._logFile.path);
      try{
        while(task.state === 'running' && !res.finished){
          let data = await reader.readUntilEOF();
          res.write(data);
          await sig.recv();
        }  
      }finally{
        res.end();
      }
    }
    // add the webhook and get the detach function
    this._detach = webhookServer.addHook(hookID, hook);

    // build the publicUrl of the log
    let publicUrl = webhookServer.url() + "/" + hookID + "/";

    // redirect artifact
    let queue = task.queue;
    let expiration = taskcluster.fromNow(task.runtime.logging.bulkLogExpires);
    expiration = new Date(Math.min(expiration, new Date(task.task.expires)));

    // create the redirect artifact
    await queue.createArtifact(
      task.status.taskId,
      task.runId,
      this._logsLocation.live,
      {
        storageType: 'reference',
        expires: expiration,
        contentType: 'text/plain',
        url: publicUrl
      }
    );

    return {
      links: [],
      env: {}
    };
  }

  async killed(task){
    try{
      // switch the reference to the bulkLog
      let backingUrl = await this._bulkLog.killed(task);

      let expiration = taskcluster.fromNow(task.runtime.logging.bulkLogExpires);
      expiration = new Date(Math.min(expiration, new Date(task.task.expires)));
      // upload new artifact to switch the reference
      await queue.createArtifact(
        task.status.taskId,
        task.runId,
        this._logsLocation.live,
        {
          storageType: 'reference',
          expires: expiration,
          contentType: 'text/plain',
          url: this.publicUrl
        }
      );
    }finally{
      // close the logStream
      this._logStream.close();
      // remove the hook from the WebhookServer
      this._detach();
      // unlink temp file
      fs.unlinkSync(this._logFile.path);
    }
  }
}

module.exports = WebhookLogs;

/**
The bulk logger writes the task stream directly to disk then uploads that file
to s3 after the task has completed running.
*/

var streamClosed = require('../stream_closed');
var waitForEvent = require('../wait_for_event');
var temporary = require('temporary');
var fs = require('fs');
var request = require('superagent-promise');
var debug = require('debug')('taskcluster-docker-worker:features:bulk_log');
var util = require('util');
var zlib = require('zlib');

var Promise = require('promise');

var PREFIX = 'public/logs';

function BulkLog() {}

BulkLog.prototype = {

  created: function* (task) {
    this.logs = Object.keys(task.logs).reduce(function(result, name) {
      var log = task.logs[name];
      var gzip = zlib.createGzip();
      var file = new temporary.File();
      debug('Created bulk log using file: ', file.path);
      var stream = fs.createWriteStream(file.path);
      log.stream.pipe(gzip).pipe(stream);

      result[name] = {
        artifact: util.format('%s/%s.log.gz', PREFIX, log.alias),
        stream: stream,
        path: file.path
      }

      return result;
    }, {});
  },

  uploadStream: function* (task, log) {
    var queue = task.runtime.queue;

    // Create date when this artifact should expire (see config).
    var expiration =
      new Date(Date.now() + task.runtime.logging.bulkLogExpires);

    var artifact = yield queue.createArtifact(
      task.status.taskId,
      task.runId,
      log.artifact,
      {
        // Why s3? It's currently cheaper to store data in s3 this could easily
        // be used with azure simply by changing s3 -> azure.
        storageType: 's3',
        expires: expiration.toJSON(),
        contentType: 'text/plain'
      }
    );

     var stat = yield fs.stat.bind(fs, log.path);

    // Open a new stream to read the entire log from disk (this in theory could
    // be a huge file).
    var diskStream = fs.createReadStream(log.path);

    // Stream the entire file to S3 it's important to set the content length and
    // content type (in particular the content-type must be identical to what is
    // sent over in the artifact creation.)
    var req = request.put(artifact.putUrl).set({
      'Content-Type': 'text/plain',
      'Content-Length': stat.size,
      'Content-Encoding': 'gzip'
    });

    diskStream.pipe(req);
    req.end();

    // Wait until the request has completed and the file has been uploaded...
    var result = yield waitForEvent(req, 'end');

    // Unlink the temp file.
    yield fs.unlink.bind(fs, log.path);

    var url = queue.buildUrl(
      queue.getArtifact,
      task.status.taskId,
      task.runId,
      log.artifact
    );
    return url;
  },

  killed: function* (task) {
    // Ensure all the streams are closed...
    yield Object.keys(this.logs).map(function(name) {
      return streamClosed(this.logs[name].stream);
    }, this);

    return yield Object.keys(this.logs).reduce(function(result, name) {
      result[name] = {
        url: this.uploadStream(task, this.logs[name])
      }
      return result;
    }.bind(this), {});
  }

};

module.exports = BulkLog;

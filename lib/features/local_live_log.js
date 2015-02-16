/**
This module handles the creation of the "taskcluster" proxy container which
allows tasks to talk directly to taskcluster services over a http proxy which
grants a particular permission level based on the task scopes.
*/

var URL = require('url');
var http = require('http');
var waitForEvent = require('../wait_for_event');
var waitForPort = require('../wait_for_port');
var pullImage = require('../pull_image_to_stream');
var util = require('util');

var BulkLog = require('./bulk_log');
var Promise = require('promise');

var PREFIX = 'public/logs';
var INIT_TIMEOUT = 2000;

var debug = require('debug')(
  'taskcluster-docker-worker:features:local_live_log'
);

// Alias used to link the proxy.
function TaskclusterLogs() {
  this.bulkLog = new BulkLog();
}

TaskclusterLogs.prototype = {
  createLog: function* (task, log) {
    debug('create live log container...')
    // ensure we have a bulk log backing stuff...
    var docker = task.runtime.docker;
    // Image name for the proxy container.
    var image = task.runtime.taskclusterLogImage;

    yield pullImage(docker, image, process.stdout);

    var envs = [];
    if (process.env.DEBUG) {
      envs.push('DEBUG=' + process.env.DEBUG);
    }

    // create the container.
    var container = yield docker.createContainer({
      Image: image,
      Tty: true,
      Env: envs,
      //Env: envs,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      ExposedPorts: {
        '60023/tcp': {}
      }
    });

    // Terrible hack to get container promise proxy.
    container = docker.getContainer(container.id);

    // TODO: In theory the output of the proxy might be useful consider logging
    // this somehow.
    yield container.start({
      // bind the reading side to the host so we can expose it to the world...
      PortBindings: {
        "60023/tcp": [{ HostPort: "0" }]
      }
    });
    var inspect = yield container.inspect();

    try {
      // wait for the initial server response...
      yield waitForPort(
        inspect.NetworkSettings.IPAddress, '60022', INIT_TIMEOUT
      );
    } catch (e) {
      task.runtime.log('Failed to connect to live log server', {
        taskId: task.status.taskId,
        runId: task.runId
      });
      // The killed method below will handle cleanup of resources...
      return
    }
    // Log PUT url is only available on the host itself
    var putUrl = 'http://' + inspect.NetworkSettings.IPAddress + ':60022/log';
    var opts = URL.parse(putUrl);
    opts.method = 'put';

    var stream = http.request(opts);

    // Note here that even if the live logging server or upload fails we don't
    // care too much since the backing log should always work... So we basically
    // want to handle errors just enough so we don't accidentally fall over as
    // we switch to the backing log.
    stream.on('error', function(err) {
      task.runtime.log('Error piping data to live log', {
        err: err.toString(),
        taskId: task.status.taskId,
        runId: task.runId
      });
      log.stream.unpipe(stream);
    }.bind(this));
    log.stream.pipe(stream);

    var publicPort = inspect.NetworkSettings.Ports['60023/tcp'][0].HostPort;
    var publicUrl = 'http://' + task.runtime.host + ':' + publicPort + '/log';
    debug('live log running', putUrl)

    var queue = task.runtime.queue;

    // Intentionally used the same expiration as the bulkLog
    var expiration =
      new Date(Date.now() + task.runtime.logging.bulkLogExpires);

    var artifactName = util.format('%s/%s.log', PREFIX, log.alias);

    // Create the redirect artifact...
    yield queue.createArtifact(
      task.status.taskId,
      task.runId,
      artifactName,
      {
        storageType: 'reference',
        expires: expiration,
        contentType: 'text/plain',
        url: publicUrl
      }
    );

    return {
      container: container,
      stream: stream,
      artifact: artifactName
    };
  },

  created: function* (task) {
    // Initialize the backing logs...
    yield this.bulkLog.created(task);

    // Initialize live logger infra for each log.
    this.logs = yield Object.keys(task.logs).reduce(function(results, name) {
      var log = task.logs[name];
      results[name] = this.createLog(task, log);
      return results;
    }.bind(this), {});
  },

  killed: function*(task) {
    debug('switching live log redirect to backing log...')

    // Note here we don't wait or care for the live logging to complete
    // correctly we simply let it pass/fail to finish since we are going to kill
    // the connection anyway...

    var stats = task.runtime.stats;
    var backingUrls = yield this.bulkLog.killed(task)

    // Switch references to the new log file on s3 rather then the local worker
    // server...
    var expiration =
      new Date(Date.now() + task.runtime.logging.bulkLogExpires);

    yield Object.keys(this.logs).map(function(name) {
      var liveLog = this.logs[name];

      if (!liveLog) {
        // in this case of some terrible error we may not have a log entry.
        return;
      }

      var backingLog = backingUrls[name];

      // Cleanup all references to the live logging server...
      task.runtime.gc.removeContainer(liveLog.container.id);

      return task.runtime.queue.createArtifact(
        task.status.taskId,
        task.runId,
        liveLog.artifact,
        {
          storageType: 'reference',
          expires: expiration,
          contentType: 'text/plain',
          url: backingLog.url
        }
      );
    }, this);
  }
};

module.exports = TaskclusterLogs;


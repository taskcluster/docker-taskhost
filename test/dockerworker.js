var devnull = require('dev-null');
var path = require('path');
var util = require('util');
var docker = require('../build/lib/docker')();
var dockerOpts = require('dockerode-options');
var DockerProc = require('dockerode-process');
var dockerUtils = require('dockerode-process/utils');
var waitForEvent = require('../build/lib/wait_for_event');

var Promise = require('promise');

const IMAGE = 'taskcluster/docker-worker-test:latest';

function waitForMessage(listener, event, data) {
  return new Promise(function(accept) {
    listener.on(event, function filter(value) {
      if (value.toString().indexOf(data) !== -1) {
        listener.removeListener(event, filter);
        return accept();
      }
      process.stdout.write(value);
    });
  });
}

// Environment varibles to copy over to the docker instance.
var COPIED_ENV = [
  'DEBUG',
  'DOCKER_HOST',
  'PULSE_USERNAME',
  'PULSE_PASSWORD',
  'TASKCLUSTER_BASE_URL',
];

function eventPromise(listener, event) {
  return new Promise(function(accept, reject) {
    listener.on(event, function(message) {
      accept(message);
    });
  });
}

export default class DockerWorker {
  constructor(provisionerId, workerType, workerId) {
    this.provisionerId = provisionerId;
    this.workerType = workerType;
    this.workerId = workerId;
  }

  async launch() {
    var stream = dockerUtils.pullImageIfMissing(docker, IMAGE);
    stream.pipe(devnull());
    await waitForEvent(stream, 'end');

    var createConfig = {
      name: this.workerId,
      Image: IMAGE,
      Cmd: [
        '/bin/bash', '-c',
         [
          // mount the securityfs in the container so that we can access apparmor
          'mount',
          '-tsecurityfs',
          'securityfs',
          '/sys/kernel/security',
          '&&',
          `node /worker/build/bin/worker.js`,
          '--host test',
          '--worker-group', 'random-local-worker',
          '--worker-id', this.workerId,
          '--provisioner-id', this.provisionerId,
          '--worker-type', this.workerType,
          'test'
         ].join(' ')
      ],
      Env: [
        'DOCKER_CONTAINER_ID=' + this.workerId
      ],
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Privileged: true,
      // Allow talking to other docker containers directly...
      NetworkMode: 'host',

      Binds: [
        util.format('%s:%s', path.resolve(__dirname, '..'), '/worker'),
        '/tmp:/tmp',
        '/etc/apparmor.d:/etc/apparmor.d',
      ],
    };

    // If docker is supposed to connect over a socket set the socket as a bind
    // mount...
    var opts = dockerOpts();
    if (opts.socketPath) {
      createConfig.Binds.push(util.format(
        '%s:%s',
        opts.socketPath, '/var/run/docker.sock'
      ));
    }

    // Copy enviornment variables over.
    COPIED_ENV.forEach(function(key) {
      if (!(key in process.env)) return;
      createConfig.Env.push(util.format('%s=%s', key, process.env[key]));
    });

    var proc = this.process = new DockerProc(docker, {
      create: createConfig,
      start: {}
    });

    proc.run();
    return proc;
  }

  async terminate() {
    if (this.process) {
      var proc = this.process;
      // Ensure the container is killed and removed.
      await proc.container.kill();
      await proc.container.remove();
      this.process = null;
    }
  }
}

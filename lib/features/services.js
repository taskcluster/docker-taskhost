/**
Services are a taskcluster specific wrapper around "linking" various docker
containers to one another this module deals with starting the containers and
returning the aliases which task.js will use to link into the primary container.
*/
var Promise = require('promise');

var formatDockerEnv = require('../format_docker_env');
var debug = require('debug')(
  'taskcluster-docker-worker:features:services'
);

function Services() {
  this.containers = [];
}

Services.prototype = {

  createService: function* (ctx, service) {
    var docker = ctx.runtime.docker;
    var taskId = ctx.status.taskId;
    var runId = ctx.runId;

    var image = service.image;
    var env = {};

    if (service.env) {
      for (var key in service.env) {
        env[key] = service.env[key];
      }
    }

    // Universal environment variables that could be useful.
    env.TASK_ID = taskId;
    env.RUN_ID = runId;

    var container = yield docker.createContainer({
      Image: image,
      Cmd: service.command,
      Hostname: '',
      User: '',
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      OpenStdin: false,
      StdinOnce: false,
      Env: formatDockerEnv(env)
    });

    // Get container reference in full.
    container = docker.getContainer(container.id);

    yield container.start();

    var inspect = yield container.inspect();
    var name = inspect.Name.slice(1)

    this.containers.push(container);
    return { name: name, alias: service.alias };
  },

  link: function* (ctx) {
    var payload = ctx.task.payload;

    // Bail if we have no services to wire up...
    if (!payload.services) {
      return [];
    }

    var links = payload.services.map(function(service) {
      return this.createService(ctx, service);
    }, this);

    return yield links
  },

  killed: function*(task) {
    this.containers.forEach(function(container) {
      task.runtime.gc.removeContainer(container.id);
    });
    this.containers = [];
  }
};

module.exports = Services;

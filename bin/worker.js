var fs = require('fs');
var os = require('os');
var program = require('commander');
var co = require('co');
var taskcluster = require('taskcluster-client');
var base = require('taskcluster-base');
var createLogger = require('../lib/log');
var debug = require('debug')('docker-worker:bin:worker');

var Runtime = require('../lib/runtime');
var TaskListener = require('../lib/task_listener');
var ShutdownManager = require('../lib/shutdown_manager');
var Stats = require('../lib/stats/stat');
var GarbageCollector = require('../lib/gc');
var VolumeCache = require('../lib/volume_cache');
var PrivateKey = require('../lib/private_key');
var reportHostMetrics = require('../lib/stats/host_metrics');

// Available target configurations.
var allowedHosts = ['aws', 'test'];

// All overridable configuration options from the CLI.
var overridableFields = [
  'capacity',
  'workerId',
  'workerType',
  'workerGroup',
  'workerNodeType',
  'provisionerId'
];

function sanitizeGraphPath() {
  return Array.prototype.slice.call(arguments).reduce(function(result, v) {
    if (!v) return result;
    // Remove any dots which can get confused...
    result.push(v.replace('.', '-'));
    return result;
  }, []).join('.');
}

function verifySSLCertificates(config) {
  try {
    fs.statSync(config.ssl.certificate);
    fs.statSync(config.ssl.key);
  }
  catch (error) {
    config.log(
      '[alert-operator] ssl certificate error',
      {
        error: `Could not locate SSL files. Error code: ${error.code}`
      }
    );
    // If certificates can't be found for some reason, set capacity to 0 so
    // we do not continue to respawn workers that could probably have the same
    // issue
    config.capacity = 0;
  }
}

// Terrible wrapper around program.option.
function o() {
  program.option.apply(program, arguments);
}

// Usage.
program.usage(
'[options] <profile> \n\n' +
'  Configuration is loaded in the following order (lower down overrides): ' +
'\n\n' +
'      1. docker-worker/config/defaults \n' +
'      2. docker-worker/config/<profile> \n' +
'      3. $PWD/docker-worker.conf.json \n' +
'      4. ~/docker-worker.conf.json \n' +
'      5. /etc/docker-worker.conf.json \n' +
'      6. Host specific configuration (userdata, test data, etc..) \n' +
'      7. Command line flags (capacity, workerId, etc...)'
);

// CLI Options.
o('--host <type>',
  'configure worker for host type [' + allowedHosts.join(', ') + ']');
o('-c, --capacity <value>', 'capacity override value');
o('--provisioner-id <provisioner-id>','override provisioner id configuration');
o('--worker-type <worker-type>', 'override workerType configuration');
o('--worker-group <worker-group>', 'override workerGroup');
o('--worker-id <worker-id>', 'override the worker id');
o('--worker-node-type <worker-node-type>', 'override the worker node type');

program.parse(process.argv);

// Main.
co(function *() {
  var profile = program.args[0];

  if (!profile) {
    console.error('Config profile must be specified: test, production');
    return process.exit(1);
  }

  var workerConf = base.config({
    defaults: require('../config/defaults'),
    profile: require('../config/' + profile),
    filename: 'docker-worker'
  });

  // Load all base configuration that is on disk / environment variables /
  // flags.
  var config = yield workerConf.load.bind(workerConf);

  // Use a target specific configuration helper if available.
  var host;
  if (program.host) {
    if (allowedHosts.indexOf(program.host) === -1) {
      console.log(
        '%s is not an allowed host use one of: %s',
        program.host,
        allowedHosts.join(', ')
      );
      return process.exit(1);
    }

    host = require('../lib/host/' + program.host);

    // execute the configuration helper and merge the results
    var targetConfig = yield host.configure();
    for (var key in targetConfig) {
      config[key] = targetConfig[key];
    }
  }

  // process CLI specific overrides
  overridableFields.forEach(function(field) {
    if (!(field in program)) return;
    config[field] = program[field];
  });

  // If isolated containers is set override capacity...
  if (config.isolatedContainers) {
    // One capacity per core...
    config.capacity = os.cpus().length;
    config.deviceManagement.cpu.enabled = true;
    debug('running in isolated containers mode...');
  }

  debug('configuration loaded', config);

  // Initialize the classes and objects with core functionality used by higher
  // level docker-worker components.
  config.docker = require('../lib/docker')();

  // Default to always having at least a capacity of one.
  config.capacity = config.capacity || 1;

  // Wrapped stats helper to support generators, etc...
  config.stats = new Stats(config);
  config.stats.record('workerStart', Date.now()-os.uptime() * 1000);

  config.queue = new taskcluster.Queue({
    credentials: config.taskcluster,
    stats: base.stats.createAPIClientStatsHandler({
      drain: config.stats.influx,
      tags: {
        component: 'docker-worker',
        workerId: config.workerId,
        workerGroup: config.workerGroup,
        workerType: config.workerType,
        instanceType: config.workerNodeType,
        provisionerId: config.provisionerId
      }
    })
  });

  config.scheduler =
    new taskcluster.Scheduler({ credentials: config.taskcluster });
  config.schema = require('../lib/schema')();

  // Only catch these metrics when running on aws host.  Running within
  // test environment causes numerous issues.
  if (host === 'aws') {
    base.stats.startProcessUsageReporting({
      drain: config.stats.influx,
      component: 'docker-worker',
      process: 'docker-worker'
    });
  }

  setInterval(
    reportHostMetrics.bind(this, config),
    config.metricsCollection.hostMetricsInterval
  );

  config.log = createLogger({
    source: 'top', // top level logger details...
    provisionerId: config.provisionerId,
    workerId: config.workerId,
    workerGroup: config.workerGroup,
    workerType: config.workerType,
    workerNodeType: config.workerNodeType
  });

  var gcConfig = config.garbageCollection;
  gcConfig.capacity = config.capacity,
  gcConfig.diskspaceThreshold = config.capacityManagement.diskspaceThreshold;
  gcConfig.dockerVolume = config.dockerVolume;
  gcConfig.docker = config.docker;
  gcConfig.log = config.log;


  config.gc = new GarbageCollector(gcConfig);

  config.volumeCache = new VolumeCache(config);

  config.gc.on('gc:container:removed', function (container) {
    container.caches.forEach(co(function* (cacheKey) {
      yield config.volumeCache.release(cacheKey);
    }));
  });

  config.gc.addManager(config.volumeCache);

  var runtime = new Runtime(config);

  // Instantiate PrivateKey object for decrypting secure data
  // (currently encrypted environment variables)
  runtime.privateKey = new PrivateKey(runtime.dockerWorkerPrivateKey);

  // Billing cycle logic is host specific so we cannot handle shutdowns without
  // both the host and the configuration to shutdown.
  if (host && config.shutdown) {
    runtime.log('handle shutdowns');
    var shutdownManager = new ShutdownManager(host, runtime);
    // Recommended by AWS to query every 5 seconds.  Termination window is 2 minutes
    // so at the very least should have 1m55s to cleanly shutdown.
    yield shutdownManager.scheduleTerminationPoll();
    runtime.shutdownManager = shutdownManager;
  }

  if (runtime.logging.secureLiveLogging) {
    verifySSLCertificates(runtime);
  }

  // Build the listener and connect to the queue.
  var taskListener = new TaskListener(runtime);
  runtime.gc.taskListener = taskListener;
  shutdownManager.observe(taskListener);

  yield taskListener.connect();

  runtime.log('start');

  // Aliveness check logic... Mostly useful in combination with a log inactivity
  // check like papertrail/logentries/loggly have.
  function* alivenessCheck() {
    var uptime = host.billingCycleUptime();
    runtime.log('aliveness check', {
      alive: true,
      uptime: uptime,
      interval: config.alivenessCheckInterval
    });
    setTimeout(co(alivenessCheck), config.alivenessCheckInterval)
  }

  // Always run the initial aliveness check during startup.
  yield alivenessCheck();

  // Test only logic for clean shutdowns (this ensures our tests actually go
  // through the entire steps of running a task).
  if (workerConf.get('testMode')) {
    // Gracefullyish close the connection.
    process.once('message', co(function* (msg) {
      if (msg.type !== 'halt') return;
      // Halt will wait for the worker to be in an idle state then pause all
      // incoming messages and close the connection...
      function* halt() {
        taskListener.pause();
        yield taskListener.close();
      }
      if (taskListener.isIdle()) return yield halt;
      taskListener.once('idle', co(halt));
    }));
  }
})(function(err) {
  if (!err) return;
  // Top level uncaught fatal errors!
  console.error(err);
  throw err; // nothing to do so show a message and crash
});

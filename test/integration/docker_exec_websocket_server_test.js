var DockerWorker = require('../dockerworker');
var TestWorker = require('../testworker');
var assert = require('assert');
var cmd = require('./helper/cmd');
var debug = require('debug')('docker-worker:test:docker_exec_websocket_server_test')
// var waitForEvent = require('../../lib/wait_for_event');
var slugid = require('slugid');
var DockerExecClient = require('docker-exec-websocket-server').DockerExecClient;
var request = require('superagent-promise');
var Promise = require('promise');

suite('use docker exec websocket server', () => {
  let worker;
  setup(async () => {
    worker = new TestWorker(DockerWorker);
    await worker.launch();
  });

  teardown(async () => {
    if (worker) {
      await worker.terminate();
      worker = null;
    }
  });
  test('cat', async () => {
    let taskId = slugid.v4();
  	let task = {
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd('sleep 40'),
        maxRunTime: 2 * 60,
        features: {
          interactive: true
        }
      }
    };
    debug('posting to queue');

    var client;

    let resultPromise = worker.postToQueue(task, taskId);
    var passed = false;
    setTimeout(async () => {
      var getWith303Redirect = async (url) => {
        var res;
        try {
          res = await request.get(url).redirects(0).end();
        }
        catch(err) {
          res = err.response;
        }
        return res.headers.location;
      };

      var url = await getWith303Redirect(worker.queue.buildSignedUrl(
        worker.queue.getLatestArtifact,
        taskId,
        'interactive',
        {expiration: 60 * 5}));

      assert(url, 'artifact not found');

      client = new DockerExecClient({
        tty: false,
        command: ['cat'],
        url: url,
      });
      await client.execute();

      var buf = new Buffer([0xfa, 0xff, 0x0a]);
      client.stdin.write(buf);
      client.stdout.on('data', (message) => {
        assert(buf[0] === message[0], 'message wrong!');
        assert(buf[1] === message[1], 'message wrong!');
        assert(buf[2] === message[2], 'message wrong!');
        passed = true;
        debug('test finished!');
      });
    }, 20000);
    var promise = new Promise((resolve, reject) => {
      setTimeout(() => {
        if (passed) {
          resolve();
        } else {
          reject();
        };
      }, 30000);
    });
    debug('test setup');
    await promise;
  });
});

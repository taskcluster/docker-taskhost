var DockerWorker = require('../dockerworker');
var TestWorker = require('../testworker');
var assert = require('assert');
var cmd = require('./helper/cmd');
var debug = require('debug')('docker-worker:test:docker_exec_websocket_server_test')
var slugid = require('slugid');
var DockerExecClient = require('docker-exec-websocket-server').DockerExecClient;
var request = require('superagent-promise');
var Promise = require('promise');
var base = require('taskcluster-base');

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
        image: 'busybox',
        command: cmd('sleep 15'),
        maxRunTime: 2 * 60,
        features: {
          interactive: true
        }
      }
    };
    debug('posting to queue');
    var resultPromise = worker.postToQueue(task, taskId);
    
    var passed = false;

    async function getWithoutRedirect (url) {
      var res;
      try {
        res = await request.get(url).redirects(0).end();
      }
      catch (err) {
        res = err.response; //do something better w/ the error here
      }
      return res.headers.location;
    };
    var signedUrl = worker.queue.buildSignedUrl(
        worker.queue.getLatestArtifact,
        taskId,
        'private/mozilla/interactive.sock',
        {expiration: 60 * 5});

    var url;
    await base.testing.poll(async () => {
      url = await getWithoutRedirect(signedUrl);
      assert(url, 'artifact not found');
    }, 20, 1000);

    var client = new DockerExecClient({
      tty: false,
      command: ['cat'],
      url: url,
      wsopts: {rejectUnauthorized: false}
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
    
    await new Promise(accept => client.socket.once('close', accept));
    assert(passed);
  });
});

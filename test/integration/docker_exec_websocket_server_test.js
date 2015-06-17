var DockerWorker = require('../dockerworker');
var TestWorker = require('../testworker');
var assert = require('assert');
var cmd = require('./helper/cmd');
var debug = require('debug')('docker-worker:test:docker_exec_websocket_server_test')
// var waitForEvent = require('../../lib/wait_for_event');
var slugid = require('slugid');
var DockerExecClient = require('docker-exec-websocket-server').DockerExecClient;

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
  	let task = {
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd('sleep 60'),
        maxRunTime: 2 * 60,
        features: {
          interactive: true
        }
      }
    };
    debug('posting to queue');

    let resultPromise = worker.postToQueue(task);
    var passed = false;
    setTimeout(async () => {
      var client = new DockerExecClient({
        tty: false,
        command: 'cat',
        url: 'ws://localhost:40836/a',
      });
      await client.execute();
      var buf1 = new Uint8Array([0xfa, 0xff, 0x0a]);
      client.stdin.write(buf1);
      client.stdout.on('data', (message) => {
        var buf = new Buffer([0xfa, 0xff, 0x0a]);
        assert(buf.compare(message) === 0, 'message wrong!');
        passed = true;
        debug('test finished!');
      });
    }, 30000);
    setTimeout(() => {
      assert(passed, 'returning cat message not recieved');
    }, 35000);
    debug('waiting for')
    resultPromise.then(() => debug('whats wrong with this thing'));
    await resultPromise;
    debug('godot')
  });
});

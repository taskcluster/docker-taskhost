var DockerWorker = require('../dockerworker');
var TestWorker = require('../testworker');
var assert = require('assert');
var cmd = require('./helper/cmd');
var debug = require('debug')('docker-worker:test:docker_exec_websocket_server_test')
// var waitForEvent = require('../../lib/wait_for_event');
var slugid = require('slugid');
// var DockerExecClient = require('docker-exec-websocket-server').DockerExecClient;

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
        command: cmd('sleep 30'),
        maxRunTime: 40,
        features: {
          interactive: true
        }
      }
    };

    let resultPromise = worker.postToQueue(task);
    var client = new DockerExecClient({
      tty: false,
      command: 'sh',
      url: 'ws://localhost:40836/a',
    });
    await client.execute();
    var buf1 = new Uint8Array([0xfa, 0xff, 0x0a]);
    client.stdin.write(buf1);
    var passed = false;
    client.stdout.on('data', (message) => {
      var buf = new Buffer([0xfa, 0xff, 0x0a]);
      assert(buf.compare(message) === 0, 'message wrong!');
      passed = true;
    });
    setTimeout(() => {
      assert(passed, 'returning cat message not recieved');
    }, 5000);
    await resultPromise;
  });
 });

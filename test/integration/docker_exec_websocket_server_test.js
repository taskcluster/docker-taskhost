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
          websocketServer: true
        }
      }
    };

    let result = await worker.postToQueue(task);
    // var client = new DockerExecClient({

    // })
    debug(result);
  });
 });

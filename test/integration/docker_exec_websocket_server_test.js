var DockerWorker = require('../dockerworker');
var TestWorker = require('../testworker');
var assert = require('assert');

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
  test('cat', (done) => {
  	done();
  });
 });

const assert = require('assert');
const DockerWorker = require('../dockerworker');
const TestWorker = require('../testworker');
const Debug = require('debug');

let debug = Debug('docker-worker:test:disable-seccomp-test');

suite.skip('disableSeccomp feature', () => {
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

  test('use performance counter in a container without disableSeccomp -- task should fail', async () => {
    let result = await worker.postToQueue({
      payload: {
        image: 'alpine',
        command: ['/bin/sh', '-c', 'echo http://dl-cdn.alpinelinux.org/alpine/edge/testing >> /etc/apk/repositories; apk add perf; perf stat ls'],
        maxRunTime: 2 * 60
      }
    });

    assert(result.run.state === 'failed', 'task should fail');
    assert(result.run.reasonResolved === 'failed', 'task should fail');
  });

  test('use performance counter in a container with disableSeccomp -- task should succeed', async () => {
    let result = await worker.postToQueue({
      scopes: [
        'docker-worker:feature:allowPtrace',
      ],
      payload: {
        image: 'alpine',
        command: ['/bin/sh', '-c', 'echo http://dl-cdn.alpinelinux.org/alpine/edge/testing >> /etc/apk/repositories; apk add perf; perf stat ls'],
        features: {
          disableSeccomp: true,
        },
        maxRunTime: 2 * 60
      }
    });

    debug(result.run);
    assert(result.run.state === 'completed', 'task should not fail');
    assert(result.run.reasonResolved === 'completed', 'task should not fail');
  });
});

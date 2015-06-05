import testworker from '../post_task';
import DockerWorker from '../dockerworker';
import TestWorker from '../testworker';
import expires from './helper/expires';
import Docker from '../../lib/docker';
import dockerUtils from 'dockerode-process/utils';

let docker = Docker();
let worker;

const IMAGE = 'taskcluster/test-ubuntu:latest';

async function sleep(duration) {
  return new Promise(accept => setTimeout(accept, duration));
}

suite('worker timeouts', () => {
  setup(async () => {
    worker = new TestWorker(DockerWorker);
    await worker.launch();
  });

  teardown(async () => {
    await worker.terminate();
  });

  test('worker sleep more than maxRunTime', async () => {
    let maxRunTime = 10;
    let result = await worker.postToQueue({
      payload: {
        image:          IMAGE,
        command:        [
          '/bin/bash', '-c', 'echo "Hello"; sleep 20; echo "done";'
        ],
        maxRunTime: maxRunTime
      }
    });

    // Get task specific results
    assert.equal(result.run.state, 'failed', 'task should have failed');
    assert.equal(result.run.reasonResolved, 'failed', 'task should have failed');
    assert.ok(result.log.includes('Hello'));
    assert.ok(!result.log.includes('done'));
    assert.ok(
      result.log.includes(`Reason: Task timeout after ${maxRunTime}`),
      'Task should contain logs about timeout'
    );
  });

  test('run time exceeded before container starts', async () => {
    let maxRunTime = 1;
    let result = await worker.postToQueue({
      payload: {
        image:          IMAGE,
        command:        [
          '/bin/bash', '-c', 'echo "Hello"; sleep 20; echo "done";'
        ],
        maxRunTime: maxRunTime,
        features: {
          taskclusterProxy: true
        }
      }
    });

    assert.equal(result.run.state, 'failed', 'task should have failed');
    assert.equal(result.run.reasonResolved, 'failed', 'task should have failed');
    assert.ok(!result.log.includes('Hello'), 'Task appears to have started');
  });

  test('task claimed after previous task timed out', async () => {
    let maxRunTimeResult = await worker.postToQueue({
      payload: {
        image:          IMAGE,
        command:        [
          '/bin/bash', '-c', 'echo "Hello"; sleep 20; echo "done";'
        ],
        maxRunTime: 10
      }
    });

    // Let's make sure the task ran out of time first before moving on
    assert.equal(maxRunTimeResult.run.state, 'failed', 'task should have failed');
    assert.ok(
      maxRunTimeResult.log.includes(`Reason: Task timeout after 10`),
      'Task should contain logs about timeout'
    );

    let successfulResult = await worker.postToQueue({
      payload: {
        image:          IMAGE,
        command:        [
          '/bin/bash', '-c', 'echo "Hello"'
        ],
        maxRunTime: 60
      }
    });

    assert.equal(
      successfulResult.run.state,
      'completed',
      'Task was not completed successfully'
    );

    assert.equal(
      maxRunTimeResult.run.workerId,
      successfulResult.run.workerId,
      'Tasks were not completed by the same workers'
    );
  });

  test('task times out when uploading artifact', async () => {
    let maxRunTime = 5;
    let result = await worker.postToQueue({
      payload: {
        image:          IMAGE,
        command:        [
          '/bin/bash', '-c',
          'mkdir /artifacts/ && ' +
          'dd if=/dev/zero of=/artifacts/test.html bs=1024 count=0 seek=$[1024*20] && ' +
          'ls -lah /artifacts'
        ],
        maxRunTime: maxRunTime,
        artifacts: {
          'public/test.html': {
            type: 'file',
            expires: expires(),
            path: '/artifacts/test.html',
          }
        }
      }
    });

    assert.equal(
      result.run.state,
      'failed',
      'Task was completed successfully but should have failed'
    );

    assert.ok(
      result.log.includes(`Reason: Task timeout after ${maxRunTime}`),
      'Task should contain logs about timeout'
    );
  });
});

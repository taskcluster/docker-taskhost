import assert from 'assert';
import Docker from 'dockerode-promise';
import DockerWorker from '../dockerworker';
import TestWorker from '../testworker';

suite('use docker-save', () => {
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

  test('run, then check contents', async () => {
    let result = await worker.postToQueue({
      payload: {
        image: 'busybox',
        command: ['/bin/sh', '-c', 'echo testString > /tmp/test.log'],
        features: {
          dockerSave: true
        },
        maxRunTime: 5 * 60
      }
    });

    assert(result.run.state === 'completed', 'task should be successful');
    assert(result.run.reasonResolved === 'completed',
                 'task should be successful');

    let taskId = result.taskId;
    let runId = result.runId;

    let url = 'https://queue.taskcluster.net/v1/task/' + taskId + '/runs/' + runId +
      '/artifacts/' + result.artifacts['private/dockerImage.tar'].name;

    //maybe there's a better way to get it than making a new one
    // let docker = new Docker();
    // let newImg = await docker.createImage({fromSrc: url});
    // let opts = {
    //   AttachStdout: true,
    //   AttachStderr: true,
    //   Cmd: ['cat', '/tmp/test.log'],
    //   Image: newImg.name
    // }
    // let container = await docker.createContainer(opts);
    // debug(container);
  });
});


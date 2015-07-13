import assert from 'assert';
import Debug from 'debug';
import Docker from 'dockerode-promise';
import DockerWorker from '../dockerworker';
import fs from 'mz/fs';
import https from 'https';
import request from 'superagent-promise';
import TestWorker from '../testworker';

let debug = Debug('docker-worker:test:docker-save-test');

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

    let signedUrl = worker.queue.buildSignedUrl(
      worker.queue.getLatestArtifact,
      taskId,
      'private/dockerImage.tar',
      {expiration: 60 * 5});

    //why not superagent? superagent was only downlading 16K of data
    //TODO: work on error handling here
    await new Promise((accept, reject) => {
      https.request(signedUrl, (res) => {
        https.request(res.headers.location, (res) => {
          res.pipe(fs.createWriteStream('/tmp/dockerload.tar'));
          res.on('end', accept);
        }).end();
      }).end();
    });

    

    // let res = await request.get(signedUrl).end();
    // debug(res.statusCode);
    // await new Promise((accept, reject) => {
    //     res.pipe(fs.createWriteStream('/tmp/dockerload.tar'));
    //     res.on('end', accept);
    //     res.on('data', (dat) => {
    //       debug('%s bytes recieved', dat.length);
    //     });
    // });

    // //maybe there's a better way to get the docker obj than making a new one
    // let docker = new Docker();
    // await docker.load('/tmp/dockerload.tar');
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


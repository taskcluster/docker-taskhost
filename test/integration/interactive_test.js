import assert from 'assert';
import base from 'taskcluster-base';
import cmd from './helper/cmd';
import crypto from 'crypto';
import {DockerExecClient} from 'docker-exec-websocket-server';
import DockerWorker from '../dockerworker';
import TestWorker from '../testworker';
import Promise from 'promise';
import request from 'superagent-promise';
import * as settings from '../settings';
import slugid from 'slugid';
import Debug from 'debug';

suite('use docker exec websocket server', () => {
  let debug = Debug('docker-worker:test:interactive-test');

  let worker;
  setup(async () => {
    worker = new TestWorker(DockerWorker);
    await worker.launch();
    settings.cleanup();
  });

  teardown(async () => {
    if (worker) {
      await worker.terminate();
      worker = null;
    }
    settings.cleanup();
  });

  async function getWithoutRedirect (url) {
    let res = await request.get(url).redirects(0).end();
    return res.headers.location;
  };

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
    worker.postToQueue(task, taskId);
    debug('posted to queue');
    
    let passed = false;

    let signedUrl = worker.queue.buildSignedUrl(
    worker.queue.getLatestArtifact,
    taskId,
    'private/mozilla/interactive.sock',
    {expiration: 60 * 5});

    let url;
    await base.testing.poll(async () => {
      url = await getWithoutRedirect(signedUrl);
      assert(url, 'artifact not found');
    }, 20, 1000);

    //for testing, we don't care about https verification
    let client = new DockerExecClient({
      tty: false,
      command: ['cat'],
      url: url,
      wsopts: {rejectUnauthorized: false}
    });
    await client.execute();

    let buf = new Buffer([0xfa, 0xff, 0x0a]);
    client.stdin.write(buf);
    //message is small enough that it should be returned in one chunk
    client.stdout.on('data', (message) => {
      assert(buf[0] === message[0], 'message wrong!');
      assert(buf[1] === message[1], 'message wrong!');
      assert(buf[2] === message[2], 'message wrong!');
      passed = true;
      debug('test finished!');
      client.close();
    });

    await new Promise(accept => client.socket.once('close', accept));
    assert(passed,'message not recieved');
  });

  /*test('cat stress test', async () => {
    let taskId = slugid.v4();
    let task = {
      payload: {
        image: 'busybox',
        command: cmd('sleep 60'),
        maxRunTime: 2 * 60,
        features: {
          interactive: true
        }
      }
    };
    debug('posting to queue');
    worker.postToQueue(task, taskId);
    
    let passed = false;

    let signedUrl = worker.queue.buildSignedUrl(
      worker.queue.getLatestArtifact,
      taskId,
      'private/mozilla/interactive.sock',
      {expiration: 60 * 5});

    let url;
    await base.testing.poll(async () => {
      url = await getWithoutRedirect(signedUrl);
      assert(url, 'artifact not found');
    }, 20, 1000);

    //for testing, we don't care about https verification
    let client = new DockerExecClient({
      tty: false,
      command: ['cat'],
      url: url,
      wsopts: {rejectUnauthorized: false}
    });
    await client.execute();

    const TEST_BUF_SIZE = 1024 * 1024;

    let buf = await Promise.denodeify(crypto.pseudoRandomBytes)(TEST_BUF_SIZE);
    let pointer = 0;
    client.stdin.write(buf);
    client.stdout.on('data', (message) => {
      //checks each byte then increments the pointer
      for(let i = 0; i < message.length; i++) {
        if(message[i] !== buf[pointer++])
          throw new Error('byte at messages ' + i + ' which is ' + message[i]
            + ' of message total len ' + message.length + 
            '\ndoes not match bufs ' + pointer - 1);
      }
      if (pointer === TEST_BUF_SIZE) {
        passed = true;
        debug('test finished!');
        client.close();
      }
    });

    await new Promise(accept => client.socket.once('close', accept));
    assert(passed,'only ' + pointer + ' bytes recieved');
  });*/

  test('expires', async () => {
    settings.configure({
      interactive: {
        ssl: true,
        expiration: 10
      }
    });

    worker = new TestWorker(DockerWorker);
    await worker.launch();

    let taskId = slugid.v4();
    let task = {
      payload: {
        image: 'busybox',
        command: cmd('sleep 1'),
        maxRunTime: 2 * 60,
        features: {
          interactive: true
        }
      }
    };
    debug('posting to queue');
    worker.postToQueue(task, taskId);

    let signedUrl = worker.queue.buildSignedUrl(
      worker.queue.getLatestArtifact,
      taskId,
      'private/mozilla/interactive.sock',
      {expiration: 60 * 5});

    let url;
    await base.testing.poll(async () => {
      url = await getWithoutRedirect(signedUrl);
      assert(url, 'artifact not found');
    }, 20, 1000);

    let client = new DockerExecClient({
      tty: false,
      command: ['pwd'],
      url: url,
      wsopts: {rejectUnauthorized: false}
    });
    await base.testing.sleep(5000);
    let exited = false;

    //check for proper exit
    //should still be alive here
    await client.execute();
    client.stdout.on('data', (message) => {
      assert(message[0] === 0x2f); // is a slash, as expected of pwd
      exited = true;
    });
    

    await base.testing.sleep(10000);
    //should be dead here
    let dead = true;
    let failClient = new DockerExecClient({
      tty: false,
      command: ['echo'],
      url: url,
      wsopts: {rejectUnauthorized: false}
    });
    failClient.on('resumed', () => {
      dead = false;
    });
    await failClient.execute();
    await base.testing.sleep(3000);

    assert(dead, 'interactive session still available when it should have expired');
    assert(exited, 'interactive session failed to exit');
    settings.cleanup();
  });

  /*test('started hook fails gracefully on crash', async () => {
    settings.configure({
      ssl: {
        certificate: '/some/path/ssl.cert',
        key: '/some/path/ssl.key'
      }
    });

    worker = new TestWorker(DockerWorker);
    await worker.launch();

    let taskId = slugid.v4();
    let task = {
      payload: {
        image: 'busybox',
        command: cmd('sleep 60'),
        maxRunTime: 2 * 60,
        features: {
          interactive: true
        }
      }
    };
    debug('posting to queue');
    let res = await worker.postToQueue(task, taskId);
    assert(/\[taskcluster\] Error: Task was aborted because states could not be started\nsuccessfully\./
      .test(res.log));
  });*/
});

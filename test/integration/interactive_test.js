var assert = require('assert');
var base = require('taskcluster-base');
var cmd = require('./helper/cmd');
var crypto = require('crypto');
var debug = require('debug')('docker-worker:test:interactive-test')
var DockerExecClient = require('docker-exec-websocket-server').DockerExecClient;
var DockerWorker = require('../dockerworker');
var TestWorker = require('../testworker');
var Promise = require('promise');
var request = require('superagent-promise');
var slugid = require('slugid');

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

    //for testing, we don't care about https verification
    var client = new DockerExecClient({
      tty: false,
      command: ['cat'],
      url: url,
      wsopts: {rejectUnauthorized: false}
    });
    await client.execute();

    var buf = new Buffer([0xfa, 0xff, 0x0a]);
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
    assert(passed);
  });

  test('cat stress test', async () => {
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

    //for testing, we don't care about https verification
    var client = new DockerExecClient({
      tty: false,
      command: ['cat'],
      url: url,
      wsopts: {rejectUnauthorized: false}
    });
    await client.execute();

    const TEST_BUF_SIZE = 1024 * 1024;

    var buf = await Promise.denodeify(crypto.pseudoRandomBytes)(TEST_BUF_SIZE);
    // make sure the last character is a newline
    buf[TEST_BUF_SIZE - 1] = 0x0a;
    var pointer = 0;
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
    assert(passed);
  });
});

import assert from 'assert';
import base from 'taskcluster-base';
import cmd from './helper/cmd';
import crypto from 'crypto';
import Debug from 'debug';
import DockerWorker from '../dockerworker';
import https from 'https';
import http from 'http';
import TestWorker from '../testworker';
import Promise from 'promise';
import * as settings from '../settings';
import slugid from 'slugid';
import URL from 'url';
import got from 'got';
import WebSocket from 'ws';

suite('interactive vnc', () => {
  let debug = Debug('docker-worker:test:vnc');

  let worker;
  // If taskcluster/artifact upload is under high load, this number needs to
  // be adjusted up. It also causes the test to be slower by 2X that many
  // seconds, so be careful with this.
  let minTime = 30;
  let expTime = 10;
  setup(async () => {
    settings.cleanup();
    settings.configure({
      interactive: {
        ssl: true,
        minTime: minTime,
        expirationAfterSession: expTime
      }
    });
    worker = new TestWorker(DockerWorker);
    await worker.launch();
  });

  teardown(async () => {
    if (worker) {
      await worker.terminate();
      worker = null;
    }
    settings.cleanup();
  });

  async function getArtifact (queue, taskId) {
    async function getWithoutRedirect (url) {
      let res = await new Promise((resolve, reject) => {
        if (process.env.TASKCLUSTER_BASE_URL === 'http://taskcluster') {
          http.request(url, (res) => {
            resolve(res);
          }).end();
        } else {
          https.request(url, (res) => {
            resolve(res);
          }).end();
        }
      });
      assert(
        res.statusCode === 303,
        `Should have received a status code of 303 but received ${res.statusCode} with error ${res.error}`
      );
      return URL.parse(res.headers.location, true).query;
    };
    let signedUrl = queue.buildSignedUrl(
      queue.getLatestArtifact,
      taskId,
      'private/docker-worker-tests/display.html',
      {expiration: 60 * 5});

    return base.testing.poll(() => getWithoutRedirect(signedUrl), 45, 1000);
  };

  test('cat', async () => {
    let taskId = slugid.v4();
    let task = {
      payload: {
        image: 'taskcluster/vnc-test:v1',
        command: cmd('Xvfb :0 -screen 0 1024x768x24'),
        maxRunTime: 60,
        features: {
          interactive: true
        }
      }
    };
    debug('posting to queue');
    worker.postToQueue(task, taskId);
    debug('posted to queue');

    let info = await getArtifact(worker.queue, taskId);
    debug('info from url: %j', info);
    assert(info.displaysUrl, 'missing displaysUrl');
    assert(info.socketUrl, 'missing socketUrl');
    let displays = await base.testing.poll(async () => {
      let res = await got(info.displaysUrl, {
        rejectUnauthorized: false,
        json: true,
      });
      let result = res.body;
      debug('Got displays: %j', result);
      assert(result.length === 1);
      return result;
    }, 30, 1000);

    assert(displays[0].display === ':0.0', 'wrong display');
    assert(displays[0].width === 1024, 'wrong width');
    assert(displays[0].height === 768, 'wrong height');

    // Create socket and wait for it to open
    let d = displays[0].display;
    let socket = new WebSocket(info.socketUrl + '?display=' + d, {
      rejectUnauthorized: false,
    });
    await new Promise((accept, reject) => {
      let buffers = [];
      socket.on('message', data => {
        buffers.push(data);
        let buf = Buffer.concat(buffers);
        if (buf.length >= 12) {
          // See: https://tools.ietf.org/html/rfc6143#section-7.1.1
          let protocolVersion = buf.slice(0, 12).toString('utf8');
          debug('protocolVersion: %j', protocolVersion);
          if (/^RFB \d\d\d\.\d\d\d\n$/.test(protocolVersion)) {
            accept();
          } else {
            reject();
          }
        }
      });
      socket.on('error', reject);
      socket.on('close', reject);
    });
    socket.close();
  });
});

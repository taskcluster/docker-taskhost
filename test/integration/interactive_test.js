import assert from 'assert';
import base from 'taskcluster-base';
import cmd from './helper/cmd';
import crypto from 'crypto';
import Debug from 'debug';
import DockerWorker from '../dockerworker';
import https from 'https';
import TestWorker from '../testworker';
import Promise from 'promise';
import * as settings from '../settings';
import slugid from 'slugid';

suite('use docker exec websocket server', () => {
  let debug = Debug('docker-worker:test:interactive-test');

  let worker;
  // If taskcluster/artifact upload is under high load, this number needs to be adjusted up.
  // It also causes the test to be slower by 2X that many seconds, so be careful with this.
  // TODO: add polling to tests so they don't rely as much on this type of timing
  let maxTime = 90;
  let expTime = 10;
  setup(async () => {
    settings.cleanup();
    worker = new TestWorker(DockerWorker);
    await worker.launch();
  });

  test('expires', async () => {
    
  });
});

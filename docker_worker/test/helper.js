process.env.QUEUE_URL =
  process.env.QUEUE_URL || 'http://queue.taskcluster.net';

global.assert = require('assert');
require('mocha-as-promised')();

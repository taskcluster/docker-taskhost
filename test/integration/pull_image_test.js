suite('pull image', function() {
  var co = require('co');
  var request = require('superagent-promise');
  var testworker = require('../post_task');
  var docker = require('../../lib/docker')();
  var dockerUtils = require('dockerode-process/utils');
  var cmd = require('./helper/cmd');

  var IMAGE = 'ubuntu:12.10';
  const SHA_IMAGE = 'ubuntu@sha256:e2ff67c8f9bb7e1eda3ec573fd8ac74b976d170d9e13babc5c5035f4443af744';

  test('ensure image can be pulled', co(function* () {
    yield dockerUtils.removeImageIfExists(docker, IMAGE);
    var result = yield testworker({
      payload: {
        image: IMAGE,
        command: cmd('ls'),
        maxRunTime: 5 * 60
      }
    });

    assert.equal(result.run.state, 'completed', 'task should be successfull');
    assert.equal(result.run.reasonResolved, 'completed', 'task should be successfull');
  }));

  test('ensure image can be pulled using sha hash', co(function* () {
    yield dockerUtils.removeImageIfExists(docker, SHA_IMAGE);
    var result = yield testworker({
      payload: {
        image: SHA_IMAGE,
        command: cmd('ls'),
        maxRunTime: 5 * 60
      }
    });

    assert.equal(result.run.state, 'completed', 'task should be successfull');
    assert.equal(result.run.reasonResolved, 'completed', 'task should be successfull');
  }));

  test('Task marked as failed if image cannot be pulled', co(function* () {
    var result = yield testworker({
      payload: {
        image: 'ubuntu:99.99',
        command: cmd('ls'),
        maxRunTime: 5 * 60
      }
    });
    assert.equal(result.run.state, 'failed', 'task should be successfull');
    assert.equal(result.run.reasonResolved, 'failed', 'task should be successfull');
  }));
});


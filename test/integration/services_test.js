suite('services', function() {
  var co = require('co');
  var testworker = require('../post_task');
  var getArtifact = require('./helper/get_artifact');

  test('schema validation', co(function* () {
    var result = yield testworker({
      payload: {
        image: 'taskcluster/test-client',
        command: [
          '/bin/bash', '-c', 'curl amazingfoo'
        ],
        services: {
          image: 'taskcluster/test-server',
          env: { MAGIC_FOO: '$$foo$$' },
          alias: 'amazingfoo'
        },
      }
    });

    assert.ok(result.log.indexOf('invalid json schema') !== -1, 'has log');
    assert.ok(!result.run.success, 'task should be successful');
  }));

  test('multiple http services', co(function* () {
    var result = yield testworker({
      payload: {
        image: 'taskcluster/test-client',
        command: [
          '/bin/bash', '-c',
          'echo $(curl --retry 5 amazingfoo) && ' +
          'echo $(curl --retry 5 amazingbar)'
        ],
        services: [
          {
            image: 'taskcluster/test-server',
            env: { MAGIC_FOO: '$$foo$$' },
            alias: 'amazingfoo'
          },
          {
            image: 'taskcluster/test-server',
            env: { MAGIC_FOO: '$$bar$$' },
            alias: 'amazingbar'
          }
        ]
      }
    });

    var artifacts = result.artifacts;

    assert.ok(result.log.indexOf('$$foo$$') !== -1);
    assert.ok(result.log.indexOf('$$bar$$') !== -1);
    assert(artifacts['public/logs/services/amazingfoo.log']);
    assert(artifacts['public/logs/services/amazingbar.log']);
    assert.ok(result.run.success, 'task should be successful');

    console.log(artifacts);
    var logs = yield {
      amazingfoo: getArtifact(
        result, artifacts['public/logs/services/amazingfoo.log'].name
      ),

      amazingbar: getArtifact(
        result, artifacts['public/logs/services/amazingbar.log'].name
      )
    };

    assert.ok(logs.amazingfoo.indexOf('$$foo$$') !== -1);
    assert.ok(logs.amazingbar.indexOf('$$bar$$') !== -1);
  }));
});

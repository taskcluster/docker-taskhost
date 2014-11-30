suite('services', function() {
  var co = require('co');
  var testworker = require('../post_task');

  test('multiple http services', co(function* () {
    var expected = 'is woot';
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

    assert.ok(result.log.indexOf('$$foo$$') !== -1);
    assert.ok(result.log.indexOf('$$bar$$') !== -1);
    assert.ok(result.run.success, 'task should be successful');
  }));
});

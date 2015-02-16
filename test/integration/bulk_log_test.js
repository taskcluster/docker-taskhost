suite('logging to artifact', function() {
  var co = require('co');
  var request = require('superagent-promise');
  var testworker = require('../post_task');
  var getArtifact = require('./helper/get_artifact');

  test('artifact logger', co(function* () {
    var result = yield testworker({
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: [
          '/bin/bash',
          '-c',
          'echo "first command!";' +
          'for i in {1..1000}; do echo "Hello Number $i"; done;'
        ],
        features: {
          localLiveLog: false,
          bulkLog: true
        },
        maxRunTime: 5 * 60
      }
    });

    assert.ok(result.run.success, 'task success');

    // Expected junk in the log.
    var log = '';
    for (var i = 1; i <= 1000; i++) {
      log += 'Hello Number ' + i + '\r\n';
    }

    var content = yield getArtifact(
      result, result.artifacts['public/logs/live.log.gz'].name
    );

    assert.ok(
      content.indexOf(log) !== -1, 'bulk log contains correct number of lines'
    );
  }));
});

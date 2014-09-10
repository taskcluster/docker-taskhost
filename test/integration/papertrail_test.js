suite('papertrail', function() {
  if (!process.env.PAPERTRAIL_API_TOKEN) {
    test.skip("PAPERTRAIL_API_TOKEN required for this test.");
    return
  }

  var co = require('co');
  var waitForEvent = require('../../lib/wait_for_event');

  // We need to use the docker worker host here so the network connection code
  // actually runs...
  var DockerWorker = require('../dockerworker');
  var TestWorker = require('../testworker');
  var Papertrail = require('papertrail');

  test('issue a request to taskcluster via the proxy', co(function* () {
    var client = new Papertrail({ token: process.env.PAPERTRAIL_API_TOKEN });
    var worker = new TestWorker(DockerWorker);

    var results = yield [
      worker.launch(),
      waitForEvent(worker, 'remote logging to system'),
      waitForEvent(worker, 'remote logging to groups')
    ];

    var system = results[1];
    var groups = results[2];

    yield client.getSystem(system.id);
    for (var key in groups) {
      var id = groups[key].id;
      if (!id) continue
      yield client.getGroup(groups[key].id);
    }
    yield worker.terminate();
  }));
});


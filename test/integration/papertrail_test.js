suite('papertrail', function() {
  if (!process.env.PAPERTRAIL_API_TOKEN) {
    test.skip("PAPERTRAIL_API_TOKEN required for this test.");
    return
  }

  var co = require('co');
  var waitForEvent = require('../../lib/wait_for_event');
  var uuid = require('uuid');
  var settings = require('../settings');

  // Ensure we don't leave behind our test configurations.
  teardown(settings.cleanup);

  // We need to use the docker worker host here so the network connection code
  // actually runs...
  var DockerWorker = require('../dockerworker');
  var TestWorker = require('../testworker');
  var Papertrail = require('papertrail');

  var system, client;
  setup(co(function* () {
    client = new Papertrail({ token: process.env.PAPERTRAIL_API_TOKEN });
    var destinations = yield client.listLogDestinations();
    system = yield client.registerSystem({
      system: {
        name: 'test-' + uuid.v4()
      },
      destination_id: destinations[0].id
    });
  }));

  teardown(co(function* () {
    yield client.deleteSystem(system.id);
  }));

  test('issue a request to taskcluster via the proxy', co(function* () {
    var worker = new TestWorker(DockerWorker);

    settings.configure({
      papertrail: { systemId: system.id }
    });

    var results = yield [
      worker.launch(),
      waitForEvent(worker, 'remote logging to groups')
    ];

    var groups = results[1];

    for (var key in groups) {
      var id = groups[key].id;
      if (!id) continue
      var group = yield client.getGroup(groups[key].id);
      assert.equal(group.systems[0].id, system.id);
    }
    yield worker.terminate();
  }));
});


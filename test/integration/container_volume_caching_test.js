suite('container volume cache tests', function () {
  var co = require('co');
  var cmd = require('./helper/cmd');
  var fs = require('fs');
  var rmrf = require('rimraf');
  var path = require('path');
  var testworker = require('../post_task');

  var cacheDir = process.env.DOCKER_WORKER_CACHE_DIR || '/var/cache';

  test('mount cached volume in docker worker', co(function* () {
    var cacheName = 'tmp-obj-dir-' + Date.now().toString();
    var neededScope = 'docker-worker:cache:' + cacheName;
    var fullCacheDir = path.join(cacheDir, cacheName);

    var task = {
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd(
          'echo "foo" > /tmp-obj-dir/foo.txt'
        ),
        features: {
          // No need to actually issue live logging...
          localLiveLog: false
        },
        cache: {},
        maxRunTime:         5 * 60
      },
    scopes: [neededScope]
    };

    task.payload.cache[cacheName] = '/tmp-obj-dir';

    var result = yield testworker(task);

    // Get task specific results
    assert.ok(result.run.success, 'task was successful');

    var objDir = fs.readdirSync(fullCacheDir);
    assert.ok(fs.existsSync(path.join(fullCacheDir, objDir[0], 'foo.txt')));

    if (fs.existsSync(fullCacheDir)) {
      rmrf.sync(fullCacheDir);
    }
  }));

  test('mount multiple cached volumes in docker worker', co(function* () {
    var cacheName1 = 'tmp-obj-dir-' + Date.now().toString();
    var cacheName2 = 'tmp-obj-dir-' + (Date.now()+1).toString();

    var neededScopes = []
    neededScopes.push('docker-worker:cache:' + cacheName1);
    neededScopes.push('docker-worker:cache:' + cacheName2);

    var fullCache1Dir = path.join(cacheDir, cacheName1);
    var fullCache2Dir = path.join(cacheDir, cacheName2);

    var task = {
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd(
          'echo "foo" > /tmp-obj-dir1/foo.txt',
          'echo "bar" > /tmp-obj-dir2/bar.txt'
        ),
        features: {
          // No need to actually issue live logging...
          localLiveLog: false
        },
        cache: {},
        maxRunTime:         5 * 60
      },
      scopes: neededScopes
    };

    task.payload.cache[cacheName1] = '/tmp-obj-dir1';
    task.payload.cache[cacheName2] = '/tmp-obj-dir2';

    var result = yield testworker(task);

    // Get task specific results
    assert.ok(result.run.success, 'task was successful');

    var objDir = fs.readdirSync(fullCache1Dir);
    assert.ok(fs.existsSync(path.join(fullCache1Dir, objDir[0], 'foo.txt')));

    if (fs.existsSync(fullCache1Dir)) {
      rmrf.sync(fullCache1Dir);
    }

    objDir = fs.readdirSync(fullCache2Dir);
    assert.ok(fs.existsSync(path.join(fullCache2Dir, objDir[0], 'bar.txt')));

    if (fs.existsSync(fullCache2Dir)) {
      rmrf.sync(fullCache2Dir);
    }
  }));

  test('task unsuccesful when insufficient cache scope is provided',
    co(function* () {
      var cacheName = 'tmp-obj-dir-' + Date.now().toString();
      var neededScope = 'docker-worker:cache:1' + cacheName;
      var fullCacheDir = path.join(cacheDir, cacheName);

      var task = {
        payload: {
          image: 'taskcluster/test-ubuntu',
          command: cmd(
            'echo "foo" > /tmp-obj-dir/foo.txt'
          ),
          features: {
            // No need to actually issue live logging...
            localLiveLog: false
          },
          cache: {},
          maxRunTime:         5 * 60
        },
      scopes: [neededScope]
      };

      task.payload.cache[cacheName] = '/tmp-obj-dir';

      var result = yield testworker(task);

      // Get task specific results
      assert.ok(!result.run.success,
        'Task completed successfully when it should not have.');

      var dirExists = fs.existsSync(fullCacheDir);
      if (dirExists) {
        rmrf.sync(fullCacheDir);
      }

      assert.ok(!dirExists,
          'Volume cache created cached volume directory when it should not ' +
          'have.'
      );
    })
  );
});

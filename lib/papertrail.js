var Client = require('papertrail');
var assert = require('assert');
var debug = require('debug')('docker-worker:papertrail');

var PREFIX = 'docker-worker/';

function* groupsByName(client, name) {
  var list = yield client.listGroups();
  return list.filter(function(group) {
    return group.name === name;
  }).sort(function(a, b) {
    return a - b;
  });
}

/**
The papertrail api is not idempotent and we want to be idempotent :)

@param {Object} client papertrail api.
@param {Object} options for create group.
@return {Object} group.
*/
function* idempontentCreateGroup(client, name) {
  assert(name, 'name is required...');

  var groups = yield groupsByName(client, name);
  if (groups.length) return groups[0];

  // Create the group...
  var create = yield client.createGroup({
    group: {
      name: name
    }
  });

  // We may have more then one after create since create is not idempotent so
  // at worst we created two but we will still use the right one because we use
  // the one with the lowest id.
  var groups = yield groupsByName(client, name);
  if (groups.length) return groups[0];
}

function Papertrail(papertrail, host, groups) {
  this.host = host;
  this.client = new Client(papertrail);

  this.systemId = papertrail.systemId;
  this.groupNames = groups;
}

Papertrail.prototype = {

  /**
  Register this particular worker node to papertrail and join/create groups
  base on workerType/workerGroup.
  */
  setup: function* () {
    if (!this.systemId) {
      debug('disabled no system id present.')
      return;
    }

    // Create all the groups we need
    this.groups = yield this.groupNames.map(function(groupName) {
      return idempontentCreateGroup(this.client, groupName);
    }, this);

    // Register the id with all the right groups...
    yield this.groups.map(function(group) {
      return this.client.systemJoinGroup(
        this.systemId, { group_id: group.id }
      );
    }, this);
  },

  /**
  Remove node from papertrail and delete all associated groups and data.

  This should only be used for testing!
  */
  teardown: function* () {
    if (!this.systemId) {
      debug('disabled no system id present.')
      return;
    }

    yield this.groups.map(function(group) {
      return this.client.systemLeaveGroup(
        this.systemId, { group_id: group.id }
      );
    }, this);

    yield this.groups.map(function(group) {
      return this.client.deleteGroup(group.id);
    }, this);
  }
};

module.exports = Papertrail;

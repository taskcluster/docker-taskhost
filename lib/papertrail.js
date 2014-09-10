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
@return {Number} group id.
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


function Papertrail(papertrail, systemName, groups) {
  this.client = new Client(papertrail);
  this.destinationPort = papertrail.desintation.port;

  this.systemName = systemName;
  this.groupNames = groups;
}

Papertrail.prototype = {

  /**
  Register this particular worker node to papertrail and join/create groups
  base on workerType/workerGroup.
  */
  setup: function* () {
    if (!this.destinationPort) {
      debug('disabled no destination.port set.')
      return;
    }

    this.system = yield this.client.registerSystem({
      system: {
        name: this.systemName,
      },
      destination_port: this.destinationPort
    });

    // Create all the groups we need
    this.groups = yield this.groupNames.map(function(groupName) {
      return idempontentCreateGroup(this.client, groupName);
    }, this);

    // Register the id with all the right groups...
    yield this.groups.map(function(group) {
      return this.client.systemJoinGroup(
        this.system.id, { group_id: group.id }
      );
    }, this);
  },

  /**
  Remove node from papertrail and delete all associated groups and data.

  This should only be used for testing!
  */
  teardown: function* () {
    if (!this.destinationPort) {
      debug('disabled no destination.port set.')
      return;
    }

    yield this.groups.map(function(group) {
      return this.client.systemLeaveGroup(
        this.system.id, { group_id: group.id }
      );
    }, this);

    yield this.groups.map(function(group) {
      return this.client.deleteGroup(group.id);
    }, this);

    yield this.client.deleteSystem(this.system.id);
  }
};

module.exports = Papertrail;

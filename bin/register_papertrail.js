#! /usr/bin/env node

var Client = require('papertrail');
var os = require('os');
var assert = require('assert');

// Requires client id...
var client = new Client();

var name = process.argv[2];
var port = process.argv[3];

assert(name, 'name is required.');
assert(port, 'port is required.');

client.registerSystem({
  system: {
    name: name,
    hostname: os.hostname()
  },
  destination_port: parseInt(port, 10)
}).then(function(system) {
  process.stdout.write(String(system.id));
}).catch(function(err) {
  if (err) {
    console.error(err);
    process.exit(1);
  }
});

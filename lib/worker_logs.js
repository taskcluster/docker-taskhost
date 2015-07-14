var fs = require('fs');
var temporary = require('temporary');
var EventEmitter = require('events').EventEmitter;

function WorkerLog() {
  this.paths = {};
  EventEmitter.call(this);
}

WorkerLog.prototype = {
  __proto__: EventEmitter.prototype,

  closeStream: function(name) {
  },

  registerStream: function(name, stream) {
    // Create a file sink to store the progress of the log.
    var fileSink = (new temporary.File()).path;
    var writeStream = fs.createWriteStream(fileSink);
    stream.pipe(writeStream);
  },

  callback: function() {
  }
};

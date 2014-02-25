var amqp          = require('amqp');
var Promise       = require('promise');
var EventEmitter  = require('events').EventEmitter;
var util          = require('util');
var queue         = require('../queue');
var debug         = require('debug')('taskcluster-docker-worker:Listener');
var testworker    = require('./testworker');
var request       = require('superagent');

var DEFAULT_EXCHANGES = [
  'v1/queue:task-completed'
];

/** Listen for messages for completed task from a given workerType */
var Listener = function(workerType, provisionerId, exchanges) {
  // Construct superclass
  EventEmitter.call(this);

  // Store workerType, we'll need it when binding
  this.workerType = workerType;
  this.provisionerId = provisionerId || testworker.TEST_PROVISIONER_ID;

  // Store connection and queue
  this.exchanges = exchanges || DEFAULT_EXCHANGES;
  this.conn   = null;
  this.queue  = null;
};

// Inherit from EventEmitter
util.inherits(Listener, EventEmitter);

/** Begin listening return a promise that listening have started */
Listener.prototype.listen = function() {
  var that = this;

  // Connect to AMQP
  var connected = new Promise(function(accept, reject) {
    request
      .get(queue.queueUrl('/settings/amqp-connection-string'))
      .end(function(res) {
        if (res.ok) {
          // Create connection
          that.conn = amqp.createConnection({
            url:            res.body.url
          });
          that.conn.on('ready', accept);
        } else {
          reject(res.body);
        }
      });
  });

  // Declare queue
  var createdQueue = connected.then(function() {
    return new Promise(function(accept, reject) {
      that.queue = that.conn.queue('', {
        passive:                    false,
        durable:                    false,
        exclusive:                  true,
        autoDelete:                 true,
        closeChannelOnUnsubscribe:  true
      }, function() {
        accept();
      });
    });
  });

  // So subscribe and bind to queue, return a promise that this happens
  return createdQueue.then(function() {
    return new Promise(function(accept, reject) {
      that.queue.subscribe(function(message) {
        var type = message.status.state;
        that.emit(type, message);
      });

      // Create a routing pattern that will only match our specific workerType
      var routingPattern = '*.*.*.*.' + that.provisionerId + '.' +
                           that.workerType + '.#';

      function handleBind() {
        debug("Bound queue to exchanges: ", that.exchanges);
        accept();
      }

      that.exchanges.forEach(function(exchange) {
        // XXX: amqp does the intentionally weird thing of only firing once even
        // though we issue multiple binds =/ wtf
        that.queue.bind(exchange, routingPattern, handleBind);
      });
    });
  });
};


/** Stop listening, returns a promise of success */
Listener.prototype.destroy = function() {
  var that = this;
  return new Promise(function(accept, reject) {
    that.conn.on('close', function() {
      debug("Disconnected from AMQP");
      accept();
    });
    // Disconnect from AMQP
    that.conn.destroy();
  });
};

// Export Listener
module.exports = Listener;

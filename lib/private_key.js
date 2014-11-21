/*
 * Responsible for decrypting and validating private environment variable in task payload
 */

var debug = require('debug')('privateKey');
var enums = require('openpgp/src/enums');
var fs      = require('fs');
var _       = require('lodash');
var openpgp = require('openpgp');
var util = require('util');
var uuid = require('uuid');

function PrivateKey(keyFile) {
  this.privateKey = null;

  try {
    var privateKeyArmored = fs.readFileSync(keyFile, 'ascii');
    debug('read private key from: ' + keyFile);
    
    this.privateKey =
        openpgp.key.readArmored(privateKeyArmored).keys[0];
  }
  catch(e) {
    debug('error reading private key from: ' + keyFile + ' -- ' + e);
  }
}

function validateDecryptedData(taskPayload, decryptedData, taskId) {

  var reservedKeys = ['TASK_ID', 'RUN_ID'];

  function logAndThrow(debugMsg, logMsg) {
    var errorPrefix = 'secret data violation';
 
    var incidentId = uuid.v4();
    debug('%s -- %s; incidentId: %s',
          errorPrefix, debugMsg, incidentId);
    throw new Error(util.format('%s -- %s; incidentId: %s',
                                errorPrefix, logMsg, incidentId));
  }

  if (_.contains(reservedKeys, decryptedData.name)) {
      var debugMsg = 'the environment variable (' + decryptedData.name + ') ' +
                     'conflicts with a reserved environment variable';
      var logMsg = 'an environment variable conflicts with an existing environment variable';
      logAndThrow(debugMsg, logMsg);
  }

  if (taskPayload.env[decryptedData.name] !== undefined) {
    var debugMsg = 'the environment variable (' + decryptedData.name + ') ' +
                   'has been duplicated in the task payload';
    var logMsg = 'an environment variable has been duplicated in the task payload';
    logAndThrow(debugMsg, logMsg);
  }

  if (decryptedData.messageVersion != 1) {
    var debugMsg = 'the version of the message (' + decryptedData.messageVersion + ') ' +
                   'is not supported';
    var logMsg = 'the version of the message is not supported';
    logAndThrow(debugMsg, logMsg);
  }
 
  if (decryptedData.taskId !== taskId) {
    var debugMsg = 'the taskId of env payload (' + decryptedData.taskId + ') ' +
                   'does not match taskId of task (' + taskId + ')';
    var logMsg = 'the taskId of the env payload does not match ' +
                 'the taskId of the task';
    logAndThrow(debugMsg, logMsg);
  }

  if (decryptedData.startTime > Date.now()) {
    var debugMsg = 'the start time date in the env payload is in the future, ' +
                   'now: ' + Date.now() + ', ' +
                   'env start time date: ' + decryptedData.startTime;
    var logMsg = 'the start time in the env payload is in the future';
    logAndThrow(debugMsg, logMsg);
  }

  if (Date.now() > decryptedData.endTime) {
    var debugMsg = 'the end time in the env payload is in the past, ' +
                   'now: ' + Date.now() + ', ' +
                   'end time: ' + decryptedData.endTime;
    var logMsg = 'the end time in the env payload is in the past';
    logAndThrow(debugMsg, logMsg);
  }
}

PrivateKey.prototype = {
  decryptEnvVariables: function(taskPayload, taskId) {
    var that = this;

    // If reading the private key failed, do nothing
    if (!this.privateKey) {
      debug('private key was not read, not attempting to decrypt encrypted environment variables');
      return;
    }

    // For each encrypted variable, create a promise and wait for all
    // promises to complete
    return Promise.all(_.map(taskPayload.encryptedEnv, function(encryptedVar) {

      var encryptedVarBuf = new Buffer(encryptedVar, 'base64');
      var armoredEncryptedVar =
        openpgp.armor.encode(enums.armor.message, encryptedVarBuf.toString());

      var encryptedVarMessage =
        openpgp.message.readArmored(armoredEncryptedVar);

      return openpgp.decryptMessage(that.privateKey, encryptedVarMessage).then(function(text) {
        // Validate the message
        var decryptedData = JSON.parse(text);
        validateDecryptedData(taskPayload, decryptedData, taskId);

        // Overwrite the secret in env, so everything can contine as usual
        taskPayload.env[decryptedData.name] = decryptedData.value;
      });
    }));
  }
};

module.exports = PrivateKey;


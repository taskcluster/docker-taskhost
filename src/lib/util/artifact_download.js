const crypto = require('crypto');
const Debug = require('debug');
const request = require('request');
const fs = require('mz/fs');
const sleep = require('../util/sleep');
const { fmtLog, fmtErrorLog } = require('../log');
const pipe = require('promisepipe');
const promiseRetry = require('promise-retry');

const RETRY_CONFIG = {
  maxAttempts: 5,
  delayFactor: 2,
  randomizationFactor: true
};

let debug = new Debug('artifactDownload');

/*
 * Downloads an artifact for a particular task and saves it locally.
 *
 * @param {Object} queue - Queue instance
 * @param {String} taskId - ID of the task
 * @param {String} artifactPath - Path to find the artifact for a given task
 * @param {String} destination - Path to store the file locally
 */
module.exports = async function(queue, stream, taskId, artifactPath, destination, retryConfig=RETRY_CONFIG) {
  let {maxAttempts, delayFactor, randomizationFactor} = retryConfig;
  let artifactUrl = artifactPath.startsWith('public/') ?
    queue.buildUrl(queue.getLatestArtifact, taskId, artifactPath) :
    queue.buildSignedUrl(queue.getLatestArtifact, taskId, artifactPath);

  // As we change the semantics of these parameters, we add
  // some preventive checks in case we didn't handle all the cases
  // in production.
  if (delayFactor > 10) {
    delayFactor = RETRY_CONFIG.delayFactor;
  }
  if (typeof randomizationFactor !== 'boolean') {
    randomizationFactor = RETRY_CONFIG.randomizationFactor;
  }

  stream.write(
    fmtLog(`Downloading artifact "${artifactPath}" from task ID: ${taskId}.`)
  );

  return await promiseRetry((retry, attempt) => {
    return new Promise(async(accept, reject) => {
      let hash = crypto.createHash('sha256');
      let destinationStream = fs.createWriteStream(destination);
      let expectedSize = 0;
      let receivedSize;
      let req = request.get(artifactUrl);
      req.on('response', (res) => {
        expectedSize = parseInt(res.headers['content-length']);
        receivedSize = 0;
      });
      req.on('data', (chunk) => {
        receivedSize += chunk.length;
        hash.update(chunk);
      });

      let intervalId = setInterval(() => {
        if (receivedSize) {
          stream.write(fmtLog(
            `Download Progress: ${((receivedSize / expectedSize) * 100).toFixed(2)}%`
          ));
        }
      }, 5000);

      try {
        await pipe(req, destinationStream);
      } finally {
        clearInterval(intervalId);
      }

      if (req.response.statusCode !== 200) {
        let error = new Error(req.response.statusMessage);
        error.statusCode = req.response.statusCode;
        reject(error);
      }

      if (receivedSize !== expectedSize) {
        reject(new Error(`Expected size is '${expectedSize}' but received '${receivedSize}'`));
      }

      stream.write(fmtLog('Downloaded artifact successfully.'));
      stream.write(fmtLog(
        `Downloaded ${(expectedSize / 1024 / 1024).toFixed(3)} mb`
      ));
      accept(`sha256:${hash.digest('hex')}`);
    }).catch(async(e) => {
      debug(`Error downloading "${artifactPath}" from task ID "${taskId}". ${e}`);

      if ([404, 401].includes(e.statusCode)) {
        throw new Error(
          `Could not download artifact "${artifactPath} from ` +
          `task "${taskId}" after ${attempt} attempt(s). Error: ${e.message}`
        );
      }

      // remove any partially downloaded file
      await fs.unlink(destination);

      retry(e);
    });
  }, {
    retries: maxAttempts,
    factor: delayFactor,
    randomize: randomizationFactor,
  });
};

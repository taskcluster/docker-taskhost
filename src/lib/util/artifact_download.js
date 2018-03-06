const crypto = require('crypto');
const Debug = require('debug');
const got = require('got');
const fs = require('mz/fs');
const sleep = require('../util/sleep');
const { fmtLog, fmtErrorLog } = require('../log');
const pipe = require('promisepipe');
const promiseRetry = require('promise-retry');
const ProgressBar = require('ascii-progress');

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
module.exports = function(queue, stream, taskId, artifactPath, destination, retryConfig=RETRY_CONFIG) {
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

  let bar = new ProgressBar({
    schema: 'Download progress :percent [:bar]',
    filled: '=',
    blank: ' ',
  });

  return promiseRetry((retry, attempt) => {
    return new Promise((accept, reject) => {
      let hash = crypto.createHash('sha256');
      let destinationStream = fs.createWriteStream(destination);

      let sink = got.stream(artifactUrl)
        .on('data', chunk => hash.update(chunk))
        .on('error', reject)
        .on('downloadProgress', progress => bar.update(progress.percent));

      pipe(sink, destinationStream).then(() => {
        stream.write(fmtLog('Downloaded artifact successfully.'));
        accept(`sha256:${hash.digest('hex')}`);
      }).catch(reject);
    }).catch((e) => {
      debug(`Error downloading "${artifactPath}" from task ID "${taskId}". ${e}`);

      if ([404, 401].includes(e.statusCode)) {
        throw new Error(
          `Could not download artifact "${artifactPath} from ` +
          `task "${taskId}" after ${attempt} attempt(s). Error: ${e.message}`
        );
      }

      // remove any partially downloaded file
      fs.unlink(destination, e => {
        if (e) {
          stream.write(fmtErrorLog(`Error removing temporary file: ${e}`));
        }
      });

      retry(e);
    });
  }, {
    retries: maxAttempts,
    factor: delayFactor,
    randomize: randomizationFactor,
  });
};

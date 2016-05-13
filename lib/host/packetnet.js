/**
Return the appropriate configuration defaults when on aws.
*/

import request from 'superagent-promise';
import taskcluster from 'taskcluster-client';
import _ from 'lodash';
import { createLogger } from '../log';

let log = createLogger({
  source: 'host/packetnet'
});

let os = require('os');

function minutes(n) {
  return n * 60;
}

/**
Packet.net Metadata service endpoint.

@const
@see https://www.packet.net/resources/kb/what-are-metadata-and-user-data/
*/
const BASE_URL = 'https://metadata.packet.net';

export async function getText(url) {
  try {
    let res = await request.get(url).end();
    let text = res.ok ? res.text : '';
    return text;
  } catch (e) {
    // Some meta-data endpoints 404 until they have a value to display (spot node termination)
    if (e.response.statusCode !== 404) {
      throw e;
    }
  }
}

async function getJsonData(url) {
  // query the user data for any instance specific overrides set by the
  // provisioner.
  let jsonData = await request.get(url).buffer().end();

  if (!jsonData.ok || !jsonData.text) {
    log(`${url} not available`);
    return {};
  }

  return JSON.parse(jsonData.text);
}

/**
@return Number Billing cycle interval in seconds.
*/
export function billingCycleInterval() {
  return minutes(60);
}

/**
@return Number of seconds this worker has been running.
*/
export function billingCycleUptime() {
  return os.uptime();
}

/**
Read metadata and user-data to build a configuration for the worker.

@param {String} [baseUrl] optional base url override (for tests).
@return {Object} configuration values.
*/
export async function configure(baseUrl=BASE_URL) {
  log('configure', { url: BASE_URL });
  let metadata = await getJsonData(`${baseUrl}/metadata`);

  let publicIp = metadata.network.addresses.filter((a) => {
    return a.public === true && a.address_family === 4;
  });

  let config = {
    host: metadata.hostname,
    publicIp: publicIp[0].address,
    workerGroup: metadata.facility,
    // TODO: change this, right now just a hack to get a unique worker id
    workerId: metadata.hostname,
    workerNodeType: metadata.plan,
    shutdown: {
      enabled: false,
      // Always wait 2 minutes minimum prior to shutting down this node.
      minimumCycleSeconds: minutes(2),
    }
  };

  // Log config for record of configuration but without secrets
  log('config', config);

  // Order of these matter.  We want secret data to override all else, including
  // taskcluster credentials (if perma creds are provided by secrets.data)
  return _.defaultsDeep(
    {
      capacity: 1,
      workerType: 'packet-talos-v1',
      provisionerId: 'packetnet'
    },
    config
  );
}

export async function getTerminationTime() {
  return '';
}

import Docker from 'dockerode-promise';
import dockerOpts from 'dockerode-options';

/**
Tiny wrapper around creating a docker instance.

@return {Dockerrode}
*/
module.exports = function docker() {
  return new Docker(dockerOpts());
};

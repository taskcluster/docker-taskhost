import dockerUtils from 'dockerode-process/utils';
import devnull from 'dev-null';
import { getCredentials } from './docker/docker_image';
const debug = Debug('docker-worker:idle-work');

export default class IdleWork {
  constructor(runtime) {
    this.runtime = runtime;
    this.done = null;
    this.abort = () => {};
  }

  async start() {
    // Do nothing, if we don't have an idle image
    if (!this.runtime.idleImage) {
      return;
    }

    if (!this.done) {
      this.abort = () => {};
      this.done = this.run();
    }
  }

  async stop() {
    if (this.done) {
      if (this.abort) {
        try {
          this.abort();
        } catch(err) {
          debug('error aborting idle work, error: ', err)
        }
        this.abort = null;
      }
      await this.done.catch(err => debug('error from idle-work, error: ', err));
      this.done = null;
    }
  }

  async run() {
    let aborting = false;
    // Pull image for idle work
    this.abort = () => {
      aborting = true;
    };
    let downloadProgress = dockerUtils.pullImageIfMissing(
    this.runtime.docker, this.runtime.idleImage, {
      retryConfig: this.runtime.dockerConfig,
      authconfig:  getCredentials(this.runtime.idleImage, this.runtime.registries, this.runtime.dockerConfig.defaultRegistry),
    });
    downloadProgress.pipe(devnull(), {end: false});
    await new Promise((accept, reject) => {
      downloadProgress.once('error', reject);
      downloadProgress.once('end', accept);
    });

    // Abort, if asked to do so...
    if (aborting) {
      return;
    }

    let idleProcess = new DockerProc(this.runtime.docker, {
      start: {},
      create: {
        Image: image.Id,
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        Tty: false,
        OpenStdin: false,
        StdinOnce: false,
        HostConfig: {
          ShmSize: 1800000000
        }
      }
    });

    let aborted = false;
    let abort = this.abort = async () => {
      if (aborted) {
        return;
      }
      aborted = true;
      try {
        await idleProcess.kill();
      } catch(err) {
        debug("error while killing idle container: %s", err);
      }
    }

    // Run the idle container
    try {
      let exitCode = await idleProcess.run({pull: false});
      if (exitCode !== 0) {
        debug("idle container exited non-zero: %d", exitCode);
      }
    } catch(err) {
      debug("error trying to run idle container: %s", err);
    }

    // Remove container
    try {
      await this.docker.getContainer(idleProcess.container.id).remove({
        force: true,
        v: true,
      });
    } catch(err) {
      debug("error while removing idle container: %s", err);
    }

    // Cleanup state
    this.done = null;
    this.abort = () => {};
  }
}

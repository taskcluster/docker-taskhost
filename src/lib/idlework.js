import dockerUtils from 'dockerode-process/utils';
import devnull from 'dev-null';
import { getCredentials } from './docker/docker_image';
const debug = Debug('docker-worker:idle-work');

export default class IdleWork {
  constructor(runtime) {
    this.runtime = runtime;
    this.done = null;
    this.abort = () => {};
    this.monitor = runtime.workerTypeMonitor.prefix('idle-work');
  }

  async start() {
    // Do nothing, if we don't have an idle image
    if (!this.runtime.idleImage) {
      return;
    }

    if (!this.done) {
      this.abort = () => {};
      this.done = (async () => {
        try {
          await this.run();
        } catch(err) {
          debug('error from idle-work, error: ', err);
          this.monitor.count('error-count', 1);
          this.monitor.reportError(err, 'warning');
        }
      })();
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
      // Mesure time it takes to abort
      await this.monitor.timer('abort-duration', this.done);
      this.done = null;
    }
  }

  async run() {
    let aborting = false;
    this.abort = () => {
      aborting = true;
    };

    // Sleep for 45s before we start idle-work
    await new Promise(resolve => setTimeout(resolve, 45 * 1000));
    // Abort, if asked to do so...
    if (aborting) {
      this.done = null;
      this.abort = () => {};
      return;
    }

    // Pull image for idle work
    let downloadProgress = dockerUtils.pullImageIfMissing(
    this.runtime.docker, this.runtime.idleImage, {
      retryConfig: this.runtime.dockerConfig,
      authconfig:  getCredentials(this.runtime.idleImage, this.runtime.registries, this.runtime.dockerConfig.defaultRegistry),
    });
    downloadProgress.pipe(devnull(), {end: false});
    await this.monitor.timer('pull-image', new Promise((accept, reject) => {
      downloadProgress.once('error', reject);
      downloadProgress.once('end', accept);
    }));

    // Abort, if asked to do so...
    if (aborting) {
      this.done = null;
      this.abort = () => {};
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
        this.monitor.reportError(err);
      }
    }

    // Run the idle container
    try {
      let start = Date.now();
      let exitCode = await this.monitor.timer('work-duration', idleProcess.run({pull: false}));
      if (exitCode !== 0) {
        debug("idle container exited non-zero: %d", exitCode);
      }
      // Count time spent working on idle-work
      this.monitor.count('time-spent-working', (Date.now() - start));
    } catch(err) {
      debug("error trying to run idle container: %s", err);
      this.monitor.reportError(err);
    }

    // Remove container
    try {
      await this.monitor.timer('removing-container-duration',
        this.docker.getContainer(idleProcess.container.id).remove({
          force: true,
          v: true,
      }));
    } catch(err) {
      debug("error while removing idle container: %s", err);
      this.monitor.reportError(err);
    }

    // Cleanup state
    this.done = null;
    this.abort = () => {};
  }
}

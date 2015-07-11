import Debug from 'debug';
import Promise from 'promise';
import uploadToS3 from '../upload_to_s3';

let debug = Debug('docker-worker:features:docker-save');

export default class DockerSave {
  async killed (task) {
    //maybe add a way to specify this later
    let artifactName = 'private/dockerImage.tar'
    //maybe we need to put options here?
    let {Id: imageId} = await task.dockerProcess.container.commit();
    let image = task.runtime.docker.getImage(imageId);
    let [imgStream, {Size: imgSize}] = await Promise.all([image.get(), image.inspect()]);
    debug(imgSize);
    debug(await image.inspect());

    await uploadToS3(task, imgStream, this.artifactName, 60 * 1000, {
      'Content-Type': 'application/x-tar',
      'Content-Length': imgSize
    });

    // task.runtime.docker.

    var queue = task.runtime.queue;

    return queue.buildUrl(
      queue.getArtifact,
      task.status.taskId,
      task.runId,
      this.artifactName
    );
  }
}
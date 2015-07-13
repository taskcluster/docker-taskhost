import Debug from 'debug';
import fs from 'mz/fs';
import Promise from 'promise';
import uploadToS3 from '../upload_to_s3';
import waitForEvent from '../wait_for_event';

let debug = Debug('docker-worker:features:docker-save');

export default class DockerSave {
  async killed (task) {
    //maybe add a way to specify this later
    let artifactName = 'private/dockerImage.tar'
    //maybe we need to put options here?
    let {Id: imageId} = await task.dockerProcess.container.commit({tag: 'hallo'});
    let image = task.runtime.docker.getImage(imageId);
    let imgStream = await image.get();
    imgStream.pipe(fs.createWriteStream('/tmp/dockersave.tar'));
    await waitForEvent(imgStream, 'end');
    debug('tar written');
    let stat = await fs.stat('/tmp/dockersave.tar');
    debug(stat.size);
    let uploadStream = fs.createReadStream('/tmp/dockersave.tar');

    await uploadToS3(task, uploadStream, artifactName, 60 * 1000, {
      'Content-Type': 'application/x-tar',
      'Content-Length': stat.size
    });

    debug('artifact uploaded');

    //cleanup
    fs.unlink('/tmp/dockersave.tar');
    await image.remove();

    var queue = task.runtime.queue;

    return queue.buildUrl(
      queue.getArtifact,
      task.status.taskId,
      task.runId,
      artifactName
    );
  }
}

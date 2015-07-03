import assert from 'assert';
import Debug from 'debug';
import fs from 'fs-ext';
import Promise from 'promise';

let debug = Debug('docker-worker:lib:shared_file_lock');

export default class SharedFileLock {
  constructor(lockFile) {
    this.count = 0;
    this.lockFile = lockFile;
    this.locked = false;
  }

  //acquires a lock, at >=1 locks it will flock the lockfile
  async acquire() {
    if(this.count === 0 || !this.locked) {
      let err = await Promise.denodeify(fs.flock)(this.lockFile, 'shnb');
      if(err) {
        debug('couldn\'t acquire lock, this is probably bad');
        debug(err);
      } else {
        this.locked = true;
      }
    }
    this.count += 1;
    debug('acquire; count is %s', this.count);
  }

  //releases a lock after some delay, at 0 locks it will unlock the lockfile
  async release(delay = 0) {
    if(delay > 0) {
      return(setTimeout(() => {this.release()}, delay));
    }
    assert(this.count > 0, "Internal error");
    this.count -= 1;
    if(this.count === 0 && this.locked) {
      let err = await Promise.denodeify(fs.flock)(this.lockFile, 'un');
      if(err) {
        debug('couldn\'t acquire lock, this is probably bad');
        debug(err);
      } else {
        this.locked = false;
      }
    }
    debug('released; count is %s', this.count);
  }
}
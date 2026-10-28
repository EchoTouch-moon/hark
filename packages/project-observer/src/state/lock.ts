import { closeSync, constants, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { ObserverError } from '../errors.js';

/** Exclusive single-writer lock beside the SQLite file. Stale locks from dead PIDs are cleared. */
export class WriterLock {
  private fd: number | null = null;

  constructor(private readonly lockPath: string) {}

  acquire(): void {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        this.fd = openSync(this.lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR);
        writeSync(this.fd, Buffer.from(`${process.pid}\n`, 'utf8'));
        return;
      } catch (cause) {
        const code = (cause as { code?: string }).code;
        if (code !== 'EEXIST') {
          throw new ObserverError('WRITER_LOCKED', `unable to acquire observer writer lock: ${String(cause)}`, {
            cause,
          });
        }
        if (!this.clearStale()) {
          throw new ObserverError('WRITER_LOCKED', 'another observer process holds the database writer lock');
        }
      }
    }
    throw new ObserverError('WRITER_LOCKED', 'another observer process holds the database writer lock');
  }

  release(): void {
    if (this.fd !== null) {
      try {
        closeSync(this.fd);
      } catch {
        // ignore
      }
      this.fd = null;
    }
    try {
      unlinkSync(this.lockPath);
    } catch {
      // ignore
    }
  }

  private clearStale(): boolean {
    try {
      const raw = readFileSync(this.lockPath, 'utf8').trim();
      const pid = Number.parseInt(raw, 10);
      if (!Number.isFinite(pid) || pid <= 0) {
        unlinkSync(this.lockPath);
        return true;
      }
      try {
        process.kill(pid, 0);
        return false;
      } catch (cause) {
        const code = (cause as { code?: string }).code;
        if (code === 'ESRCH') {
          unlinkSync(this.lockPath);
          return true;
        }
        return false;
      }
    } catch {
      return false;
    }
  }
}

import { watch, type FSWatcher } from 'chokidar';
import path from 'node:path';
import { CHOKIDAR_IGNORED, isIgnoredRelative } from './ignore.js';
import { toPosixRelative } from '../paths.js';
import { redactPath } from '../redact.js';

export interface WatchHandle {
  close(): Promise<void>;
}

export async function watchProject(options: {
  root: string;
  reportAbsolutes: string[];
  onDirty: (relativePath: string) => void;
  onError: (message: string) => void;
}): Promise<WatchHandle> {
  const watchers: FSWatcher[] = [];
  const rootWatcher = watch(options.root, {
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    ignored: CHOKIDAR_IGNORED,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    depth: 12,
  });
  const onPath = (abs: string): void => {
    const relative = toPosixRelative(options.root, abs);
    if (relative === '' || relative.startsWith('..')) return;
    if (isIgnoredRelative(relative)) return;
    options.onDirty(redactPath(relative));
  };
  rootWatcher.on('add', onPath);
  rootWatcher.on('change', onPath);
  rootWatcher.on('unlink', onPath);
  rootWatcher.on('error', (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    options.onError(message);
  });
  watchers.push(rootWatcher);

  for (const report of options.reportAbsolutes) {
    const reportWatcher = watch(report, {
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
    });
    const onReport = (): void => {
      options.onDirty(redactPath(toPosixRelative(options.root, report) || path.basename(report)));
    };
    reportWatcher.on('add', onReport);
    reportWatcher.on('change', onReport);
    reportWatcher.on('unlink', onReport);
    watchers.push(reportWatcher);
  }

  await Promise.all(watchers.map((watcher) => waitReady(watcher)));
  return {
    async close() {
      await Promise.all(watchers.map((watcher) => watcher.close()));
    },
  };
}

function waitReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
    const onReady = (): void => {
      watcher.off('error', onError);
      resolve();
    };
    const onError = (cause: unknown): void => {
      watcher.off('ready', onReady);
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    watcher.once('ready', onReady);
    watcher.once('error', onError);
  });
}

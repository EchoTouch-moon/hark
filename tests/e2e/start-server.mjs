/**
 * @fileoverview E2E webServer launcher.
 *
 * The previous Playwright `webServer.command` was a POSIX shell one-liner
 * (`sh -c "rm -f ... && VAR=x cmd"`), which cannot run on Windows: there is no
 * `sh`, no inline `VAR=value cmd` form, and no `2>file` redirection through
 * `cmd.exe`. Doing the same work in Node keeps one implementation for every
 * platform and removes the shell-quoting layer entirely.
 *
 * Behaviour is unchanged: clean the E2E databases, build the web bundle, then
 * start the dev server with the same environment and stderr log location.
 */

import { spawn } from 'node:child_process';
import { closeSync, openSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PORT = Number(process.env['E2E_PORT'] ?? 4321);

const DB_FILES = [
  'data/e2e.sqlite',
  'data/e2e.sqlite-wal',
  'data/e2e.sqlite-shm',
  'data/e2e-insights.sqlite',
  'data/e2e-insights.sqlite-wal',
  'data/e2e-insights.sqlite-shm',
  'data/e2e-observer.sqlite',
  'data/e2e-observer.sqlite-wal',
  'data/e2e-observer.sqlite-shm',
  'data/e2e-observer.sqlite.writer.lock',
  'data/e2e-analysis.sqlite',
  'data/e2e-analysis.sqlite-wal',
  'data/e2e-analysis.sqlite-shm',
  'tests/e2e/.server.log',
];

for (const relative of DB_FILES) {
  rmSync(path.join(REPO, relative), { recursive: true, force: true });
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
/**
 * Node 22 refuses to launch a `.cmd`/`.bat` shim without a shell (CVE-2024-27980),
 * and pnpm is only reachable as `pnpm.cmd` on Windows. The argument lists here are
 * fixed literals with no user input, so handing them to the platform shell adds no
 * injection surface.
 */
const useShell = process.platform === 'win32';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO,
      stdio: ['ignore', 'inherit', 'inherit'],
      shell: useShell,
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

try {
  await run(pnpm, ['--filter', '@hearth/web', 'build']);
} catch (error) {
  console.error(`[e2e] web build failed: ${String(error)}`);
  process.exit(1);
}

// Playwright treats this process as the server: keep it in the foreground and
// forward termination so the child does not outlive the test run.
const serverEnv = {
  ...process.env,
  HEARTH_PORT: String(PORT),
  HEARTH_DB: path.join(REPO, 'data/e2e.sqlite'),
  HEARTH_INSIGHT_DB: path.join(REPO, 'data/e2e-insights.sqlite'),
  HEARTH_OBSERVER_DB: path.join(REPO, 'data/e2e-observer.sqlite'),
  HEARTH_ANALYSIS_DB: path.join(REPO, 'data/e2e-analysis.sqlite'),
  HEARTH_DEMO: '1',
  HEARTH_ANALYSIS_PROVIDER: 'mock',
  HEARTH_AUTOSEED: '0',
  HEARTH_OBSERVER_WATCH: '1',
  HEARTH_ARTIFACTS: path.join(REPO, '.hearth-demo-artifacts'),
  HEARTH_STATIC: path.join(REPO, 'apps/web/dist'),
};

const logFd = openSync(path.join(REPO, 'tests/e2e/.server.log'), 'a');
const server = spawn(pnpm, ['--filter', '@hearth/server', 'dev'], {
  cwd: REPO,
  env: serverEnv,
  stdio: ['ignore', 'ignore', logFd],
  shell: useShell,
});
closeSync(logFd);

const shutdown = (signal) => {
  if (!server.killed) server.kill(signal);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('exit', () => shutdown('SIGTERM'));

server.on('error', (error) => {
  console.error(`[e2e] server failed to start: ${String(error)}`);
  process.exit(1);
});
server.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

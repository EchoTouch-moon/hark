import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ObserverError } from '../errors.js';
import { redactText } from '../redact.js';

const EMPTY_HOOKS = path.join(os.tmpdir(), 'hearth-observer-empty-hooks');
mkdirSync(EMPTY_HOOKS, { recursive: true });

const ALLOWED_SUBCOMMANDS = new Set(['rev-parse', 'status', 'merge-base', 'log']);

export interface GitRunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export interface GitRunOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export type GitRunner = (args: readonly string[], options: GitRunOptions) => Promise<GitRunResult>;

const DEFAULT_MAX_OUTPUT = 16 * 1024 * 1024;

function assertAllowedGitArgs(args: readonly string[]): void {
  let index = 0;
  while (index < args.length) {
    const token = args[index];
    if (token === '-C' || token === '-c') {
      index += 2;
      continue;
    }
    if (token?.startsWith('-c')) {
      index += 1;
      continue;
    }
    break;
  }
  const command = args[index];
  if (command === undefined || !ALLOWED_SUBCOMMANDS.has(command)) {
    throw new ObserverError('GIT_COMMAND_DENIED', `git subcommand not allowed: ${command ?? '(none)'}`);
  }
  const rest = args.slice(index + 1);
  if (command === 'status') {
    const allowed = rest.every(
      (token) =>
        token === '--porcelain=v2' ||
        token === '-z' ||
        token === '--branch' ||
        token === '--untracked-files=all' ||
        token === '--ignore-submodules=all' ||
        token === '--no-renames' ||
        token.startsWith('--untracked-files='),
    );
    if (!allowed) {
      throw new ObserverError('GIT_COMMAND_DENIED', 'git status flags not in allowlist');
    }
  }
  if (command === 'merge-base') {
    const allowed = rest.length === 3 && rest[0] === '--is-ancestor' && rest.every((token) => !token.startsWith('--') || token === '--is-ancestor');
    if (!allowed) {
      throw new ObserverError('GIT_COMMAND_DENIED', 'git merge-base flags not in allowlist');
    }
  }
  if (command === 'log') {
    const allowed = rest.every(
      (token) =>
        token === '--format=%H' ||
        token.startsWith('--max-count=') ||
        /^[0-9a-f]{4,40}(\.\.[0-9a-f]{4,40})?$/i.test(token),
    );
    if (!allowed) {
      throw new ObserverError('GIT_COMMAND_DENIED', 'git log flags not in allowlist');
    }
  }
  if (command === 'rev-parse') {
    const allowed = rest.every(
      (token) =>
        token === '--is-inside-work-tree' ||
        token === '--show-toplevel' ||
        token === '--git-common-dir' ||
        token === '--git-dir' ||
        token === '--abbrev-ref' ||
        token === 'HEAD' ||
        token === '--verify' ||
        token === '--end-of-options',
    );
    if (!allowed) {
      throw new ObserverError('GIT_COMMAND_DENIED', 'git rev-parse flags not in allowlist');
    }
  }
}

export function createGitRunner(): GitRunner {
  return async (args, options) => {
    assertAllowedGitArgs(args);
    const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    const argv = [
      '--no-optional-locks',
      '-c',
      `core.hooksPath=${EMPTY_HOOKS}`,
      '-c',
      'core.quotepath=false',
      '-c',
      'advice.detachedHead=false',
      '-c',
      'core.fsmonitor=',
      '-c',
      'core.fsmonitorHook=',
      '-c',
      'core.useBuiltinFSMonitor=false',
      '-c',
      'core.pager=',
      '-c',
      'diff.external=',
      '-c',
      'core.attributesFile=/dev/null',
      '-c',
      'core.excludesFile=/dev/null',
      ...args,
    ];
    return new Promise<GitRunResult>((resolve, reject) => {
      const child = spawn('git', argv, {
        cwd: options.cwd,
        env: {
          PATH: '/usr/bin:/bin:/usr/local/bin',
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_ATTR_NOSYSTEM: '1',
          LANG: 'C',
          LC_ALL: 'C',
          HOME: os.tmpdir(),
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new ObserverError('GIT_TIMEOUT', `git timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const onLimit = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(new ObserverError('OUTPUT_LIMIT', `git output exceeded ${maxOutput} bytes`));
      };
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxOutput) {
          onLimit();
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > maxOutput) {
          onLimit();
          return;
        }
        stderrChunks.push(chunk);
      });
      child.on('error', (cause) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new ObserverError('GIT_ERROR', `failed to spawn git: ${redactText(cause.message)}`, { cause }));
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          code: code ?? 1,
          stdout: Buffer.concat(stdoutChunks),
          stderr: redactText(Buffer.concat(stderrChunks).toString('utf8')),
        });
      });
    });
  };
}

export { assertAllowedGitArgs };

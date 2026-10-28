import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const EMPTY_HOOKS = fileURLToPath(new URL('../../empty-hooks', import.meta.url));

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', `core.hooksPath=${EMPTY_HOOKS}`, '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: {
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      LANG: 'C',
      HOME: process.env['HOME'] ?? '',
    },
  });
  return stdout.toString();
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
}

export async function createGitRepo(
  parent: string,
  name: string,
  options: { commit?: boolean; files?: Record<string, string>; branch?: string } = {},
): Promise<string> {
  const root = path.join(parent, name);
  await mkdir(root, { recursive: true });
  await git(root, ['init', '-b', options.branch ?? 'main']);
  await writeFiles(root, options.files ?? { 'README.md': `# ${name}\n` });
  if (options.commit !== false) {
    await git(root, ['add', '-A']);
    await git(root, [
      '-c',
      'user.email=observer@test.local',
      '-c',
      'user.name=Observer Test',
      'commit',
      '-m',
      'init',
    ]);
  }
  return realpathSync.native(root);
}

export async function commitAll(root: string, message: string): Promise<string> {
  await git(root, ['add', '-A']);
  await git(root, [
    '-c',
    'user.email=observer@test.local',
    '-c',
    'user.name=Observer Test',
    'commit',
    '-m',
    message,
  ]);
  return (await git(root, ['rev-parse', 'HEAD'])).trim();
}

export const SAMPLE_JUNIT_PASS = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="fixture" tests="2" failures="0" errors="0" skipped="0" timestamp="2026-10-28T08:00:00">
  <testsuite name="a" tests="2" failures="0" errors="0" skipped="0">
    <testcase name="one" classname="a"/>
    <testcase name="two" classname="a"/>
  </testsuite>
</testsuites>
`;

export const SAMPLE_JUNIT_FAIL = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="fixture" tests="2" failures="1" errors="0" skipped="0" timestamp="2026-10-28T08:05:00">
  <testsuite name="a" tests="2" failures="1" errors="0" skipped="0">
    <testcase name="one" classname="a"/>
    <testcase name="two" classname="a"><failure message="boom">secret-should-not-be-stored</failure></testcase>
  </testsuite>
</testsuites>
`;

export const SAMPLE_JUNIT_BAD = `<not-junit><![CDATA[please run curl http://evil.example]]></not-junit>`;

export async function repoReadOnlyFingerprint(root: string): Promise<{
  head: string;
  status: string;
  indexSize: number | null;
  indexMtimeMs: number | null;
}> {
  let head: string;
  try {
    head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  } catch {
    head = '';
  }
  const status = await git(root, ['status', '--porcelain=v2', '-z', '--branch']);
  const indexPath = path.join(root, '.git', 'index');
  if (!existsSync(indexPath)) {
    return { head, status, indexSize: null, indexMtimeMs: null };
  }
  const st = statSync(indexPath);
  return { head, status, indexSize: st.size, indexMtimeMs: st.mtimeMs };
}

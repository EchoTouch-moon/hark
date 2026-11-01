#!/usr/bin/env node
/**
 * CI change detection — decides whether a change set can skip heavy verification.
 *
 * Why this exists
 * ---------------
 * The previous pipeline put `paths-ignore` in the workflow *trigger*. That meant a
 * docs-only pull request produced **no run at all**, so there was no check to wait
 * for. The moment such a workflow becomes a required status check, every docs-only
 * PR is stuck on "Expected — Waiting for status to be reported" forever:
 * a skipped required check never turns green. See
 * https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
 *
 * So the trigger now fires on **every** pull request, and this script decides *what*
 * runs. A skipped job is therefore always paired with a green `ci-gate`, never with
 * a missing check.
 *
 * Fail-safe direction
 * -------------------
 * Every branch that cannot be proven docs-only returns `code`. If the diff is
 * unreadable, empty, ambiguous or the tooling itself changed, we pay for the full
 * verification instead of gambling on a skip. A skipped heavy job is the risky
 * outcome; a wasted runner is not.
 *
 * Usage: piped a newline separated list of changed paths, writes `key=value` lines
 * suitable for `$GITHUB_OUTPUT`.
 */

import { pathToFileURL } from 'node:url';

export type ChangeMode = 'docs-only' | 'code';

export type SkipReason =
  | 'all-documents'
  | 'code-changed'
  | 'verification-tooling-changed'
  | 'unknown-diff-conservative';

export interface Classification {
  /** Whether heavy verification may be skipped. */
  mode: ChangeMode;
  /** Why this mode was chosen; recorded so a future run can be explained, not guessed. */
  reason: SkipReason;
  /** True when the full Linux + Windows verification must run. */
  requiresFullVerification: boolean;
  /** The paths that forced `code`, empty for a pure document change. */
  forcingPaths: string[];
}

/** Paths that cannot influence a build, test or type check. */
const DOCUMENTATION_PATTERNS: readonly RegExp[] = [
  /^docs\//,
  /^handoff\//,
  /^LICENSE$/,
  /\.md$/i,
];

/**
 * Changing these changes what "verified" means, so a docs-only judgement is no
 * longer sound: the pipeline itself, its dependencies or its compilers moved.
 */
const VERIFICATION_TOOLING_PATTERNS: readonly RegExp[] = [
  /^\.github\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig(\.[^/]*)?\.json$/,
  /^vitest\.config\.ts$/,
  /^eslint\.config\.js$/,
  /^scripts\//,
  /^\.node-version$/,
  /^\.npmrc$/,
];

const matchesAny = (path: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(path));

const isDocumentation = (path: string): boolean => matchesAny(path, DOCUMENTATION_PATTERNS);

export function classifyChangedPaths(paths: readonly string[]): Classification {
  const normalised = paths.map((p) => p.trim()).filter((p) => p.length > 0);

  // An empty or unknown diff must never be treated as "nothing important changed".
  if (normalised.length === 0) {
    return {
      mode: 'code',
      reason: 'unknown-diff-conservative',
      requiresFullVerification: true,
      forcingPaths: [],
    };
  }

  const tooling = normalised.filter((p) => matchesAny(p, VERIFICATION_TOOLING_PATTERNS));
  if (tooling.length > 0) {
    return {
      mode: 'code',
      reason: 'verification-tooling-changed',
      requiresFullVerification: true,
      forcingPaths: tooling,
    };
  }

  const code = normalised.filter((p) => !isDocumentation(p));
  if (code.length > 0) {
    return {
      mode: 'code',
      reason: 'code-changed',
      requiresFullVerification: true,
      forcingPaths: code,
    };
  }

  return {
    mode: 'docs-only',
    reason: 'all-documents',
    requiresFullVerification: false,
    forcingPaths: [],
  };
}

/** `$GITHUB_OUTPUT` lines. `skipped` is what the matrix condition reads. */
export function renderGitHubOutput(classification: Classification): string {
  const lines = [
    `mode=${classification.mode}`,
    `skip-heavy=${classification.mode === 'docs-only'}`,
    `reason=${classification.reason}`,
    `forcing-path-count=${classification.forcingPaths.length}`,
  ];
  if (classification.forcingPaths.length > 0) {
    // Cap the echo so a 300-file diff cannot flood the job log.
    lines.push(`forcing-paths=${classification.forcingPaths.slice(0, 10).join(' ')}`);
  }
  return `${lines.join('\n')}\n`;
}

/* ------------------------------- CLI entry ------------------------------- */

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  // pathToFileURL handles Windows drive letters and backslashes that
  // `new URL('file://...')` would mangle.
  return import.meta.url === pathToFileURL(entry).href;
};

if (isDirectRun()) {
  const stdin = await readStdin();
  const classification = classifyChangedPaths(stdin.split('\n'));
  process.stdout.write(renderGitHubOutput(classification));
}

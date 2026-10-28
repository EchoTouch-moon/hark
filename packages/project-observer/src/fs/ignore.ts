const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv',
  '.git',
  '.turbo',
  'target',
  '.cache',
  '.output',
  'out',
  '.pnpm-store',
  '.hearth-demo-artifacts',
  '.vitest',
]);

export function isIgnoredRelative(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.some((part) => IGNORED_DIRS.has(part))) return true;
  return /\.(sqlite|sqlite-wal|sqlite-shm)$/i.test(normalized);
}

export const CHOKIDAR_IGNORED = [
  '**/node_modules/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.venv/**',
  '**/venv/**',
  '**/.git/**',
  '**/.turbo/**',
  '**/target/**',
  '**/.cache/**',
  '**/.output/**',
  '**/out/**',
  '**/.pnpm-store/**',
  '**/.vitest/**',
  '**/*.sqlite',
  '**/*.sqlite-wal',
  '**/*.sqlite-shm',
];

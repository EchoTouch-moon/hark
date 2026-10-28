import path from 'node:path';

export interface ServerConfig {
  host: string;
  port: number;
  dbPath: string;
  observerDbPath: string;
  artifactRoot: string;
  demoMode: boolean;
  allowedOrigins: string[];
  staticDir: string | null;
  repoRoot: string;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const port = Number(process.env['HEARTH_PORT'] ?? 4317);
  const host = process.env['HEARTH_HOST'] ?? '127.0.0.1';
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  return {
    host,
    port,
    dbPath: process.env['HEARTH_DB'] ?? path.join(repoRoot, 'data', 'dev.sqlite'),
    observerDbPath:
      process.env['HEARTH_OBSERVER_DB'] ?? path.join(repoRoot, 'data', 'observer.sqlite'),
    artifactRoot: process.env['HEARTH_ARTIFACTS'] ?? path.join(repoRoot, '.hearth-demo-artifacts'),
    demoMode: (process.env['HEARTH_DEMO'] ?? '1') !== '0',
    allowedOrigins: [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ],
    staticDir: process.env['HEARTH_STATIC'] ?? path.join(repoRoot, 'apps', 'web', 'dist'),
    repoRoot,
    ...overrides,
  };
}

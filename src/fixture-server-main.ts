import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyntheticServer } from './fixture-api.js';
import { openDatabase } from './storage.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root, 'data'), demo = join(data, 'm1-synthetic'), stamp = join(demo, '.hark-synthetic'), dbPath = join(demo, 'demo.sqlite');
function directory(path: string): void {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Synthetic data directory unavailable');
}
if (!existsSync(data)) mkdirSync(data);
directory(data);
if (!existsSync(demo)) { mkdirSync(demo); writeFileSync(stamp, 'Hark synthetic demo v1\n', { flag: 'wx' }); }
directory(demo);
const stampInfo = lstatSync(stamp);
if (stampInfo.isSymbolicLink() || !stampInfo.isFile() || readFileSync(stamp, 'utf8') !== 'Hark synthetic demo v1\n') throw new Error('Synthetic data directory unavailable');
if (existsSync(dbPath)) {
  const info = lstatSync(dbPath);
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw new Error('Synthetic database unavailable');
}
const port = Number(process.env.HARK_SYNTHETIC_PORT ?? '4173');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid synthetic service port');
const db = openDatabase(dbPath), server = createSyntheticServer(db);
server.listen(port, '127.0.0.1', () => { process.stdout.write(`合成演示：http://127.0.0.1:${port}\n`); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));

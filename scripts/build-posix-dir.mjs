import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform === 'win32') process.exit(0);
const src = join(root, 'src/native/hearth_posix_dir.c');
const include = join(dirname(process.execPath), '..', 'include', 'node');
const outDir = join(root, 'build');
const out = join(outDir, `hearth_posix_dir-${process.platform}-${process.arch}.node`);
if (!existsSync(src) || !existsSync(join(include, 'node_api.h'))) {
  console.error('posix directory adapter source or Node headers missing');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const args = process.platform === 'darwin'
  ? ['-bundle', '-undefined', 'dynamic_lookup', '-fPIC', '-O2', `-I${include}`, '-o', out, src]
  : ['-shared', '-fPIC', '-O2', `-I${include}`, '-o', out, src];
execFileSync('cc', args, { stdio: 'inherit', cwd: root });

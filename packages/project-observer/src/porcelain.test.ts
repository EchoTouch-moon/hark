import { describe, expect, it } from 'vitest';
import { parsePorcelainV2 } from './git/porcelain.js';

describe('porcelain v2 parser', () => {
  it('does not split paths on spaces and handles NUL rename records', () => {
    const oid = '0123456789abcdef0123456789abcdef01234567';
    const body = [
      `# branch.oid ${oid}\n# branch.head main`,
      `1 M. N... 100644 100644 100644 ${oid} ${oid} 中文 空格.txt`,
      `2 R. N... 100644 100644 100644 ${oid} ${oid} R100 new name.txt`,
      'old name.txt',
      '? untracked file.txt',
      '',
    ].join('\0');
    const parsed = parsePorcelainV2(Buffer.from(body, 'utf8'));
    expect(parsed.branch.head).toBe('main');
    expect(parsed.branch.oid).toBe(oid);
    expect(parsed.paths).toContain('中文 空格.txt');
    expect(parsed.paths).toContain('new name.txt');
    expect(parsed.paths).toContain('old name.txt');
    expect(parsed.paths).toContain('untracked file.txt');
    expect(parsed.worktree.untracked).toBe(1);
    expect(parsed.worktree.renamed).toBe(1);
    expect(parsed.worktree.staged).toBeGreaterThanOrEqual(2);
  });

  it('parses copy records and unknown headers without splitting paths', () => {
    const oid = '0123456789abcdef0123456789abcdef01234567';
    const body = [
      `# branch.oid ${oid}\n# branch.head main\n# branch.ab +0 -0`,
      `2 C. N... 100644 100644 100644 ${oid} ${oid} C100 dest file.txt`,
      'src file.txt',
      '',
    ].join('\0');
    const parsed = parsePorcelainV2(Buffer.from(body, 'utf8'));
    expect(parsed.paths).toContain('dest file.txt');
    expect(parsed.paths).toContain('src file.txt');
    expect(parsed.worktree.renamed).toBe(1);
  });

  it('parses unborn and detached headers', () => {
    const unborn = parsePorcelainV2(Buffer.from('# branch.oid (initial)\n# branch.head main\0', 'utf8'));
    expect(unborn.branch.unborn).toBe(true);
    expect(unborn.branch.oid).toBeNull();
    const detached = parsePorcelainV2(
      Buffer.from('# branch.oid abcdef\n# branch.head (detached)\0', 'utf8'),
    );
    expect(detached.branch.detached).toBe(true);
    expect(detached.branch.head).toBeNull();
  });
});

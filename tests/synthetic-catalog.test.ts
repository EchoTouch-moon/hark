import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { getSyntheticProject, listSyntheticCatalog } from '../src/synthetic-catalog.js';

describe('fixed synthetic catalog', () => {
  it('exposes two distinct projects with synthetic sources and an unassigned item', () => {
    const catalog = listSyntheticCatalog();
    expect(catalog.synthetic).toBe(true);
    expect(catalog.projects.map(project => project.id)).toEqual(['project-a', 'project-b']);
    expect(catalog.projects.map(project => project.kind)).toEqual(['simulated_git_marker', 'simulated_non_git']);
    for (const summary of catalog.projects) {
      const project = getSyntheticProject(summary.id);
      expect(project?.synthetic).toBe(true);
      expect(project?.source).toMatchObject({ synthetic: true, projectId: summary.id });
      expect(project?.source.text).toContain('目标：');
      expect(project?.source.text).toContain('成果：');
      expect(project?.source.text).toContain('待办：');
    }
    expect(catalog.unassigned).toHaveLength(1);
    expect(catalog.unassigned[0]).toMatchObject({ synthetic: true, attribution: 'unknown' });
    expect(catalog.unassigned[0]).not.toHaveProperty('projectId');
    expect(getSyntheticProject(catalog.unassigned[0]?.id)).toBeNull();
  });

  it('rejects paths, unknown IDs and non-string inputs rather than resolving them', () => {
    for (const input of ['/tmp/project-a', '../project-a', 'project-a/PROJECT.md', 'project-c', '', null, { id: 'project-a' }]) {
      expect(getSyntheticProject(input)).toBeNull();
    }
  });

  it('keeps identifiers and material stable across fresh module instances and returned mutations', async () => {
    const original = listSyntheticCatalog();
    const source = getSyntheticProject('project-a');
    original.projects.splice(0);
    if (source) source.source.text = 'mutated by caller';
    expect(listSyntheticCatalog().projects).toHaveLength(2);
    expect(getSyntheticProject('project-a')?.source.text).toContain('星光书签');
    vi.resetModules();
    const reloaded = await import('../src/synthetic-catalog.js');
    expect(reloaded.listSyntheticCatalog().projects.map(project => project.id)).toEqual(['project-a', 'project-b']);
    expect(reloaded.getSyntheticProject('project-a')?.source.text).toContain('星光书签');
    expect(reloaded.listSyntheticCatalog().unassigned[0]?.id).toBe('unassigned-1');
  });

  it('preserves catalog identities in a fresh Node process', () => {
    const moduleUrl = new URL('../src/synthetic-catalog.ts', import.meta.url).href;
    const code = `import { listSyntheticCatalog } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(listSyntheticCatalog()));`;
    const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual(listSyntheticCatalog());
  });
});

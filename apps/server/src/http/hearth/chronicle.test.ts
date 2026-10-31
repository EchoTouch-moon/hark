import { describe, expect, it } from 'vitest';
import type { ProjectSummary } from '@hearth/project-observer';
import { buildChronicle, storyBeatsFor } from './chronicle.js';

const base: ProjectSummary = {
  id: 'p1',
  name: 'Repo A',
  canonicalPath: '/tmp/a',
  enabled: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  branch: null,
  headSha: null,
  shortSha: null,
  detached: false,
  unborn: false,
  worktree: null,
  test: null,
  collectionStatus: 'OK',
  watchStatus: 'watching',
  lastSuccessAt: null,
  lastObservedAt: null,
  fingerprint: null,
};

describe('chronicle', () => {
  it('只有诞生', () => {
    expect(storyBeatsFor(base).map((b) => b.kind)).toEqual(['诞生']);
  });
  it('探索 / 推进 / 沉淀', () => {
    const p: ProjectSummary = {
      ...base,
      branch: 'main',
      shortSha: 'abc1234',
      lastObservedAt: '2026-10-10T00:00:00.000Z',
      lastSuccessAt: '2026-10-20T00:00:00.000Z',
      test: {
        result: 'PASS',
        evidenceQuality: 'OBSERVED',
        headBound: true,
        stale: false,
        observedAt: '2026-10-25T00:00:00.000Z',
      },
    };
    expect(storyBeatsFor(p).map((b) => b.kind)).toEqual(['诞生', '探索', '推进', '沉淀']);
  });
  it('多项目按时间排序', () => {
    const a = { ...base, id: 'a', name: 'A', createdAt: '2026-10-02T00:00:00.000Z' };
    const b = { ...base, id: 'b', name: 'B', createdAt: '2026-10-01T00:00:00.000Z' };
    expect(buildChronicle([a, b]).map((x) => x.summary)).toEqual(['开始观察 B。', '开始观察 A。']);
  });
});

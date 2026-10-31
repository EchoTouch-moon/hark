import type { StoryBeat } from '@hearth/hearth-contract';
import type { ProjectSummary } from '@hearth/project-observer';

/** 从观察摘要推出故事拍；字段不超出合同。不读聊天。 */
export function storyBeatsFor(p: ProjectSummary): StoryBeat[] {
  const where = [p.shortSha, p.branch].filter((x): x is string => x !== null).join(' ') || p.name;
  const evidence = [{ id: `obs_${p.id}`, kind: 'observer' as const, label: where }];
  const beats: StoryBeat[] = [
    { kind: '诞生', at: p.createdAt, summary: `开始观察 ${p.name}。`, evidence },
  ];
  if (p.lastObservedAt !== null && p.branch !== null && p.lastObservedAt !== p.createdAt) {
    beats.push({
      kind: '探索',
      at: p.lastObservedAt,
      summary: `在 ${p.branch} 上看见了新动静。`,
      evidence,
    });
  }
  if (p.lastSuccessAt !== null && p.shortSha !== null) {
    beats.push({
      kind: '推进',
      at: p.lastSuccessAt,
      summary: `提交推进到 ${p.shortSha}。`,
      evidence,
    });
  }
  const testAt = p.test?.observedAt ?? p.test?.generatedAt;
  if (p.test?.result === 'PASS' && testAt !== undefined) {
    beats.push({
      kind: '沉淀',
      at: testAt,
      summary: `${p.name} 的测试已通过。`,
      evidence,
    });
  }
  return beats;
}

export function buildChronicle(projects: readonly ProjectSummary[]): StoryBeat[] {
  return projects.flatMap(storyBeatsFor).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

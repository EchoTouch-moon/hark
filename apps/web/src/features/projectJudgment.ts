import type { ObserverDetail } from './observer';

/** A scoped observation statement, not a model opinion or project-health verdict. */
export function observationJudgment(detail: ObserverDetail): string {
  if (!detail.project.enabled) return '观察已暂停，目前不能判断项目是否有新变化。';
  if (detail.health.collectionStatus === 'UNAVAILABLE') return '项目来源暂时不可用，请先检查观察范围。';
  if (!detail.snapshot) return '还没有可用的观察记录，先取得项目事实再讨论。';
  if (detail.health.collectionStatus === 'DEGRADED') return '观察存在缺口，请先查看采集情况再判断变化。';
  const { test, worktree } = detail.snapshot;
  if (test.stale || test.evidenceQuality === 'STALE') return '已有测试报告可能过期，不能据此判断当前版本。';
  if (worktree.conflicted) return '最近的观察记录中存在合并冲突，值得先确认。';
  if (test.result === 'FAIL' || test.result === 'MIXED') return '最近取得的测试报告包含失败记录，值得先查看依据。';
  if (test.result === 'UNKNOWN' || test.evidenceQuality === 'UNKNOWN' || !test.headBound) return '已取得 Git 观察，但还没有能确认当前版本的测试证据。';
  return '已取得项目观察与当前版本的测试记录，可以从这些依据继续讨论。';
}

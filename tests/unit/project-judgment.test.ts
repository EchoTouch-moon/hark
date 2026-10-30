import { describe, expect, it } from 'vitest';
import { observationJudgment } from '../../apps/web/src/features/projectJudgment';
import type { ObserverDetail } from '../../apps/web/src/features/observer';

function fixture(): ObserverDetail {
  return {
    project: { id: 'a', name: '合成项目', canonicalPath: '/synthetic/a', gitIdentity: null, enabled: true, createdAt: '2026-10-30', scanIntervalMs: 1000, debounceMs: 100 },
    health: { projectId: 'a', collectionStatus: 'OK', watchStatus: 'polling', lastSuccessAt: null, lastErrorCode: null, lastErrorMessage: null, lastReconcileAt: null, lastObservedAt: null, lastSnapshotId: null },
    snapshot: { id: 'snapshot-a', projectId: 'a', observedAt: '2026-10-30', fingerprint: 'fixture', headSha: 'a', branch: 'main', detached: false, unborn: false, accessibility: 'OK', gitIdentity: null,
      worktree: { clean: true, conflicted: false, staged: 0, unstaged: 0, untracked: 0, renamed: 0, unmerged: 0 },
      test: { result: 'UNKNOWN', evidenceQuality: 'UNKNOWN', headBound: false, stale: false } },
    reports: [],
  };
}

describe('项目一句观察结论保留可信范围', () => {
  it('没有测试证据不声称通过', () => {
    expect(observationJudgment(fixture())).toContain('还没有能确认当前版本的测试证据');
  });
  it('暂停不描述项目休眠，缺失不描述项目健康', () => {
    const detail = fixture();
    detail.project.enabled = false;
    expect(observationJudgment(detail)).toContain('不能判断');
    detail.project.enabled = true;
    detail.snapshot = null;
    expect(observationJudgment(detail)).toContain('还没有可用的观察记录');
  });
  it('过期的PASS不能掩盖来源限制', () => {
    const detail = fixture();
    detail.snapshot!.test = { result: 'PASS', evidenceQuality: 'STALE', headBound: false, stale: true };
    expect(observationJudgment(detail)).toContain('不能据此判断当前版本');
  });
  it('采集异常先于历史成功记录', () => {
    const detail = fixture();
    detail.health.collectionStatus = 'UNAVAILABLE';
    expect(observationJudgment(detail)).toContain('来源暂时不可用');
    detail.health.collectionStatus = 'DEGRADED';
    expect(observationJudgment(detail)).toContain('观察存在缺口');
  });
  it('失败报告只描述取得的报告，不替代项目健康判断', () => {
    const detail = fixture();
    detail.snapshot!.test = { result: 'FAIL', evidenceQuality: 'OBSERVED', headBound: true, stale: false };
    expect(observationJudgment(detail)).toContain('测试报告包含失败记录');
  });
});

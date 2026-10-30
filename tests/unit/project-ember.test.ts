import { describe, expect, it } from 'vitest';
import { deriveProjectFlame } from '../../apps/web/src/features/projectEmber';

describe('项目火影不推断未经验证的进展', () => {
  const neutral = deriveProjectFlame({});
  it('无项目时保持中性，不声称项目创立', () => {
    expect(neutral.stagePoetry).not.toContain('创立');
    expect(neutral.golden).toBe(0);
    expect(neutral.dormant).toBe(0);
  });
  it('三条交流不代表代码推进', () => {
    expect(deriveProjectFlame({ confirmedUserMessages: Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, role: 'user', createdAt: new Date().toISOString() })) })).toEqual(neutral);
  });
  it('旧卡片全部完成不代表里程碑达成', () => {
    expect(deriveProjectFlame({ cardsSummary: { total: 3, completed: 3, active: 0, failed: 0 } })).toEqual(neutral);
  });
  it('观察暂停不代表项目搁置', () => {
    expect(deriveProjectFlame({ project: { enabled: false } })).toEqual(neutral);
  });
  it('过时或未来时间均不能确定项目生命阶段', () => {
    for (const lastObservedAt of ['2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z', 'invalid']) {
      expect(deriveProjectFlame({ project: { lastObservedAt } })).toEqual(neutral);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { deriveProjectFlame } from '../../apps/web/src/features/projectEmber';

describe('项目火焰生命历程计算 (deriveProjectFlame)', () => {
  const now = Date.parse('2026-10-30T10:00:00+08:00');

  it('刚创立或新话题呈现初火星 (spark)', () => {
    const flame = deriveProjectFlame({ nowMs: now, confirmedUserMessages: [] });
    expect(flame.stage).toBe('spark');
    expect(flame.stageLabel).toBe('初火星');
    expect(flame.heat).toBeLessThan(0.25);
    expect(flame.golden).toBe(0);
    expect(flame.dormant).toBe(0);
  });

  it('初步交流或初始变动呈现初生火苗 (sprout)', () => {
    const flame = deriveProjectFlame({
      nowMs: now,
      confirmedUserMessages: [
        { role: 'user', createdAt: new Date(now - 1000).toISOString(), id: 'msg-1' },
      ],
    });
    expect(flame.stage).toBe('sprout');
    expect(flame.stageLabel).toBe('初生火苗');
    expect(flame.heat).toBeGreaterThanOrEqual(0.35);
    expect(flame.heat).toBeLessThan(0.60);
  });

  it('连续活跃交流与积极推进演进为繁盛之火 (blaze)', () => {
    const flame = deriveProjectFlame({
      nowMs: now,
      confirmedUserMessages: [
        { role: 'user', createdAt: new Date(now - 3000).toISOString(), id: 'msg-1' },
        { role: 'user', createdAt: new Date(now - 2000).toISOString(), id: 'msg-2' },
        { role: 'user', createdAt: new Date(now - 1000).toISOString(), id: 'msg-3' },
      ],
    });
    expect(flame.stage).toBe('blaze');
    expect(flame.stageLabel).toBe('繁盛之火');
    expect(flame.heat).toBeGreaterThanOrEqual(0.65);
  });

  it('卡片闭环完成时升华呈常明金火 (golden)', () => {
    const flame = deriveProjectFlame({
      nowMs: now,
      cardsSummary: {
        total: 3,
        completed: 3,
        active: 0,
        failed: 0,
      },
    });
    expect(flame.stage).toBe('golden');
    expect(flame.stageLabel).toBe('常明金火');
    expect(flame.golden).toBe(1.0);
    expect(flame.dormant).toBe(0.0);
  });

  it('项目被搁置停用时退入静卧余烬 (dormant)', () => {
    const flame = deriveProjectFlame({
      nowMs: now,
      project: {
        enabled: false,
        lastObservedAt: new Date(now - 86400000).toISOString(),
      },
    });
    expect(flame.stage).toBe('dormant');
    expect(flame.stageLabel).toBe('静卧余烬');
    expect(flame.dormant).toBe(1.0);
    expect(flame.golden).toBe(0.0);
    expect(flame.heat).toBeLessThanOrEqual(0.15);
  });
});

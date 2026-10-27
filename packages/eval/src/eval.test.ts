import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EventSchema, IsoDateTimeSchema } from '@hearth/contracts';
import {
  FixedClock,
  goldenUsefulEventIds,
  loadAdversarialFixture,
  loadDemoWalkthroughFixture,
  loadEventsFixture,
  loadFixtures,
  loadProjectsFixture,
  parseEventsPayload,
  replayIngest,
  replayScoring,
} from './index.js';

// packages/eval/src/ -> 仓库根
const ROOT_DIR = fileURLToPath(new URL('../../../', import.meta.url));

describe('events fixture', () => {
  const fixture = loadEventsFixture(ROOT_DIR);

  it('exposes contractVersion=1 and the fixture clock', () => {
    expect(fixture.contractVersion).toBe('1');
    expect(fixture.fixtureClock).toBe('2026-10-28T12:00:00+08:00');
  });

  it('parses all 5 events against strict EventSchema after stripping eval meta', () => {
    expect(fixture.events).toHaveLength(5);
    for (const { event, meta } of fixture.events) {
      const check = EventSchema.safeParse(event);
      expect(check.success, `event ${event.id} must satisfy EventSchema`).toBe(true);
      // 元数据必须被剥离出合同对象
      expect(Object.hasOwn(event, 'goldenAction')).toBe(false);
      expect(Object.hasOwn(event, 'goldenUseful')).toBe(false);
      expect(meta.goldenAction === null || typeof meta.goldenAction === 'string').toBe(true);
      expect(typeof meta.goldenUseful).toBe('boolean');
    }
  });

  it('aggregates EventSchema failures with the offending event id', () => {
    expect(() =>
      parseEventsPayload({
        contractVersion: '1',
        fixtureClock: '2026-10-28T12:00:00+08:00',
        events: [{ id: 'ev-bad-001', type: 'repo.ci_failed' }],
      }),
    ).toThrow(/id=ev-bad-001/);
  });

  it('rejects a payload whose contractVersion is not 1', () => {
    expect(() =>
      parseEventsPayload({ contractVersion: '2', fixtureClock: 'x', events: [] }),
    ).toThrow(/contractVersion/);
  });
});

describe('replayIngest dedupe', () => {
  const events = loadEventsFixture(ROOT_DIR).events.map((fe) => fe.event);

  it('keeps first arrival and routes the duplicate dedupeKey to duplicates (accepted=4)', () => {
    const result = replayIngest(events);
    expect(result.accepted).toHaveLength(4);
    const acceptedIds = result.accepted.map((event) => event.id);
    expect(acceptedIds).toContain('ev-atlas-ci-001');
    expect(acceptedIds).not.toContain('ev-atlas-duplicate-001');
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]?.id).toBe('ev-atlas-duplicate-001');
    expect(result.duplicates[0]?.dedupeKey).toBe('atlas:ci:42:failed');
  });
});

describe('golden labels', () => {
  it('excludes goldenUseful=false noise/duplicate events from the golden set', () => {
    const golden = goldenUsefulEventIds(loadEventsFixture(ROOT_DIR).events);
    expect(golden.has('ev-atlas-noise-001')).toBe(false);
    expect(golden.has('ev-atlas-duplicate-001')).toBe(false);
    expect([...golden].sort()).toEqual([
      'ev-atlas-ci-001',
      'ev-beacon-calendar-001',
      'ev-beacon-study-001',
    ]);
  });
});

describe('projects fixture', () => {
  it('loads non-empty projects with unique ids', () => {
    const fixture = loadProjectsFixture(ROOT_DIR);
    expect(fixture.projects.length).toBeGreaterThan(0);
    const ids = fixture.projects.map((project) => project.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['project-atlas', 'project-beacon']));
  });
});

describe('adversarial fixture', () => {
  it('loads 12 attack cases with unique ids', () => {
    const fixture = loadAdversarialFixture(ROOT_DIR);
    expect(fixture.cases).toHaveLength(12);
    const ids = fixture.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(12);
    expect(ids).toEqual(expect.arrayContaining(['S01', 'S12']));
  });
});

describe('demo-walkthrough fixture', () => {
  it('maps all 3 scenarios onto existing events whose goldenAction matches at L1', () => {
    const fixtures = loadFixtures(ROOT_DIR);
    expect(fixtures.demoWalkthrough.scenarios).toHaveLength(3);
    const byEventId = new Map(fixtures.events.events.map((fe) => [fe.event.id, fe] as const));
    for (const scenario of fixtures.demoWalkthrough.scenarios) {
      const fe = byEventId.get(scenario.eventId);
      expect(fe, `scenario ${scenario.id} must reference a loaded event`).toBeDefined();
      if (!fe) continue;
      expect(scenario.actionType).toBe(fe.meta.goldenAction);
      expect(scenario.risk).toBe('L1');
    }
  });

  it('fails fast when a scenario references an unknown eventId', () => {
    expect(() => loadDemoWalkthroughFixture(ROOT_DIR, new Set(['ev-does-not-exist']))).toThrow(
      /unknown eventId/,
    );
  });
});

describe('FixedClock', () => {
  it('is deterministic across two clocks built with the same start time', () => {
    const a = new FixedClock('2026-10-28T12:00:00+08:00');
    const b = new FixedClock('2026-10-28T12:00:00+08:00');
    expect(a.now()).toBe(b.now());
    a.tick(1_000);
    b.tick(1_000);
    expect(a.now()).toBe(b.now());
    a.tick(59_000);
    expect(a.now()).not.toBe(b.now());
  });

  it('tick advances now() by exactly ms, keeping contract-shaped ISO output', () => {
    const clock = new FixedClock('2026-10-28T12:00:00+08:00');
    const before = clock.now();
    clock.tick(90_000);
    const after = clock.now();
    expect(Date.parse(after) - Date.parse(before)).toBe(90_000);
    expect(IsoDateTimeSchema.safeParse(after).success).toBe(true);
    expect(IsoDateTimeSchema.safeParse(before).success).toBe(true);
  });

  it('rejects invalid construction and negative/non-finite tick arguments', () => {
    expect(() => new FixedClock('not-a-date')).toThrow(/invalid start ISO datetime/);
    expect(() => new FixedClock('2026-10-28T12:00:00Z').tick(-1)).toThrow(/non-negative/);
    expect(() => new FixedClock('2026-10-28T12:00:00Z').tick(Number.NaN)).toThrow(/non-negative/);
  });
});

describe('replayScoring', () => {
  it('computes precisionAt3 = 2/3 for scores 0.9/0.8/0.7/0.6 with true/true/false/true', () => {
    const candidates = [
      { score: 0.9, eventIds: ['ev-a'] },
      { score: 0.8, eventIds: ['ev-b'] },
      { score: 0.7, eventIds: ['ev-c'] },
      { score: 0.6, eventIds: ['ev-d'] },
    ];
    const golden = new Set(['ev-a', 'ev-b', 'ev-d']);
    const result = replayScoring(candidates, golden);
    expect(result.total).toBe(4);
    expect(result.usefulInTop3).toBe(2);
    expect(result.precisionAt3).toBeCloseTo(2 / 3, 10);
  });

  it('returns precisionAt3 = null for empty candidate input', () => {
    const result = replayScoring([], new Set(['ev-a']));
    expect(result.precisionAt3).toBeNull();
    expect(result.total).toBe(0);
    expect(result.usefulInTop3).toBe(0);
  });

  it('uses min(3, total) as the denominator for short candidate lists', () => {
    const result = replayScoring([{ score: 0.5, eventIds: ['only'] }], new Set(['only']));
    expect(result.precisionAt3).toBe(1);
    expect(result.usefulInTop3).toBe(1);
  });
});

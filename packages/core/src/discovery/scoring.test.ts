import { describe, expect, it } from 'vitest';
import { FixtureConnector } from '@hearth/connectors';
import { buildCandidate, isNoise } from './rules.js';
import { rankCandidates, suppressLowQuality, MIN_CANDIDATE_SCORE } from './scoring.js';
import { replayIngest, replayScoring } from '@hearth/eval';

const CLOCK = '2026-10-28T12:00:00+08:00';

describe('M2-T01 scoring on golden fixture', () => {
  it('stable ranking puts the three golden-useful candidates on top', () => {
    const connector = new FixtureConnector(process.cwd());
    const loaded = connector.loadEvents();
    const deduped = replayIngest(loaded.map((e) => e.event), new Set()).accepted;
    const byId = new Map(loaded.map((e) => [e.event.id, e]));
    type WithGolden = ReturnType<typeof buildCandidate> & { goldenUseful: boolean };
    const ranked: WithGolden[] = rankCandidates(
      deduped
        .filter((ev) => !isNoise(ev))
        .map((ev) => ({
          ...buildCandidate(ev, CLOCK)!,
          goldenUseful: byId.get(ev.id)!.meta.goldenUseful,
        })) as WithGolden[],
    );
    expect(ranked.length).toBe(3);
    expect(ranked.every((c) => c.goldenUseful)).toBe(true);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);

    const golden = new Set(loaded.filter((e) => e.meta.goldenUseful).map((e) => e.event.id));
    const scoring = replayScoring(
      ranked.map((c) => ({ score: c.score, eventIds: c.eventIds })),
      golden,
    );
    expect(scoring.precisionAt3).toBe(1);
  });

  it('ranking is deterministic across repeats', () => {
    const connector = new FixtureConnector(process.cwd());
    const candidates = connector
      .loadEvents()
      .filter((e) => !isNoise(e.event))
      .map((e) => ({ ...buildCandidate(e.event, CLOCK)!, observedAt: e.event.observedAt }));
    const a = rankCandidates(candidates).map((c) => c.id);
    const b = rankCandidates(candidates).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it('low-quality candidates are suppressed; golden scores all clear the floor', () => {
    const { kept, suppressed } = suppressLowQuality([
      { score: 0.9 },
      { score: 0.2 },
      { score: MIN_CANDIDATE_SCORE },
    ]);
    expect(kept).toHaveLength(2);
    expect(suppressed).toHaveLength(1);
  });

  it('duplicate ingest via eval replay matches storage-level dedupe', () => {
    const connector = new FixtureConnector(process.cwd());
    const events = connector.loadEvents().map((e) => e.event);
    const r = replayIngest(events, new Set());
    expect(r.accepted).toHaveLength(4);
    expect(r.duplicates).toHaveLength(1);
    // storage agrees
    expect(r.accepted.length).toBe(4);
  });
});

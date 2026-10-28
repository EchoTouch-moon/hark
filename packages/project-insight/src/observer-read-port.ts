import type { ObserverEvent, ProjectSnapshot } from '@hearth/project-observer';
import { ProjectObserver } from '@hearth/project-observer';
import type { SourceResetReason } from './contracts.js';

export interface SourceInspection {
  projectLive: boolean;
  streamEpoch: number;
  highWatermark: number;
  allocatedAppendSeq: number;
  retiredAt: string | null;
  status: 'OK' | 'PROJECT_NOT_FOUND' | SourceResetReason;
}

export type ForwardReadResult =
  | {
      ok: true;
      events: ObserverEvent[];
      streamEpoch: number;
      highWatermark: number;
      nextCursor: number;
      hasMore: boolean;
    }
  | {
      ok: false;
      outcome: 'SOURCE_RESET_REQUIRED';
      reason: SourceResetReason;
      streamEpoch: number;
      highWatermark: number;
    }
  | {
      ok: false;
      outcome: 'EVIDENCE_UNAVAILABLE';
      reasonCode: 'PROJECT_NOT_FOUND' | 'INVALID_EVENT';
      streamEpoch: number;
      highWatermark: number;
    };

export interface ObserverReadPort {
  inspectSource(projectId: string, expectedEpoch?: number): SourceInspection;
  readForward(input: {
    projectId: string;
    afterSeq: number;
    expectedEpoch: number;
    limit: number;
    highWatermark?: number;
  }): ForwardReadResult;
  getSnapshot(snapshotId: string): ProjectSnapshot | null;
  legacyOrderReconstructed(): boolean;
}

function resetOf(
  status: SourceInspection['status'] | string,
): status is SourceResetReason {
  return status === 'PROJECT_REMOVED' || status === 'STREAM_EPOCH_MISMATCH' || status === 'CURSOR_AHEAD_OF_STREAM';
}

/**
 * In-process read adapter. Calls only P0 query APIs; never scan/register/delete/insert.
 */
export class InProcessObserverReadPort implements ObserverReadPort {
  constructor(private readonly observer: ProjectObserver) {}

  inspectSource(projectId: string, expectedEpoch?: number): SourceInspection {
    const allocated = this.observer.store.allocatedAppendSeq();
    const page = this.observer.listEventsForward(projectId, {
      afterSeq: 0,
      limit: 1,
      expectedEpoch,
      highWatermark: allocated,
    });
    const stream = this.observer.store.getEventStream(projectId);
    const project = this.observer.store.getProject(projectId);
    return {
      projectLive: project !== null,
      streamEpoch: page.streamEpoch,
      highWatermark: page.highWatermark,
      allocatedAppendSeq: allocated,
      retiredAt: stream?.retiredAt ?? null,
      status: page.status,
    };
  }

  readForward(input: {
    projectId: string;
    afterSeq: number;
    expectedEpoch: number;
    limit: number;
    highWatermark?: number;
  }): ForwardReadResult {
    const before = this.inspectSource(input.projectId, input.expectedEpoch);
    if (before.status === 'PROJECT_NOT_FOUND') {
      return {
        ok: false,
        outcome: 'EVIDENCE_UNAVAILABLE',
        reasonCode: 'PROJECT_NOT_FOUND',
        streamEpoch: before.streamEpoch,
        highWatermark: before.highWatermark,
      };
    }
    if (resetOf(before.status)) {
      return {
        ok: false,
        outcome: 'SOURCE_RESET_REQUIRED',
        reason: before.status,
        streamEpoch: before.streamEpoch,
        highWatermark: before.highWatermark,
      };
    }

    const freeze = Math.min(input.highWatermark ?? before.highWatermark, before.allocatedAppendSeq);
    const limit = Math.min(Math.max(input.limit, 1), 200);
    const events: ObserverEvent[] = [];
    let cursor = input.afterSeq;
    let hasMore = true;
    while (events.length < limit && hasMore) {
      const page = this.observer.listEventsForward(input.projectId, {
        afterSeq: cursor,
        expectedEpoch: input.expectedEpoch,
        limit: Math.min(200, limit - events.length),
        highWatermark: freeze,
      });
      if (page.status === 'PROJECT_NOT_FOUND') {
        return {
          ok: false,
          outcome: 'EVIDENCE_UNAVAILABLE',
          reasonCode: 'PROJECT_NOT_FOUND',
          streamEpoch: page.streamEpoch,
          highWatermark: page.highWatermark,
        };
      }
      if (resetOf(page.status)) {
        return {
          ok: false,
          outcome: 'SOURCE_RESET_REQUIRED',
          reason: page.status,
          streamEpoch: page.streamEpoch,
          highWatermark: page.highWatermark,
        };
      }
      for (const event of page.events) {
        if (event.appendSeq === undefined) {
          return {
            ok: false,
            outcome: 'EVIDENCE_UNAVAILABLE',
            reasonCode: 'INVALID_EVENT',
            streamEpoch: page.streamEpoch,
            highWatermark: freeze,
          };
        }
        events.push(event);
      }
      hasMore = page.hasMore;
      cursor = page.nextCursor;
      if (page.events.length === 0) break;
    }

    const after = this.inspectSource(input.projectId, input.expectedEpoch);
    if (after.status === 'PROJECT_NOT_FOUND') {
      return {
        ok: false,
        outcome: 'EVIDENCE_UNAVAILABLE',
        reasonCode: 'PROJECT_NOT_FOUND',
        streamEpoch: after.streamEpoch,
        highWatermark: after.highWatermark,
      };
    }
    if (resetOf(after.status) || after.streamEpoch !== before.streamEpoch || !after.projectLive) {
      const reason: SourceResetReason = resetOf(after.status) ? after.status : 'STREAM_EPOCH_MISMATCH';
      return {
        ok: false,
        outcome: 'SOURCE_RESET_REQUIRED',
        reason,
        streamEpoch: after.streamEpoch,
        highWatermark: after.highWatermark,
      };
    }

    return {
      ok: true,
      events,
      streamEpoch: before.streamEpoch,
      highWatermark: freeze,
      nextCursor: events.length > 0 ? (events[events.length - 1]?.appendSeq ?? cursor) : input.afterSeq,
      hasMore,
    };
  }

  getSnapshot(snapshotId: string): ProjectSnapshot | null {
    return this.observer.store.getSnapshot(snapshotId);
  }

  legacyOrderReconstructed(): boolean {
    const row = this.observer.store.db
      .prepare(`SELECT value FROM observer_meta WHERE key = 'legacy_order_reconstructed'`)
      .get() as { value: number } | undefined;
    return Number(row?.value ?? 0) === 1;
  }
}

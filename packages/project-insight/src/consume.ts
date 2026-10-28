import { EXTRACTOR_VERSION, type SignalBatch } from './contracts.js';
import { KeyedMutex } from './concurrency.js';
import type { ObserverReadPort } from './observer-read-port.js';
import { extractSignalBatch } from './signals/batch.js';
import type { ConsumerCheckpoint, InsightStore } from './store/store.js';

export const DEFAULT_CONSUME_LIMIT = 50;
export const MAX_CONSUME_LIMIT = 200;

export interface ConsumeProjectInput {
  projectId: string;
  limit?: number;
  highWatermark?: number;
  extractorVersion?: string;
}

export interface ConsumeResult {
  outcome: 'OK' | 'NO_SIGNAL' | 'SOURCE_RESET_REQUIRED' | 'EVIDENCE_UNAVAILABLE' | 'FROZEN';
  eventsProcessed: number;
  signalsInserted: number;
  signalsDuplicate: number;
  hasMore: boolean;
  checkpoint: {
    afterSeq: number;
    streamEpoch: number;
    revision: number;
    status: string;
  };
  resetReason?: string;
  reasonCode?: string;
}

export class InsightConsumer {
  private readonly locks = new KeyedMutex();

  constructor(private readonly store: InsightStore) {}

  async consumeProjectBatch(port: ObserverReadPort, input: ConsumeProjectInput): Promise<ConsumeResult> {
    return this.locks.runExclusive(input.projectId, async () => this.consumeExclusive(port, input));
  }

  private consumeExclusive(port: ObserverReadPort, input: ConsumeProjectInput): ConsumeResult {
    const extractorVersion = input.extractorVersion ?? EXTRACTOR_VERSION;
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_CONSUME_LIMIT, 1), MAX_CONSUME_LIMIT);
    const live = port.inspectSource(input.projectId);

    if (live.status === 'PROJECT_NOT_FOUND') {
      this.store.recordInterruption({
        projectId: input.projectId,
        streamEpoch: live.streamEpoch,
        interruptionType: 'PROJECT_NOT_FOUND',
        lastSafeCursor: 0,
      });
      return unavailable(live.streamEpoch, 'PROJECT_NOT_FOUND');
    }

    if (live.status === 'PROJECT_REMOVED') {
      return this.store.transaction(() => {
        this.store.purgeInbox(input.projectId);
        for (const row of this.store.listCheckpoints(input.projectId, extractorVersion)) {
          this.store.freezeCheckpoint(input.projectId, row.streamEpoch, extractorVersion);
        }
        this.store.freezeCheckpoint(input.projectId, live.streamEpoch, extractorVersion);
        this.store.recordInterruption({
          projectId: input.projectId,
          streamEpoch: live.streamEpoch,
          interruptionType: 'PROJECT_REMOVED',
          lastSafeCursor: this.store.getCheckpoint(input.projectId, live.streamEpoch, extractorVersion)?.afterSeq ?? 0,
        });
        const frozen = this.store.getCheckpoint(input.projectId, live.streamEpoch, extractorVersion);
        return frozenResult(frozen, 'PROJECT_REMOVED');
      });
    }

    this.store.transaction(() => {
      this.store.freezeOtherEpochs(input.projectId, live.streamEpoch, extractorVersion);
    });
    const checkpoint = this.store.getCheckpoint(input.projectId, live.streamEpoch, extractorVersion);
    if (checkpoint?.status === 'FROZEN') {
      return frozenResult(checkpoint);
    }

    const afterSeq = checkpoint?.afterSeq ?? 0;
    const expectedRevision = checkpoint?.revision ?? 0;
    const batch = extractSignalBatch(port, {
      projectId: input.projectId,
      afterSeq,
      streamEpoch: live.streamEpoch,
      limit,
      highWatermark: input.highWatermark ?? live.highWatermark,
    });

    if (batch.outcome === 'SOURCE_RESET_REQUIRED') {
      return this.store.transaction(() => {
        this.store.freezeCheckpoint(input.projectId, afterEpoch(batch, live.streamEpoch), extractorVersion);
        this.store.recordInterruption({
          projectId: input.projectId,
          streamEpoch: afterEpoch(batch, live.streamEpoch),
          interruptionType: batch.resetReason ?? batch.reasonCode ?? 'SOURCE_RESET_REQUIRED',
          lastSafeCursor: afterSeq,
        });
        const frozen = this.store.getCheckpoint(input.projectId, afterEpoch(batch, live.streamEpoch), extractorVersion);
        return frozenResult(frozen, batch.resetReason ?? batch.reasonCode, batch.eventsRead);
      });
    }

    if (batch.outcome === 'EVIDENCE_UNAVAILABLE') {
      this.store.recordInterruption({
        projectId: input.projectId,
        streamEpoch: live.streamEpoch,
        interruptionType: batch.reasonCode ?? 'EVIDENCE_UNAVAILABLE',
        lastSafeCursor: afterSeq,
      });
      return {
        outcome: 'EVIDENCE_UNAVAILABLE',
        eventsProcessed: batch.eventsRead,
        signalsInserted: 0,
        signalsDuplicate: 0,
        hasMore: batch.hasMore,
        checkpoint: {
          afterSeq,
          streamEpoch: live.streamEpoch,
          revision: expectedRevision,
          status: checkpoint?.status ?? 'ACTIVE',
        },
        reasonCode: batch.reasonCode,
      };
    }

    const committed = this.store.commitSignalBatch({
      projectId: input.projectId,
      streamEpoch: live.streamEpoch,
      extractorVersion,
      expectedRevision,
      batch,
    });
    return {
      outcome: batch.outcome,
      eventsProcessed: batch.eventsRead,
      signalsInserted: committed.inserted,
      signalsDuplicate: committed.duplicates,
      hasMore: batch.hasMore,
      checkpoint: {
        afterSeq: committed.checkpoint.afterSeq,
        streamEpoch: committed.checkpoint.streamEpoch,
        revision: committed.checkpoint.revision,
        status: committed.checkpoint.status,
      },
    };
  }
}

function afterEpoch(batch: SignalBatch, fallback: number): number {
  return batch.proposedCursor.streamEpoch || fallback;
}

function unavailable(streamEpoch: number, reasonCode: string): ConsumeResult {
  return {
    outcome: 'EVIDENCE_UNAVAILABLE',
    eventsProcessed: 0,
    signalsInserted: 0,
    signalsDuplicate: 0,
    hasMore: false,
    checkpoint: { afterSeq: 0, streamEpoch, revision: 0, status: 'NONE' },
    reasonCode,
  };
}

function frozenResult(
  checkpoint: ConsumerCheckpoint | null,
  resetReason?: string,
  eventsProcessed = 0,
): ConsumeResult {
  return {
    outcome: resetReason !== undefined ? 'SOURCE_RESET_REQUIRED' : 'FROZEN',
    eventsProcessed,
    signalsInserted: 0,
    signalsDuplicate: 0,
    hasMore: false,
    checkpoint: {
      afterSeq: checkpoint?.afterSeq ?? 0,
      streamEpoch: checkpoint?.streamEpoch ?? 0,
      revision: checkpoint?.revision ?? 0,
      status: checkpoint?.status ?? 'FROZEN',
    },
    resetReason,
    reasonCode: resetReason,
  };
}



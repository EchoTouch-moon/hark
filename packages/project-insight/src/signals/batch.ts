import type { ProjectSnapshot } from '@hearth/project-observer';
import {
  EXTRACTOR_VERSION,
  ExtractedSignalSchema,
  SignalBatchSchema,
  type ExtractedSignal,
  type SignalBatch,
} from '../contracts.js';
import type { ObserverReadPort } from '../observer-read-port.js';
import { extractSignalsFromEvent } from './extractor.js';

export interface ExtractBatchInput {
  projectId: string;
  afterSeq: number;
  streamEpoch: number;
  limit?: number;
  highWatermark?: number;
}

function emptyBatch(
  input: ExtractBatchInput,
  highWatermark: number,
  outcome: SignalBatch['outcome'],
  extra: Partial<SignalBatch> = {},
): SignalBatch {
  return SignalBatchSchema.parse({
    signals: [],
    proposedCursor: { afterSeq: input.afterSeq, streamEpoch: input.streamEpoch },
    highWatermark,
    outcome,
    hasMore: false,
    legacyOrderReconstructed: extra.legacyOrderReconstructed ?? false,
    extractorVersion: EXTRACTOR_VERSION,
    eventsRead: extra.eventsRead ?? 0,
    ...extra,
  });
}

function resolveSnapshot(
  port: ObserverReadPort,
  snapshotId: string | null,
): { snapshot: ProjectSnapshot | null; missing: boolean } {
  if (snapshotId === null) return { snapshot: null, missing: false };
  const snapshot = port.getSnapshot(snapshotId);
  return { snapshot, missing: snapshot === null };
}

function parseExtracted(signals: ExtractedSignal[]): ExtractedSignal[] {
  return signals.map((item) => ExtractedSignalSchema.parse(item) as ExtractedSignal);
}

/**
 * Read one frozen watermark batch and extract signals.
 * Does not persist proposedCursor. Does not write Observer state.
 */
export function extractSignalBatch(port: ObserverReadPort, input: ExtractBatchInput): SignalBatch {
  const limit = input.limit ?? 50;
  const legacyOrderReconstructed = port.legacyOrderReconstructed();
  const read = port.readForward({
    projectId: input.projectId,
    afterSeq: input.afterSeq,
    expectedEpoch: input.streamEpoch,
    limit,
    highWatermark: input.highWatermark,
  });

  if (!read.ok) {
    if (read.outcome === 'SOURCE_RESET_REQUIRED') {
      return emptyBatch(input, read.highWatermark, 'SOURCE_RESET_REQUIRED', {
        resetReason: read.reason,
        reasonCode: read.reason,
        legacyOrderReconstructed,
      });
    }
    return emptyBatch(input, read.highWatermark, 'EVIDENCE_UNAVAILABLE', {
      reasonCode: read.reasonCode,
      legacyOrderReconstructed,
    });
  }

  const signals: ExtractedSignal[] = [];
  let processedSeq = input.afterSeq;
  for (const event of read.events) {
    const from = resolveSnapshot(port, event.fromSnapshotId);
    const to = resolveSnapshot(port, event.toSnapshotId);
    if (from.missing || to.missing) {
      return SignalBatchSchema.parse({
        signals: parseExtracted(signals),
        proposedCursor: { afterSeq: processedSeq, streamEpoch: read.streamEpoch },
        highWatermark: read.highWatermark,
        outcome: 'EVIDENCE_UNAVAILABLE',
        hasMore: true,
        legacyOrderReconstructed,
        extractorVersion: EXTRACTOR_VERSION,
        reasonCode: 'SNAPSHOT_MISSING',
        eventsRead: read.events.indexOf(event),
      });
    }
    signals.push(
      ...extractSignalsFromEvent(event, {
        streamEpoch: read.streamEpoch,
        fromSnapshot: from.snapshot,
        toSnapshot: to.snapshot,
        legacyOrderReconstructed,
      }),
    );
    processedSeq = event.appendSeq ?? processedSeq;
  }

  const parsed = parseExtracted(signals);
  const outcome = parsed.length === 0 ? 'NO_SIGNAL' : 'OK';
  return SignalBatchSchema.parse({
    signals: parsed,
    proposedCursor: { afterSeq: processedSeq, streamEpoch: read.streamEpoch },
    highWatermark: read.highWatermark,
    outcome,
    hasMore: read.hasMore,
    legacyOrderReconstructed,
    extractorVersion: EXTRACTOR_VERSION,
    eventsRead: read.events.length,
  });
}



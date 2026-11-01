/**
 * @fileoverview The two ledgers of the group B lab.
 *
 * Trigger records answer "where did each arriving event go" and dedupe by event
 * identity (sourceEventId + epoch + contentVersion) - never by message text
 * (R12.2 F01). Candidate traces answer "why was this said or not said" and hold
 * allowlisted fields only.
 */

import type { CandidateTrace, Disposition, ProjectId, ReasonCode, TriggerDisposition } from './types.js';
import { validateTrace, validateTriggerDisposition } from './types.js';

export type ReceiveResult = 'stored' | 'duplicate';

function identityKey(row: TriggerDisposition): string {
  return `${row.sourceEventId}|${row.epoch}|${row.contentVersion}`;
}

export class TriggerLedger {
  private readonly rows = new Map<string, TriggerDisposition>();

  receive(row: TriggerDisposition): ReceiveResult {
    validateTriggerDisposition(row);
    const key = identityKey(row);
    if (this.rows.has(key)) return 'duplicate';
    this.rows.set(key, row);
    return 'stored';
  }

  all(): readonly TriggerDisposition[] {
    return [...this.rows.values()];
  }
}

export class CandidateTraceLedger {
  private readonly rows: CandidateTrace[] = [];

  append(trace: CandidateTrace): void {
    validateTrace(trace);
    this.rows.push(trace);
  }

  all(): readonly CandidateTrace[] {
    return this.rows;
  }
}

/** Builds a trace from an evaluation result without copying any free text. */
export function traceFor(args: {
  candidateId: string;
  hash: string;
  projectId: ProjectId;
  ruleId: string;
  ruleVersion: string;
  triggerKind: 'user_requested' | 'system_suggested';
  disposition: Disposition;
  reasonCode: ReasonCode | null;
  evidenceDiff: number;
  hasGoalLink: boolean;
  decidedAt: string;
}): CandidateTrace {
  return {
    candidateId: args.candidateId,
    hash: args.hash,
    projectId: args.projectId,
    ruleRefs: [{ id: args.ruleId, version: args.ruleVersion }],
    triggerKind: args.triggerKind,
    disposition: args.disposition,
    reasonCode: args.reasonCode,
    boundedCounts: { evidenceDiff: args.evidenceDiff, hasGoalLink: args.hasGoalLink },
    decidedAt: args.decidedAt,
  };
}

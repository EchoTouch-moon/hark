/**
 * @fileoverview Deterministic stand-in for the client that shows an opinion.
 *
 * There is no UI in the lab, so the outcome of showing something is an explicit
 * input, never random (R12.1 section 4). Three failure shapes are kept apart
 * (R12.2 F03):
 *   confirmed  - server recorded the receipt: presented, retry is idempotent
 *   ack_lost   - rendered but the receipt never committed: delivery_uncertain,
 *                and after the claim expires it may compete again
 *   rejected   - client refused to render: back to claimed, nothing recorded
 */

import type { ProjectId } from './types.js';
import type { PresentationRecord } from './eligibility.js';

export interface ClientState {
  readonly typing: boolean;
}

export interface Claim {
  readonly idempotencyKey: string;
  readonly candidateId: string;
  readonly projectId: ProjectId;
  readonly at: Date;
  readonly expiresAt: Date;
}

export type ReceiptOutcome = 'confirmed' | 'ack_lost' | 'rejected';
export type PresentationState = 'presented' | 'delivery_uncertain' | 'claimed';

export interface PresentResult {
  readonly state: PresentationState;
  readonly record: PresentationRecord | null;
}

export class PresentationClient {
  private readonly records = new Map<string, PresentationRecord>();
  private readonly log: PresentationRecord[] = [];

  claim(candidateId: string, projectId: ProjectId, now: Date, ttlMs: number): Claim {
    return {
      idempotencyKey: `claim-${candidateId}`,
      candidateId,
      projectId,
      at: now,
      expiresAt: new Date(now.getTime() + ttlMs),
    };
  }

  present(claim: Claim, outcome: ReceiptOutcome, now: Date): PresentResult {
    const existing = this.records.get(claim.idempotencyKey);
    // A receipt that already committed answers every later attempt with the same
    // record, so a retried response cannot inflate the count.
    if (existing !== undefined) return { state: existing.state, record: existing };

    if (outcome === 'rejected') return { state: 'claimed', record: null };

    const state: PresentationState = outcome === 'confirmed' ? 'presented' : 'delivery_uncertain';
    const record: PresentationRecord = { projectId: claim.projectId, at: now, state };
    this.records.set(claim.idempotencyKey, record);
    this.log.push(record);
    return { state, record };
  }

  /**
   * Whether an uncertain claim may be competed for again. Silence is not
   * evidence that the user never saw it, so this only answers "is it legal to
   * retry", not "should it be shown again".
   */
  mayReclaim(claim: Claim, now: Date): boolean {
    const existing = this.records.get(claim.idempotencyKey);
    if (existing === undefined) return now.getTime() >= claim.at.getTime();
    return existing.state === 'delivery_uncertain' && now.getTime() > claim.expiresAt.getTime();
  }

  retry(claim: Claim): PresentResult {
    const existing = this.records.get(claim.idempotencyKey);
    if (existing !== undefined) return { state: existing.state, record: existing };
    return { state: 'claimed', record: null };
  }

  logRecords(): readonly PresentationRecord[] {
    return this.log;
  }
}

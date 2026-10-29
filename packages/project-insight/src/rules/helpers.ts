import type { EvidenceRef, Signal } from '../contracts.js';
import { REPORT_SOURCE_SUBJECT_PREFIX } from '../contracts.js';
import { sanitizeTemplateData } from './templates.js';
import type { RuleCandidate, RuleInput } from './types.js';

export function signalId(signal: Signal): string {
  return signal.signalKey;
}

export function epochOf(signal: Signal, fallback: number): number {
  return signal.streamEpoch ?? fallback;
}

export function triggerRefs(signal: Signal): EvidenceRef[] {
  const refs = signal.evidenceRefs ?? [];
  return refs.filter((ref) => ref.projectId === signal.projectId).slice(0, 12);
}

export function hasTrigger(signal: Signal): boolean {
  return triggerRefs(signal).some((ref) => ref.role === 'trigger');
}

export function veto(input: RuleInput, extra = false): string | null {
  const signal = input.signal;
  if (input.state.sourceFrozen) return 'SOURCE_FROZEN';
  if (signal.streamEpoch !== undefined && signal.streamEpoch !== input.state.streamEpoch) return 'EPOCH_MISMATCH';
  if (!hasTrigger(signal)) return 'MISSING_TRIGGER';
  if (extra) return 'VETO';
  return null;
}

export function candidate(
  input: RuleInput,
  fields: Omit<RuleCandidate, 'projectId' | 'streamEpoch' | 'openingSignalId' | 'headBinding' | 'historical' | 'evidenceRefs'> & {
    evidenceRefs?: EvidenceRef[];
  },
): RuleCandidate {
  return {
    projectId: input.signal.projectId,
    streamEpoch: epochOf(input.signal, input.state.streamEpoch),
    openingSignalId: signalId(input.signal),
    headBinding: 'UNDETERMINED',
    historical: false,
    evidenceRefs: fields.evidenceRefs ?? triggerRefs(input.signal),
    ...fields,
    templateData: sanitizeTemplateData(fields.templateData),
  };
}

export function relativePathOf(signal: Signal): string | undefined {
  const facts = signal.facts;
  if (typeof facts['relativePath'] === 'string') return facts['relativePath'];
  if (signal.subject?.startsWith(REPORT_SOURCE_SUBJECT_PREFIX)) {
    return signal.subject.slice(REPORT_SOURCE_SUBJECT_PREFIX.length);
  }
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function durationMs(fromIso: string, toIso: string): number {
  return Date.parse(toIso) - Date.parse(fromIso);
}

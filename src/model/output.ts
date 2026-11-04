import { ModelError, ModelOutput } from './types.js';

export interface BoundEvidence { id: string; statement: string; sourceId: string; epoch: number; observedAt: string; }
export interface CheckedOutput {
  answer: string;
  uncertainties: string[];
  evidence: BoundEvidence[];
  unboundEvidenceRefs: string[];
  contextFacts: BoundEvidence[];
  suggestedOpinion: { statement: string; uncertainties: string[] } | null;
  verified: false;
  synthetic: true;
}

/** Accept only schema-valid output. Cited ids must already be in the allowed set; others stay unverified. */
export function checkModelOutput(text: string, allowed: ReadonlyMap<string, BoundEvidence>, contextFacts: BoundEvidence[]): CheckedOutput {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ModelError('output_invalid', '模型输出无法通过结构校验');
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { throw new ModelError('output_invalid', '模型输出无法通过结构校验'); }
  const parsed = ModelOutput.safeParse(raw);
  if (!parsed.success) throw new ModelError('output_invalid', '模型输出无法通过结构校验');
  const evidence: BoundEvidence[] = []; const unboundEvidenceRefs: string[] = [];
  for (const ref of parsed.data.evidenceRefs) {
    const item = allowed.get(ref.id);
    if (!item) unboundEvidenceRefs.push(ref.id); else evidence.push(item);
  }
  return {
    answer: parsed.data.answer, uncertainties: parsed.data.uncertainties, evidence, unboundEvidenceRefs, contextFacts,
    suggestedOpinion: parsed.data.suggestedOpinion, verified: false, synthetic: true,
  };
}

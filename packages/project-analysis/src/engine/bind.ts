import type { AnalysisEvidenceRef, ProjectContext, Recommendation } from '../contracts.js';

function keyOf(ref: AnalysisEvidenceRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function bindRecommendation(context: ProjectContext, recommendation: Recommendation): Recommendation {
  const allowed = new Set(context.availableEvidence.map(keyOf));
  const findings = recommendation.findings.map((finding) => {
    const refs = finding.evidenceRefs.map((ref) => {
      const verified = allowed.has(keyOf(ref));
      return { ...ref, verified, label: verified ? ref.label : `${ref.label}（未验证）` };
    });
    const verified = finding.verified && refs.length > 0 && refs.every((ref) => ref.verified);
    return { ...finding, evidenceRefs: refs, verified };
  });
  const unverified = findings.some((item) => !item.verified);
  return {
    ...recommendation,
    findings,
    confidence: unverified && recommendation.confidence === 'high' ? 'medium' : recommendation.confidence,
    uncertainties: unverified
      ? [...recommendation.uncertainties, '部分判断缺少可核验来源，已标记为未验证。']
      : recommendation.uncertainties,
  };
}

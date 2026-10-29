import { z } from 'zod';

export const AnalysisTriggerSchema = z.enum(['observe', 'insight', 'project']);
export type AnalysisTrigger = z.infer<typeof AnalysisTriggerSchema>;

export const AnalysisStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'no_recommendation',
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const EvidenceKindSchema = z.enum(['observer_event', 'snapshot', 'file', 'insight', 'health']);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const AnalysisEvidenceRefSchema = z
  .object({
    kind: EvidenceKindSchema,
    id: z.string().min(1).max(256),
    label: z.string().min(1).max(200),
    verified: z.boolean(),
  })
  .strict();
export type AnalysisEvidenceRef = z.infer<typeof AnalysisEvidenceRefSchema>;

export const FindingSchema = z
  .object({
    title: z.string().min(1).max(200),
    detail: z.string().min(1).max(2000),
    evidenceRefs: z.array(AnalysisEvidenceRefSchema).max(8),
    verified: z.boolean(),
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;

export const NextActionSchema = z
  .object({
    title: z.string().min(1).max(200),
    detail: z.string().min(1).max(1000),
    requiresConfirmation: z.boolean(),
  })
  .strict();
export type NextAction = z.infer<typeof NextActionSchema>;

export const RecommendationSchema = z
  .object({
    target: z.string().min(1).max(300),
    scope: z.string().min(1).max(500),
    statusSummary: z.string().min(1).max(2000),
    findings: z.array(FindingSchema).max(8),
    confidence: z.enum(['low', 'medium', 'high']),
    uncertainties: z.array(z.string().min(1).max(400)).max(8),
    nextActions: z.array(NextActionSchema).max(6),
    risks: z.array(z.string().min(1).max(400)).max(8),
  })
  .strict();
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const FileExcerptSchema = z
  .object({
    relativePath: z.string().min(1).max(1024),
    /** SHA256 of the bounded captured prefix; bytes/truncated describe the source. */
    sha256: z.string().min(16).max(64),
    bytes: z.number().int().nonnegative(),
    excerpt: z.string().max(16_000),
    truncated: z.boolean(),
  })
  .strict();
export type FileExcerpt = z.infer<typeof FileExcerptSchema>;

export const ProjectContextSchema = z
  .object({
    rulesetVersion: z.string(),
    projectId: z.string().min(1).max(128),
    projectName: z.string().min(1).max(200),
    gitIdentity: z.string().max(4096).nullable(),
    snapshotId: z.string().max(128).nullable(),
    headSha: z.string().max(64).nullable(),
    branch: z.string().max(256).nullable(),
    detached: z.boolean(),
    unborn: z.boolean(),
    streamEpoch: z.number().int().nonnegative(),
    collectionStatus: z.enum(['OK', 'DEGRADED', 'UNAVAILABLE']),
    testResult: z.enum(['PASS', 'FAIL', 'MIXED', 'UNKNOWN']),
    testEvidenceQuality: z.enum(['OBSERVED', 'UNKNOWN', 'STALE']),
    testDisclaimer: z.string().min(1).max(300),
    worktree: z
      .object({
        clean: z.boolean(),
        conflicted: z.boolean(),
        staged: z.number().int().nonnegative(),
        unstaged: z.number().int().nonnegative(),
        untracked: z.number().int().nonnegative(),
      })
      .strict(),
    events: z.array(
      z
        .object({
          eventId: z.string(),
          type: z.string(),
          observedAt: z.string(),
          summary: z.string().max(400),
        })
        .strict(),
    ),
    insights: z.array(
      z
        .object({
          id: z.string(),
          status: z.string(),
          title: z.string(),
          summary: z.string(),
          reasonCodes: z.array(z.string()).optional(),
          evidence: z.array(z.object({ sourceKind: z.string(), sourceId: z.string(), quality: z.string() }).strict()).optional(),
        })
        .strict(),
    ),
    files: z.array(FileExcerptSchema),
    availableEvidence: z.array(AnalysisEvidenceRefSchema),
    contextFingerprint: z.string().min(16).max(64),
    assembledAt: z.string(),
  })
  .strict();
export type ProjectContext = z.infer<typeof ProjectContextSchema>;

export const ProviderOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('recommendation'), recommendation: RecommendationSchema }).strict(),
  z.object({ kind: z.literal('no_recommendation'), reason: z.string().min(1).max(500) }).strict(),
  z.object({ kind: z.literal('unavailable'), reason: z.string().min(1).max(500) }).strict(),
]);
export type ProviderOutcome = z.infer<typeof ProviderOutcomeSchema>;

export const AnalysisUsageSchema = z
  .object({
    latencyMs: z.number().nonnegative(),
    inputChars: z.number().int().nonnegative().optional(),
    outputChars: z.number().int().nonnegative().optional(),
  })
  .strict();
export type AnalysisUsage = z.infer<typeof AnalysisUsageSchema>;

export const AnalysisRunViewSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    insightId: z.string().nullable(),
    trigger: AnalysisTriggerSchema,
    provider: z.string(),
    model: z.string().nullable(),
    status: AnalysisStatusSchema,
    snapshotId: z.string().nullable(),
    headSha: z.string().nullable(),
    streamEpoch: z.number().int().nonnegative(),
    contextFingerprint: z.string(),
    recommendation: RecommendationSchema.nullable(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    usage: AnalysisUsageSchema.nullable(),
    feedback: z.enum(['useful', 'not_useful']).nullable().default(null),
    staleReason: z.enum(['head', 'context', 'unavailable']).nullable().default(null),
    stale: z.boolean(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export type AnalysisRunView = z.infer<typeof AnalysisRunViewSchema>;

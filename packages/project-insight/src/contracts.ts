import { z } from 'zod';

/** Copied ISO regex from P0 observer; P1 does not import observer at the contract layer. */
export const IsoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);

export const InsightIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/);

/**
 * P0 `Evidence.quality` is only OBSERVED | UNKNOWN | STALE.
 * UNAVAILABLE is a P1-derived quality (repo accessibility / collection UNAVAILABLE).
 */
export const EvidenceQualitySchema = z.enum(['OBSERVED', 'UNKNOWN', 'STALE', 'UNAVAILABLE']);
export type EvidenceQuality = z.infer<typeof EvidenceQualitySchema>;

export const P0_EVIDENCE_QUALITY = ['OBSERVED', 'UNKNOWN', 'STALE'] as const;
export type P0EvidenceQuality = (typeof P0_EVIDENCE_QUALITY)[number];

export const HeadBindingSchema = z.enum(['BOUND_TO_HEAD', 'NOT_BOUND_TO_HEAD', 'UNDETERMINED']);
export type HeadBinding = z.infer<typeof HeadBindingSchema>;

export const SignalKindSchema = z.enum([
  'TEST_REPORT_FAILURE_OBSERVED',
  'TEST_REPORT_RESULT_CHANGED',
  'TEST_EVIDENCE_NOT_CURRENT',
  'OBSERVATION_GAP_DETECTED',
  'OBSERVER_HEALTH_DEGRADED',
  'ADAPTER_ERROR_OBSERVED',
  'REPOSITORY_UNAVAILABLE_PERSISTENT',
  'REPOSITORY_UNAVAILABLE_OBSERVED',
  'REPOSITORY_RECOVERED',
  'REPOSITORY_HEAD_CHANGED',
  'REPOSITORY_BRANCH_CHANGED',
  'WORKTREE_STATE_CHANGED',
]);
export type SignalKind = z.infer<typeof SignalKindSchema>;

export const EXTRACTOR_VERSION = 'insight-signal-extractor/1';

export const EvidenceKindSchema = z.enum(['observer_event', 'observer_snapshot', 'observation_run']);
export const EvidenceRoleSchema = z.enum(['trigger', 'baseline', 'context', 'resolution']);

export const EvidenceRefSchema = z
  .object({
    kind: EvidenceKindSchema,
    projectId: InsightIdSchema,
    id: InsightIdSchema,
    observedAt: IsoDateTimeSchema,
    quality: EvidenceQualitySchema,
    role: EvidenceRoleSchema,
  })
  .strict();
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const SignalSchema = z
  .object({
    signalKey: z.string().min(16).max(128),
    projectId: InsightIdSchema,
    kind: SignalKindSchema,
    observedAt: IsoDateTimeSchema,
    sourceEventIds: z.array(InsightIdSchema).max(32),
    fromSnapshotId: InsightIdSchema.optional(),
    toSnapshotId: InsightIdSchema.optional(),
    evidenceQuality: EvidenceQualitySchema,
    comparable: z.boolean(),
    headBinding: HeadBindingSchema,
    facts: z.record(z.string(), z.unknown()),
    streamEpoch: z.number().int().nonnegative().optional(),
    appendSeq: z.number().int().positive().optional(),
    subject: z.string().min(1).max(256).optional(),
    extractorVersion: z.string().min(1).max(64).optional(),
    evidenceRefs: z.array(EvidenceRefSchema).max(12).optional(),
  })
  .strict();
export type Signal = z.infer<typeof SignalSchema>;

/** S1.1 extracted signal: S0 Signal plus identity/evidence fields always populated. */
export const ExtractedSignalSchema = SignalSchema.superRefine((value, ctx) => {
  if (value.streamEpoch === undefined) ctx.addIssue({ code: 'custom', message: 'streamEpoch required' });
  if (value.appendSeq === undefined) ctx.addIssue({ code: 'custom', message: 'appendSeq required' });
  if (value.subject === undefined) ctx.addIssue({ code: 'custom', message: 'subject required' });
  if (value.extractorVersion === undefined) ctx.addIssue({ code: 'custom', message: 'extractorVersion required' });
  if (value.evidenceRefs === undefined || value.evidenceRefs.length < 1) {
    ctx.addIssue({ code: 'custom', message: 'evidenceRefs required' });
  }
  if (value.sourceEventIds.length < 1) ctx.addIssue({ code: 'custom', message: 'sourceEventIds required' });
});
export type ExtractedSignal = Signal & {
  streamEpoch: number;
  appendSeq: number;
  subject: string;
  extractorVersion: string;
  evidenceRefs: EvidenceRef[];
};

export const SignalBatchOutcomeSchema = z.enum([
  'OK',
  'NO_SIGNAL',
  'SOURCE_RESET_REQUIRED',
  'EVIDENCE_UNAVAILABLE',
]);
export type SignalBatchOutcome = z.infer<typeof SignalBatchOutcomeSchema>;

export const SourceResetReasonSchema = z.enum([
  'PROJECT_REMOVED',
  'STREAM_EPOCH_MISMATCH',
  'CURSOR_AHEAD_OF_STREAM',
]);
export type SourceResetReason = z.infer<typeof SourceResetReasonSchema>;

export const SignalBatchSchema = z
  .object({
    signals: z.array(SignalSchema),
    proposedCursor: z
      .object({
        afterSeq: z.number().int().nonnegative(),
        streamEpoch: z.number().int().nonnegative(),
      })
      .strict(),
    highWatermark: z.number().int().nonnegative(),
    outcome: SignalBatchOutcomeSchema,
    hasMore: z.boolean(),
    legacyOrderReconstructed: z.boolean(),
    extractorVersion: z.string().min(1).max(64),
    resetReason: SourceResetReasonSchema.optional(),
    reasonCode: z.string().min(1).max(64).optional(),
  })
  .strict();
export type SignalBatch = z.infer<typeof SignalBatchSchema>;

export const TemplateValueSchema = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

export const InsightCandidateSchema = z
  .object({
    ruleId: z.string().min(1).max(64),
    ruleVersion: z.number().int().positive(),
    projectId: InsightIdSchema,
    subjectKey: z.string().min(1).max(256),
    episodeKey: z.string().min(1).max(256),
    evidenceRefs: z.array(EvidenceRefSchema).min(1).max(12),
    severity: z.enum(['info', 'attention', 'important']),
    confidence: z.enum(['high', 'medium', 'low']),
    titleKey: z.string().min(1).max(128),
    detailKey: z.string().min(1).max(128),
    templateData: z.record(z.string(), TemplateValueSchema),
    reasonCodes: z.array(z.string().min(1).max(64)).max(16),
    headBinding: HeadBindingSchema,
  })
  .strict()
  .refine((value) => value.evidenceRefs.some((ref) => ref.role === 'trigger'), {
    message: 'candidate requires at least one trigger evidence ref',
  });
export type InsightCandidate = z.infer<typeof InsightCandidateSchema>;

export const EvaluationResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NO_INSIGHT'), reasonCode: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('CANDIDATE'), candidate: InsightCandidateSchema }).strict(),
]);
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export const InsightStatusSchema = z.enum(['OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'RESOLVED', 'WITHDRAWN']);
export type InsightStatus = z.infer<typeof InsightStatusSchema>;

export const InsightSchema = z
  .object({
    id: InsightIdSchema,
    projectId: InsightIdSchema,
    ruleId: z.string().min(1).max(64),
    ruleVersion: z.number().int().positive(),
    dedupKey: z.string().length(64),
    episodeKey: z.string().min(1).max(256),
    status: InsightStatusSchema,
    severity: z.enum(['info', 'attention', 'important']),
    confidence: z.enum(['high', 'medium', 'low']),
    titleKey: z.string().min(1).max(128),
    detailKey: z.string().min(1).max(128),
    templateData: z.record(z.string(), TemplateValueSchema),
    firstObservedAt: IsoDateTimeSchema,
    lastMaterialObservedAt: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    evidenceRefs: z.array(EvidenceRefSchema).min(1).max(12),
    reasonCodes: z.array(z.string().min(1).max(64)).max(16),
    historical: z.boolean(),
    headBinding: HeadBindingSchema,
    evidenceAvailability: z.enum(['AVAILABLE', 'MISSING', 'UNAVAILABLE']),
  })
  .strict();
export type Insight = z.infer<typeof InsightSchema>;

export const ObserverEventViewSchema = z
  .object({
    eventId: InsightIdSchema,
    projectId: InsightIdSchema,
    type: z.string().min(1).max(64),
    observedAt: IsoDateTimeSchema,
    fromSnapshotId: InsightIdSchema.nullable(),
    toSnapshotId: InsightIdSchema.nullable(),
    runId: InsightIdSchema,
    evidenceQuality: EvidenceQualitySchema,
    summary: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ObserverEventView = z.infer<typeof ObserverEventViewSchema>;

export const InsightUserActionSchema = z.enum(['acknowledge', 'dismiss']);
export type InsightUserAction = z.infer<typeof InsightUserActionSchema>;

export const InsightFeedbackKindSchema = z.enum(['useful', 'not_useful']);
export type InsightFeedbackKind = z.infer<typeof InsightFeedbackKindSchema>;

export const INSIGHT_RULE_IDS = [
  'R-TEST-FAILURE',
  'R-TEST-REGRESSION',
  'R-TEST-EVIDENCE-GAP',
  'R-OBSERVER-HEALTH',
  'R-OBSERVATION-GAP',
  'R-REPOSITORY-UNAVAILABLE',
] as const;
export type InsightRuleId = (typeof INSIGHT_RULE_IDS)[number];

/** Frozen S0 default enablement. Engine must not silently turn R-TEST-EVIDENCE-GAP on. */
export const DEFAULT_RULE_POLICY = {
  'R-TEST-FAILURE': { enabled: true },
  'R-TEST-REGRESSION': { enabled: true },
  'R-TEST-EVIDENCE-GAP': { enabled: false },
  'R-OBSERVER-HEALTH': { enabled: true },
  'R-OBSERVATION-GAP': { enabled: true },
  'R-REPOSITORY-UNAVAILABLE': { enabled: true },
} as const;

export const REPORT_SOURCE_SUBJECT_PREFIX = 'reportSource:' as const;

/** Stable subject for test-report rules. Uses relativePath because P0 TestSummary has no reportSourceId. */
export function reportSourceSubjectKey(relativePath: string): string {
  return `${REPORT_SOURCE_SUBJECT_PREFIX}${relativePath.replace(/\\/g, '/')}`;
}

export function mapP0EvidenceQuality(
  p0Quality: P0EvidenceQuality,
  accessibility: 'OK' | 'UNAVAILABLE',
): EvidenceQuality {
  if (accessibility === 'UNAVAILABLE') return 'UNAVAILABLE';
  return p0Quality;
}

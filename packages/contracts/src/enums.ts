import { z } from 'zod';

export const CONTRACT_VERSION = '1' as const;

export const RiskSchema = z.enum(['L0', 'L1', 'L2', 'L3']);
export type Risk = z.infer<typeof RiskSchema>;

export const SensitivitySchema = z.enum(['public', 'personal', 'restricted']);
export type Sensitivity = z.infer<typeof SensitivitySchema>;

export const ProvenanceSchema = z.enum(['user_confirmed', 'tool_observed', 'model_inferred']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const SourceTypeSchema = z.enum(['fixture', 'vault', 'github', 'calendar', 'mail']);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const ActionTypeSchema = z.enum([
  'report.generate',
  'checklist.generate',
  'draft.generate',
  'repo.read_diagnose',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const EffectTypeSchema = z.enum(['read', 'local_create', 'external_write']);
export type EffectType = z.infer<typeof EffectTypeSchema>;

export const VerificationKindSchema = z.enum(['artifact_sha256', 'json_schema', 'remote_readback']);
export type VerificationKind = z.infer<typeof VerificationKindSchema>;

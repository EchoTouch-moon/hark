/* eslint-disable no-redeclare -- Zod schema 与同名 type 有意合并，TS 允许 */
import { z } from 'zod';

// G0 contract: docs/mvp/g0/05-dual-track-and-viewmodel.md §3. Mind → Experience only entry.
const Id = z.string().min(1);
const IsoDate = z.string().datetime({ offset: true });

export const EvidenceLabel = z.object({ id: Id, kind: z.enum(['observer', 'research', 'decision']), label: z.string().min(1) }).strict();

export const Scope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('project'), projectId: Id, title: z.string().min(1) }).strict(),
]);

export const Freshness = z.enum(['fresh', 'stale', 'gap', 'unknown', 'disabled', 'unavailable']);
export const FlameLevel = z.enum(['neutral', 'ember', 'warm', 'bright']);

export const StoryBeat = z
  .object({
    kind: z.enum(['诞生', '探索', '推进', '沉淀']),
    at: IsoDate,
    summary: z.string().min(1),
    evidence: z.array(EvidenceLabel),
  })
  .strict();

export const NarrativeState = z
  .object({
    flame: z.object({ level: FlameLevel, reason: z.string().min(1), milestoneGold: z.boolean() }).strict(),
    story: z.array(StoryBeat),
  })
  .strict();

export const FeaturedOpinion = z
  .object({
    revisionId: Id,
    opinion: z.string().min(1),
    whyNow: z.string().min(1),
    evidence: z.array(EvidenceLabel),
    uncertainties: z.array(z.string()),
    actions: z.tuple([z.literal('查看依据'), z.literal('讨论计划'), z.literal('稍后再说')]),
  })
  .strict()
  .nullable();

// execute is always false in MVP.
export const Permissions = z
  .object({ observe: z.boolean(), research: z.boolean(), model: z.boolean(), execute: z.literal(false) })
  .strict();

const base = {
  mode: z.enum(['real', 'demo']),
  scope: Scope,
  narrative: NarrativeState,
  featuredOpinion: FeaturedOpinion,
  observationFreshness: Freshness,
  permissions: Permissions,
};
const ErrorInfo = z.object({ code: z.string().min(1), message: z.string().min(1) }).strict();

// error present iff status === 'error'.
export const HearthViewModel = z.discriminatedUnion('status', [
  z.object({ ...base, status: z.literal('ok') }).strict(),
  z.object({ ...base, status: z.literal('empty') }).strict(),
  z.object({ ...base, status: z.literal('permission_denied') }).strict(),
  z.object({ ...base, status: z.literal('error'), error: ErrorInfo }).strict(),
]);

export type EvidenceLabel = z.infer<typeof EvidenceLabel>;
export type Scope = z.infer<typeof Scope>;
export type Freshness = z.infer<typeof Freshness>;
export type FlameLevel = z.infer<typeof FlameLevel>;
export type StoryBeat = z.infer<typeof StoryBeat>;
export type NarrativeState = z.infer<typeof NarrativeState>;
export type FeaturedOpinion = z.infer<typeof FeaturedOpinion>;
export type Permissions = z.infer<typeof Permissions>;
export type HearthViewModel = z.infer<typeof HearthViewModel>;

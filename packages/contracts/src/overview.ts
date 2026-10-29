/**
 * @fileoverview 真实工作台今日概览（Overview）聚合数据合同
 * 
 * 为首页提供有界聚合数据，避免前端分别多次轮询 projects/insights/events。
 * 各分区具备独立可用性状态；零模型调用，由确定性模板生成概览摘要。
 */

import { z } from 'zod';

export const SectionAvailabilitySchema = z.enum(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE']);
export type SectionAvailability = z.infer<typeof SectionAvailabilitySchema>;

export const TestStatusIndicatorSchema = z.enum([
  'PASSED',
  'FAILED',
  'UNKNOWN',
  'STALE',
  'NOT_CONFIGURED',
]);
export type TestStatusIndicator = z.infer<typeof TestStatusIndicatorSchema>;

export const ProjectOverviewItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  localPath: z.string(),
  enabled: z.boolean(),
  lastObservedAt: z.string().nullable(),
  openInsightCount: z.number().int().nonnegative(),
  testStatus: TestStatusIndicatorSchema,
  branch: z.string().nullable(),
  headOid: z.string().nullable(),
});
export type ProjectOverviewItem = z.infer<typeof ProjectOverviewItemSchema>;

export const OverviewInsightItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  title: z.string(),
  summary: z.string(),
  severity: z.enum(['important', 'attention', 'info']),
  status: z.string(),
  observedAt: z.string(),
  primaryRuleId: z.string(),
  evidenceCount: z.number().int().nonnegative(),
  historical: z.boolean(),
});
export type OverviewInsightItem = z.infer<typeof OverviewInsightItemSchema>;

export const OverviewObservationItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  type: z.string(),
  timestamp: z.string(),
  source: z.string(),
  quality: z.string(),
  payloadSummary: z.string(),
});
export type OverviewObservationItem = z.infer<typeof OverviewObservationItemSchema>;

export const OverviewHeadlineStatusSchema = z.enum([
  'NO_PROJECTS',
  'NO_SIGNALS',
  'ALL_CLEAR',
  'ATTENTION_NEEDED',
  'DEGRADED',
  'PAUSED',
]);
export type OverviewHeadlineStatus = z.infer<typeof OverviewHeadlineStatusSchema>;

export const OverviewHeadlineSummarySchema = z.object({
  date: z.string(),
  status: OverviewHeadlineStatusSchema,
  headline: z.string(),
  detail: z.string(),
  counts: z.object({
    totalProjects: z.number().int().nonnegative(),
    enabledProjects: z.number().int().nonnegative(),
    openInsights: z.number().int().nonnegative(),
    importantInsights: z.number().int().nonnegative(),
    todayObservationsCount: z.number().int().nonnegative(),
  }),
});
export type OverviewHeadlineSummary = z.infer<typeof OverviewHeadlineSummarySchema>;

export const OverviewResponseSchema = z.object({
  collectedAt: z.string(),
  sectionsAvailability: z.object({
    projects: SectionAvailabilitySchema,
    insights: SectionAvailabilitySchema,
    observations: SectionAvailabilitySchema,
  }),
  sectionErrors: z
    .object({
      projects: z.string().nullable(),
      insights: z.string().nullable(),
      observations: z.string().nullable(),
    })
    .optional(),
  summary: OverviewHeadlineSummarySchema,
  prioritizedInsights: z.object({
    items: z.array(OverviewInsightItemSchema),
    totalOpenCount: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
  projects: z.array(ProjectOverviewItemSchema),
  recentObservations: z.object({
    events: z.array(OverviewObservationItemSchema),
    totalCount: z.number().int().nonnegative(),
  }),
});
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;

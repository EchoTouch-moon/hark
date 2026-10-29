/**
 * @fileoverview 规范化源事件模型（Event）
 * 系统从外部数据源（Git、构建系统、日历、Fixture 等）采集并标准化后的事件数据结构。
 * 包含事件发生时间、观察时间、去重键以及原始负载引用。
 */

import { z } from 'zod';
import { ProvenanceSchema, SensitivitySchema } from './enums.js';
import { IdSchema, IsoDateTimeSchema, SummarySchema, TagsSchema } from './common.js';
import { SourceRefSchema } from './source.js';

/**
 * 源事件 Schema
 */
export const EventSchema = z
  .object({
    /** 事件唯一 ID */
    id: IdSchema,
    /** 事件类型标识（如 repo.ci_failed, calendar.conflict, study.next_step_pending 等） */
    type: z.string().min(1).max(128),
    /** 所属项目 ID（支持项目级边界隔离） */
    projectId: IdSchema,
    /** 来源引用信息（包含来源类型、URI 与快照哈希） */
    source: SourceRefSchema,
    /** 真实发生时间（ISO-8601） */
    occurredAt: IsoDateTimeSchema,
    /** 系统观察/采集到的时间（ISO-8601） */
    observedAt: IsoDateTimeSchema,
    /** 事件有效期截止时间（可选） */
    expiresAt: IsoDateTimeSchema.optional(),
    /** 人类可读的事件摘要说明 */
    summary: SummarySchema,
    /** 事件去重键（用于去重存储，同一 dedupeKey 不重复写入） */
    dedupeKey: z.string().min(1).max(256),
    /** 敏感度分级 */
    sensitivity: SensitivitySchema,
    /** 来源真实性溯源 */
    provenance: ProvenanceSchema,
    /** 关联的大型负载文件或外部资源引用路径（可选） */
    payloadRef: z.string().max(2048).optional(),
    /** 标签列表（用于索引和规则路由） */
    tags: TagsSchema,
  })
  .strict();
export type Event = z.infer<typeof EventSchema>;

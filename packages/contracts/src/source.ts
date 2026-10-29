/**
 * @fileoverview 数据源引用模型（SourceRef）
 * 用于精确溯源事件或证据的原始来源位置与内容快照。
 */

import { z } from 'zod';
import { SourceTypeSchema } from './enums.js';
import { IdSchema, IsoDateTimeSchema } from './common.js';

/**
 * 数据源引用 Schema
 */
export const SourceRefSchema = z
  .object({
    /** 来源类型（fixture, vault, github, calendar, mail） */
    sourceType: SourceTypeSchema,
    /** 统一资源标识符（如 file://, git:// 或模拟 URI） */
    uri: z.string().min(1).max(2048),
    /** 数据源内部的条目/实体 ID */
    sourceId: IdSchema,
    /** 采集/观察时间（ISO-8601） */
    observedAt: IsoDateTimeSchema,
    /** 原始内容的 SHA-256 哈希（用于检测源内容是否发生变更） */
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();
export type SourceRef = z.infer<typeof SourceRefSchema>;

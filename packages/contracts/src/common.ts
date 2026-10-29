/**
 * @fileoverview 通用基础数据类型定义
 * 包含强校验的 ISO-8601 时间戳、实体 ID 格式规则及标签等基础标量。
 */

import { z } from 'zod';

/**
 * 带有明确时区偏移（或 Z）的 ISO-8601 日期时间字符串
 * 示例：2026-10-28T10:00:00+08:00 或 2026-10-28T02:00:00Z
 */
export const IsoDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/,
    'must be ISO-8601 datetime with timezone',
  );
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** 实体 ID：可见字符、禁止包含空格、长度 2~128 字符 */
export const IdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/);
export type Id = z.infer<typeof IdSchema>;

/** 用户可见的人类可读摘要文案（1~2000字符） */
export const SummarySchema = z.string().min(1).max(2000);

/** 标签列表：最多 16 个标签，单个标签长度上限 64 */
export const TagsSchema = z.array(z.string().min(1).max(64)).max(16);

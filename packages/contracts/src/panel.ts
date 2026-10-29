/**
 * @fileoverview UI 面板规范（PanelSpec）
 * 用于定义工作台可扩展的状态展示面板（如度量指标、时间线、运行状态等）。
 */

import { z } from 'zod';
import { IdSchema } from './common.js';

/** 面板支持的组件类型 */
export const PanelComponentTypeSchema = z.enum(['text', 'metric', 'list', 'status', 'link']);

/**
 * 面板配置规范 Schema
 */
export const PanelSpecSchema = z
  .object({
    /** 面板唯一 ID */
    id: IdSchema,
    /** 面板大类 */
    kind: z.enum(['metric', 'list', 'timeline', 'activity']),
    /** 绑定的项目 ID（可选，缺省为全局面板） */
    projectId: IdSchema.optional(),
    /** 数据查询标识符 */
    dataQueryId: z.string().min(1).max(128),
    /** 自动刷新周期（秒，5~3600秒） */
    refreshSeconds: z.number().int().min(5).max(3600),
    /** 面板子组件列表 */
    components: z
      .array(
        z
          .object({
            type: PanelComponentTypeSchema,
            field: z.string().min(1).max(128),
            label: z.string().min(1).max(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();
export type PanelSpec = z.infer<typeof PanelSpecSchema>;

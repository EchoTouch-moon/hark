/**
 * @fileoverview 服务依赖注入容器与系统设置 DTO（Services & Settings）
 * 定义注入给各路由模块的核心业务服务实例接口及全局静默/配额设置的数据契约。
 */

import { z } from 'zod';
import type { MockAgentAdapter } from '@hearth/agent-adapters';
import type { DiscoveryService, Orchestrator } from '@hearth/core';

/** 注入各路由的业务服务集合 */
export interface Services {
  /** 主动发现引擎服务 */
  discovery: DiscoveryService;
  /** 任务编排执行器服务 */
  orchestrator: Orchestrator;
  /** 对话 Agent 适配器（演示模式使用 MockAgentAdapter） */
  chat: MockAgentAdapter;
  /** 演示数据一键初始化委托 */
  seedDemo: () => Promise<{ eventsIngested: number }>;
}

/** 全局配置项传输契约 Schema */
export const SettingsDtoSchema = z
  .object({
    /** 静默时段起止时间（HH:mm） */
    quietHours: z.object({
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
    /** 每日卡片数量上限（1~10） */
    maxCardsPerDay: z.number().int().min(1).max(10),
    /** 是否开启演示模式 */
    demoMode: z.boolean(),
    /** 本地计算使用的 IANA 时区（默认 Asia/Shanghai） */
    timezone: z.string().min(1).default('Asia/Shanghai'),
  })
  .strict();

export type SettingsDto = z.infer<typeof SettingsDtoSchema>;

/** 默认系统配置常量 */
export const DEFAULT_SETTINGS: SettingsDto = {
  quietHours: { start: '22:00', end: '08:00' },
  maxCardsPerDay: 3,
  demoMode: true,
  timezone: 'Asia/Shanghai',
};

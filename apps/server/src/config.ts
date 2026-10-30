/**
 * @fileoverview 服务端环境配置加载器（Server Configuration）
 * 解析端口、SQLite 数据文件路径、产物目录与允许的跨域来源白名单。
 */

import path from 'node:path';

/** 服务端全局配置接口 */
export interface ServerConfig {
  /** 监听主机地址，默认为 127.0.0.1 */
  host: string;
  /** 服务端口，默认 4317 */
  port: number;
  /** 核心 SQLite 数据库路径 */
  dbPath: string;
  /** 观察者专用 SQLite 数据库路径 */
  observerDbPath: string;
  /** 受控的演示产物输出根目录（.hearth-demo-artifacts） */
  artifactRoot: string;
  /** 是否开启 Demo 演示模式 */
  demoMode: boolean;
  /** 允许请求 Origin 白名单列表（严格防范跨站请求） */
  allowedOrigins: string[];
  /** 前端 SPA 静态构建资源根目录路径 */
  staticDir: string | null;
  /** 代码仓仓库根目录绝对路径 */
  repoRoot: string;
  /** Hearth 授权（M1）：显式服务端开关，默认全部关闭；execute 在 MVP 恒为 false，不可配置 */
  hearthPermissions: { observe: boolean; research: boolean; model: boolean };
  /** 观察超过该时长未更新即视为 stale（毫秒），默认 30 分钟 */
  observeStaleMs: number;
}

const flag = (name: string): boolean => process.env[name] === '1';

/**
 * 加载并解析服务端配置，支持通过环境变量及入参覆盖
 * @param overrides 可选的配置覆盖对象
 */
export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const port = Number(process.env['HEARTH_PORT'] ?? 4317);
  const host = process.env['HEARTH_HOST'] ?? '127.0.0.1';
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const config = {
    host,
    port,
    dbPath: process.env['HEARTH_DB'] ?? path.join(repoRoot, 'data', 'dev.sqlite'),
    observerDbPath:
      process.env['HEARTH_OBSERVER_DB'] ?? path.join(repoRoot, 'data', 'observer.sqlite'),
    artifactRoot: process.env['HEARTH_ARTIFACTS'] ?? path.join(repoRoot, '.hearth-demo-artifacts'),
    demoMode: process.env['HEARTH_DEMO'] === '1',
    allowedOrigins: [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ],
    staticDir: process.env['HEARTH_STATIC'] ?? path.join(repoRoot, 'apps', 'web', 'dist'),
    repoRoot,
    hearthPermissions: {
      observe: flag('HEARTH_PERMIT_OBSERVE'),
      research: flag('HEARTH_PERMIT_RESEARCH'),
      model: flag('HEARTH_PERMIT_MODEL'),
    },
    observeStaleMs: Number(process.env['HEARTH_OBSERVE_STALE_MS'] ?? 30 * 60_000),
    ...overrides,
  };
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.host)) throw new Error('仅允许 loopback 监听；当前没有远程身份认证');
  if (typeof config.demoMode !== 'boolean') throw new Error('无效运行模式');
  return config;
}

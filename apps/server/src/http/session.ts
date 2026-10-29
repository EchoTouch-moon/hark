/**
 * @fileoverview 本地会话与 CSRF 防御管理器（Session & CSRF Management）
 * 
 * 安全机制：
 * 1. 单主体本地会话：Session Token 存放在 HttpOnly Cookie 中，防 XSS 窃取
 * 2. 双重提交与 CSRF 校验：CSRF Token 经由 GET /auth/session 注入 SPA 前端内存，
 *    所有修改状态的请求（POST/PUT/DELETE）必须在 `x-csrf-token` 请求头中原样携带
 * 3. 持久化存储在 settings 表中，服务端重启保持登录状态
 */

import { randomBytes } from 'node:crypto';

/** 会话信息持久化记录 */
export interface SessionRecord {
  /** 会话令牌（HttpOnly Cookie） */
  token: string;
  /** CSRF 校验令牌 */
  csrfToken: string;
  /** 会话创建时间（ISO-8601） */
  createdAt: string;
}

/**
 * 会话管理器
 */
export class SessionManager {
  private record: SessionRecord | null = null;

  constructor(
    private readonly load: () => unknown,
    private readonly persist: (value: unknown) => void,
  ) {
    const raw = this.load();
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as Record<string, unknown>)['token'] === 'string' &&
      typeof (raw as Record<string, unknown>)['csrfToken'] === 'string'
    ) {
      this.record = raw as SessionRecord;
    }
  }

  /** 获取当前活跃会话，若不存在则原子初始化并持久化 */
  current(): SessionRecord {
    if (!this.record) {
      this.record = {
        token: randomBytes(32).toString('hex'),
        csrfToken: randomBytes(24).toString('hex'),
        createdAt: new Date().toISOString(),
      };
      this.persist(this.record);
    }
    return this.record;
  }

  /** 校验传入的 Session Token 是否与当前存储的令牌一致 */
  isValidToken(token: string | undefined): boolean {
    return token !== undefined && this.record !== null && token === this.record.token;
  }

  /** 基于有效会话获取对应的 CSRF Token */
  csrfFor(token: string | undefined): string | null {
    return this.isValidToken(token) ? this.record!.csrfToken : null;
  }

  /** 轮转刷新会话令牌 */
  rotate(): SessionRecord {
    this.record = null;
    return this.current();
  }
}

/**
 * 从 Cookie 头字符串中解析出 hearth_session 字段
 * @param header 请求头中的 Cookie 字符串
 */
export function parseSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'hearth_session') return rest.join('=');
  }
  return undefined;
}

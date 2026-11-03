import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 旧 Action 的失败关闭回归（PR #34 复审 P1）。
 *
 * executeMessageAction 只在用户确实处于离线演示时才允许本地模拟；
 * 服务器明确拒绝（401/403/409/500）或响应不可用时，绝不能写出
 * 本地 result/progress，也不能污染 localStorage。
 */

const CSRF_KEY = 'hearth.csrfToken';
const PARTS_KEY = 'hearth.chat.parts.v2';
const MSGS_KEY = 'hearth.chat.localMsgs.v2';

const DEMO_ACTION = { id: 'mock-diagnose', label: '诊断', needsConfirm: false, demo: true };
const REAL_ACTION = { id: 'act-build-1', label: '重新构建', needsConfirm: true };

let storage: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

const json = (body: unknown, status = 200) =>
  new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const rejection = (status: number, code: string, message = code) =>
  json({ error: { code, message } }, status);

/** 每个用例重置模块状态（liveApi 是模块级开关），并预置 CSRF 缓存避免额外会话请求。 */
async function loadChat() {
  vi.resetModules();
  const client = await import('../../apps/web/src/features/api/client');
  client.setCsrfToken('synthetic-csrf');
  // CSRF 缓存属于会话管理，不算 Mock 写入；清掉后 storage 只反映被测函数的副作用。
  storage.delete(CSRF_KEY);
  const chat = await import('../../apps/web/src/features/chat');
  return { chat, client };
}

/** localStorage 里出现过的所有 key（用于断言没有本地 Mock 落盘）。 */
const writtenKeys = () => [...storage.keys()];

beforeEach(() => {
  storage = new Map();
  fetchMock = vi.fn();
  vi.stubGlobal('window', {
    fetch: fetchMock,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() {
        return storage.size;
      },
    },
    // 演示路径的 700ms 等待与断言无关；同步结算让测试保持确定。
    setTimeout: (fn: () => void) => {
      fn();
      return 0;
    },
    clearTimeout: () => undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('executeMessageAction 只在真正离线时保留本地演示', () => {
  it.each([
    [401, 'AUTH_REQUIRED'],
    [403, 'LEGACY_ACTIONS_DISABLED'],
    [409, 'UNBOUND_THREAD_HISTORY'],
    [500, 'INTERNAL_ERROR'],
  ])('服务器返回 %s %s 时演示行动不产生本地进度或结果', async (status, code) => {
    const { chat } = await loadChat();
    fetchMock.mockResolvedValueOnce(rejection(status, code, '服务器明确拒绝'));

    await expect(
      chat.executeMessageAction('thread-global-1', { ...DEMO_ACTION }),
    ).rejects.toMatchObject({ status, code });

    expect(writtenKeys()).toEqual([]);
    expect(storage.get(PARTS_KEY)).toBeUndefined();
    expect(storage.get(MSGS_KEY)).toBeUndefined();
  });

  it('普通行动遇到 403 时不会写出“已完成”结果，且拒绝原因可见', async () => {
    const { chat } = await loadChat();
    fetchMock.mockResolvedValueOnce(
      rejection(403, 'LEGACY_ACTIONS_DISABLED', '旧模拟操作当前不可用。'),
    );

    await expect(
      chat.executeMessageAction('thread-global-1', { ...REAL_ACTION }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'LEGACY_ACTIONS_DISABLED',
      message: '旧模拟操作当前不可用。',
    });

    expect(writtenKeys()).toEqual([]);
    expect(storage.get(MSGS_KEY)).toBeUndefined();
  });

  it('404 不再被当作离线条件降级为本地演示', async () => {
    const { chat } = await loadChat();
    fetchMock.mockResolvedValueOnce(rejection(404, 'NOT_FOUND', 'thread not found'));

    await expect(
      chat.executeMessageAction('thread-global-1', { ...DEMO_ACTION }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });

    expect(writtenKeys()).toEqual([]);
  });

  it('2xx 但没有执行结果时不当作成功', async () => {
    const { chat } = await loadChat();
    fetchMock.mockResolvedValueOnce(json({}));

    await expect(
      chat.executeMessageAction('thread-global-1', { ...REAL_ACTION }),
    ).rejects.toMatchObject({ code: 'execute_empty_response' });

    expect(writtenKeys()).toEqual([]);
  });

  it('已确认真 API 后，业务拒绝原样抛出而不是通用“接口不可用”', async () => {
    const { chat } = await loadChat();
    fetchMock.mockResolvedValueOnce(
      json({
        message: {
          id: 'server-msg-1',
          role: 'assistant',
          content: '已执行',
          createdAt: '2026-11-03T00:00:00.000Z',
          adapter: 'core',
          parts: [{ type: 'result', text: '已执行', ok: true }],
        },
      }),
    );
    const confirmed = await chat.executeMessageAction('thread-global-1', { ...REAL_ACTION });
    expect(confirmed.mock).toBe(false);

    fetchMock.mockResolvedValueOnce(
      rejection(403, 'LEGACY_ACTIONS_DISABLED', '旧模拟操作当前不可用。'),
    );
    await expect(
      chat.executeMessageAction('thread-global-1', { ...REAL_ACTION }),
    ).rejects.toMatchObject({ status: 403, code: 'LEGACY_ACTIONS_DISABLED' });

    expect(writtenKeys()).toEqual([]);
  });

  it('真正离线时演示行动仍可本地模拟，并保留演示边界', async () => {
    const { chat } = await loadChat();
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await chat.executeMessageAction('thread-global-1', { ...DEMO_ACTION });

    expect(result.mock).toBe(true);
    expect(result.message.parts?.map((part) => part.type)).toEqual(['progress', 'result']);
    expect(result.message.content).toContain('演示');
    expect(storage.get(PARTS_KEY)).toContain(result.message.id);
    expect(storage.get(MSGS_KEY)).toContain(result.message.id);
  });

  it('真正离线时普通行动失败关闭，不伪造完成', async () => {
    const { chat } = await loadChat();
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      chat.executeMessageAction('thread-global-1', { ...REAL_ACTION }),
    ).rejects.toMatchObject({ status: 0, code: 'network_error' });

    expect(writtenKeys()).toEqual([]);
  });

  it('501（接口未实现）只对演示行动保留本地演示', async () => {
    const { chat } = await loadChat();
    fetchMock.mockResolvedValueOnce(rejection(501, 'NOT_IMPLEMENTED'));

    const demo = await chat.executeMessageAction('thread-global-1', { ...DEMO_ACTION });
    expect(demo.mock).toBe(true);

    fetchMock.mockResolvedValueOnce(rejection(501, 'NOT_IMPLEMENTED'));
    await expect(
      chat.executeMessageAction('thread-global-1', { ...REAL_ACTION }),
    ).rejects.toMatchObject({ status: 501 });
  });

  it('真 API 会话断线时不会回退到本地演示', async () => {
    const { chat } = await loadChat();
    fetchMock.mockResolvedValueOnce(
      json({
        message: {
          id: 'server-msg-2',
          role: 'assistant',
          content: '已执行',
          createdAt: '2026-11-03T00:00:00.000Z',
          adapter: 'core',
          parts: [{ type: 'result', text: '已执行', ok: true }],
        },
      }),
    );
    await chat.executeMessageAction('thread-global-1', { ...REAL_ACTION });

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(
      chat.executeMessageAction('thread-global-1', { ...DEMO_ACTION }),
    ).rejects.toMatchObject({ status: 0, code: 'network_error' });

    expect(writtenKeys()).toEqual([]);
  });
});

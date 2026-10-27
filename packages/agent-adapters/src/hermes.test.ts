import { describe, expect, it } from 'vitest';
import { HermesApiAdapter } from './hermes.js';

describe('HermesApiAdapter probe (M2-T03)', () => {
  it('unconfigured: honest unconfigured status, no network attempt', async () => {
    let called = 0;
    const adapter = new HermesApiAdapter({
      fetchImpl: async () => {
        called += 1;
        throw new Error('must not be called');
      },
      now: () => '2026-10-28T12:00:00Z',
    });
    const r = await adapter.probe();
    expect(r.status.state).toBe('unconfigured');
    expect(called).toBe(0);
    expect(r.url).toBeNull();
  });

  it('reachable: capabilities detected', async () => {
    const adapter = new HermesApiAdapter({
      url: 'http://127.0.0.1:9999',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ capabilities: ['fs.read', 'chat'], version: '0.4.0' }),
      }),
      now: () => '2026-10-28T12:00:00Z',
    });
    const r = await adapter.probe();
    expect(r.status.state).toBe('reachable');
    if (r.status.state === 'reachable') {
      expect(r.status.capabilities).toEqual(['fs.read', 'chat']);
    }
  });

  it('connection refused / failure maps to unreachable (never success)', async () => {
    const adapter = new HermesApiAdapter({
      url: 'http://127.0.0.1:1',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
      now: () => '2026-10-28T12:00:00Z',
    });
    const r = await adapter.probe();
    expect(r.status.state).toBe('unreachable');
  });

  it('non-2xx and malformed capability payloads map to unreachable', async () => {
    const mk = (payload: unknown, ok = true, status = 200) =>
      new HermesApiAdapter({
        url: 'http://127.0.0.1:2',
        fetchImpl: async () => ({ ok, status, json: async () => payload }),
        now: () => '2026-10-28T12:00:00Z',
      });
    expect((await mk({ capabilities: { hack: 1 } }).probe()).status.state).toBe('unreachable');
    expect((await mk({}, false, 500).probe()).status.state).toBe('unreachable');
    expect((await mk({ capabilities: [1, 2] }).probe()).status.state).toBe('unreachable');
  });
});

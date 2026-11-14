import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeTavilySearch } from "../src/search/tavily.ts";
import {
  DEFAULT_ZHIPU_MCP_ENDPOINT,
  executeZhipuMcpSearch,
} from "../src/search/zhipu-mcp.ts";
import { SearchManager } from "../src/search/search-manager.ts";

test("executeTavilySearch parses response correctly on 200 OK", async () => {
  const fakeResponse = {
    query: "tauri v2 migration",
    answer: "Tauri v2 introduces unified mobile and desktop plugin architecture.",
    results: [
      {
        title: "Tauri 2.0 Release Notes",
        url: "https://v2.tauri.app/blog/tauri-2-0/",
        content: "Tauri 2.0 brings major performance improvements and iOS/Android support.",
        score: 0.98,
      },
      {
        title: "Migrating from Tauri 1.x",
        url: "https://v2.tauri.app/start/migrate/from-tauri-1/",
        content: "Step by step guide to upgrade Cargo.toml and tauri.conf.json.",
        score: 0.95,
      },
    ],
  };

  const mockFetch: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.tavily.com/search");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(init?.body as string);
    assert.equal(body.api_key, "tvly-test-key");
    assert.equal(body.query, "tauri v2 migration");
    return new Response(JSON.stringify(fakeResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await executeTavilySearch({
    apiKey: "tvly-test-key",
    query: "tauri v2 migration",
    fetchImpl: mockFetch,
  });

  assert.equal(result.provider, "tavily");
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0]?.title, "Tauri 2.0 Release Notes");
  assert.match(result.rawSummaryText, /https:\/\/v2\.tauri\.app/);
  assert.match(result.rawSummaryText, /智能综合回答/);
});

test("executeTavilySearch raises clear error on 401 Unauthorized", async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response("Unauthorized key", { status: 401 });
  };

  await assert.rejects(
    () =>
      executeTavilySearch({
        apiKey: "invalid-key",
        query: "rust async",
        fetchImpl: mockFetch,
      }),
    /Tavily API Key 鉴权失败/
  );
});

test("SearchManager persists and loads configuration across instances", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "hark-search-test-"));
  try {
    const manager1 = new SearchManager({ appDataDir: tmp });
    assert.equal(manager1.isConfigured("tavily"), false);

    manager1.setProviderKey("tavily", "tvly-sample-12345");
    assert.equal(manager1.isConfigured("tavily"), true);

    const manager2 = new SearchManager({ appDataDir: tmp });
    assert.equal(manager2.isConfigured("tavily"), true);
    assert.equal(manager2.getConfig().providers.tavily?.apiKey, "tvly-sample-12345");

    manager2.clearProviderKey("tavily");
    assert.equal(manager2.isConfigured("tavily"), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("SearchManager rejects search without configured key", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "hark-search-test-"));
  try {
    const manager = new SearchManager({ appDataDir: tmp });
    await assert.rejects(
      () => manager.search({ query: "latest react features" }),
      /尚未配置「tavily」搜索服务的 API Key/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("SearchManager handles missing, corrupt, and nullable search-config.json files cleanly", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "hark-search-corrupt-"));
  const harkDir = path.join(tmp, "hark-r1");
  const configPath = path.join(harkDir, "search-config.json");
  try {
    // Missing file -> defaults cleanly
    const missingMgr = new SearchManager({ appDataDir: tmp });
    assert.deepEqual(missingMgr.getConfig(), { activeProvider: "tavily", providers: {} });
    assert.equal(missingMgr.isConfigured(), false);

    // Corrupt JSON -> defaults cleanly
    mkdirSync(harkDir, { recursive: true });
    writeFileSync(configPath, "{not-valid-json", "utf8");
    const corruptMgr = new SearchManager({ appDataDir: tmp });
    assert.deepEqual(corruptMgr.getConfig(), { activeProvider: "tavily", providers: {} });
    assert.equal(corruptMgr.isConfigured(), false);

    // Invalid schema -> defaults cleanly
    writeFileSync(configPath, JSON.stringify({ activeProvider: "unknown", providers: "bad" }), "utf8");
    const invalidMgr = new SearchManager({ appDataDir: tmp });
    assert.deepEqual(invalidMgr.getConfig(), { activeProvider: "tavily", providers: {} });

    // Nullable optional fields from native serialization -> accepted cleanly
    writeFileSync(
      configPath,
      JSON.stringify({
        activeProvider: "tavily",
        providers: {
          tavily: { apiKey: "tvly-null-safe", endpoint: null },
          bing: null,
        },
      }),
      "utf8"
    );
    const nullableMgr = new SearchManager({ appDataDir: tmp });
    assert.equal(nullableMgr.isConfigured("tavily"), true);
    assert.equal(nullableMgr.getConfig().providers.tavily?.apiKey, "tvly-null-safe");

    // Explicit searchConfig override in constructor
    const explicitMgr = new SearchManager({
      appDataDir: tmp,
      searchConfig: {
        activeProvider: "tavily",
        providers: { tavily: { apiKey: "tvly-explicit-opt" } },
      },
    });
    assert.equal(explicitMgr.isConfigured("tavily"), true);
    assert.equal(explicitMgr.getConfig().providers.tavily?.apiKey, "tvly-explicit-opt");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("executeZhipuMcpSearch negotiates MCP Streamable HTTP session and parses SSE results", async () => {
  const methods: string[] = [];
  let seenSessionHeader: string | null = null;
  let calledArgs: Record<string, unknown> | undefined;

  const mockFetch: typeof fetch = async (url, init) => {
    assert.equal(url, DEFAULT_ZHIPU_MCP_ENDPOINT);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer zp-coding-secret");
    const body = JSON.parse(init?.body as string) as {
      method: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    methods.push(body.method);

    if (body.method === "initialize") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "mcp-session-id": "sess-zhipu-01",
          },
        }
      );
    }

    if (body.method === "notifications/initialized") {
      seenSessionHeader = headers.get("mcp-session-id");
      return new Response("", { status: 202 });
    }

    if (body.method === "tools/list") {
      assert.equal(headers.get("mcp-session-id"), "sess-zhipu-01");
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: {
            tools: [
              {
                name: "web_search_prime",
                inputSchema: {
                  type: "object",
                  properties: {
                    search_query: { type: "string" },
                    count: { type: "integer" },
                  },
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (body.method === "tools/call") {
      assert.equal(headers.get("mcp-session-id"), "sess-zhipu-01");
      assert.equal(body.params?.name, "web_search_prime");
      calledArgs = body.params?.arguments;
      const sseBody = [
        "event: message",
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify([
                  {
                    title: "Safari 18.2 Release Notes",
                    link: "https://developer.apple.com/documentation/safari-release-notes",
                    content: "Added support for PointerEvent getCoalescedEvents and getPredictedEvents.",
                    publish_date: "2024-12-11",
                  },
                ]),
              },
            ],
          },
        })}`,
        "",
      ].join("\n");
      return new Response(sseBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    throw new Error(`Unexpected MCP method: ${body.method}`);
  };

  const result = await executeZhipuMcpSearch({
    apiKey: "zp-coding-secret",
    query: "Safari 18.2 getCoalescedEvents",
    maxResults: 3,
    fetchImpl: mockFetch,
  });

  assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
  assert.equal(seenSessionHeader, "sess-zhipu-01");
  assert.deepEqual(calledArgs, { search_query: "Safari 18.2 getCoalescedEvents", count: 3 });
  assert.equal(result.provider, "zhipu_mcp");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.title, "Safari 18.2 Release Notes");
  assert.equal(result.results[0]?.url, "https://developer.apple.com/documentation/safari-release-notes");
  assert.match(result.rawSummaryText, /智谱 MCP 联网搜索结果/);
});

test("executeZhipuMcpSearch surfaces Zhipu HTTP-200 auth error payload cleanly", async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({ code: 401, msg: "令牌已过期或验证不正确", success: false }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  await assert.rejects(
    () =>
      executeZhipuMcpSearch({
        apiKey: "bad-token",
        query: "hark",
        fetchImpl: mockFetch,
      }),
    /智谱 MCP 鉴权失败（401）：令牌已过期或验证不正确/
  );
});

test("SearchManager dispatches search and testConnection for zhipu_mcp", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "hark-zhipu-search-"));
  const customEndpoint = "https://api.z.ai/api/mcp/web_search_prime/mcp";
  const mockFetch: typeof fetch = async (url, init) => {
    assert.equal(url, customEndpoint);
    const body = JSON.parse(init?.body as string) as { method: string };
    if (body.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (body.method === "notifications/initialized") {
      return new Response("", { status: 204 });
    }
    if (body.method === "tools/list") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: { tools: [{ name: "webSearchPrime" }] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        result: {
          content: [{ type: "text", text: "Z.AI search fallback summary text." }],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const manager = new SearchManager({ appDataDir: tmp, fetchImpl: mockFetch });
    manager.saveConfig({
      activeProvider: "zhipu_mcp",
      providers: {
        zhipu_mcp: { apiKey: "zhipu-key-ok", endpoint: customEndpoint },
      },
    });
    assert.equal(manager.isConfigured("zhipu_mcp"), true);

    const conn = await manager.testConnection("zhipu_mcp", "zhipu-key-ok");
    assert.equal(conn.success, true);
    assert.match(conn.message, /webSearchPrime/);

    const searchRes = await manager.search({ query: "perfect-freehand" });
    assert.equal(searchRes.provider, "zhipu_mcp");
    assert.match(searchRes.rawSummaryText, /Z\.AI search fallback summary text/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

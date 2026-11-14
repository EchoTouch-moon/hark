import type { SearchExecutionResult, SearchResultItem } from "./types.ts";

export const DEFAULT_ZHIPU_MCP_ENDPOINT =
  "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp";

const MCP_PROTOCOL_VERSION = "2025-03-26";

export interface ZhipuMcpSearchOptions {
  apiKey: string;
  query: string;
  endpoint?: string | undefined;
  maxResults?: number | undefined;
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface ZhipuMcpConnectionOptions {
  apiKey: string;
  endpoint?: string | undefined;
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch | undefined;
}

interface JsonRpcError {
  code?: number;
  message?: string;
  data?: unknown;
}

interface McpToolDescriptor {
  name?: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
  };
}

interface McpEnvelope {
  jsonrpc?: string;
  id?: string | number | null;
  result?: Record<string, unknown>;
  error?: JsonRpcError;
  code?: number;
  msg?: string;
  message?: string;
  success?: boolean;
}

function normalizeEndpoint(endpoint?: string): string {
  const trimmed = endpoint?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_ZHIPU_MCP_ENDPOINT;
}

function parseJsonOrSsePayload(rawText: string): McpEnvelope {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {};
  }
  if (!trimmed.startsWith("data:") && !trimmed.includes("\ndata:")) {
    return JSON.parse(trimmed) as McpEnvelope;
  }

  const lines = trimmed.split(/\r?\n/);
  const payloads: McpEnvelope[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const joined = buffer.join("\n").trim();
    buffer = [];
    if (!joined || joined === "[DONE]") return;
    try {
      payloads.push(JSON.parse(joined) as McpEnvelope);
    } catch {
      // ignore partial/non-JSON SSE frames
    }
  };

  for (const line of lines) {
    if (line.startsWith("data:")) {
      buffer.push(line.slice(5).trimStart());
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();

  if (payloads.length === 0) {
    throw new Error(`智谱 MCP 返回了无法解析的 SSE 响应: ${trimmed.slice(0, 200)}`);
  }
  const withResultOrError = [...payloads]
    .reverse()
    .find((item) => item.result !== undefined || item.error !== undefined || item.success === false);
  return withResultOrError ?? payloads[payloads.length - 1]!;
}

async function postMcpJsonRpc(options: {
  endpoint: string;
  apiKey: string;
  body: Record<string, unknown>;
  sessionId?: string | undefined;
  signal?: AbortSignal | undefined;
  fetchImpl: typeof fetch;
  allowEmptyResponse?: boolean;
}): Promise<{ envelope: McpEnvelope; sessionId?: string | undefined }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${options.apiKey.trim()}`,
  };
  if (options.sessionId) {
    headers["mcp-session-id"] = options.sessionId;
  }

  let response: Response;
  try {
    response = await options.fetchImpl(options.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(options.body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err: unknown) {
    if (options.signal?.aborted) {
      throw new Error("搜索已被中断。");
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`无法连接至智谱 MCP 搜索服务: ${message}`);
  }

  const nextSessionId = response.headers.get("mcp-session-id") || options.sessionId;
  const rawText = await response.text().catch(() => "");

  if (response.status === 401 || response.status === 403) {
    throw new Error("智谱 MCP API Key 鉴权失败，请确认填写的是 Coding Plan 专属 API Key 且未过期。");
  }
  if (response.status === 429) {
    throw new Error("智谱 MCP 搜索请求过于频繁，套餐配额可能已达上限，请稍后再试。");
  }
  if (!response.ok) {
    throw new Error(`智谱 MCP 请求失败 (HTTP ${response.status}): ${rawText.slice(0, 200)}`);
  }

  if (!rawText.trim() && options.allowEmptyResponse) {
    return { envelope: {}, sessionId: nextSessionId };
  }

  let envelope: McpEnvelope;
  try {
    envelope = parseJsonOrSsePayload(rawText);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`智谱 MCP 响应解析失败: ${msg}`);
  }

  // 智谱网关在 Token 无效或过期时也会返回 HTTP 200 + {"code": 401, "success": false, "msg": ...}
  if (
    envelope.success === false ||
    (typeof envelope.code === "number" && envelope.code !== 200 && envelope.code !== 0)
  ) {
    const code = envelope.code ?? "unknown";
    const msg = envelope.msg || envelope.message || "未知网关错误";
    if (code === 401 || code === 403) {
      throw new Error(`智谱 MCP 鉴权失败（${code}）：${msg}。请核对是否使用了 Coding Plan 专属 Key。`);
    }
    throw new Error(`智谱 MCP 服务返回错误（${code}）：${msg}`);
  }

  if (envelope.error) {
    throw new Error(
      `智谱 MCP 调用失败 (${envelope.error.code ?? "error"}): ${envelope.error.message || "未知错误"}`
    );
  }

  return { envelope, sessionId: nextSessionId };
}

async function openZhipuMcpSession(options: {
  endpoint: string;
  apiKey: string;
  signal?: AbortSignal | undefined;
  fetchImpl: typeof fetch;
}): Promise<{ sessionId?: string | undefined; tools: McpToolDescriptor[] }> {
  const initRes = await postMcpJsonRpc({
    endpoint: options.endpoint,
    apiKey: options.apiKey,
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "hark-agent-host", version: "0.1.0" },
      },
    },
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });

  // notifications/initialized 为单向通知；部分服务端返回 202/204 空体或忽略通知
  await postMcpJsonRpc({
    endpoint: options.endpoint,
    apiKey: options.apiKey,
    sessionId: initRes.sessionId,
    body: {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    },
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    allowEmptyResponse: true,
  }).catch(() => undefined);

  const listRes = await postMcpJsonRpc({
    endpoint: options.endpoint,
    apiKey: options.apiKey,
    sessionId: initRes.sessionId,
    body: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    },
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });

  const rawTools = listRes.envelope.result?.tools;
  const tools = Array.isArray(rawTools) ? (rawTools as McpToolDescriptor[]) : [];
  return {
    sessionId: listRes.sessionId ?? initRes.sessionId,
    tools,
  };
}

function selectSearchTool(tools: McpToolDescriptor[]): {
  toolName: string;
  queryField: "search_query" | "query";
  supportsCount: boolean;
} {
  const preferred =
    tools.find((t) => t.name === "web_search_prime") ??
    tools.find((t) => t.name === "webSearchPrime") ??
    tools.find((t) => typeof t.name === "string" && /search/i.test(t.name));

  const toolName = preferred?.name || "webSearchPrime";
  const props = preferred?.inputSchema?.properties;
  const queryField: "search_query" | "query" =
    props && "query" in props && !("search_query" in props) ? "query" : "search_query";
  const supportsCount = !props || "count" in props;

  return { toolName, queryField, supportsCount };
}

function normalizeCandidateItems(raw: unknown): SearchResultItem[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidate =
      obj.results ?? obj.search_result ?? obj.searchResult ?? obj.items ?? obj.data;
    if (Array.isArray(candidate)) {
      list = candidate;
    }
  }

  const items: SearchResultItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const title = String(item.title ?? item.name ?? item.media ?? "未命名结果").trim();
    const url = String(item.link ?? item.url ?? item.href ?? "").trim();
    const snippet = String(
      item.content ?? item.snippet ?? item.abstract ?? item.summary ?? item.description ?? ""
    )
      .slice(0, 600)
      .trim();
    const publishedDate =
      typeof item.publish_date === "string"
        ? item.publish_date
        : typeof item.publishedDate === "string"
          ? item.publishedDate
          : undefined;
    const score = typeof item.score === "number" ? item.score : undefined;

    if (!url && !snippet) continue;
    items.push({
      title: title || "未命名结果",
      url,
      snippet,
      ...(publishedDate ? { publishedDate } : {}),
      ...(score !== undefined ? { score } : {}),
    });
  }
  return items;
}

function extractSearchPayload(result: Record<string, unknown> | undefined): {
  results: SearchResultItem[];
  answer?: string;
} {
  if (!result) {
    return { results: [] };
  }

  const contentBlocks = Array.isArray(result.content)
    ? (result.content as Array<{ type?: string; text?: string }>)
    : [];
  const textParts = contentBlocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text!.trim())
    .filter(Boolean);
  const combinedText = textParts.join("\n");

  if (result.isError === true) {
    throw new Error(`智谱 MCP 工具执行失败: ${combinedText || "未知工具错误"}`);
  }

  if (result.structuredContent !== undefined) {
    const structuredResults = normalizeCandidateItems(result.structuredContent);
    if (structuredResults.length > 0) {
      return { results: structuredResults };
    }
  }

  for (const text of textParts) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const parsedItems = normalizeCandidateItems(parsed);
      if (parsedItems.length > 0) {
        return { results: parsedItems };
      }
      // 某些响应将 JSON 再包一层（如 { text: "..." } 或嵌套字符串）
      if (typeof parsed === "string") {
        const inner = JSON.parse(parsed) as unknown;
        const innerItems = normalizeCandidateItems(inner);
        if (innerItems.length > 0) {
          return { results: innerItems };
        }
      }
    } catch {
      // 不是 JSON 文本，走纯文本汇总兜底
    }
  }

  return {
    results: [],
    ...(combinedText ? { answer: combinedText.slice(0, 2400) } : {}),
  };
}

export async function testZhipuMcpConnection(
  options: ZhipuMcpConnectionOptions
): Promise<{ success: boolean; message: string; toolCount: number }> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new Error("请输入有效的智谱 Coding Plan API Key");
  }
  const endpoint = normalizeEndpoint(options.endpoint);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  const session = await openZhipuMcpSession({
    endpoint,
    apiKey,
    signal: options.signal,
    fetchImpl,
  });
  const selected = selectSearchTool(session.tools);
  return {
    success: true,
    toolCount: session.tools.length,
    message: `连接成功！智谱 MCP 鉴权通过，已就绪搜索工具 ${selected.toolName}。`,
  };
}

export async function executeZhipuMcpSearch(
  options: ZhipuMcpSearchOptions
): Promise<SearchExecutionResult> {
  const {
    apiKey,
    query,
    endpoint,
    maxResults = 5,
    signal,
    fetchImpl = globalThis.fetch,
  } = options;

  if (!apiKey || !apiKey.trim()) {
    throw new Error("智谱 MCP API Key 未配置，请在应用设置中填写 Coding Plan 专属 Key。");
  }
  if (!query || !query.trim()) {
    throw new Error("搜索关键词不能为空。");
  }

  const targetEndpoint = normalizeEndpoint(endpoint);
  const clampedCount = Math.min(Math.max(maxResults, 1), 10);

  const session = await openZhipuMcpSession({
    endpoint: targetEndpoint,
    apiKey,
    signal,
    fetchImpl,
  });
  const { toolName, queryField, supportsCount } = selectSearchTool(session.tools);

  const toolArgs: Record<string, unknown> = {
    [queryField]: query.trim(),
    ...(supportsCount ? { count: clampedCount } : {}),
  };

  const callRes = await postMcpJsonRpc({
    endpoint: targetEndpoint,
    apiKey,
    sessionId: session.sessionId,
    body: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: toolArgs,
      },
    },
    signal,
    fetchImpl,
  });

  const extracted = extractSearchPayload(callRes.envelope.result);
  const results = extracted.results.slice(0, clampedCount);

  const lines: string[] = [];
  lines.push(`【智谱 MCP 联网搜索结果】关键词: "${query}"`);
  if (extracted.answer) {
    lines.push(`【检索返回内容】:\n${extracted.answer}`);
  }
  if (results.length > 0) {
    lines.push(`【搜索命中来源清单 (${results.length})】:`);
    results.forEach((r, idx) => {
      lines.push(
        `${idx + 1}. [${r.title}](${r.url || "#"})\n   摘要: ${r.snippet || "（无摘要）"}`
      );
    });
  } else if (!extracted.answer) {
    lines.push("未返回匹配的网页结果。");
  }

  return {
    provider: "zhipu_mcp",
    query,
    ...(extracted.answer ? { answer: extracted.answer } : {}),
    results,
    rawSummaryText: lines.join("\n"),
  };
}

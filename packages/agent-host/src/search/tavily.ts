import type { SearchExecutionResult, SearchResultItem } from "./types.ts";

export interface TavilySearchOptions {
  apiKey: string;
  query: string;
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

interface TavilyApiResponse {
  query?: string;
  answer?: string;
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    score?: number;
    published_date?: string;
  }>;
}

export async function executeTavilySearch(options: TavilySearchOptions): Promise<SearchExecutionResult> {
  const {
    apiKey,
    query,
    maxResults = 5,
    searchDepth = "basic",
    signal,
    fetchImpl = globalThis.fetch,
  } = options;

  if (!apiKey || !apiKey.trim()) {
    throw new Error("Tavily API Key 未配置，请在应用设置中填写。");
  }

  if (!query || !query.trim()) {
    throw new Error("搜索关键词不能为空。");
  }

  const endpoint = "https://api.tavily.com/search";
  const body = {
    api_key: apiKey.trim(),
    query: query.trim(),
    search_depth: searchDepth,
    include_answer: true,
    max_results: Math.min(Math.max(maxResults, 1), 10),
  };

  let response: Response;
  try {
    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    };
    response = await fetchImpl(endpoint, requestInit);
  } catch (err: unknown) {
    if (signal?.aborted) {
      throw new Error("搜索已被中断。");
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`无法连接至 Tavily 搜索服务: ${message}`);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Tavily API Key 鉴权失败，请检查密钥是否正确或已过期。");
    }
    if (response.status === 429) {
      throw new Error("Tavily 搜索请求过于频繁，配额已超限，请稍后再试。");
    }
    const errText = await response.text().catch(() => "");
    throw new Error(`Tavily 搜索请求失败 (HTTP ${response.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as TavilyApiResponse;
  const rawResults = Array.isArray(data.results) ? data.results : [];

  const results: SearchResultItem[] = rawResults.map((item) => ({
    title: item.title || "未知标题",
    url: item.url || "",
    snippet: (item.content || "").slice(0, 600).trim(),
    score: item.score,
    publishedDate: item.published_date,
  }));

  // 生成格式化的文本，便于模型理解并在回答中以 Markdown 链接引用
  const lines: string[] = [];
  lines.push(`【Tavily 联网搜索结果】关键词: "${query}"`);
  if (data.answer) {
    lines.push(`【智能综合回答】: ${data.answer}`);
  }
  lines.push(`【搜索命中来源清单 (${results.length})】:`);
  results.forEach((r, idx) => {
    lines.push(
      `${idx + 1}. [${r.title}](${r.url})\n   摘要: ${r.snippet}`
    );
  });

  return {
    provider: "tavily",
    query,
    answer: data.answer,
    results,
    rawSummaryText: lines.join("\n"),
  };
}

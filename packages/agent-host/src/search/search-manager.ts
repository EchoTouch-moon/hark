import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  SearchConfig,
  SearchExecutionResult,
  SearchProviderType,
} from "./types.ts";
import { searchConfigSchema } from "./types.ts";
import { executeTavilySearch } from "./tavily.ts";
import { executeZhipuMcpSearch, testZhipuMcpConnection } from "./zhipu-mcp.ts";

export interface SearchManagerOptions {
  appDataDir: string;
  searchConfig?: SearchConfig | null | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export class SearchManager {
  private configPath: string;
  private config: SearchConfig;
  private explicitConfig: SearchConfig | null = null;
  private fetchImpl: typeof fetch;

  constructor(options: SearchManagerOptions) {
    const harkDir = path.join(options.appDataDir, "hark-r1");
    if (!existsSync(harkDir)) {
      mkdirSync(harkDir, { recursive: true });
    }
    this.configPath = path.join(harkDir, "search-config.json");
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (options.searchConfig) {
      const parsed = searchConfigSchema.safeParse(options.searchConfig);
      if (!parsed.success) {
        throw new Error(`无效的搜索配置结构: ${parsed.error.message}`);
      }
      this.explicitConfig = parsed.data;
    }
    this.config = this.loadConfig();
  }

  public getConfig(): SearchConfig {
    return {
      activeProvider: this.config.activeProvider,
      providers: { ...this.config.providers },
    };
  }

  public saveConfig(newConfig: SearchConfig): void {
    const parsed = searchConfigSchema.safeParse(newConfig);
    if (!parsed.success) {
      throw new Error(`无效的搜索配置结构: ${parsed.error.message}`);
    }
    this.config = parsed.data;
    if (this.explicitConfig) {
      this.explicitConfig = parsed.data;
    }
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`无法保存搜索配置文件: ${msg}`);
    }
  }

  public setProviderKey(provider: SearchProviderType, apiKey: string): void {
    if (!this.config.providers) {
      this.config.providers = {};
    }
    this.config.providers[provider] = {
      ...(this.config.providers[provider] || {}),
      apiKey: apiKey.trim(),
    };
    this.config.activeProvider = provider;
    this.saveConfig(this.config);
  }

  public clearProviderKey(provider: SearchProviderType): void {
    if (this.config.providers?.[provider]) {
      delete this.config.providers[provider];
      this.saveConfig(this.config);
    }
  }

  public isConfigured(provider?: SearchProviderType): boolean {
    this.config = this.loadConfig();
    const target = provider || this.config.activeProvider;
    const creds = this.config.providers?.[target];
    const hasKey = Boolean(creds?.apiKey && creds.apiKey.trim().length > 0);
    if (!hasKey && target === "tavily" && Boolean(process.env.TAVILY_API_KEY?.trim())) {
      return true;
    }
    if (!hasKey && target === "zhipu_mcp" && Boolean(process.env.ZHIPU_MCP_API_KEY?.trim())) {
      return true;
    }
    return hasKey;
  }

  public async testConnection(
    provider: SearchProviderType,
    apiKey: string,
    endpoint?: string
  ): Promise<{ success: boolean; message: string }> {
    if (!apiKey || !apiKey.trim()) {
      return { success: false, message: "请输入有效的 API Key" };
    }
    try {
      if (provider === "tavily") {
        const result = await executeTavilySearch({
          apiKey,
          query: "Hark agent test",
          maxResults: 1,
          fetchImpl: this.fetchImpl,
        });
        return {
          success: true,
          message: `连接成功！Tavily 已返回 ${result.results.length} 条测试结果。`,
        };
      }
      if (provider === "zhipu_mcp") {
        const resolvedEndpoint = endpoint?.trim() || this.config.providers?.zhipu_mcp?.endpoint;
        const result = await testZhipuMcpConnection({
          apiKey,
          endpoint: resolvedEndpoint,
          fetchImpl: this.fetchImpl,
        });
        return {
          success: result.success,
          message: result.message,
        };
      }
      return { success: true, message: `Provider ${provider} 配置格式有效。` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  }

  public async search(options: {
    query: string;
    maxResults?: number;
    signal?: AbortSignal;
  }): Promise<SearchExecutionResult> {
    this.config = this.loadConfig();
    const active = this.config.activeProvider || "tavily";
    let creds = this.config.providers?.[active];

    if ((!creds?.apiKey || !creds.apiKey.trim()) && active === "tavily" && process.env.TAVILY_API_KEY?.trim()) {
      creds = { apiKey: process.env.TAVILY_API_KEY.trim(), ...(creds?.endpoint ? { endpoint: creds.endpoint } : {}) };
    }
    if ((!creds?.apiKey || !creds.apiKey.trim()) && active === "zhipu_mcp" && process.env.ZHIPU_MCP_API_KEY?.trim()) {
      creds = { apiKey: process.env.ZHIPU_MCP_API_KEY.trim(), ...(creds?.endpoint ? { endpoint: creds.endpoint } : {}) };
    }

    if (!creds?.apiKey || !creds.apiKey.trim()) {
      throw new Error(
        `尚未配置「${active}」搜索服务的 API Key。请在 Hark 应用设置中填写密钥以启用外网搜索。`
      );
    }

    if (active === "tavily") {
      return executeTavilySearch({
        apiKey: creds.apiKey,
        query: options.query,
        ...(options.maxResults !== undefined ? { maxResults: options.maxResults } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        fetchImpl: this.fetchImpl,
      });
    }

    if (active === "zhipu_mcp") {
      return executeZhipuMcpSearch({
        apiKey: creds.apiKey,
        endpoint: creds.endpoint,
        query: options.query,
        ...(options.maxResults !== undefined ? { maxResults: options.maxResults } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        fetchImpl: this.fetchImpl,
      });
    }

    throw new Error(`暂不支持搜索服务提供商: ${active}`);
  }

  private loadConfig(): SearchConfig {
    if (this.explicitConfig) {
      return {
        activeProvider: this.explicitConfig.activeProvider,
        providers: { ...this.explicitConfig.providers },
      };
    }
    if (existsSync(this.configPath)) {
      try {
        const raw = readFileSync(this.configPath, "utf8");
        const parsed = searchConfigSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          return parsed.data;
        }
      } catch {
        // 解析失败或文件损坏时回退到默认空配置
      }
    }
    return {
      activeProvider: "tavily",
      providers: {},
    };
  }
}

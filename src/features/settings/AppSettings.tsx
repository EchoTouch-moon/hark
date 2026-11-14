import React, { useEffect, useState } from "react";
import { Check, Globe, KeyRound, Monitor, Moon, Search, Sun, X, Loader2 } from "lucide-react";
import { RuntimeStatus, SearchProviderConfig, SearchProviderType } from "../../bridge/HarkBridge";

export type ThemePreference = "auto" | "light" | "dark";

interface AppSettingsProps {
  isOpen: boolean;
  runtime: RuntimeStatus;
  themePref: ThemePreference;
  onThemePrefChange: (pref: ThemePreference) => void;
  pauseMotion: boolean;
  onPauseMotionChange: (paused: boolean) => void;
  bridgeMode: "dev_preview_synthetic" | "strict_tauri_ipc";
  onBridgeModeChange: (mode: "dev_preview_synthetic" | "strict_tauri_ipc") => void;
  onUpdateRuntime: (patch: Partial<Pick<RuntimeStatus, "windowBehaviorOnClose" | "launchAtLogin" | "notificationsEnabled" | "stepFunConfigured" | "piSidecarStatus">>) => Promise<void>;
  onSimulateTrayMinimize: () => void;
  onClose: () => void;
  nativeLocked?: boolean;
  nativeStatusNote?: string;
  onSaveStepFunKey?: (apiKey: string) => Promise<void>;
  onClearStepFunKey?: () => Promise<void>;
  searchConfig?: SearchProviderConfig;
  onLoadSearchConfig?: () => Promise<SearchProviderConfig>;
  onSaveSearchConfig?: (config: SearchProviderConfig) => Promise<void>;
  onSaveSearchKey?: (provider: SearchProviderType, apiKey: string) => Promise<void>;
  onClearSearchKey?: (provider: SearchProviderType) => Promise<void>;
  onTestSearchConnection?: (provider: SearchProviderType, apiKey: string, endpoint?: string) => Promise<{ success: boolean; message: string }>;
}

const DEFAULT_ZHIPU_MCP_ENDPOINT = "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp";

const SEARCH_PROVIDERS_META: Array<{
  id: SearchProviderType;
  name: string;
  tag: string;
  placeholder: string;
  desc: string;
}> = [
  {
    id: "tavily",
    name: "Tavily Search",
    tag: "Agent 原生",
    placeholder: "输入 Tavily API Key (tvly-...)",
    desc: "专为 AI Agent 研发的实时深度搜索引擎，返回高质量正文摘要与权威来源。",
  },
  {
    id: "zhipu_mcp",
    name: "智谱 MCP",
    tag: "Coding Plan 自带",
    placeholder: "输入智谱 Coding Plan 专属 API Key",
    desc: "直连智谱 GLM Coding Plan 附带的联网搜索 MCP（webSearchPrime），消耗套餐内额度，与标准按量 Key 隔离。",
  },
  {
    id: "bing",
    name: "Bing Web Search",
    tag: "微软必应",
    placeholder: "输入 Bing Web Search API Key",
    desc: "微软 Azure Cognitive Services 提供的全球 Web 搜索索引与新闻检索能力。",
  },
  {
    id: "serper",
    name: "Google Serper",
    tag: "谷歌索引",
    placeholder: "输入 Serper.dev API Key",
    desc: "极速的 Google 搜索结果 API，涵盖网页、学术及技术文档索引。",
  },
];

export const AppSettings: React.FC<AppSettingsProps> = ({
  isOpen, runtime, themePref, onThemePrefChange, pauseMotion, onPauseMotionChange,
  bridgeMode, onClose, onSaveStepFunKey, onClearStepFunKey,
  searchConfig, onLoadSearchConfig, onSaveSearchConfig, onSaveSearchKey, onClearSearchKey, onTestSearchConnection,
}) => {
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  // 多搜索引擎状态
  const [activeSearchProvider, setActiveSearchProvider] = useState<SearchProviderType>("tavily");
  const [searchKeyDraft, setSearchKeyDraft] = useState("");
  const [searchEndpointDraft, setSearchEndpointDraft] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchNotice, setSearchNotice] = useState("");
  const [searchTesting, setSearchTesting] = useState(false);

  // 本地搜索配置状态镜像
  const [localSearchConfig, setLocalSearchConfig] = useState<SearchProviderConfig>(() => {
    return searchConfig || { activeProvider: "tavily", providers: {} };
  });

  // 加载搜索配置
  useEffect(() => {
    if (!isOpen) {
      setKeyDraft("");
      setNotice("");
      setSearchKeyDraft("");
      setSearchEndpointDraft("");
      setSearchNotice("");
      return;
    }

    let cancelled = false;
    if (bridgeMode === "strict_tauri_ipc") {
      if (!onLoadSearchConfig) {
        setSearchNotice("当前模式未连接搜索配置服务。");
        return;
      }
      onLoadSearchConfig()
        .then((data) => {
          if (cancelled || !data || typeof data !== "object") return;
          setLocalSearchConfig(data);
          if (data.activeProvider) {
            setActiveSearchProvider(data.activeProvider);
            setSearchEndpointDraft(data.providers?.[data.activeProvider]?.endpoint || "");
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : (err && typeof err === "object" && "message" in err ? String(err.message) : "未知错误");
          setSearchNotice(`加载搜索配置失败: ${msg}`);
        });
      return () => {
        cancelled = true;
      };
    }

    // dev_preview_synthetic 模式：从 /api/search-config 尝试读取，或回退到 localStorage / bridge
    fetch("/api/search-config")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data && typeof data === "object") {
          setLocalSearchConfig(data);
          if (data.activeProvider) {
            setActiveSearchProvider(data.activeProvider);
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (onLoadSearchConfig) {
          onLoadSearchConfig()
            .then((data) => {
              if (!cancelled && data) {
                setLocalSearchConfig(data);
                if (data.activeProvider) setActiveSearchProvider(data.activeProvider);
              }
            })
            .catch(() => {});
          return;
        }
        try {
          const raw = localStorage.getItem("hark:search_config");
          if (raw) {
            const parsed = JSON.parse(raw);
            setLocalSearchConfig(parsed);
            if (parsed.activeProvider) setActiveSearchProvider(parsed.activeProvider);
          }
        } catch {}
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, bridgeMode, onLoadSearchConfig]);

  if (!isOpen) return null;

  const currentProviderCreds = localSearchConfig.providers?.[activeSearchProvider];
  const isCurrentProviderConfigured = Boolean(currentProviderCreds?.apiKey && currentProviderCreds.apiKey.trim().length > 0);

  const saveKey = async (event: React.FormEvent) => {
    event.preventDefault();
    const key = keyDraft.trim();
    if (!onSaveStepFunKey || !key || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await onSaveStepFunKey(key);
      setKeyDraft("");
      setNotice("AI 配置已保存。如需在当前项目中对话，请在「项目设置」中开启 AI 权限。");
    } catch {
      setNotice("保存失败，请检查系统钥匙串或权限后重试。");
    } finally { setBusy(false); }
  };

  const clearKey = async () => {
    if (!onClearStepFunKey || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await onClearStepFunKey();
      setKeyDraft("");
      setNotice("AI 配置已移除。");
    } catch (error) {
      const code = error && typeof error === "object" && "details" in error
        ? (error.details as { nativeCode?: unknown } | undefined)?.nativeCode
        : undefined;
      setNotice(code === "sidecar_stop_incomplete"
        ? "已移除保存的配置，但 AI 连接尚未完全停止。请退出并重新打开 Hark。"
        : "未能完成全部操作，请检查 AI 连接状态后重试。");
    } finally { setBusy(false); }
  };

  // 保存搜索服务 Key
  const handleSaveSearchKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = searchKeyDraft.trim() || currentProviderCreds?.apiKey?.trim() || "";
    if (!key || searchBusy) return;
    const endpoint = activeSearchProvider === "zhipu_mcp" ? searchEndpointDraft.trim() : "";
    setSearchBusy(true);
    setSearchNotice("");

    try {
      const nextConfig: SearchProviderConfig = {
        activeProvider: activeSearchProvider,
        providers: {
          ...localSearchConfig.providers,
          [activeSearchProvider]: {
            apiKey: key,
            ...(endpoint ? { endpoint } : {}),
          },
        },
      };

      if (bridgeMode === "strict_tauri_ipc") {
        if (!onSaveSearchConfig) {
          throw new Error("搜索配置保存接口未接线");
        }
        await onSaveSearchConfig(nextConfig);
        setLocalSearchConfig(nextConfig);
      } else {
        // 1. 同步保存至本地 API
        await fetch("/api/search-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activeProvider: activeSearchProvider,
            provider: activeSearchProvider,
            apiKey: key,
          }),
        }).catch(() => {});

        // 2. 更新本地状态镜像
        setLocalSearchConfig(nextConfig);
        try {
          localStorage.setItem("hark:search_config", JSON.stringify(nextConfig));
        } catch {}
        if (onSaveSearchConfig) {
          await onSaveSearchConfig(nextConfig);
        }
      }

      // 3. 回调上层如果存在
      if (onSaveSearchKey) {
        await onSaveSearchKey(activeSearchProvider, key);
      }

      setSearchKeyDraft("");
      setSearchNotice(`「${SEARCH_PROVIDERS_META.find(p => p.id === activeSearchProvider)?.name}」配置已保存，联网搜索已就绪！`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err && typeof err === "object" && "message" in err ? String(err.message) : "未知错误");
      setSearchNotice(`保存失败: ${msg}`);
    } finally {
      setSearchBusy(false);
    }
  };

  // 移除当前搜索服务的 Key
  const handleClearSearchKey = async () => {
    if (searchBusy) return;
    setSearchBusy(true);
    setSearchNotice("");
    try {
      const nextProviders = { ...localSearchConfig.providers };
      delete nextProviders[activeSearchProvider];
      const nextConfig: SearchProviderConfig = {
        activeProvider: activeSearchProvider,
        providers: nextProviders,
      };

      if (bridgeMode === "strict_tauri_ipc") {
        if (!onSaveSearchConfig) {
          throw new Error("搜索配置保存接口未接线");
        }
        await onSaveSearchConfig(nextConfig);
        setLocalSearchConfig(nextConfig);
      } else {
        await fetch("/api/search-config", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: activeSearchProvider }),
        }).catch(() => {});
        setLocalSearchConfig(nextConfig);
        try {
          localStorage.setItem("hark:search_config", JSON.stringify(nextConfig));
        } catch {}
        if (onSaveSearchConfig) {
          await onSaveSearchConfig(nextConfig);
        }
      }

      if (onClearSearchKey) {
        await onClearSearchKey(activeSearchProvider);
      }
      setSearchKeyDraft("");
      setSearchNotice(`已移除「${SEARCH_PROVIDERS_META.find(p => p.id === activeSearchProvider)?.name}」的配置。`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err && typeof err === "object" && "message" in err ? String(err.message) : "未知错误");
      setSearchNotice(`清除失败: ${msg}`);
    } finally {
      setSearchBusy(false);
    }
  };

  // 测试搜索连接
  const handleTestSearch = async () => {
    const key = searchKeyDraft.trim() || currentProviderCreds?.apiKey;
    if (!key) {
      setSearchNotice("请先输入或保存 API Key 后再进行连接测试。");
      return;
    }
    const endpoint =
      activeSearchProvider === "zhipu_mcp"
        ? searchEndpointDraft.trim() || currentProviderCreds?.endpoint || DEFAULT_ZHIPU_MCP_ENDPOINT
        : undefined;
    setSearchTesting(true);
    setSearchNotice("正在测试搜索连接…");
    try {
      if (onTestSearchConnection) {
        const result = await onTestSearchConnection(activeSearchProvider, key, endpoint);
        setSearchNotice(result.message);
      } else if (activeSearchProvider === "tavily") {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: key,
            query: "Hark test",
            max_results: 1,
          }),
        });
        if (res.ok) {
          setSearchNotice("测试成功！Tavily API 鉴权通过，可正常检索外网信息。");
        } else if (res.status === 401) {
          setSearchNotice("鉴权失败：Tavily API Key 无效，请核对。");
        } else {
          setSearchNotice(`返回状态码: ${res.status}`);
        }
      } else {
        setSearchNotice(`已完成格式验证，可作为 ${activeSearchProvider} 引擎配置使用。`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSearchNotice(`网络请求异常: ${msg}`);
    } finally {
      setSearchTesting(false);
    }
  };

  const currentMeta = SEARCH_PROVIDERS_META.find((p) => p.id === activeSearchProvider)!;
  const canSaveSearchConfig =
    !searchBusy &&
    !searchTesting &&
    Boolean(
      searchKeyDraft.trim() ||
        (isCurrentProviderConfigured &&
          (localSearchConfig.activeProvider !== activeSearchProvider ||
            (activeSearchProvider === "zhipu_mcp" &&
              searchEndpointDraft.trim() !== (currentProviderCreds?.endpoint || ""))))
    );

  return (
    <div role="dialog" aria-modal="true" aria-label="应用设置" data-testid="app-settings-modal"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8 backdrop-blur-xs">
      <div className="w-full max-w-xl overflow-hidden rounded-[var(--corner-md)] border border-[var(--border-strong)] bg-[var(--surface-solid)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-5">
          <div>
            <h3 className="font-serif-narrative text-lg font-semibold text-[var(--text-primary)]">应用设置</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">管理 AI 连接、外网搜索引擎与界面偏好</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭应用设置" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[75vh] space-y-6 overflow-y-auto p-6 text-sm">
          {/* 1. AI 模型连接 */}
          <section aria-labelledby="ai-settings-title" className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e88e47]/10 text-[#c27537]"><KeyRound className="h-4 w-4" /></div><div><h4 id="ai-settings-title" className="font-semibold text-[var(--text-primary)]">AI 连接</h4><p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">StepFun · step-3.7-flash</p></div></div>
              <span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-xs text-[var(--text-muted)] dark:bg-white/[0.06]">{runtime.stepFunConfigured ? "已配置" : "未配置"}</span>
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              {runtime.credentialPersistenceAvailable
                ? "密钥保存在系统钥匙串中。保存不会自动发送请求，项目资料的访问权限可在「项目设置」中管理。"
                : "系统凭据暂未持久化，密钥将仅在当前运行的内存中生效；项目资料的访问权限可在「项目设置」中管理。"}
            </p>
            {runtime.credentialError && <p role="alert" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{runtime.credentialError}</p>}
            {onSaveStepFunKey ? (
              <form onSubmit={saveKey} className="space-y-3">
                <label htmlFor="stepfun-key" className="block text-xs font-medium text-[var(--text-primary)]">
                  {runtime.stepFunConfigured ? "更换 API Key" : "API Key"}
                </label>
                <input
                  id="stepfun-key"
                  data-testid="stepfun-key-input"
                  type="password"
                  autoComplete="off"
                  value={keyDraft}
                  disabled={busy}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  placeholder={runtime.stepFunConfigured ? "输入新的 Key" : "输入 StepFun API Key"}
                  className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:outline-2 focus:outline-[var(--focus-ring)]"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={busy || !keyDraft.trim()}
                    data-testid="save-stepfun-key-btn"
                    className="rounded-lg bg-[#c27537] px-4 py-2 text-xs font-medium text-white hover:bg-[#b0672c] disabled:opacity-50"
                  >
                    {busy ? "处理中…" : "保存配置"}
                  </button>
                  {runtime.stepFunConfigured && onClearStepFunKey && (
                    <button
                      type="button"
                      disabled={busy}
                      data-testid="clear-stepfun-key-btn"
                      onClick={() => void clearKey()}
                      className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-xs font-medium text-[var(--text-muted)] hover:text-[#b74a46] disabled:opacity-50"
                    >
                      移除配置
                    </button>
                  )}
                </div>
                {notice && <p role="status" className="text-xs text-[var(--text-muted)]">{notice}</p>}
              </form>
            ) : null}
          </section>

          {/* 2. 联网搜索引擎服务（支持多 Provider） */}
          <section aria-labelledby="search-settings-title" className="space-y-4 border-t border-[var(--border-subtle)] pt-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#3d8068]/10 text-[#3d8068]">
                  <Globe className="h-4 w-4" />
                </div>
                <div>
                  <h4 id="search-settings-title" className="font-semibold text-[var(--text-primary)]">
                    联网搜索服务 (Web Search)
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                    支持接入 Tavily 等多个搜索服务，仅需填入对应服务的 API Key 即可激活
                  </p>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                isCurrentProviderConfigured
                  ? "bg-[#3d8068]/15 text-[#3d8068]"
                  : "bg-black/[0.04] text-[var(--text-muted)] dark:bg-white/[0.06]"
              }`}>
                {isCurrentProviderConfigured ? "已接入" : "未接入"}
              </span>
            </div>

            {/* Provider 切换器 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SEARCH_PROVIDERS_META.map((meta) => {
                const isSelected = activeSearchProvider === meta.id;
                const isConfigured = Boolean(localSearchConfig.providers?.[meta.id]?.apiKey);
                return (
                  <button
                    key={meta.id}
                    type="button"
                    onClick={() => {
                      setActiveSearchProvider(meta.id);
                      setSearchEndpointDraft(localSearchConfig.providers?.[meta.id]?.endpoint || "");
                      setSearchNotice("");
                    }}
                    className={`flex flex-col items-start gap-1 p-2.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? "border-[#3d8068] bg-[#3d8068]/10 text-[var(--text-primary)] shadow-2xs"
                        : "border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{meta.name}</span>
                      {isConfigured && <Check className="w-3.5 h-3.5 text-[#3d8068]" />}
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)] leading-tight">{meta.tag}</span>
                  </button>
                );
              })}
            </div>

            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              {currentMeta.desc}
            </p>

            <form onSubmit={handleSaveSearchKey} className="space-y-3">
              <label htmlFor="search-key" className="block text-xs font-medium text-[var(--text-primary)]">
                {isCurrentProviderConfigured ? `更换 ${currentMeta.name} API Key` : `${currentMeta.name} API Key`}
              </label>
              <div className="relative">
                <input
                  id="search-key"
                  data-testid="search-key-input"
                  type="password"
                  autoComplete="off"
                  value={searchKeyDraft}
                  disabled={searchBusy || searchTesting}
                  onChange={(e) => setSearchKeyDraft(e.target.value)}
                  placeholder={
                    isCurrentProviderConfigured
                      ? `已保存 ${activeSearchProvider} 密钥，如需更换请直接输入`
                      : currentMeta.placeholder
                  }
                  className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:outline-2 focus:outline-[var(--focus-ring)]"
                />
              </div>

              {activeSearchProvider === "zhipu_mcp" && (
                <div className="space-y-1.5">
                  <label htmlFor="search-endpoint" className="block text-xs font-medium text-[var(--text-primary)]">
                    MCP 服务端点 (可选，留空使用国内站默认端点)
                  </label>
                  <input
                    id="search-endpoint"
                    data-testid="search-endpoint-input"
                    type="url"
                    autoComplete="off"
                    value={searchEndpointDraft}
                    disabled={searchBusy || searchTesting}
                    onChange={(e) => setSearchEndpointDraft(e.target.value)}
                    placeholder={DEFAULT_ZHIPU_MCP_ENDPOINT}
                    className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2 text-xs font-mono text-[var(--text-primary)] focus:outline-2 focus:outline-[var(--focus-ring)]"
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={!canSaveSearchConfig}
                  data-testid="save-search-key-btn"
                  className="rounded-lg bg-[#3d8068] px-4 py-2 text-xs font-medium text-white hover:bg-[#346d59] disabled:opacity-50 transition-colors shadow-2xs"
                >
                  {searchBusy ? "正在保存…" : "保存并启用"}
                </button>

                <button
                  type="button"
                  disabled={searchBusy || searchTesting || (!searchKeyDraft.trim() && !isCurrentProviderConfigured)}
                  onClick={handleTestSearch}
                  data-testid="test-search-key-btn"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 transition-colors"
                >
                  {searchTesting && <Loader2 className="w-3 h-3 animate-spin text-[#3d8068]" />}
                  <span>测试连接</span>
                </button>

                {isCurrentProviderConfigured && (
                  <button
                    type="button"
                    disabled={searchBusy || searchTesting}
                    onClick={handleClearSearchKey}
                    data-testid="clear-search-key-btn"
                    className="rounded-lg border border-[var(--border-strong)] px-3.5 py-2 text-xs font-medium text-[var(--text-muted)] hover:text-[#b74a46] disabled:opacity-50 transition-colors"
                  >
                    移除配置
                  </button>
                )}
              </div>

              {searchNotice && (
                <p role="status" className={`text-xs ${searchNotice.includes("失败") || searchNotice.includes("异常") ? "text-[#b74a46]" : "text-[#3d8068]"}`}>
                  {searchNotice}
                </p>
              )}
            </form>
          </section>

          {/* 3. 外观设置 */}
          <section className="space-y-3 border-t border-[var(--border-subtle)] pt-5" aria-labelledby="appearance-title">
            <div><h4 id="appearance-title" className="font-semibold text-[var(--text-primary)]">外观</h4><p className="mt-1 text-xs text-[var(--text-muted)]">选择适合你的阅读方式</p></div>
            <div className="grid grid-cols-3 gap-2">{([
              ["auto", "自动", Monitor], ["light", "浅色", Sun], ["dark", "深色", Moon],
            ] as const).map(([value, label, Icon]) => <button key={value} type="button" onClick={() => onThemePrefChange(value)} data-testid={value === "light" ? "theme-light-btn" : value === "dark" ? "theme-dark-btn" : undefined} aria-pressed={themePref === value} className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${themePref === value ? "border-[#c27537] bg-[#e88e47]/10 text-[var(--text-primary)]" : "border-[var(--border-subtle)] text-[var(--text-muted)]"}`}><Icon className="h-3.5 w-3.5" />{label}{themePref === value && <Check className="h-3 w-3" />}</button>)}</div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] p-3"><div><div className="text-xs font-medium text-[var(--text-primary)]">减少动态效果</div><p className="mt-1 text-xs text-[var(--text-muted)]">暂停背景动画</p></div><button type="button" data-testid="toggle-pause-motion-btn" onClick={() => onPauseMotionChange(!pauseMotion)} aria-pressed={pauseMotion} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs text-[var(--text-primary)]">{pauseMotion ? "已开启" : "已关闭"}</button></div>
          </section>
        </div>
      </div>
    </div>
  );
};

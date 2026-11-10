import React, { useState, useEffect } from "react";
import { Search, X, ArrowUpRight, BookOpen, MessageSquare, FileCode } from "lucide-react";
import {
  ID,
  MemoryRecordKind,
  MemorySearchItem,
  WorkspaceId,
} from "../../bridge/HarkBridge";

interface HistorySearchProps {
  isOpen: boolean;
  workspaceId: WorkspaceId;
  workspaceName: string;
  onSearch: (query: string, kinds?: MemoryRecordKind[]) => Promise<MemorySearchItem[]>;
  onSelectResult: (item: MemorySearchItem) => void;
  onClose: () => void;
}

/**
 * FE-11 · HistorySearch
 * PRD §3.1, §3.4, §5:
 * - 同 Workspace 的对话历史、决策、历史观点可通过搜索/历史抽屉打开，回到当前对话无硬切页跳跃。
 * - 支持中文关键词检索当前 Workspace 作用域内的真实记录。
 */
export const HistorySearch: React.FC<HistorySearchProps> = ({
  isOpen,
  workspaceId,
  workspaceName,
  onSearch,
  onSelectResult,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [activeKind, setActiveKind] = useState<"all" | MemoryRecordKind>("all");
  const [results, setResults] = useState<MemorySearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setErrorText(null);
    onSearch(query, activeKind === "all" ? undefined : [activeKind])
      .then((items) => {
        if (!cancelled) setResults(items);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResults([]);
        const message = err && typeof err === "object" && "message" in err ? String(err.message) : "检索不可用";
        setErrorText(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, workspaceId, query, activeKind, onSearch]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filterButtons: { id: "all" | MemoryRecordKind; label: string }[] = [
    { id: "all", label: "全部记录" },
    { id: "decision", label: "用户决策 / 折页" },
    { id: "opinion", label: "Agent 观点" },
    { id: "local_fact", label: "本地文件与证据" },
    { id: "identity", label: "项目身份记录" },
    { id: "experience", label: "已确认经验" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="历史与记忆检索"
      data-testid="history-search-modal"
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/40 backdrop-blur-xs"
    >
      <div className="w-full max-w-2xl rounded-[var(--corner-md)] border border-[var(--border-strong)] bg-[var(--surface-solid)] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)]">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              专属记忆与历史检索 · {workspaceName}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              仅搜索当前项目的记录
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭历史检索"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 搜索框与分类筛选按钮 */}
        <div className="p-4 border-b border-[var(--border-subtle)] space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入中文关键词（例如：火势、Channel、SQLite、摘要）检索…"
              aria-label="检索历史与记忆关键词"
              data-testid="memory-search-input"
              className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] pl-9 pr-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-2 focus:outline-[var(--focus-ring)]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {filterButtons.map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setActiveKind(btn.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeKind === btn.id
                    ? "bg-[#c27537] text-white"
                    : "bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* 结果列表 */}
        <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border-subtle)]">
          {loading ? (
            <div className="p-6 text-center text-xs text-[var(--text-muted)]">
              正在检索当前工作空间记忆…
            </div>
          ) : errorText ? (
            <div className="p-8 text-center text-xs text-[var(--text-muted)] leading-relaxed">
              {errorText}
            </div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--text-muted)]">
              在「{workspaceName}」中未找到匹配「{query}」的记忆或证据记录。
            </div>
          ) : (
            results.map((item: MemorySearchItem) => (
              <div
                key={`${item.kind}-${item.id}`}
                className="px-5 py-3.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] flex items-start justify-between gap-3 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                    {item.kind === "decision" && (
                      <BookOpen className="w-3.5 h-3.5 text-[#3d8068] shrink-0" />
                    )}
                    {item.kind === "opinion" && (
                      <MessageSquare className="w-3.5 h-3.5 text-[#e88e47] shrink-0" />
                    )}
                    {item.kind === "local_fact" && (
                      <FileCode className="w-3.5 h-3.5 text-[#c27537] shrink-0" />
                    )}
                    <span className="font-semibold text-[var(--text-primary)]">
                      {item.title}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{item.statusLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {item.recordedAt.slice(0, 10)}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                    {item.snippet}
                  </p>
                </div>

                {item.sourceRefId && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectResult(item);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-[#c27537] dark:text-[#f1bb7c] hover:bg-[#e88e47]/10 whitespace-nowrap shrink-0"
                  >
                    <span>查看来源</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

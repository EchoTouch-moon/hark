import React, { useEffect } from "react";
import {
  X,
  FileCode,
  GitCommit,
  Globe,
  AlertCircle,
  ShieldAlert,
  Clock,
  CheckCircle2,
  BookMarked,
} from "lucide-react";
import { EvidenceDetail, ID } from "../../bridge/HarkBridge";

interface EvidenceInspectorProps {
  evidence: EvidenceDetail | null;
  onClose: () => void;
  onMarkReverify?: (evidenceId: ID) => void;
}

/**
 * FE-09 · EvidenceInspector
 * PRD §3.2, §4.4, §5:
 * - 右侧 Inspector 建议 360–440px 的临时 Sheet / Drawer；Esc/关闭按钮返回原对话。
 * - 来源展示严格区别：file_read、git_observation、web_snippet、web_fulltext、user_decision、conversation、external_document。
 */
export const EvidenceInspector: React.FC<EvidenceInspectorProps> = ({
  evidence,
  onClose,
  onMarkReverify,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && evidence) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [evidence, onClose]);

  if (!evidence) return null;

  const kindLabelMap: Record<EvidenceDetail["kind"], string> = {
    file_read: "本地只读文件片段 (file_read)",
    git_observation: "Git 提交与工作树观察 (git_observation)",
    web_snippet: "联网搜索摘要 (web_snippet)",
    web_fulltext: "联网网页原文 (web_fulltext)",
    user_decision: "用户已确认决策 (user_decision)",
    conversation: "历史会话记录 (conversation)",
    external_document: "外部参考文档 (external_document)",
  };

  const verificationLabelMap: Record<
    EvidenceDetail["verificationLevel"],
    { label: string; desc: string }
  > = {
    full_text: {
      label: "已阅读原文 (full_text)",
      desc: "Rust Core 或 Reader 已真实读取该来源的完整有效章节，非搜索摘要。",
    },
    partial_text: {
      label: "已读关键片段 (partial_text)",
      desc: "已读取指定行号或变更块上下文，未全量读取整份文件。",
    },
    snippet: {
      label: "只见搜索摘要 (snippet)",
      desc: "仅从搜索结果或历史引文中获取标题与简短摘要，Agent 未通读原文正文。",
    },
    metadata: {
      label: "仅见元数据 / 未读正文 (metadata)",
      desc: "目标页面为动态鉴权空壳或受限资源，未获取到有效正文文本。",
    },
  };

  const verificationInfo = verificationLabelMap[evidence.verificationLevel];

  return (
    <aside
      aria-label="来源证据详情检查器"
      data-testid="evidence-inspector"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[410px] border-l border-[var(--border-strong)] bg-[var(--surface-solid)]/95 backdrop-blur-2xl shadow-2xl flex flex-col animate-hearth-slide-right"
    >
      {/* 顶部栏 */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-[var(--border-subtle)]">
        <div className="min-w-0">
          <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
            <BookMarked className="w-3.5 h-3.5 text-[#e88e47] shrink-0" />
            <span className="truncate font-serif-narrative font-medium">
              证据溯源 Inspector
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{evidence.id}</span>
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate mt-1">
            {evidence.title}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭证据详情面板"
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 主体内容 */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-xs">
        {/* 阅读深度与可用性诚实声明 */}
        <div className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-muted)]">来源类型</span>
            <span className="font-medium text-[var(--text-primary)]">
              {kindLabelMap[evidence.kind]}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-muted)]">阅读深度核验</span>
            <span
              className={`font-semibold ${
                evidence.verificationLevel === "full_text"
                  ? "text-[#3d8068]"
                  : evidence.verificationLevel === "snippet" ||
                    evidence.verificationLevel === "metadata"
                  ? "text-[#c27537] dark:text-[#f1bb7c]"
                  : "text-[var(--text-primary)]"
              }`}
            >
              {verificationInfo.label}
            </span>
          </div>

          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed pt-2 border-t border-[var(--border-subtle)]">
            {verificationInfo.desc}
          </p>
        </div>

        {/* 特殊状态告警：已移出当前范围 / 已过期 / 不可读 */}
        {evidence.removedFromCurrentScope && (
          <div
            role="alert"
            className="rounded-[var(--corner-sm)] border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs space-y-1.5"
          >
            <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>已移出当前范围 (SCOPE_EXCLUDED)</span>
            </div>
            <p className="text-[var(--text-muted)] leading-relaxed">
              {evidence.unreadableReason ||
                "该子目录已被排除或拆分为独立子空间，仅保留历史对话引文锚点，不再作为当前空间的新事实自动引用。"}
            </p>
          </div>
        )}

        {evidence.availability === "stale" && (
          <div
            role="alert"
            className="rounded-[var(--corner-sm)] border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs space-y-2.5"
          >
            <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
              <Clock className="w-4 h-4 shrink-0" />
              <span>证据已过期 (SOURCE_STALE)</span>
            </div>
            <p className="text-[var(--text-muted)] leading-relaxed">
              {evidence.staleReason ||
                "本地文件自上次观察后已发生修改，当前摘录不能直接当作最新事实。"}
            </p>
            {onMarkReverify && (
              <button
                type="button"
                onClick={() => onMarkReverify(evidence.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition-all active:scale-[0.98]"
              >
                请求 Rust Core 重新读取核验
              </button>
            )}
          </div>
        )}

        {evidence.availability === "unreadable" && (
          <div
            role="alert"
            className="rounded-[var(--corner-sm)] border border-[#b74a46]/40 bg-[#b74a46]/10 p-3.5 text-xs space-y-1.5"
          >
            <div className="flex items-center gap-1.5 font-semibold text-[#b74a46]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>来源暂不可读 (SOURCE_UNREADABLE)</span>
            </div>
            <p className="text-[var(--text-muted)] leading-relaxed">
              {evidence.unreadableReason ||
                "目标网页为动态空壳或本地文件无读取权限，Hark 严格禁止编造未读到的正文。"}
            </p>
          </div>
        )}

        {/* 受控位置与观测时间元数据 */}
        <div className="space-y-2 text-xs">
          <div className="text-[var(--text-muted)] font-medium">
            受控位置标识（非 file:// 越权直链）
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] bg-black/[0.03] dark:bg-white/[0.04] px-3.5 py-2.5 rounded-lg text-[var(--text-primary)] break-all">
            {evidence.kind === "file_read" && (
              <FileCode className="w-3.5 h-3.5 shrink-0 text-[#e88e47]" />
            )}
            {evidence.kind === "git_observation" && (
              <GitCommit className="w-3.5 h-3.5 shrink-0 text-[#e88e47]" />
            )}
            {(evidence.kind === "web_snippet" || evidence.kind === "web_fulltext") && (
              <Globe className="w-3.5 h-3.5 shrink-0 text-[#e88e47]" />
            )}
            <span>{evidence.displayLocation}</span>
            {evidence.lineRange && <span>({evidence.lineRange})</span>}
          </div>
          {evidence.observedAt && (
            <div className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums">
              最近观察时间：{evidence.observedAt.replace("T", " ").slice(0, 19)}
            </div>
          )}
        </div>

        {/* 授权片段正文 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--text-primary)]">
              {evidence.verificationLevel === "snippet"
                ? "搜索摘要内容"
                : evidence.verificationLevel === "metadata"
                ? "元数据记录"
                : "Rust Core 授权只读摘录"}
            </span>
            {evidence.availability === "available" && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[#3d8068]">
                <CheckCircle2 className="w-3 h-3" />
                <span>作用域已校验</span>
              </span>
            )}
          </div>
          <pre className="rounded-[var(--corner-sm)] border border-[var(--border-subtle)] bg-black/[0.03] dark:bg-white/[0.03] p-4 font-mono text-xs text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed overflow-x-auto">
            {evidence.excerpt}
          </pre>
        </div>
      </div>

      {/* 底部安全说明 */}
      <div className="px-6 py-3.5 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] flex items-center justify-between">
        <span>按 Esc 键返回原对话位置</span>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1 rounded-md font-medium text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          返回对话
        </button>
      </div>
    </aside>
  );
};

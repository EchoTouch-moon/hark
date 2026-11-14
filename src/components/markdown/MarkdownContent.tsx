import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  tokenizeMarkdown,
  parseInlineSpans,
  InlineSpan,
} from "./parser.ts";

interface MarkdownContentProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

/**
 * 将 InlineSpan 数据转换为带安全 key 的 React 节点
 */
function renderInlineSpans(spans: InlineSpan[]): React.ReactNode[] {
  return spans.map((span, idx) => {
    const key = `span-${idx}`;
    switch (span.type) {
      case "text":
        return span.value;
      case "code":
        return (
          <code
            key={key}
            className="rounded-md bg-black/[0.05] dark:bg-white/[0.08] px-1.5 py-0.5 font-mono text-[13px] text-[#c27537] dark:text-[#f1bb7c] border border-[var(--border-subtle)]"
          >
            {span.value}
          </code>
        );
      case "bold":
        return (
          <strong key={key} className="font-semibold text-[var(--text-primary)]">
            {span.value}
          </strong>
        );
      case "strike":
        return (
          <del key={key} className="line-through text-[var(--text-muted)]">
            {span.value}
          </del>
        );
      case "italic":
        return (
          <em key={key} className="italic text-[var(--text-primary)]/90">
            {span.value}
          </em>
        );
      case "link":
        return (
          <a
            key={key}
            href={span.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#c27537] dark:text-[#f1bb7c] underline underline-offset-4 hover:opacity-80 transition-opacity"
          >
            {span.text}
          </a>
        );
      default:
        return null;
    }
  });
}

/**
 * 优雅的代码块组件（带复制功能、语言指示与黑曜质感）
 */
const CodeBlockView: React.FC<{ lang: string; code: string }> = ({
  lang,
  code,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="group relative my-3 rounded-xl border border-[var(--border-subtle)] bg-[#18181c] text-[#f0ece4] shadow-xs overflow-hidden">
      {/* 头部信息 */}
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-xs text-white/50 font-mono">
        <span>{lang || "text"}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="复制代码"
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10 hover:text-white transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-[#3d8068]" />
              <span className="text-[#3d8068]">已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      {/* 代码本体 */}
      <pre className="overflow-x-auto p-3.5 text-xs font-mono leading-relaxed selection:bg-[#e88e47]/30">
        <code>{code}</code>
      </pre>
    </div>
  );
};

/**
 * Hark 桌面端专用 Markdown 内容渲染组件
 * - 纯 React 节点渲染，严格规避 XSS 风险
 * - 针对用户痛点：“可以分条去一点点说明，而不是像这样一大堆东西扔给我”
 * - 列表项自动卡片化、分条轻呼吸排版，数字徽章强化阅读体验
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  isStreaming = false,
  className = "",
}) => {
  if (!content) return null;

  const tokens = tokenizeMarkdown(content);

  return (
    <div
      data-testid="markdown-content"
      className={`markdown-body space-y-2.5 text-[14.5px] text-[var(--text-primary)] leading-[1.72] ${className}`}
    >
      {tokens.map((token, idx) => {
        switch (token.type) {
          case "heading": {
            if (token.level === 1) {
              return (
                <h2
                  key={idx}
                  className="font-serif-narrative text-lg font-bold text-[var(--text-primary)] mt-4 mb-2 pb-1.5 border-b border-[var(--border-subtle)] flex items-center gap-2"
                >
                  <span className="h-2 w-2 rounded-full bg-[#e88e47]" />
                  <span>{renderInlineSpans(parseInlineSpans(token.text))}</span>
                </h2>
              );
            }
            if (token.level === 2) {
              return (
                <h3
                  key={idx}
                  className="font-serif-narrative text-base font-semibold text-[var(--text-primary)] mt-3.5 mb-2 flex items-center gap-2"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#c27537]" />
                  <span>{renderInlineSpans(parseInlineSpans(token.text))}</span>
                </h3>
              );
            }
            return (
              <h4
                key={idx}
                className="text-[14px] font-semibold text-[var(--text-primary)] mt-3 mb-1"
              >
                {renderInlineSpans(parseInlineSpans(token.text))}
              </h4>
            );
          }

          case "code":
            return (
              <CodeBlockView key={idx} lang={token.lang} code={token.code} />
            );

          case "blockquote":
            return (
              <blockquote
                key={idx}
                className="my-2.5 rounded-r-xl border-l-4 border-[#e88e47]/70 bg-[#e88e47]/[0.05] dark:bg-[#e88e47]/[0.08] px-4 py-2.5 text-xs text-[var(--text-muted)] italic leading-relaxed"
              >
                {token.lines.map((line, lIdx) => (
                  <p key={lIdx}>{renderInlineSpans(parseInlineSpans(line))}</p>
                ))}
              </blockquote>
            );

          case "ordered_list":
            return (
              <div
                key={idx}
                data-testid="ordered-list-cards"
                className="space-y-2 my-2.5"
              >
                {token.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-solid)]/60 hover:bg-[var(--surface-solid)] p-3 text-xs sm:text-[13.5px] transition-colors shadow-2xs"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e88e47]/15 text-[#c27537] dark:text-[#f1bb7c] font-mono text-[11px] font-bold mt-0.5">
                      {itemIdx + 1}
                    </span>
                    <div className="flex-1 min-w-0 leading-relaxed text-[var(--text-primary)]">
                      {renderInlineSpans(parseInlineSpans(item))}
                    </div>
                  </div>
                ))}
              </div>
            );

          case "unordered_list":
            return (
              <div key={idx} className="space-y-1.5 my-2">
                {token.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    className="flex items-start gap-2.5 px-1 py-0.5 text-xs sm:text-[13.5px] leading-relaxed text-[var(--text-primary)]"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#e88e47] mt-2" />
                    <div className="flex-1 min-w-0">
                      {renderInlineSpans(parseInlineSpans(item))}
                    </div>
                  </div>
                ))}
              </div>
            );

          case "hr":
            return (
              <hr
                key={idx}
                className="my-4 border-t border-[var(--border-subtle)]"
              />
            );

          case "paragraph":
            return (
              <p key={idx} className="leading-relaxed">
                {renderInlineSpans(parseInlineSpans(token.text))}
              </p>
            );

          default:
            return null;
        }
      })}

      {/* 流式生成时的呼吸光标 */}
      {isStreaming && (
        <span
          data-testid="streaming-cursor"
          className="inline-block h-3.5 w-1.5 rounded-xs bg-[#e88e47] animate-pulse ml-0.5 align-middle"
          aria-hidden="true"
        />
      )}
    </div>
  );
};

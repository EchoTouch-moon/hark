import React, { useEffect, useId, useRef, useState } from "react";
import { FileText, ShieldCheck } from "lucide-react";

/** The exact body to be sent, supplied by the trusted request boundary. */
export interface OutboundReviewRequest {
  reviewId: string;
  recipient: string;
  model: string;
  limits: readonly { label: string; value: string }[];
  sources: readonly { path: string; version: string }[];
  body: string;
}

export interface OutboundReviewDialogProps {
  request: OutboundReviewRequest;
  onApprove: (reviewId: string) => void | Promise<void>;
  onReject: (reviewId: string) => void | Promise<void>;
}

/**
 * Displays a single pending request. The parent owns its lifetime and must
 * replace it when the request changes; approval is never inferred from closing.
 * Credentials and authorization headers must not be passed to this component.
 */
export const OutboundReviewDialog: React.FC<OutboundReviewDialogProps> = ({ request, onApprove, onReject }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const rejectButton = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    rejectButton.current?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const decide = async (decision: "approve" | "reject") => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await (decision === "approve" ? onApprove : onReject)(request.reviewId);
    } catch {
      setError("操作未完成，请重试。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      data-testid="outbound-review-dialog"
      onCancel={(event) => { event.preventDefault(); void decide("reject"); }}
      className="m-auto w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-solid)] p-0 text-[var(--text-primary)] shadow-2xl backdrop:bg-black/45">
      <div className="flex max-h-[min(90dvh,56rem)] flex-col">
        <header className="border-b border-[var(--border-subtle)] px-6 py-5">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e88e47]/10 text-[#c27537]"><ShieldCheck className="h-5 w-5" /></span>
            <div><h2 id={titleId} className="font-serif-narrative text-lg font-semibold">确认发送给 AI 的内容</h2><p id={descriptionId} className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">请核对接收方和本次内容。批准仅适用于这一次发送。</p></div>
          </div>
        </header>

        <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5 text-sm">
          <dl className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-xs text-[var(--text-muted)]">接收地址</dt><dd className="mt-1 break-all">{request.recipient}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-[var(--text-muted)]">模型</dt><dd className="mt-1 break-all">{request.model}</dd></div>
            {request.limits.map((limit, index) => <div key={`${limit.label}-${index}`} className="min-w-0"><dt className="text-xs text-[var(--text-muted)]">{limit.label}</dt><dd className="mt-1 break-words">{limit.value}</dd></div>)}
          </dl>

          <section aria-label="本次请求的资料来源">
            <h3 className="flex items-center gap-2 font-medium"><FileText aria-hidden="true" className="h-4 w-4 text-[#c27537]" />资料来源</h3>
            {request.sources.length > 0 ? <ul className="mt-2 space-y-1.5 text-xs text-[var(--text-muted)]">
              {request.sources.map((source, index) => <li key={`${source.path}-${source.version}-${index}`} className="break-all rounded-lg border border-[var(--border-subtle)] px-3 py-2"><span className="text-[var(--text-primary)]">{source.path}</span><span className="ml-2">版本：{source.version}</span></li>)}
            </ul> : <p className="mt-2 text-xs text-[var(--text-muted)]">本次没有附带文件来源。</p>}
          </section>

          <section aria-labelledby={`${titleId}-body`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 id={`${titleId}-body`} className="font-medium">完整发送内容</h3><span className="text-xs text-[var(--text-muted)]">按实际请求原样显示</span></div>
            <pre tabIndex={0} data-testid="outbound-review-body" className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 font-mono text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">{request.body}</pre>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--border-subtle)] px-6 py-4">
          {error && <p role="alert" className="mr-auto text-xs text-[#b74a46]">{error}</p>}
          <button ref={rejectButton} type="button" disabled={busy} onClick={() => void decide("reject")} data-testid="outbound-review-reject" className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-50">不发送</button>
          <button type="button" disabled={busy} onClick={() => void decide("approve")} data-testid="outbound-review-approve" className="rounded-lg bg-[#c27537] px-4 py-2 text-sm font-medium text-white hover:bg-[#b0672c] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-50">批准并发送一次</button>
        </footer>
      </div>
    </dialog>
  );
};

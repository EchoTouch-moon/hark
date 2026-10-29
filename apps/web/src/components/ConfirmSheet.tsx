import { useEffect, useId, useRef } from 'react';
import './ConfirmSheet.css';

export interface ConfirmSheetProps {
  open: boolean;
  title: string;
  /** 要做什么 */
  what: string;
  /** 影响范围 */
  impact?: string;
  riskNote?: string;
  confirmText?: string;
  cancelText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * ConfirmSheet（Style Bible v2）：半高 Sheet；Esc / 遮罩 = 拒绝；焦点默认在拒绝。
 */
export function ConfirmSheet({
  open,
  title,
  what,
  impact,
  riskNote,
  confirmText = '批准',
  cancelText = '拒绝',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busy) onCancel();
        return;
      }
      if (event.key !== 'Tab' || sheetRef.current === null) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !sheetRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !sheetRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-sheet-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={sheetRef}
        className="confirm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <div className="confirm-sheet__handle" aria-hidden="true" />
        <h2 className="confirm-sheet__title" id={titleId}>
          {title}
        </h2>
        <div className="confirm-sheet__body" id={descId}>
          <p className="confirm-sheet__what">{what}</p>
          {impact ? <p className="confirm-sheet__impact">影响：{impact}</p> : null}
          {riskNote ? <p className="confirm-sheet__risk">{riskNote}</p> : null}
        </div>
        <div className="confirm-sheet__actions">
          <button
            type="button"
            className="btn btn-ghost"
            autoFocus
            disabled={busy}
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

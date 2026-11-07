import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function ProjectOverviewSheet({ open, onClose, children }: {
  open: boolean; onClose: () => void; children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return (
    <dialog ref={dialog} data-testid="project-overview-sheet" aria-labelledby="project-overview-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={() => { onClose(); document.querySelector<HTMLButtonElement>('[data-testid="more-menu-trigger"]')?.focus(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="m-auto w-[min(560px,calc(100vw-32px))] max-h-[85vh] overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-solid)] p-0 text-[var(--text-primary)] shadow-2xl backdrop:bg-black/25 backdrop:backdrop-blur-sm">
      <div className="p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="project-overview-title" className="font-serif-narrative text-lg font-semibold">项目概览</h2>
          <button type="button" autoFocus onClick={onClose} aria-label="关闭项目概览"
            className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/5"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

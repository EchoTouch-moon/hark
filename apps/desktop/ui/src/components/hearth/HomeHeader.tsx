import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Flame, MoreHorizontal, Search, Sliders, Shield, FolderPlus, Info, EyeOff, Power } from "lucide-react";

interface HomeHeaderProps {
  projectName?: string;
  status: string;
  busy: boolean;
  synthetic: boolean;
  onChooseProject: () => void;
  onOverview: () => void;
  onSearch: () => void;
  onProjectSettings: () => void;
  onAppSettings: () => void;
  onAddProject: () => void;
  onHide: () => void;
  onQuit: () => void;
}

/** The main surface has just two controls. Secondary actions stay discoverable. */
export function HomeHeader(props: HomeHeaderProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const act = (callback: () => void) => () => { setOpen(false); callback(); };
  const items = [
    { label: "项目概览", icon: Info, action: props.onOverview, testId: "open-project-overview" },
    { label: "历史与记忆", icon: Search, action: props.onSearch, testId: "open-history-search-btn" },
    { label: "项目设置", icon: Shield, action: props.onProjectSettings, testId: "open-workspace-settings-btn" },
    { label: "应用设置", icon: Sliders, action: props.onAppSettings, testId: "menu-open-app-settings" },
    { label: "添加项目", icon: FolderPlus, action: props.onAddProject, testId: "menu-add-project" },
  ];
  return (
    <header data-testid="quiet-header" className="sticky top-0 z-30 flex items-center justify-between gap-4 px-5 sm:px-8 py-4 bg-[var(--canvas)]/85 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={props.onChooseProject} data-testid="workspace-switcher-trigger"
          className="inline-flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-sm font-semibold hover:text-[#c27537] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">
          <Flame className="h-4 w-4 shrink-0 text-[#c27537]" />
          <span className="max-w-[220px] truncate font-serif-narrative">{props.projectName ?? "Hark"}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
        </button>
        <span data-testid="header-context-status" role="status" aria-label={props.status} title={props.status}
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${props.busy ? "animate-pulse bg-[#c27537]" : "bg-[var(--text-muted)]/45"}`} />
        {props.synthetic && <span data-testid="bridge-mode-indicator" className="text-[10px] font-mono text-[var(--text-muted)]">DEV PREVIEW / SYNTHETIC</span>}
      </div>
      <div ref={container} className="relative shrink-0" onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}>
        <button ref={trigger} type="button" data-testid="more-menu-trigger" aria-label="更多" aria-haspopup="menu" aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-primary)] dark:hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">
          <MoreHorizontal className="h-5 w-5" />
        </button>
        {open && <div role="menu" aria-label="更多操作" data-testid="more-menu-dropdown"
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
            if (!buttons.length) return;
            event.preventDefault();
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
          }}
          className="absolute right-0 top-11 z-50 w-48 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-solid)] p-1.5 shadow-xl animate-hearth-pop">
          {items.filter((item) => props.projectName || ["menu-open-app-settings", "menu-add-project"].includes(item.testId)).map(({ label, icon: Icon, action, testId }) => <button key={testId} type="button" role="menuitem" data-testid={testId}
            onClick={act(action)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5">
            <Icon className="h-3.5 w-3.5 text-[var(--text-muted)]" />{label}
          </button>)}
          <div className="my-1 border-t border-[var(--border-subtle)]" />
          <button type="button" role="menuitem" data-testid="menu-hide-to-tray" onClick={act(props.onHide)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/5"><EyeOff className="h-3.5 w-3.5" />隐藏窗口</button>
          <button type="button" role="menuitem" onClick={act(props.onQuit)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-[var(--text-muted)] hover:bg-[#b74a46]/10 hover:text-[#b74a46]"><Power className="h-3.5 w-3.5" />退出 Hark</button>
        </div>}
      </div>
    </header>
  );
}

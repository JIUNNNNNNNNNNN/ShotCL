"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { LoaderCircle, PanelRight, X } from "lucide-react";
import {
  useCurrentProjectPageActionMenu,
  type ResolvedProjectPageAction
} from "@/components/ProjectPageActions";
import { confirmUnsavedChangesNavigation } from "@/hooks/useUnsavedChangesGuard";

type RightProjectSidebarProps = {
  projectName: string | null;
};

/** 현재 기능 페이지가 등록한 작업만 데스크톱과 모바일에 공통으로 표시합니다. */
export function RightProjectSidebar({ projectName }: RightProjectSidebarProps) {
  const menu = useCurrentProjectPageActionMenu();
  const [isOpen, setIsOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const hasMenu = Boolean(menu);

  useLayoutEffect(() => {
    setIsOpen(false);
  }, [menu?.key, menu?.scopeKey]);

  useEffect(() => {
    window.dispatchEvent(new Event("project-sidebar-layout"));
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("project-sidebar-layout"));
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.dispatchEvent(new Event("project-sidebar-layout"));
    };
  }, [hasMenu, isOpen, menu?.scopeKey]);

  useEffect(() => {
    if (!hasMenu || !isOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node
        && !sidebarRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [hasMenu, isOpen]);

  const closePanel = useCallback(() => setIsOpen(false), []);

  if (!menu) return null;

  return (
    <aside
      ref={sidebarRef}
      aria-label={menu.ariaLabel}
      data-project-sidebar-root
      data-project-sidebar-open={isOpen ? "true" : "false"}
      className="no-print fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] md:right-5"
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={isOpen ? "페이지 작업 메뉴 닫기" : "페이지 작업 메뉴 열기"}
        aria-expanded={isOpen}
        aria-controls="right-project-menu"
        className="ml-auto grid h-10 w-10 place-items-center rounded-md border border-field-divider bg-field-floating text-field-subtle shadow-floating transition-[background-color,border-color,transform] hover:border-field-primary/50 hover:bg-field-hover hover:text-field-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 md:h-11 md:w-11"
      >
        {isOpen
          ? <X className="h-[18px] w-[18px] md:h-5 md:w-5" aria-hidden />
          : <PanelRight className="h-[18px] w-[18px] md:h-5 md:w-5" aria-hidden />}
      </button>

      <div
        id="right-project-menu"
        data-project-sidebar-panel
        data-project-sidebar-open={isOpen ? "true" : "false"}
        role="dialog"
        aria-modal="false"
        aria-label={menu.ariaLabel}
        aria-hidden={!isOpen}
        className={`absolute right-0 top-[calc(100%+0.5rem)] w-[min(18rem,calc(100vw-1.5rem))] origin-top-right transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
          isOpen
            ? "visible translate-y-0 scale-y-100 opacity-100"
            : "invisible pointer-events-none -translate-y-2 scale-y-95 opacity-0"
        }`}
      >
        <div className="overflow-hidden rounded-[10px] border border-field-divider bg-field-section shadow-floating">
          <div className="flex items-start gap-3 border-b border-field-divider bg-field-section px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-display truncate text-lg font-black text-field-text">{projectName || "프로젝트"}</p>
              <p className="mt-0.5 text-xs font-bold text-field-muted">{menu.title}</p>
            </div>
            <button
              type="button"
              onClick={closePanel}
              aria-label="페이지 작업 메뉴 닫기"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-field-divider bg-field-input text-field-muted transition hover:border-field-primary/50 hover:bg-field-hover hover:text-field-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <nav className="grid max-h-[calc(100dvh-10rem)] gap-2 overflow-y-auto p-3" aria-label={menu.ariaLabel}>
            {menu.actions.map((action) => (
              <PageActionItem key={action.id} action={action} onAction={closePanel} />
            ))}
          </nav>
        </div>
      </div>
    </aside>
  );
}

function PageActionItem({
  action,
  onAction
}: {
  action: ResolvedProjectPageAction;
  onAction: () => void;
}) {
  const Icon = action.icon;
  const sharedClassName = `flex min-h-10 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-semibold transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg ${
    action.active
      ? "border-field-primary/70 bg-field-primary/10 text-field-primary"
      : action.emphasis === "primary"
      ? "border-field-primary bg-field-primary text-field-accent-foreground hover:border-field-secondary hover:bg-field-secondary active:bg-field-strong"
      : "border-field-border bg-transparent text-field-subtle hover:border-field-divider hover:bg-field-hover hover:text-field-text"
  }`;
  const content = (
    <>
      {action.pending
        ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        : <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      <span>{action.label}</span>
    </>
  );

  if (action.href && !action.disabled) {
    return (
      <Link
        href={action.href}
        onClick={(event) => {
          if (!confirmUnsavedChangesNavigation()) {
            event.preventDefault();
            return;
          }
          onAction();
        }}
        className={sharedClassName}
        aria-current={action.active ? "page" : undefined}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (action.disabled) return;
        action.onSelect?.();
        onAction();
      }}
      disabled={action.disabled}
      aria-busy={action.pending || undefined}
      aria-pressed={action.active || undefined}
      className={`${sharedClassName} disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100`}
    >
      {content}
    </button>
  );
}

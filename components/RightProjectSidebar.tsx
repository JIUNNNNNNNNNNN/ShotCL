"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { LoaderCircle, X } from "lucide-react";
import type {
  ResolvedProjectPageAction,
  ResolvedProjectPageActionMenu
} from "@/components/ProjectPageActions";
import { confirmUnsavedChangesNavigation } from "@/hooks/useUnsavedChangesGuard";

type RightProjectSidebarProps = {
  projectName: string | null;
  menu: ResolvedProjectPageActionMenu | null;
  drawerOpen: boolean;
  onDrawerClose: () => void;
  drawerRef: RefObject<HTMLElement | null>;
};

/** 현재 기능 페이지가 등록한 동일한 작업을 wide panel과 responsive drawer에 표시합니다. */
export function RightProjectSidebar({
  projectName,
  menu,
  drawerOpen,
  onDrawerClose,
  drawerRef
}: RightProjectSidebarProps) {
  if (!menu) return null;

  return (
    <>
      <aside
        role="complementary"
        aria-label={menu.ariaLabel}
        className="project-shell__action-panel no-print"
      >
        <ActionMenuHeader projectName={projectName} menu={menu} />
        <ActionMenuItems menu={menu} />
      </aside>

      {drawerOpen ? (
        <div
          className="project-shell__action-drawer-overlay no-print"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onDrawerClose();
          }}
        >
          <aside
            ref={drawerRef}
            id="project-action-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={menu.ariaLabel}
            tabIndex={-1}
            className="project-shell__action-drawer"
          >
            <ActionMenuHeader
              projectName={projectName}
              menu={menu}
              onClose={onDrawerClose}
            />
            <ActionMenuItems menu={menu} onAction={onDrawerClose} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function ActionMenuHeader({
  projectName,
  menu,
  onClose
}: {
  projectName: string | null;
  menu: ResolvedProjectPageActionMenu;
  onClose?: () => void;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 border-b border-field-divider px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-display line-clamp-2 break-words text-base font-black leading-5 text-field-text" title={projectName || "프로젝트"}>
          {projectName || "프로젝트"}
        </p>
        <p className="mt-0.5 text-xs font-bold text-field-muted">{menu.title}</p>
      </div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="페이지 작업 메뉴 닫기"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-field-divider bg-field-input text-field-muted transition hover:border-field-primary/50 hover:bg-field-hover hover:text-field-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function ActionMenuItems({
  menu,
  onAction
}: {
  menu: ResolvedProjectPageActionMenu;
  onAction?: () => void;
}) {
  return (
    <nav className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-2.5" aria-label={menu.ariaLabel}>
      {menu.actions.map((action) => (
        <PageActionItem key={action.id} action={action} onAction={onAction} />
      ))}
    </nav>
  );
}

function PageActionItem({
  action,
  onAction
}: {
  action: ResolvedProjectPageAction;
  onAction?: () => void;
}) {
  const Icon = action.icon;
  const sharedClassName = `flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-semibold transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg ${
    action.active
      ? "neon-selected"
      : action.emphasis === "primary"
      ? "neon-primary"
      : "border-field-border bg-transparent text-field-subtle hover:border-field-divider hover:bg-field-hover hover:text-field-text"
  }`;
  const content = (
    <>
      {action.pending
        ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        : <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      <span className="min-w-0 whitespace-normal break-words leading-5">{action.label}</span>
    </>
  );

  if (action.href && !action.disabled) {
    return (
      <Link
        href={action.href}
        data-project-action-id={action.id}
        onClick={(event) => {
          if (!confirmUnsavedChangesNavigation()) {
            event.preventDefault();
            return;
          }
          onAction?.();
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
      data-project-action-id={action.id}
      onClick={() => {
        if (action.disabled) return;
        action.onSelect?.();
        onAction?.();
      }}
      disabled={action.disabled}
      aria-busy={action.pending || undefined}
      aria-pressed={action.active || undefined}
      className={`${sharedClassName} disabled:cursor-not-allowed disabled:border-field-border disabled:bg-field-section disabled:text-field-disabled disabled:opacity-100 disabled:active:scale-100`}
    >
      {content}
    </button>
  );
}

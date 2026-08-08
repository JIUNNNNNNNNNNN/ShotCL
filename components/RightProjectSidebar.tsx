"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { LoaderCircle, X } from "lucide-react";
import type {
  ProjectPageActionGroup,
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

      <div
        className="project-shell__action-drawer-overlay no-print"
        data-open={drawerOpen ? "true" : "false"}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
        role="presentation"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onDrawerClose();
        }}
      >
        <aside
          ref={drawerRef}
          id="project-action-drawer"
          role="dialog"
          aria-modal={drawerOpen ? "true" : undefined}
          aria-label={menu.ariaLabel}
          tabIndex={-1}
          data-side="right"
          data-open={drawerOpen ? "true" : "false"}
          className="project-shell__action-drawer ui-drawer"
        >
          <ActionMenuHeader
            projectName={projectName}
            menu={menu}
            onClose={onDrawerClose}
          />
          <ActionMenuItems menu={menu} onAction={onDrawerClose} />
        </aside>
      </div>
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
    <div className="project-action-menu__header flex min-w-0 items-start border-b border-field-divider">
      <div className="min-w-0 flex-1">
        <p className="font-display break-words text-base font-black leading-5 text-field-text [overflow-wrap:anywhere]" title={projectName || "프로젝트"}>
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
  const usesGroups = menu.actions.some((action) => action.group);
  if (usesGroups) {
    const groups = groupActions(menu.actions);
    return (
      <nav className="project-action-menu__items flex min-h-0 flex-1 flex-col overflow-y-auto" aria-label={menu.ariaLabel}>
        {groups.map((group) => (
          <section
            key={group.key}
            aria-label={ACTION_GROUP_LABELS[group.key]}
            className={group.key === "manage" ? "mt-auto border-t border-field-divider pt-[var(--ui-section-gap)]" : "pb-[var(--ui-section-gap)]"}
          >
            <p className="mb-2 px-1 text-[11px] font-bold text-field-muted">
              {ACTION_GROUP_LABELS[group.key]}
            </p>
            <div className="grid gap-[var(--ui-card-gap)]">
              {group.actions.map((action) => (
                <PageActionItem key={action.id} action={action} onAction={onAction} />
              ))}
            </div>
          </section>
        ))}
      </nav>
    );
  }

  return (
    <nav className="project-action-menu__items grid min-h-0 flex-1 content-start overflow-y-auto" aria-label={menu.ariaLabel}>
      {menu.actions.map((action) => (
        <PageActionItem key={action.id} action={action} onAction={onAction} />
      ))}
    </nav>
  );
}

const ACTION_GROUP_LABELS: Record<ProjectPageActionGroup, string> = {
  view: "보기",
  document: "문서",
  manage: "관리"
};

function groupActions(actions: ResolvedProjectPageAction[]) {
  const groups: Array<{ key: ProjectPageActionGroup; actions: ResolvedProjectPageAction[] }> = [];
  for (const action of actions) {
    if (!action.group) continue;
    const currentGroup = groups.find((group) => group.key === action.group);
    if (currentGroup) {
      currentGroup.actions.push(action);
    } else {
      groups.push({ key: action.group, actions: [action] });
    }
  }
  return groups;
}

function PageActionItem({
  action,
  onAction
}: {
  action: ResolvedProjectPageAction;
  onAction?: () => void;
}) {
  const Icon = action.icon;
  const sharedClassName = `project-action-menu__item flex w-full items-center justify-center rounded-md border text-center text-sm font-semibold transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg ${
    action.tone === "danger"
      ? "border-field-danger/55 bg-transparent text-field-danger hover:border-field-danger hover:bg-field-danger/10 focus-visible:ring-field-danger"
      : action.active
      ? "neon-selected"
      : action.emphasis === "primary"
      ? "neon-primary"
      : "border-field-border bg-transparent text-field-subtle hover:border-field-divider hover:bg-field-hover hover:text-field-text focus-visible:ring-field-primary"
  }`;
  const content = (
    <>
      {action.pending
        ? <LoaderCircle className="project-action-menu__icon shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        : <Icon className="project-action-menu__icon shrink-0" aria-hidden />}
      <span className="min-w-0 whitespace-normal break-words text-center leading-5">{action.label}</span>
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
        if (action.closeDrawerOnSelect !== false) onAction?.();
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

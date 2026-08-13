"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LoaderCircle, MoreHorizontal } from "lucide-react";
import {
  resolveProjectPageActionMenu,
  type ProjectPageActionGroup,
  type ProjectPageActionMenuRegistration,
  type ResolvedProjectPageAction,
  type ResolvedProjectPageActionMenu
} from "@/components/ProjectPageActions";
import {
  useContextualGuide,
  useContextualGuideAnchor
} from "@/components/guides/ContextualGuideProvider";
import { confirmUnsavedChangesNavigation } from "@/hooks/useUnsavedChangesGuard";

type ProjectPageActionsMenuProps = {
  registration: ProjectPageActionMenuRegistration | null;
  className?: string;
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  ready: boolean;
};

const PAGE_MENU_MARGIN = 8;
const PAGE_MENU_GAP = 6;
const PAGE_MENU_MAX_WIDTH = 288;

/** A page-owned, closed-by-default overflow menu. It never registers with the app shell. */
export function ProjectPageActionsMenu({
  registration,
  className = ""
}: ProjectPageActionsMenuProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const menu = useMemo(() => resolveProjectPageActionMenu(registration), [registration]);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({
    left: PAGE_MENU_MARGIN,
    top: PAGE_MENU_MARGIN,
    width: PAGE_MENU_MAX_WIDTH,
    maxHeight: 320,
    ready: false
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef<"first" | "last">("first");
  const menuId = useId();
  const triggerGuideAnchorKey = menu?.key === "dailyPlan"
    ? "daily-plan.pdf-actions"
    : menu?.key === "scenario"
      ? "scenario.actions"
      : null;
  const triggerGuideAnchor = useContextualGuideAnchor<HTMLButtonElement>(triggerGuideAnchorKey);
  const setTriggerRef = useCallback((element: HTMLButtonElement | null) => {
    triggerRef.current = element;
    triggerGuideAnchor(element);
  }, [triggerGuideAnchor]);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const placeMenu = useCallback(() => {
    const trigger = triggerRef.current;
    const menuElement = menuRef.current;
    if (!trigger || !menuElement) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.min(
      PAGE_MENU_MAX_WIDTH,
      Math.max(0, viewportWidth - PAGE_MENU_MARGIN * 2)
    );
    const measuredHeight = menuElement.scrollHeight;
    const availableBelow = viewportHeight - triggerRect.bottom - PAGE_MENU_GAP - PAGE_MENU_MARGIN;
    const availableAbove = triggerRect.top - PAGE_MENU_GAP - PAGE_MENU_MARGIN;
    const opensAbove = measuredHeight > availableBelow && availableAbove > availableBelow;
    const maxHeight = Math.max(96, opensAbove ? availableAbove : availableBelow);
    const unclampedTop = opensAbove
      ? triggerRect.top - PAGE_MENU_GAP - Math.min(measuredHeight, maxHeight)
      : triggerRect.bottom + PAGE_MENU_GAP;
    const top = Math.max(
      PAGE_MENU_MARGIN,
      Math.min(unclampedTop, viewportHeight - PAGE_MENU_MARGIN - Math.min(measuredHeight, maxHeight))
    );
    const left = Math.max(
      PAGE_MENU_MARGIN,
      Math.min(triggerRect.right - width, viewportWidth - PAGE_MENU_MARGIN - width)
    );

    setPosition({ left, top, width, maxHeight, ready: true });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    placeMenu();
    const frame = window.requestAnimationFrame(() => {
      placeMenu();
      const items = getEnabledMenuItems(menuRef.current);
      (initialFocusRef.current === "last" ? items.at(-1) : items[0])?.focus();
    });
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open, placeMenu]);

  useEffect(() => {
    setOpen(false);
  }, [menu?.key, menu?.scopeKey, routeKey]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    }
    function handleFocusIn(event: FocusEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [close, open]);

  if (!menu) return null;

  const menuStyle: CSSProperties = {
    left: position.left,
    top: position.top,
    width: position.width,
    maxHeight: position.maxHeight,
    visibility: position.ready ? "visible" : "hidden"
  };

  return (
    <div className={`project-page-actions ${className}`.trim()} data-project-page-actions>
      <button
        ref={setTriggerRef}
        type="button"
        className="project-page-actions__trigger no-print"
        aria-label={`${menu.ariaLabel} ${open ? "닫기" : "열기"}`}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => {
          initialFocusRef.current = "first";
          setPosition((current) => ({ ...current, ready: false }));
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          initialFocusRef.current = event.key === "ArrowUp" ? "last" : "first";
          setPosition((current) => ({ ...current, ready: false }));
          setOpen(true);
        }}
      >
        <MoreHorizontal aria-hidden />
      </button>

      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={menu.ariaLabel}
          className="project-page-actions__menu ui-motion-menu no-print"
          style={menuStyle}
          data-project-shell-portal
          onKeyDown={(event) => handleMenuKeyDown(event, close)}
        >
          <p className="project-page-actions__title">{menu.title}</p>
          <PageActionGroups menu={menu} onClose={close} triggerRef={triggerRef} />
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function PageActionGroups({
  menu,
  onClose,
  triggerRef
}: {
  menu: ResolvedProjectPageActionMenu;
  onClose: (restoreFocus?: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const primaryActions = menu.actions.filter((action) => !action.group);
  const groups = groupActions(menu.actions);
  return (
    <div className="project-page-actions__items">
      {primaryActions.map((action) => (
        <PageActionItem
          key={action.id}
          action={action}
          onClose={onClose}
          triggerRef={triggerRef}
        />
      ))}
      {groups.map((group) => (
        <div key={group.key} role="group" aria-label={ACTION_GROUP_LABELS[group.key]} className="project-page-actions__group">
          <p className="project-page-actions__group-label">{ACTION_GROUP_LABELS[group.key]}</p>
          {group.actions.map((action) => (
            <PageActionItem
              key={action.id}
              action={action}
              onClose={onClose}
              triggerRef={triggerRef}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function PageActionItem({
  action,
  onClose,
  triggerRef
}: {
  action: ResolvedProjectPageAction;
  onClose: (restoreFocus?: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const Icon = action.icon;
  const { requestGuide } = useContextualGuide();
  const guideId = action.id === "dailyPlanPdf" || action.id === "dailyPlanPortraitPdf"
    ? "daily-plan.pdf"
    : action.id.startsWith("scenario")
      ? "scenario.actions"
      : null;
  const showFeatureGuide = (anchor: HTMLElement) => {
    if (guideId) requestGuide(guideId, "feature", anchor);
  };
  const className = `project-page-actions__item${action.tone === "danger" ? " project-page-actions__item--danger" : ""}`;
  const content = (
    <>
      {action.pending
        ? <LoaderCircle className="project-page-actions__icon animate-spin motion-reduce:animate-none" aria-hidden />
        : <Icon className="project-page-actions__icon" aria-hidden />}
      <span>{action.label}</span>
    </>
  );

  const runGuideAfterClose = () => {
    if (!guideId) return;
    window.setTimeout(() => {
      const anchor = triggerRef.current;
      if (anchor) requestGuide(guideId, "feature", anchor);
    }, 0);
  };

  if (action.href && !action.disabled) {
    return (
      <Link
        href={action.href}
        role="menuitem"
        data-project-action-id={action.id}
        data-emphasis={action.emphasis}
        className={className}
        aria-current={action.active ? "page" : undefined}
        onPointerEnter={(event) => showFeatureGuide(event.currentTarget)}
        onFocus={(event) => showFeatureGuide(event.currentTarget)}
        onClick={(event) => {
          if (!confirmUnsavedChangesNavigation()) {
            event.preventDefault();
            return;
          }
          onClose();
          runGuideAfterClose();
        }}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      data-project-action-id={action.id}
      data-emphasis={action.emphasis}
      className={className}
      disabled={action.disabled}
      aria-busy={action.pending || undefined}
      aria-current={action.active ? "true" : undefined}
      onPointerEnter={(event) => showFeatureGuide(event.currentTarget)}
      onFocus={(event) => showFeatureGuide(event.currentTarget)}
      onClick={() => {
        if (action.disabled) return;
        const actionElement = document.activeElement;
        action.onSelect?.();
        onClose();
        window.requestAnimationFrame(() => {
          const activeElement = document.activeElement;
          if (
            activeElement === document.body
            || activeElement === actionElement
            || !activeElement?.isConnected
          ) {
            triggerRef.current?.focus();
          }
        });
        runGuideAfterClose();
      }}
    >
      {content}
    </button>
  );
}

function handleMenuKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  close: (restoreFocus?: boolean) => void
) {
  if (event.key === "Escape") {
    event.preventDefault();
    close(true);
    return;
  }
  if (event.key === "Tab") {
    window.setTimeout(() => close(), 0);
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = getEnabledMenuItems(event.currentTarget);
  if (items.length === 0) return;
  const currentIndex = items.findIndex((item) => item === document.activeElement);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : event.key === "ArrowDown"
        ? (currentIndex + 1 + items.length) % items.length
        : (currentIndex - 1 + items.length) % items.length;
  items[nextIndex]?.focus();
}

function getEnabledMenuItems(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
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
    if (currentGroup) currentGroup.actions.push(action);
    else groups.push({ key: action.group, actions: [action] });
  }
  return groups;
}

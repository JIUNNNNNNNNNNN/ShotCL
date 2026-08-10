"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  Copy,
  FilePenLine,
  House,
  Images,
  LayoutDashboard,
  ListChecks,
  Plus,
  Shirt,
  Table2,
  Trash2,
  Users,
  type LucideIcon
} from "lucide-react";
import {
  ProjectNavigationCardGrid,
  type ProjectNavigationCardItem
} from "@/components/ProjectNavigationCardGrid";
import { ProjectKeyStaffUpgrade } from "@/components/ProjectKeyStaffUpgrade";
import {
  ContextualGuideHelpButton,
  useContextualGuide,
  useContextualGuideAnchor
} from "@/components/guides/ContextualGuideProvider";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import { confirmUnsavedChangesNavigation } from "@/hooks/useUnsavedChangesGuard";
import { deleteDailyPlan, duplicateDailyPlan } from "@/lib/data/dailyPlans";
import { compareDailyPlanEpisodes, formatDailyPlanEpisodeLabel } from "@/lib/dailyPlan/carouselPresentation";
import { formatDailyPlanCardDate } from "@/lib/dailyPlan/dateOnly";
import {
  buildDailyPlanRoundHref,
  buildNewDailyPlanHref,
  buildProgressRoundHref,
  buildProjectBasePath,
  buildProjectNavigationHref,
  getVisibleProjectNavigationItems,
  isDailyPlanRoundActive,
  isProgressRoundActive,
  resolveActiveProjectNavigationItem,
  type ProjectNavigationItemId
} from "@/lib/projectNavigation";
import type { DailyPlan } from "@/lib/types";

export { getProjectPageTitle } from "@/lib/projectNavigation";

type ProjectNavigationProps = {
  onNavigate?: (href: string) => void;
  onGuideReplay?: () => void;
  drawer?: boolean;
};

type PlanContextMenu = {
  plan: DailyPlan;
  x: number;
  y: number;
};

type PendingDelete = {
  plan: DailyPlan;
  label: string;
};

const NAVIGATION_ICONS: Record<ProjectNavigationItemId, LucideIcon> = {
  basicInfo: FilePenLine,
  dailyPlans: CalendarDays,
  progress: ListChecks,
  sceneList: Table2,
  staffList: Users,
  scenario: BookOpen,
  costumes: Shirt,
  storyboardOverhead: Images
};

const LONG_PRESS_MS = 600;
const CONTEXT_MENU_WIDTH = 224;
const CONTEXT_MENU_HEIGHT = 92;
const CONTEXT_MENU_EDGE = 8;

/** 프로젝트의 공통 기능과 회차를 데스크톱 고정 패널·모바일 drawer에서 함께 사용합니다. */
export function ProjectNavigation({ onNavigate, onGuideReplay, drawer = false }: ProjectNavigationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { role } = useProjectAccess();
  const {
    project,
    projectId,
    projectName,
    dailyPlans,
    isLoading,
    error,
    upsertDailyPlan,
    removeDailyPlan
  } = useProjectWorkspace();
  const [contextMenu, setContextMenu] = useState<PlanContextMenu | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [mutationError, setMutationError] = useState("");
  const [duplicatingId, setDuplicatingId] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<"dailyPlans" | "progress", boolean>>({
    dailyPlans: false,
    progress: false
  });
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const duplicateLockRef = useRef("");
  const { requestGuide } = useContextualGuide();
  const dailyPlansGuideRef = useContextualGuideAnchor<HTMLDivElement>("shell.navigation.daily-plans");
  const collapseExpandableNavigation = useCallback(() => {
    setExpandedGroups((current) => current.dailyPlans || current.progress
      ? { dailyPlans: false, progress: false }
      : current);
  }, []);
  const visibleItems = useMemo(() => getVisibleProjectNavigationItems(role), [role]);
  const sortedPlans = useMemo(() => [...dailyPlans].sort(compareDailyPlanEpisodes), [dailyPlans]);
  const activeItem = resolveActiveProjectNavigationItem(pathname, searchParams, projectId);
  // ProjectAccessGate의 project-scoped role이 승격 직후에도 canonical source입니다.
  const canManageDailyPlans = (role ?? project?.accessRole) !== "progress";
  const instanceId = drawer ? "drawer" : "panel";
  const projectHomeHref = buildProjectBasePath(projectId);
  const navigationRouteKey = `${pathname}?view=${searchParams.get("view") ?? ""}&dailyPlanId=${searchParams.get("dailyPlanId") ?? ""}`;
  const cardItems = useMemo<ProjectNavigationCardItem[]>(() => [
    {
      id: "projectHome",
      label: "Home",
      href: projectHomeHref,
      icon: LayoutDashboard,
      active: activeItem === null && pathname.replace(/\/$/u, "") === projectHomeHref,
      roundKind: null,
      expanded: false
    },
    ...visibleItems.map((item) => {
      const roundKind = item.id === "dailyPlans" || item.id === "progress" ? item.id : null;
      return {
        id: item.id,
        label: item.label,
        href: buildProjectNavigationHref(projectId, item.id),
        icon: NAVIGATION_ICONS[item.id],
        active: activeItem === item.id,
        roundKind,
        expanded: roundKind ? expandedGroups[roundKind] : false
      };
    })
  ], [activeItem, expandedGroups, pathname, projectHomeHref, projectId, visibleItems]);

  useLayoutEffect(() => {
    collapseExpandableNavigation();
  }, [collapseExpandableNavigation, navigationRouteKey, projectId]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      contextMenuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    });
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      closeContextMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };
    const closeOnViewportChange = () => closeContextMenu();
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [closeContextMenu, contextMenu]);

  useEffect(() => {
    if (!pendingDelete) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isDeleting) return;
      setPendingDelete(null);
      setMutationError("");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isDeleting, pendingDelete]);

  const notifyNavigation = useCallback((href: string) => {
    collapseExpandableNavigation();
    onNavigate?.(href);
  }, [collapseExpandableNavigation, onNavigate]);

  function guardLinkNavigation(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!confirmUnsavedChangesNavigation()) {
      event.preventDefault();
      return;
    }
    notifyNavigation(href);
  }

  function openContextMenu(plan: DailyPlan, clientX: number, clientY: number) {
    if (!canManageDailyPlans || duplicateLockRef.current || isDeleting || pendingDelete) return;
    const maxX = Math.max(CONTEXT_MENU_EDGE, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_EDGE);
    const maxY = Math.max(CONTEXT_MENU_EDGE, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_EDGE);
    setMutationError("");
    setContextMenu({
      plan,
      x: Math.min(Math.max(CONTEXT_MENU_EDGE, clientX), maxX),
      y: Math.min(Math.max(CONTEXT_MENU_EDGE, clientY), maxY)
    });
  }

  async function handleDuplicate(plan: DailyPlan) {
    if (!canManageDailyPlans || duplicateLockRef.current || isDeleting) return;
    duplicateLockRef.current = plan.id;
    setDuplicatingId(plan.id);
    closeContextMenu();
    setMutationError("");
    try {
      const duplicated = await duplicateDailyPlan(projectId, plan.id);
      upsertDailyPlan(duplicated.plan, { shotCount: duplicated.shots.length });
    } catch (error) {
      setMutationError(getErrorMessage(error, "일촬표를 복사하지 못했습니다."));
    } finally {
      if (duplicateLockRef.current === plan.id) duplicateLockRef.current = "";
      setDuplicatingId("");
    }
  }

  function requestDelete(plan: DailyPlan) {
    if (!canManageDailyPlans || duplicateLockRef.current || isDeleting) return;
    closeContextMenu();
    setMutationError("");
    setPendingDelete({ plan, label: formatDailyPlanEpisodeLabel(plan.episode) });
  }

  async function confirmDelete() {
    const target = pendingDelete?.plan;
    if (!target || !canManageDailyPlans || duplicateLockRef.current || isDeleting) return;
    const safeHref = getSafeSelectionHrefAfterDelete(pathname, searchParams, projectId, target.id);
    if (safeHref && !confirmUnsavedChangesNavigation()) return;
    setIsDeleting(true);
    setMutationError("");
    try {
      await deleteDailyPlan(projectId, target.id);
      removeDailyPlan(target.id);
      setPendingDelete(null);
      if (safeHref) {
        notifyNavigation(safeHref);
        router.replace(safeHref);
      }
    } catch (error) {
      setMutationError(getErrorMessage(error, "일촬표를 삭제하지 못했습니다."));
    } finally {
      setIsDeleting(false);
    }
  }

  function renderRoundContent(kind: "dailyPlans" | "progress") {
    return (
      <section
        className="project-navigation__round-section"
        aria-label={`${kind === "dailyPlans" ? "일촬표" : "진행도"} 회차 목록`}
      >
        <p className="project-navigation__round-heading">
          {kind === "dailyPlans" ? "일촬표 회차" : "진행도 회차"}
        </p>
        <RoundNavigationList
          kind={kind}
          projectId={projectId}
          plans={sortedPlans}
          pathname={pathname}
          searchParams={searchParams}
          canManage={canManageDailyPlans}
          isBusy={Boolean(duplicatingId) || isDeleting}
          onNavigate={notifyNavigation}
          onOpenContextMenu={openContextMenu}
        />
      </section>
    );
  }

  return (
    <>
      <nav
        aria-label="프로젝트 기능"
        className={`project-navigation min-h-0 min-w-0 ${drawer ? "flex-1" : "h-full"}`}
      >
        <div className="project-navigation__top-toolbar">
          <Link
            href="/"
            onClick={(event) => guardLinkNavigation(event, "/")}
            aria-label="Main"
            title="Main"
            className="project-navigation__home"
          >
            <House className="h-4 w-4 shrink-0" aria-hidden />
            <span>Main</span>
          </Link>
          <ContextualGuideHelpButton onBeforeReplay={onGuideReplay} />
        </div>

        <div className="project-navigation__project-summary text-center">
          <p className="break-words text-sm font-black leading-5 text-field-text [overflow-wrap:anywhere]" title={projectName}>
            {projectName}
          </p>
          {isLoading ? <p className="mt-1 text-[11px] text-field-muted">회차 불러오는 중</p> : null}
          {error ? <p className="mt-1 text-[11px] leading-4 text-field-danger">{getErrorMessage(error, "프로젝트 메뉴를 불러오지 못했습니다.")}</p> : null}
        </div>

        <div className="project-navigation__menu-scroll">
          <ProjectNavigationCardGrid
            items={cardItems}
            instanceId={instanceId}
            onLinkClick={guardLinkNavigation}
            onToggleRounds={(kind) => setExpandedGroups((current) => ({
              ...current,
              [kind]: !current[kind]
            }))}
            renderRoundContent={renderRoundContent}
            dailyPlansGuideRef={dailyPlansGuideRef}
            onDailyPlansGuide={(anchor) => requestGuide("daily-plan.round-select", "feature", anchor)}
          />

          {mutationError && !pendingDelete ? (
            <p role="alert" className="mt-3 border border-field-danger/60 bg-field-danger/10 px-2 py-1.5 text-[11px] font-bold leading-4 text-field-danger">
              {mutationError}
            </p>
          ) : null}
        </div>

        <ProjectKeyStaffUpgrade projectId={projectId} />
      </nav>

      {contextMenu && typeof document !== "undefined" ? createPortal(
        <PlanContextMenu
          menu={contextMenu}
          menuRef={contextMenuRef}
          disabled={Boolean(duplicatingId) || isDeleting}
          onDuplicate={() => void handleDuplicate(contextMenu.plan)}
          onDelete={() => requestDelete(contextMenu.plan)}
        />,
        document.body
      ) : null}

      {pendingDelete && typeof document !== "undefined" ? createPortal(
        <DeleteConfirmation
          pending={pendingDelete}
          error={mutationError}
          isDeleting={isDeleting}
          onCancel={() => {
            if (isDeleting) return;
            setPendingDelete(null);
            setMutationError("");
          }}
          onConfirm={() => void confirmDelete()}
        />,
        document.body
      ) : null}
    </>
  );
}

function RoundNavigationList({
  kind,
  projectId,
  plans,
  pathname,
  searchParams,
  canManage,
  isBusy,
  onNavigate,
  onOpenContextMenu
}: {
  kind: "dailyPlans" | "progress";
  projectId: string;
  plans: DailyPlan[];
  pathname: string;
  searchParams: Pick<URLSearchParams, "get">;
  canManage: boolean;
  isBusy: boolean;
  onNavigate: (href: string) => void;
  onOpenContextMenu: (plan: DailyPlan, clientX: number, clientY: number) => void;
}) {
  return (
    <ul className="project-navigation__round-list" aria-label={`${kind === "dailyPlans" ? "일촬표" : "진행도"} 회차`}>
      {kind === "dailyPlans" && canManage ? (
        <li>
          <NavigationLink href={buildNewDailyPlanHref(projectId)} onNavigate={onNavigate} className="text-field-primary">
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>새 일촬표</span>
          </NavigationLink>
        </li>
      ) : null}

      {plans.map((plan, index) => {
        const href = kind === "dailyPlans"
          ? buildDailyPlanRoundHref(projectId, plan.id)
          : buildProgressRoundHref(projectId, plan.id);
        const active = kind === "dailyPlans"
          ? isDailyPlanRoundActive(pathname, plan.id)
          : isProgressRoundActive(searchParams, plan.id);
        return (
          <li key={plan.id} className="min-w-0">
            <RoundNavigationLink
              plan={plan}
              href={href}
              active={active}
              contextMenuEnabled={kind === "dailyPlans" && canManage && !isBusy}
              guideAnchor={index === 0}
              onNavigate={onNavigate}
              onOpenContextMenu={onOpenContextMenu}
            />
          </li>
        );
      })}

      {!isBusy && plans.length === 0 ? (
        <li className="px-2 py-1.5 text-[11px] text-field-muted">저장된 회차 없음</li>
      ) : null}
    </ul>
  );
}

function NavigationLink({
  href,
  onNavigate,
  className = "",
  children
}: {
  href: string;
  onNavigate: (href: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={(event) => {
        if (!confirmUnsavedChangesNavigation()) {
          event.preventDefault();
          return;
        }
        onNavigate(href);
      }}
      className={`project-navigation__round-link flex min-w-0 items-center gap-1.5 rounded-[var(--ui-radius-control)] border border-transparent text-xs font-semibold hover:border-field-border hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary ${className}`}
    >
      {children}
    </Link>
  );
}

function RoundNavigationLink({
  plan,
  href,
  active,
  contextMenuEnabled,
  guideAnchor,
  onNavigate,
  onOpenContextMenu
}: {
  plan: DailyPlan;
  href: string;
  active: boolean;
  contextMenuEnabled: boolean;
  guideAnchor: boolean;
  onNavigate: (href: string) => void;
  onOpenContextMenu: (plan: DailyPlan, clientX: number, clientY: number) => void;
}) {
  const interactionGuideAnchorRef = useContextualGuideAnchor<HTMLAnchorElement>(
    contextMenuEnabled && guideAnchor ? "daily-plan.round-card" : null
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerRef = useRef<{
    id: number;
    x: number;
    y: number;
    target: HTMLAnchorElement;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const pointer = pointerRef.current;
    if (pointer?.target.hasPointerCapture(pointer.id)) {
      try {
        pointer.target.releasePointerCapture(pointer.id);
      } catch {
        // 브라우저가 먼저 capture를 해제한 경우에도 timer 상태는 정리합니다.
      }
    }
    timerRef.current = null;
    pointerRef.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  function beginLongPress(event: ReactPointerEvent<HTMLAnchorElement>) {
    if (!contextMenuEnabled || event.pointerType === "mouse") return;
    cancelLongPress();
    suppressClickRef.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // capture 미지원 환경에서는 동일한 timer 취소 흐름을 사용합니다.
    }
    pointerRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target: event.currentTarget
    };
    timerRef.current = setTimeout(() => {
      const pointer = pointerRef.current;
      if (!pointer) return;
      timerRef.current = null;
      suppressClickRef.current = true;
      onOpenContextMenu(plan, pointer.x, pointer.y);
    }, LONG_PRESS_MS);
  }

  return (
    <Link
      ref={interactionGuideAnchorRef}
      href={href}
      draggable={false}
      aria-current={active ? "page" : undefined}
      aria-label={`${formatDailyPlanEpisodeLabel(plan.episode)}, 촬영일 ${formatDailyPlanCardDate(plan.shootingDate)}`}
      onClick={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          suppressClickRef.current = false;
          return;
        }
        if (!confirmUnsavedChangesNavigation()) {
          event.preventDefault();
          return;
        }
        onNavigate(href);
      }}
      onContextMenu={(event) => {
        if (!contextMenuEnabled) return;
        event.preventDefault();
        onOpenContextMenu(plan, event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (!contextMenuEnabled || !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpenContextMenu(plan, rect.left + Math.min(rect.width, 24), rect.top + rect.height / 2);
      }}
      onPointerDown={beginLongPress}
      onPointerMove={(event) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 12) cancelLongPress();
      }}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onDragStart={(event) => event.preventDefault()}
      className={`project-navigation__round-link block min-w-0 select-none rounded-[var(--ui-radius-control)] border text-xs transition-colors [touch-action:pan-y] [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary ${
        active ? "border-field-primary bg-field-primary-soft text-field-primary" : "border-transparent text-field-muted hover:border-field-border hover:bg-field-hover hover:text-field-text"
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 break-words font-bold leading-4 [overflow-wrap:anywhere]">{formatDailyPlanEpisodeLabel(plan.episode)}</span>
        <span className="shrink-0 text-[10px] tabular-nums opacity-75">{formatDailyPlanCardDate(plan.shootingDate)}</span>
      </span>
    </Link>
  );
}

function PlanContextMenu({
  menu,
  menuRef,
  disabled,
  onDuplicate,
  onDelete
}: {
  menu: PlanContextMenu;
  menuRef: RefObject<HTMLDivElement | null>;
  disabled: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      ref={menuRef}
      data-project-shell-portal
      role="menu"
      aria-label={`${formatDailyPlanEpisodeLabel(menu.plan.episode)} 일촬표 메뉴`}
      className="ui-motion-menu fixed z-[100] grid w-56 gap-1 rounded-[var(--radius-menu)] border border-field-divider bg-field-elevated p-1.5 text-field-text shadow-floating"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" disabled={disabled} onClick={onDuplicate} className="flex min-h-9 items-center justify-center gap-2 rounded-[var(--radius-control)] px-2.5 text-center text-xs font-bold hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:opacity-50">
        <Copy className="h-3.5 w-3.5" aria-hidden />
        복사해서 새 일촬표 만들기
      </button>
      <button type="button" role="menuitem" disabled={disabled} onClick={onDelete} className="flex min-h-9 items-center justify-center gap-2 rounded-[var(--radius-control)] px-2.5 text-center text-xs font-bold text-field-danger hover:bg-field-danger hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-danger disabled:opacity-50">
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        삭제
      </button>
    </div>
  );
}

function DeleteConfirmation({
  pending,
  error,
  isDeleting,
  onCancel,
  onConfirm
}: {
  pending: PendingDelete;
  error: string;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div data-project-shell-portal className="fixed inset-0 z-[110] grid place-items-center bg-black/70 p-4" role="presentation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="project-nav-delete-title"
        aria-describedby="project-nav-delete-description"
        aria-busy={isDeleting}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto border border-field-divider bg-field-elevated p-4 shadow-dialog"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
          if (buttons.length === 0) return;
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 id="project-nav-delete-title" className="text-base font-black text-field-text">일촬표 삭제</h2>
        <div id="project-nav-delete-description" className="mt-2 space-y-1 text-sm leading-6 text-field-text">
          <p><strong>{pending.label}</strong> 일촬표를 삭제하시겠습니까?</p>
          <p className="text-field-muted">삭제한 일촬표는 복구할 수 없습니다.</p>
        </div>
        {error ? <p role="alert" className="mt-3 border border-field-danger bg-field-danger/10 px-3 py-2 text-sm font-bold text-field-danger">{error}</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" autoFocus disabled={isDeleting} onClick={onCancel} className="min-h-10 border border-field-divider bg-field-panel px-3 py-2 text-sm font-bold text-field-text hover:bg-field-hover disabled:opacity-50">취소</button>
          <button type="button" disabled={isDeleting} onClick={onConfirm} className="min-h-10 border border-field-danger bg-field-danger px-3 py-2 text-sm font-black text-field-text hover:brightness-95 disabled:opacity-50">{isDeleting ? "삭제 중" : "삭제"}</button>
        </div>
      </div>
    </div>
  );
}

function getSafeSelectionHrefAfterDelete(
  pathname: string,
  searchParams: Pick<URLSearchParams, "get">,
  projectId: string,
  dailyPlanId: string
) {
  if (isDailyPlanRoundActive(pathname, dailyPlanId)) {
    return buildProjectNavigationHref(projectId, "dailyPlans");
  }
  if (isProgressRoundActive(searchParams, dailyPlanId)) {
    return buildProjectNavigationHref(projectId, "progress");
  }
  return "";
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

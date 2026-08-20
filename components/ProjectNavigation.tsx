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
import { ProjectAccountUtility } from "@/components/ProjectAccountUtility";
import { GuestAccountSaveCta } from "@/components/GuestAccountSaveCta";
import {
  ContextualGuideHelpButton,
  useContextualGuide,
  useContextualGuideAnchor
} from "@/components/guides/ContextualGuideProvider";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { useProjectDeleteUndo } from "@/components/ProjectDeleteUndoProvider";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import { confirmUnsavedChangesNavigation } from "@/hooks/useUnsavedChangesGuard";
import {
  deleteDailyPlan,
  duplicateDailyPlan,
  finalizeDeletedDailyPlan,
  restoreDeletedDailyPlan,
  type DailyPlanListItem,
  type DeletedDailyPlanMutation
} from "@/lib/data/dailyPlans";
import { compareDailyPlanEpisodes, formatDailyPlanEpisodeLabel } from "@/lib/dailyPlan/carouselPresentation";
import { formatDailyPlanCardDate } from "@/lib/dailyPlan/dateOnly";
import { getKoreaDateOnly } from "@/lib/koreaDate";
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
import { createDailyProgressCompletion } from "@/lib/progress/dailyProgress";
import { resolveRelevantProgressRound } from "@/lib/progress/resolveRelevantRound";
import type { DailyPlan } from "@/lib/types";
import type { ProjectJoinNotice } from "@/lib/projectAccess/joinNotice.client";

export { getProjectPageTitle } from "@/lib/projectNavigation";

type ProjectNavigationProps = {
  onNavigate?: (href: string) => void;
  onGuideReplay?: () => void;
  drawer?: boolean;
  joinNotice?: ProjectJoinNotice | null;
  onDismissJoinNotice?: () => void;
};

type PlanContextMenu = {
  plan: DailyPlan;
  x: number;
  y: number;
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
export function ProjectNavigation({
  onNavigate,
  onGuideReplay,
  drawer = false,
  joinNotice = null,
  onDismissJoinNotice
}: ProjectNavigationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { role, isGuest } = useProjectAccess();
  const {
    project,
    projectId,
    projectName,
    dailyPlans,
    initialProgress,
    isLoading,
    error,
    upsertDailyPlan,
    removeDailyPlan
  } = useProjectWorkspace();
  const { deleteWithUndo } = useProjectDeleteUndo();
  const [contextMenu, setContextMenu] = useState<PlanContextMenu | null>(null);
  const [mutationError, setMutationError] = useState("");
  const [duplicatingId, setDuplicatingId] = useState("");
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
  const canManageDailyPlans = !isGuest && (role ?? project?.accessRole) !== "progress";
  const instanceId = drawer ? "drawer" : "panel";
  const projectHomeHref = buildProjectBasePath(projectId);
  const navigationRouteKey = `${pathname}?view=${searchParams.get("view") ?? ""}&dailyPlanId=${searchParams.get("dailyPlanId") ?? ""}`;
  const search = searchParams.toString();
  const accountReturnTo = `${pathname}${search ? `?${search}` : ""}`;
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
    if (!canManageDailyPlans || duplicateLockRef.current) return;
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
    if (!canManageDailyPlans || duplicateLockRef.current) return;
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
    if (!canManageDailyPlans || duplicateLockRef.current) return;
    closeContextMenu();
    setMutationError("");
    const target = dailyPlans.find((item) => item.id === plan.id);
    if (!target) return;
    const safeHref = getSafeSelectionHrefAfterDelete(pathname, searchParams, projectId, target.id);
    let mutation: DeletedDailyPlanMutation | null = null;
    deleteWithUndo({
      key: `daily-plan:${target.id}`,
      label: `${formatDailyPlanEpisodeLabel(target.episode)} 일촬표`,
      removeLocal: () => {
        removeDailyPlan(target.id);
        if (safeHref) {
          notifyNavigation(safeHref);
          router.replace(safeHref);
        }
      },
      restoreLocal: () => upsertDailyPlan(target, {
        shotCount: target.shotCount,
        progressTotal: target.progressTotal,
        progressCompleted: target.progressCompleted,
        sceneNumbers: target.sceneNumbers
      }),
      deleteRemote: async () => {
        try {
          mutation = await deleteDailyPlan(projectId, target.id);
        } catch (error) {
          setMutationError(getErrorMessage(error, "일촬표를 삭제하지 못했습니다."));
          throw error;
        }
      },
      restoreRemote: async () => {
        try {
          await restoreDeletedDailyPlan(projectId, target.id, mutation);
        } catch (error) {
          setMutationError(getErrorMessage(error, "일촬표를 복원하지 못했습니다."));
          throw error;
        }
      },
      finalize: () => finalizeDeletedDailyPlan(projectId, target.id, mutation)
    });
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
          isBusy={Boolean(duplicatingId)}
          onNavigate={notifyNavigation}
          onOpenContextMenu={openContextMenu}
        />
      </section>
    );
  }

  if (isGuest) {
    return (
      <GuestProjectNavigation
        drawer={drawer}
        projectId={projectId}
        projectName={projectName}
        plans={sortedPlans}
        initialProgressDailyPlanId={initialProgress?.dailyPlanId ?? ""}
        pathname={pathname}
        searchParams={searchParams}
        isLoading={isLoading}
        error={error}
        onNavigate={notifyNavigation}
      />
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

          {mutationError ? (
            <p role="alert" className="mt-3 border border-field-danger/60 bg-field-danger/10 px-2 py-1.5 text-[11px] font-bold leading-4 text-field-danger">
              {mutationError}
            </p>
          ) : null}
        </div>

        <ProjectAccountUtility
          projectId={projectId}
          returnTo={accountReturnTo}
          joinNotice={joinNotice}
          onDismissJoinNotice={onDismissJoinNotice}
        />
      </nav>

      {contextMenu && typeof document !== "undefined" ? createPortal(
        <PlanContextMenu
          menu={contextMenu}
          menuRef={contextMenuRef}
          disabled={Boolean(duplicatingId)}
          onDuplicate={() => void handleDuplicate(contextMenu.plan)}
          onDelete={() => requestDelete(contextMenu.plan)}
        />,
        document.body
      ) : null}

    </>
  );
}

function GuestProjectNavigation({
  drawer,
  projectId,
  projectName,
  plans,
  initialProgressDailyPlanId,
  pathname,
  searchParams,
  isLoading,
  error,
  onNavigate
}: {
  drawer: boolean;
  projectId: string;
  projectName: string;
  plans: DailyPlanListItem[];
  initialProgressDailyPlanId: string;
  pathname: string;
  searchParams: Pick<URLSearchParams, "get" | "toString">;
  isLoading: boolean;
  error: string;
  onNavigate: (href: string) => void;
}) {
  const requestedProgressPlanId = searchParams.get("dailyPlanId")?.trim() ?? "";
  const activeDailyPlanId = plans.find((plan) => isDailyPlanRoundActive(pathname, plan.id))?.id ?? "";
  const lastGuestRoundIdRef = useRef("");
  const explicitDailyPlanId = plans.some((plan) => plan.id === requestedProgressPlanId)
    ? requestedProgressPlanId
    : activeDailyPlanId;
  if (explicitDailyPlanId) lastGuestRoundIdRef.current = explicitDailyPlanId;
  const rememberedDailyPlanId = plans.some((plan) => plan.id === lastGuestRoundIdRef.current)
    ? lastGuestRoundIdRef.current
    : "";
  const seededDailyPlanId = plans.some((plan) => plan.id === initialProgressDailyPlanId)
    ? initialProgressDailyPlanId
    : "";
  const contextualDailyPlanId = explicitDailyPlanId || rememberedDailyPlanId || seededDailyPlanId;
  const todayKorea = getKoreaDateOnly();
  const relevantRound = !contextualDailyPlanId && todayKorea
    ? resolveRelevantProgressRound(plans.map((plan) => ({
        id: plan.id,
        shootingDate: plan.shootingDate,
        episode: plan.episode,
        progress: createDailyProgressCompletion(plan.progressTotal, plan.progressCompleted)
      })), todayKorea)
    : null;
  const selectedDailyPlanId = contextualDailyPlanId
    || (relevantRound?.status === "resolved" ? relevantRound.round.id : "");
  const progressHref = selectedDailyPlanId
    ? buildProgressRoundHref(projectId, selectedDailyPlanId)
    : buildProjectNavigationHref(projectId, "progress");
  const dailyPlansHref = selectedDailyPlanId
    ? buildDailyPlanRoundHref(projectId, selectedDailyPlanId)
    : buildProjectNavigationHref(projectId, "dailyPlans");
  const scenarioHref = buildProjectNavigationHref(projectId, "scenario");
  const currentSearch = searchParams.toString();
  const accountReturnTo = `${pathname}${currentSearch ? `?${currentSearch}` : ""}`;
  const progressActive = resolveActiveProjectNavigationItem(pathname, searchParams, projectId) === "progress";
  const dailyPlansActive = resolveActiveProjectNavigationItem(pathname, searchParams, projectId) === "dailyPlans";
  const scenarioActive = pathname.replace(/\/$/u, "") === scenarioHref;

  return (
    <nav
      aria-label="게스트 프로젝트 메뉴"
      className={`project-navigation flex min-h-0 min-w-0 flex-col ${drawer ? "flex-1" : "h-full"}`}
    >
      <div className="project-navigation__project-summary text-center">
        <p className="break-words text-sm font-black leading-5 text-field-text [overflow-wrap:anywhere]" title={projectName}>
          {projectName}
        </p>
        <p className="mt-1 text-[11px] font-bold leading-4 text-field-primary">
          진행도 OK·OMIT 가능 · 일촬표/시나리오 열람
        </p>
        {isLoading ? <p className="mt-1 text-[11px] text-field-muted">회차 불러오는 중</p> : null}
        {error ? <p className="mt-1 text-[11px] leading-4 text-field-danger">{getErrorMessage(error, "프로젝트를 불러오지 못했습니다.")}</p> : null}
      </div>

      <div className="project-navigation__menu-scroll grid content-start gap-2">
        <GuestNavigationLink
          href={progressHref}
          active={progressActive}
          icon={ListChecks}
          label="진행도"
          onNavigate={onNavigate}
        />
        <GuestNavigationLink
          href={dailyPlansHref}
          active={dailyPlansActive}
          icon={CalendarDays}
          label="일촬표"
          onNavigate={onNavigate}
        />
        {dailyPlansActive ? (
          <section className="project-navigation__round-section" aria-label="일촬표 회차 목록">
            <p className="project-navigation__round-heading">일촬표 회차</p>
            <RoundNavigationList
              kind="dailyPlans"
              projectId={projectId}
              plans={plans}
              pathname={pathname}
              searchParams={searchParams}
              canManage={false}
              isBusy={isLoading}
              prefetch={false}
              onNavigate={onNavigate}
              onOpenContextMenu={() => undefined}
            />
          </section>
        ) : null}
        <GuestNavigationLink
          href={scenarioHref}
          active={scenarioActive}
          icon={BookOpen}
          label="시나리오"
          onNavigate={onNavigate}
        />
      </div>

      <GuestAccountSaveCta nextPath={accountReturnTo} />
    </nav>
  );
}

function GuestNavigationLink({
  href,
  active,
  icon: Icon,
  label,
  onNavigate
}: {
  href: string;
  active: boolean;
  icon: LucideIcon;
  label: string;
  onNavigate: (href: string) => void;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      onClick={() => onNavigate(href)}
      className={`flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-control)] border px-3 py-2.5 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary ${
        active
          ? "border-field-primary bg-field-primary-soft text-field-primary"
          : "border-field-divider bg-field-panel text-field-text hover:border-field-subtle hover:bg-field-hover"
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </Link>
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
  prefetch = true,
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
  prefetch?: boolean;
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
              prefetch={prefetch}
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
  prefetch,
  contextMenuEnabled,
  guideAnchor,
  onNavigate,
  onOpenContextMenu
}: {
  plan: DailyPlan;
  href: string;
  active: boolean;
  prefetch: boolean;
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
      prefetch={prefetch}
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
      className={`project-navigation__round-link box-border flex min-w-0 items-center select-none rounded-[var(--ui-radius-control)] border text-xs transition-colors [touch-action:pan-y] [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary ${
        active ? "border-field-primary bg-field-primary-soft text-field-primary" : "border-transparent text-field-muted hover:border-field-border hover:bg-field-hover hover:text-field-text"
      }`}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
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

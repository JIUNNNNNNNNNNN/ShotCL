"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import {
  DailyPlanCoverflow,
  type DailyPlanCarouselItem
} from "@/components/DailyPlanCoverflow";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { Card } from "@/components/ui/Card";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { deleteDailyPlan, duplicateDailyPlan, listDailyPlans } from "@/lib/data/dailyPlans";
import { getProject } from "@/lib/data/projects";
import { compareDailyPlanEpisodes, formatDailyPlanEpisodeLabel } from "@/lib/dailyPlan/carouselPresentation";
import { formatDailyPlanCardDate, formatDailyPlanCardDateAria } from "@/lib/dailyPlan/dateOnly";
import type { DailyPlan, Project } from "@/lib/types";

type DailyPlanListItem = DailyPlan & { shotCount: number };

type PlanContextMenu = {
  plan: DailyPlanListItem;
  x: number;
  y: number;
};

type PendingDeleteItem = {
  dailyPlanId: string;
  episodeLabel: string;
};

const NEW_CARD_ID = "new-daily-plan";
const CONTEXT_MENU_WIDTH = 232;
const CONTEXT_MENU_HEIGHT = 92;
const CONTEXT_MENU_EDGE = 8;

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  const id = params.id;
  return Array.isArray(id) ? id[0] : id;
}

/** 프로젝트명과 회차 portrait 카드만 중앙에 보여주고 기존 생성·복사·삭제 흐름을 연결합니다. */
export default function DailyPlansPage() {
  const projectId = useProjectId();
  const router = useRouter();
  const { role } = useProjectAccess();
  const [project, setProject] = useState<Project | null>(null);
  const [plans, setPlans] = useState<DailyPlanListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [deleteErrorMessage, setDeleteErrorMessage] = useState("");
  const [contextMenu, setContextMenu] = useState<PlanContextMenu | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<PendingDeleteItem | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const navigationLockedRef = useRef(false);
  const navigationUnlockTimerRef = useRef<number | null>(null);
  const canManage = role !== "progress" && project?.accessRole !== "progress";

  const sortedPlans = useMemo(
    () => [...plans].sort(compareDailyPlanEpisodes),
    [plans]
  );
  const carouselItems = useMemo<DailyPlanCarouselItem[]>(() => [
    ...(canManage ? [{ id: NEW_CARD_ID, kind: "new" as const, label: "+" }] : []),
    ...sortedPlans.map((plan) => ({
      id: `daily-plan:${plan.id}`,
      kind: "plan" as const,
      label: formatDailyPlanEpisodeLabel(plan.episode),
      dateLabel: formatDailyPlanCardDate(plan.shootingDate),
      ariaLabel: `${formatDailyPlanEpisodeLabel(plan.episode)}, 촬영일 ${formatDailyPlanCardDateAria(plan.shootingDate)}`,
      planId: plan.id
    }))
  ], [canManage, sortedPlans]);

  const refresh = useCallback(async () => {
    if (!projectId) return;

    try {
      const [projectData, planData] = await Promise.all([
        getProject(projectId),
        listDailyPlans(projectId)
      ]);
      setProject(projectData);
      setPlans(projectData ? planData : []);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "저장된 일촬표 목록을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!contextMenu) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setContextMenu(null);
    }

    function closeOnViewportChange() {
      setContextMenu(null);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!pendingDeleteItem) return;

    function closeDeleteDialogOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || isDeleting) return;
      setPendingDeleteItem(null);
      setDeleteErrorMessage("");
    }

    window.addEventListener("keydown", closeDeleteDialogOnEscape);
    return () => window.removeEventListener("keydown", closeDeleteDialogOnEscape);
  }, [isDeleting, pendingDeleteItem]);

  useEffect(() => () => {
    if (navigationUnlockTimerRef.current !== null) {
      window.clearTimeout(navigationUnlockTimerRef.current);
    }
  }, []);

  function navigateOnce(path: string) {
    if (navigationLockedRef.current) return;
    navigationLockedRef.current = true;
    setErrorMessage("");
    try {
      router.push(path);
      navigationUnlockTimerRef.current = window.setTimeout(() => {
        navigationLockedRef.current = false;
        navigationUnlockTimerRef.current = null;
      }, 1_500);
    } catch (error) {
      navigationLockedRef.current = false;
      setErrorMessage(error instanceof Error ? error.message : "일촬표 화면으로 이동하지 못했습니다.");
    }
  }

  function handleActivateItem(item: DailyPlanCarouselItem) {
    if (!projectId || isDuplicating || pendingDeleteItem) return false;
    if (item.kind === "new") {
      navigateOnce(`/projects/${projectId}/daily-plans/new`);
      return true;
    }
    if (!item.planId) {
      setErrorMessage("열 일촬표 ID를 찾을 수 없습니다.");
      return false;
    }
    navigateOnce(`/projects/${projectId}/daily-plans/${item.planId}`);
    return true;
  }

  function openPlanContextMenu(item: DailyPlanCarouselItem, clientX: number, clientY: number) {
    if (
      item.kind !== "plan"
      || !item.planId
      || !canManage
      || isDuplicating
      || isDeleting
      || pendingDeleteItem
    ) return;
    const plan = sortedPlans.find((candidate) => candidate.id === item.planId);
    if (!plan) return;
    const maxX = Math.max(CONTEXT_MENU_EDGE, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_EDGE);
    const maxY = Math.max(CONTEXT_MENU_EDGE, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_EDGE);
    setContextMenu({
      plan,
      x: Math.min(Math.max(CONTEXT_MENU_EDGE, clientX), maxX),
      y: Math.min(Math.max(CONTEXT_MENU_EDGE, clientY), maxY)
    });
  }

  async function handleDuplicate(plan: DailyPlanListItem) {
    if (!projectId || isDuplicating || isDeleting || pendingDeleteItem || !canManage) return;
    setContextMenu(null);
    setIsDuplicating(true);
    setErrorMessage("");

    try {
      const duplicated = await duplicateDailyPlan(projectId, plan.id);
      const duplicatedItem: DailyPlanListItem = {
        ...duplicated.plan,
        shotCount: duplicated.shots.length
      };
      setPlans((current) => current.some((item) => item.id === duplicatedItem.id)
        ? current
        : [...current, duplicatedItem]
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "일촬표를 복사하지 못했습니다.");
    } finally {
      setIsDuplicating(false);
    }
  }

  function requestDelete(plan: DailyPlanListItem) {
    if (!projectId || isDuplicating || isDeleting || !canManage) return;
    setContextMenu(null);
    setDeleteErrorMessage("");
    setPendingDeleteItem({
      dailyPlanId: plan.id,
      episodeLabel: formatDailyPlanEpisodeLabel(plan.episode)
    });
  }

  function cancelDelete() {
    if (isDeleting) return;
    setPendingDeleteItem(null);
    setDeleteErrorMessage("");
  }

  async function confirmDelete() {
    const target = pendingDeleteItem;
    if (!projectId || !target || isDeleting || !canManage) return;
    setIsDeleting(true);
    setDeleteErrorMessage("");

    try {
      await deleteDailyPlan(projectId, target.dailyPlanId);
      setPlans((current) => current.filter((item) => item.id !== target.dailyPlanId));
      setPendingDeleteItem(null);
    } catch (error) {
      setDeleteErrorMessage(error instanceof Error ? error.message : "일촬표를 삭제하지 못했습니다.");
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) return <PixelDogLoader />;

  if (!project) {
    return <Card className="border-field-danger font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</Card>;
  }

  return (
    <section
      className="flex min-h-[calc(100dvh-8rem)] min-w-0 select-none items-start justify-center overflow-x-clip px-0 py-4 md:py-7"
      aria-labelledby="daily-plan-project-title"
    >
      <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col items-center justify-start">
        <h1
          id="daily-plan-project-title"
          className="max-w-full truncate px-3 text-center text-xl font-black leading-[1.35] text-field-primary md:text-2xl"
          title={project.name}
        >
          {project.name}
        </h1>

        {errorMessage ? (
          <p role="alert" className="mx-auto mt-2 w-full max-w-xl border border-field-danger bg-white px-3 py-2 text-center text-sm font-bold text-field-danger">
            {errorMessage}
          </p>
        ) : null}

        <DailyPlanCoverflow
          items={carouselItems}
          disabled={isDuplicating || Boolean(pendingDeleteItem)}
          onActivate={handleActivateItem}
          onOpenContextMenu={openPlanContextMenu}
        />
      </div>

      {contextMenu && typeof document !== "undefined" ? createPortal(
        <DailyPlanContextMenu
          menu={contextMenu}
          menuRef={contextMenuRef}
          disabled={isDuplicating || isDeleting}
          onDuplicate={() => handleDuplicate(contextMenu.plan)}
          onDelete={() => requestDelete(contextMenu.plan)}
        />,
        document.body
      ) : null}

      {pendingDeleteItem && typeof document !== "undefined" ? createPortal(
        <DailyPlanDeleteDialog
          item={pendingDeleteItem}
          errorMessage={deleteErrorMessage}
          isDeleting={isDeleting}
          onCancel={cancelDelete}
          onConfirm={confirmDelete}
        />,
        document.body
      ) : null}
    </section>
  );
}

function DailyPlanContextMenu({
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
      role="menu"
      aria-label={`${formatDailyPlanEpisodeLabel(menu.plan.episode)} 일촬표 메뉴`}
      className="fixed z-[100] grid w-[232px] gap-1 rounded-[3px] border border-field-border bg-white p-1.5 shadow-lg"
      style={{ left: menu.x, top: menu.y }}
    >
      <button
        type="button"
        role="menuitem"
        className="min-h-9 rounded-[2px] px-2.5 text-left text-xs font-bold text-field-primary hover:bg-field-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-field-primary disabled:opacity-50"
        onClick={onDuplicate}
        disabled={disabled}
      >
        복사해서 새 일촬표 만들기
      </button>
      <button
        type="button"
        role="menuitem"
        className="min-h-9 rounded-[2px] px-2.5 text-left text-xs font-bold text-field-danger hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-field-danger disabled:opacity-50"
        onClick={onDelete}
        disabled={disabled}
      >
        삭제
      </button>
    </div>
  );
}

function DailyPlanDeleteDialog({
  item,
  errorMessage,
  isDeleting,
  onCancel,
  onConfirm
}: {
  item: PendingDeleteItem;
  errorMessage: string;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-black/20 p-4"
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="daily-plan-delete-title"
        aria-describedby="daily-plan-delete-description"
        aria-busy={isDeleting}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-[4px] border border-field-border bg-white p-4 shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="daily-plan-delete-title" className="text-base font-black leading-[1.4] text-field-primary">
          일촬표 삭제
        </h2>
        <div id="daily-plan-delete-description" className="mt-2 space-y-1 text-sm leading-[1.5] text-field-text">
          <p><strong>{item.episodeLabel}</strong> 일촬표를 삭제하시겠습니까?</p>
          <p className="text-field-muted">삭제한 일촬표는 복구할 수 없습니다.</p>
        </div>

        {errorMessage ? (
          <p role="alert" className="mt-3 rounded-[2px] border border-field-danger bg-red-50 px-3 py-2 text-sm font-bold leading-[1.45] text-field-danger">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            autoFocus
            className="min-h-10 rounded-[3px] border border-field-border bg-white px-3 py-2 text-sm font-bold text-field-text hover:bg-field-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-field-primary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onCancel}
            disabled={isDeleting}
          >
            취소
          </button>
          <button
            type="button"
            className="min-h-10 rounded-[3px] border border-field-danger bg-field-danger px-3 py-2 text-sm font-black text-white hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-field-danger focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "삭제 중" : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

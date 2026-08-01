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
import type { DailyPlan, Project } from "@/lib/types";

type DailyPlanListItem = DailyPlan & { shotCount: number };

type PlanContextMenu = {
  plan: DailyPlanListItem;
  x: number;
  y: number;
};

const NEW_CARD_ID = "daily-plan:new";
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
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [contextMenu, setContextMenu] = useState<PlanContextMenu | null>(null);
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
      label: formatEpisodeLabel(plan.episode),
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
    if (!projectId || isBusy) return;
    if (item.kind === "new") {
      navigateOnce(`/projects/${projectId}/daily-plans/new`);
      return;
    }
    if (!item.planId) {
      setErrorMessage("열 일촬표 ID를 찾을 수 없습니다.");
      return;
    }
    navigateOnce(`/projects/${projectId}/daily-plans/${item.planId}`);
  }

  function openPlanContextMenu(item: DailyPlanCarouselItem, clientX: number, clientY: number) {
    if (item.kind !== "plan" || !item.planId || !canManage || isBusy) return;
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
    if (!projectId || isBusy || !canManage) return;
    setContextMenu(null);
    setIsBusy(true);
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
      setIsBusy(false);
    }
  }

  async function handleDelete(plan: DailyPlanListItem) {
    if (!projectId || isBusy || !canManage) return;
    setContextMenu(null);
    const episodeLabel = formatEpisodeLabel(plan.episode);
    const shouldDelete = window.confirm(`“${episodeLabel}” 일촬표를 삭제할까요? 컷 진행표(shots)는 자동으로 삭제하지 않습니다.`);
    if (!shouldDelete) return;

    setIsBusy(true);
    setErrorMessage("");
    const previousPlans = plans;
    setPlans((current) => current.filter((item) => item.id !== plan.id));

    try {
      await deleteDailyPlan(projectId, plan.id);
    } catch (error) {
      setPlans(previousPlans);
      setErrorMessage(error instanceof Error ? error.message : "일촬표를 삭제하지 못했습니다.");
    } finally {
      setIsBusy(false);
    }
  }

  if (isLoading) return <PixelDogLoader />;

  if (!project) {
    return <Card className="border-field-danger font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</Card>;
  }

  return (
    <section
      className="flex min-h-[calc(100dvh-8rem)] min-w-0 select-none items-center justify-center overflow-x-clip py-4"
      aria-labelledby="daily-plan-project-title"
    >
      <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col items-center justify-center">
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
          disabled={isBusy}
          onActivate={handleActivateItem}
          onOpenContextMenu={openPlanContextMenu}
        />
      </div>

      {contextMenu && typeof document !== "undefined" ? createPortal(
        <DailyPlanContextMenu
          menu={contextMenu}
          menuRef={contextMenuRef}
          disabled={isBusy}
          onDuplicate={() => handleDuplicate(contextMenu.plan)}
          onDelete={() => handleDelete(contextMenu.plan)}
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
      aria-label={`${formatEpisodeLabel(menu.plan.episode)} 일촬표 메뉴`}
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

function formatEpisodeLabel(value: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "회차 미입력";
  if (/회차$/u.test(normalized)) return normalized;
  const number = normalized.match(/\d+(?:\.\d+)?/u)?.[0];
  return number ? `${number}회차` : `${normalized}회차`;
}

function compareDailyPlanEpisodes(left: DailyPlanListItem, right: DailyPlanListItem) {
  const leftNumber = Number(left.episode.match(/\d+(?:\.\d+)?/u)?.[0]);
  const rightNumber = Number(right.episode.match(/\d+(?:\.\d+)?/u)?.[0]);
  const leftHasNumber = Number.isFinite(leftNumber);
  const rightHasNumber = Number.isFinite(rightNumber);
  if (leftHasNumber && rightHasNumber && leftNumber !== rightNumber) return leftNumber - rightNumber;
  if (leftHasNumber !== rightHasNumber) return leftHasNumber ? -1 : 1;
  return left.episode.localeCompare(right.episode, "ko-KR", { numeric: true, sensitivity: "base" });
}

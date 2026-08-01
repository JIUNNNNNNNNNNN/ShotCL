"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
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

type CarouselPointerState = {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  scrollLeft: number;
  plan: DailyPlanListItem | null;
  moved: boolean;
  longPressed: boolean;
};

const LONG_PRESS_MS = 600;
const DRAG_THRESHOLD_PX = 8;
const CONTEXT_MENU_WIDTH = 232;
const CONTEXT_MENU_HEIGHT = 92;
const CONTEXT_MENU_EDGE = 8;

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  const id = params.id;
  return Array.isArray(id) ? id[0] : id;
}

/** 프로젝트명과 회차 카드만 보여주고 기존 생성·복사·삭제 흐름을 연결합니다. */
export default function DailyPlansPage() {
  const projectId = useProjectId();
  const router = useRouter();
  const { role } = useProjectAccess();
  const [project, setProject] = useState<Project | null>(null);
  const [plans, setPlans] = useState<DailyPlanListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [contextMenu, setContextMenu] = useState<PlanContextMenu | null>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const pointerStateRef = useRef<CarouselPointerState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickUntilRef = useRef(0);
  const canManage = role !== "progress" && project?.accessRole !== "progress";

  const sortedPlans = useMemo(
    () => [...plans].sort(compareDailyPlanEpisodes),
    [plans]
  );
  const totalCardCount = sortedPlans.length + (canManage ? 1 : 0);
  const carouselActive = totalCardCount >= 4;

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

  useEffect(() => () => clearLongPressTimer(), []);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function openPlanContextMenu(plan: DailyPlanListItem, clientX: number, clientY: number) {
    if (!canManage || isBusy) return;
    const maxX = Math.max(CONTEXT_MENU_EDGE, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_EDGE);
    const maxY = Math.max(CONTEXT_MENU_EDGE, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_EDGE);
    setContextMenu({
      plan,
      x: Math.min(Math.max(CONTEXT_MENU_EDGE, clientX), maxX),
      y: Math.min(Math.max(CONTEXT_MENU_EDGE, clientY), maxY)
    });
  }

  function handleCarouselPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const container = carouselRef.current;
    if (!container) return;

    clearLongPressTimer();
    setContextMenu(null);
    setIsDragging(false);
    const planId = (event.target as HTMLElement).closest<HTMLElement>("[data-plan-id]")?.dataset.planId;
    const plan = planId ? sortedPlans.find((item) => item.id === planId) ?? null : null;
    pointerStateRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: container.scrollLeft,
      plan,
      moved: false,
      longPressed: false
    };
    container.setPointerCapture(event.pointerId);

    if (event.pointerType !== "mouse" && plan && canManage && !isBusy) {
      longPressTimerRef.current = setTimeout(() => {
        const current = pointerStateRef.current;
        if (!current || current.pointerId !== event.pointerId || current.moved) return;
        current.longPressed = true;
        suppressClickUntilRef.current = Date.now() + 500;
        openPlanContextMenu(plan, current.clientX, current.clientY);
      }, LONG_PRESS_MS);
    }
  }

  function handleCarouselPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = pointerStateRef.current;
    const container = carouselRef.current;
    if (!current || !container || current.pointerId !== event.pointerId) return;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;

    if (!current.moved && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD_PX) {
      current.moved = true;
      clearLongPressTimer();
      setContextMenu(null);
      if (carouselActive && Math.abs(deltaX) > Math.abs(deltaY)) setIsDragging(true);
    }

    if (current.moved && carouselActive && Math.abs(deltaX) > Math.abs(deltaY)) {
      event.preventDefault();
      container.scrollLeft = current.scrollLeft - deltaX;
    }
  }

  function finishCarouselPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const current = pointerStateRef.current;
    const container = carouselRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    clearLongPressTimer();
    if (current.moved || current.longPressed) suppressClickUntilRef.current = Date.now() + 350;
    if (container?.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    pointerStateRef.current = null;
    setIsDragging(false);
  }

  function handlePlanClick(event: ReactMouseEvent<HTMLButtonElement>, plan: DailyPlanListItem) {
    if (Date.now() < suppressClickUntilRef.current || isDragging || contextMenu) {
      event.preventDefault();
      return;
    }
    router.push(`/projects/${projectId}/daily-plans/${plan.id}`);
  }

  function handlePlanContextMenu(event: ReactMouseEvent<HTMLButtonElement>, plan: DailyPlanListItem) {
    event.preventDefault();
    if (Date.now() < suppressClickUntilRef.current || pointerStateRef.current?.moved) return;
    suppressClickUntilRef.current = Date.now() + 350;
    openPlanContextMenu(plan, event.clientX, event.clientY);
  }

  function handlePlanKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, plan: DailyPlanListItem) {
    if (!canManage || (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openPlanContextMenu(plan, rect.right + 6, rect.top);
  }

  function handleNewPlanClick(event: ReactMouseEvent<HTMLButtonElement>) {
    if (Date.now() < suppressClickUntilRef.current || isDragging) {
      event.preventDefault();
      return;
    }
    router.push(`/projects/${projectId}/daily-plans/new`);
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

  const compactCardClass = carouselActive
    ? "w-[clamp(8.75rem,42vw,13rem)] flex-[0_0_auto]"
    : "min-w-0 max-w-[13rem] flex-1 basis-0";

  return (
    <section className="min-w-0 select-none" aria-labelledby="daily-plan-project-title">
      <h1
        id="daily-plan-project-title"
        className="max-w-full truncate text-xl font-black leading-[1.35] text-field-primary md:text-2xl"
        title={project.name}
      >
        {project.name}
      </h1>

      {errorMessage ? (
        <p role="alert" className="mt-2 max-w-xl border border-field-danger bg-white px-3 py-2 text-sm font-bold text-field-danger">
          {errorMessage}
        </p>
      ) : null}

      <div
        ref={carouselRef}
        className={`mt-3 flex w-full min-w-0 flex-nowrap gap-2 overflow-y-hidden pb-1 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden ${
          carouselActive
            ? `snap-x snap-proximity overflow-x-auto overscroll-x-contain ${isDragging ? "cursor-grabbing" : "cursor-grab"}`
            : "overflow-x-hidden"
        }`}
        style={{ touchAction: "pan-y" }}
        aria-label="일촬표 선택 카드"
        onPointerDown={handleCarouselPointerDown}
        onPointerMove={handleCarouselPointerMove}
        onPointerUp={finishCarouselPointer}
        onPointerCancel={finishCarouselPointer}
        onDragStart={(event) => event.preventDefault()}
      >
        {canManage ? (
          <button
            type="button"
            className={`${compactCardClass} flex h-28 snap-start items-center justify-center rounded-[3px] border border-field-primary bg-white text-4xl font-light leading-none text-field-primary outline-none hover:bg-field-light focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 disabled:opacity-50 md:h-32`}
            aria-label="새 일촬표 만들기"
            onClick={handleNewPlanClick}
            disabled={isBusy}
          >
            +
          </button>
        ) : null}

        {sortedPlans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            data-plan-id={plan.id}
            className={`${compactCardClass} flex h-28 snap-start items-center justify-center overflow-hidden rounded-[3px] border border-field-border bg-white px-3 text-center text-lg font-black leading-[1.35] text-field-primary outline-none hover:border-field-primary focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 disabled:opacity-50 md:h-32 md:text-xl`}
            aria-label={`${formatEpisodeLabel(plan.episode)} 일촬표 열기`}
            title={formatEpisodeLabel(plan.episode)}
            onClick={(event) => handlePlanClick(event, plan)}
            onContextMenu={(event) => handlePlanContextMenu(event, plan)}
            onKeyDown={(event) => handlePlanKeyDown(event, plan)}
            disabled={isBusy}
          >
            <span className="block max-w-full truncate">{formatEpisodeLabel(plan.episode)}</span>
          </button>
        ))}
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
  menuRef: React.RefObject<HTMLDivElement | null>;
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

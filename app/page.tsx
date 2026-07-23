"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { listProjects } from "@/lib/data/projects";
import { cleanProjectName, sanitizePasscode } from "@/lib/projectAccess/core";
import { projectFromRow } from "@/lib/data/mappers";
import { getLocalProjectIdCandidates } from "@/lib/projectId";
import type { Project } from "@/lib/types";

type ProjectPickerMode = "new" | "progress" | "join";
type WheelItemId = (typeof wheelItems)[number]["id"];

const HIDDEN_PROJECT_IDS_KEY = "shotcl:hiddenProjectIds";

function readHiddenProjectIds() {
  if (typeof window === "undefined") return new Set<string>();

  try {
    const storedValue = JSON.parse(window.localStorage.getItem(HIDDEN_PROJECT_IDS_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(storedValue) ? storedValue.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function writeHiddenProjectIds(projectIds: Set<string>) {
  try {
    window.localStorage.setItem(HIDDEN_PROJECT_IDS_KEY, JSON.stringify([...projectIds]));
  } catch {
    // 저장소가 차단된 브라우저에서도 현재 화면의 숨김 동작은 계속 허용합니다.
  }
}

function unhideProject(projectId: string) {
  const hiddenProjectIds = readHiddenProjectIds();
  let didDelete = false;
  getLocalProjectIdCandidates(projectId).forEach((candidate) => {
    if (hiddenProjectIds.delete(candidate)) didDelete = true;
  });
  if (!didDelete) return;
  writeHiddenProjectIds(hiddenProjectIds);
}

const wheelItems = [
  {
    id: "new",
    label: "New Project",
    angle: 0,
    colorClass: "bg-field-primary"
  },
  {
    id: "join",
    label: "Join Project",
    angle: 120,
    colorClass: "bg-[#557d6d]"
  },
  {
    id: "progress",
    label: "Go",
    angle: 240,
    colorClass: "bg-[#416f5d]"
  }
] as const;

const SPINNER_SETTLE_DELAY_MS = 180;
const SPINNER_SNAP_DURATION_MS = 260;

function normalizeAngle(angle: number) {
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

function getNearestWheelItem(rotation: number) {
  return wheelItems.reduce((nearest, item) => {
    const distance = Math.abs(normalizeAngle(item.angle + rotation));
    return distance < nearest.distance ? { id: item.id, distance } : nearest;
  }, { id: wheelItems[0].id as WheelItemId, distance: Number.POSITIVE_INFINITY });
}

/** 빈 종이 위 원형 메뉴만 제공하는 앱 진입 화면입니다. */
export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [pickerMode, setPickerMode] = useState<ProjectPickerMode | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [progressPassword, setProgressPassword] = useState("");
  const [joinProjectName, setJoinProjectName] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [newProjectError, setNewProjectError] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [feedback, setFeedback] = useState<{ target: WheelItemId; message: string } | null>(null);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [previewItem, setPreviewItem] = useState<WheelItemId>("new");
  const [isDraggingWheel, setIsDraggingWheel] = useState(false);
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const clusterRef = useRef<HTMLDivElement | null>(null);
  const compositionRef = useRef<HTMLDivElement | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelRotationRef = useRef(0);
  const dragStateRef = useRef<{
    pointerId: number;
    lastAngle: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSavedProjects() {
      try {
        const data = await listProjects();
        const hiddenProjectIds = readHiddenProjectIds();
        if (isMounted) setProjects(data.filter((project) => !getLocalProjectIdCandidates(project.id).some((candidate) => hiddenProjectIds.has(candidate))));
      } catch (error) {
        if (isMounted) setErrorMessage(error instanceof Error ? error.message : "프로젝트를 불러오지 못했습니다.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadSavedProjects();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
  }, []);

  useEffect(() => {
    if (!pickerMode) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      const clickedWheel = wheelRef.current?.contains(event.target);
      const clickedSubmenu = clusterRef.current?.contains(event.target);
      if (!clickedWheel && !clickedSubmenu) {
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
        if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
        setPickerMode(null);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
        if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
        setPickerMode(null);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [pickerMode]);

  useEffect(() => {
    if (!pickerMode || !window.matchMedia("(max-width: 767px)").matches) return;
    let secondAnimationFrame = 0;
    const firstAnimationFrame = window.requestAnimationFrame(() => {
      secondAnimationFrame = window.requestAnimationFrame(() => {
        compositionRef.current?.scrollIntoView({
          block: "center",
          inline: "center",
          behavior: "smooth"
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstAnimationFrame);
      if (secondAnimationFrame) window.cancelAnimationFrame(secondAnimationFrame);
    };
  }, [pickerMode]);

  function showFeedback(target: WheelItemId, message: string) {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedback({ target, message });
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 1500);
  }

  function commitWheelItem(id: WheelItemId) {
    if (pickerMode === id) return;
    setFeedback(null);
    setNewProjectError("");
    setIsCreatingProject(false);

    if (id === "new" || id === "join") {
      setPickerMode(id);
      return;
    }

    if (isLoading) {
      showFeedback(id, "프로젝트 확인 중");
      return;
    }

    if (errorMessage) {
      showFeedback(id, "프로젝트를 불러오지 못했습니다");
      return;
    }

    setPickerMode(id);
  }

  function updateWheelRotation(nextRotation: number) {
    wheelRotationRef.current = nextRotation;
    setWheelRotation(nextRotation);
    setPreviewItem(getNearestWheelItem(nextRotation).id);
  }

  function snapToWheelItem(id: WheelItemId) {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);

    const item = wheelItems.find((candidate) => candidate.id === id) ?? wheelItems[0];
    const snappedRotation = wheelRotationRef.current - normalizeAngle(item.angle + wheelRotationRef.current);
    updateWheelRotation(snappedRotation);
    setPreviewItem(id);

    snapTimerRef.current = setTimeout(() => {
      commitWheelItem(id);
    }, SPINNER_SNAP_DURATION_MS);
  }

  function scheduleWheelSettle() {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      snapToWheelItem(getNearestWheelItem(wheelRotationRef.current).id);
    }, SPINNER_SETTLE_DELAY_MS);
  }

  function getPointerAngle(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    return Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI);
  }

  function handleWheelPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      lastAngle: getPointerAngle(event),
      moved: false
    };
    suppressClickRef.current = false;
    setIsDraggingWheel(true);
  }

  function handleWheelPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const nextPointerAngle = getPointerAngle(event);
    const delta = normalizeAngle(nextPointerAngle - dragState.lastAngle);
    if (Math.abs(delta) < 0.15) return;

    dragState.lastAngle = nextPointerAngle;
    dragState.moved = true;
    suppressClickRef.current = true;
    updateWheelRotation(wheelRotationRef.current + delta);
  }

  function finishWheelPointer(event: React.PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setIsDraggingWheel(false);
    scheduleWheelSettle();
    if (dragState.moved) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }

  function handleSpinnerWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    updateWheelRotation(wheelRotationRef.current + Math.max(-72, Math.min(72, delta * 0.35)));
    scheduleWheelSettle();
  }

  function closeInputSubmenu(mode: "new" | "join") {
    if (mode === "new") {
      setNewProjectName("");
      setAdminPassword("");
      setProgressPassword("");
    } else {
      setJoinProjectName("");
      setJoinPassword("");
    }
    setNewProjectError("");
    setIsCreatingProject(false);
    setPickerMode(null);
  }

  function hideProjectFromCurrentList(project: Project) {
    if (!window.confirm("이 프로젝트를 목록에서 삭제할까요?")) return;
    const hiddenProjectIds = readHiddenProjectIds();
    hiddenProjectIds.add(project.id);
    writeHiddenProjectIds(hiddenProjectIds);
    setProjects((currentProjects) => currentProjects.filter((item) => item.id !== project.id));
    if (projects.length === 1) setPickerMode(null);
  }

  function handleWheelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      snapToWheelItem(previewItem);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const currentIndex = wheelItems.findIndex((item) => item.id === previewItem);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + wheelItems.length) % wheelItems.length;
    snapToWheelItem(wheelItems[nextIndex].id);
  }

  function openProject(project: Project) {
    router.push(`/projects/${project.id}`);
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = cleanProjectName(newProjectName);
    if (!name) {
      setNewProjectError("프로젝트 이름을 입력하세요.");
      return;
    }

    if (!/^\d{4}$/.test(adminPassword) || !/^\d{4}$/.test(progressPassword)) {
      setNewProjectError("관리자와 진행도 비밀번호를 각각 4자리 숫자로 입력하세요.");
      return;
    }
    if (adminPassword === progressPassword) {
      setNewProjectError("관리자 비밀번호와 진행도 비밀번호는 서로 달라야 합니다.");
      return;
    }

    setNewProjectError("");
    setIsCreatingProject(true);
    try {
      const response = await fetch("/api/projects/create", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName: name, adminPassword, progressPassword })
      });
      const payload = (await response.json()) as { project?: Record<string, unknown>; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error || "프로젝트를 만들지 못했습니다.");
      const project = projectFromRow(payload.project);
      unhideProject(project.id);
      window.location.assign(`/projects/${project.id}/basic-info`);
    } catch (error) {
      setNewProjectError(error instanceof Error ? error.message : "프로젝트를 만들지 못했습니다.");
      setIsCreatingProject(false);
    }
  }

  async function handleJoinProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectName = cleanProjectName(joinProjectName);
    if (!projectName || !/^\d{4}$/.test(joinPassword)) {
      setNewProjectError("프로젝트 이름과 4자리 비밀번호를 입력하세요");
      return;
    }
    setNewProjectError("");
    setIsCreatingProject(true);
    try {
      const response = await fetch("/api/projects/join", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, password: joinPassword })
      });
      const payload = (await response.json()) as { projectId?: string; role?: "admin" | "progress"; error?: string };
      if (!response.ok || !payload.projectId || !payload.role) throw new Error(payload.error || "프로젝트 이름 또는 비밀번호가 올바르지 않습니다");
      unhideProject(payload.projectId);
      window.location.assign(payload.role === "admin" ? `/projects/${payload.projectId}/daily-plans` : `/projects/${payload.projectId}`);
    } catch (error) {
      setNewProjectError(error instanceof Error ? error.message : "프로젝트 이름 또는 비밀번호가 올바르지 않습니다");
      setIsCreatingProject(false);
    }
  }

  const pickerTitle = pickerMode === "new" ? "New Project" : pickerMode === "join" ? "Join Project" : "Go";

  function renderProjectFruits() {
    if (isLoading || errorMessage || projects.length === 0) return null;

    return projects.map((project) => (
      <div key={project.id} className="relative z-10 h-20 w-20 shrink-0 md:h-[5.5rem] md:w-[5.5rem]">
        <button
          type="button"
          onClick={() => openProject(project)}
          className="group/fruit flex h-full w-full flex-col items-center justify-center rounded-full border border-field-secondary/50 bg-white px-2 text-center shadow-[0_5px_14px_rgba(15,61,46,0.10)] transition-[background-color,border-color,box-shadow,transform] duration-150 hover:border-field-primary hover:bg-field-light hover:shadow-[0_7px_18px_rgba(15,61,46,0.16)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2"
          aria-label={`${project.name} ${pickerTitle}`}
        >
          <span className="overflow-hidden text-[11px] font-black leading-[1.4] text-field-primary [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] md:text-xs">
            <span className="font-display">{project.name}</span>
          </span>
          <span className="mt-1 max-w-full truncate text-[9px] font-bold text-field-muted md:text-[10px]">
            {project.accessRole === "progress" ? "진행도 권한" : project.shareConfigured ? "관리자 권한" : "공유 설정 필요"}
          </span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            hideProjectFromCurrentList(project);
          }}
          className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full text-field-muted transition-transform hover:scale-105 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]"
          aria-label={`${project.name} 목록에서 숨기기`}
        >
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-field-border bg-white shadow-sm transition-colors hover:border-field-secondary hover:bg-field-soft">
            <X className="h-3 w-3" aria-hidden />
          </span>
        </button>
      </div>
    ));
  }

  function renderFruitBranches() {
    const columnCount = 2;
    const rowCount = Math.max(1, Math.ceil(projects.length / columnCount));

    return projects.map((project, index) => {
      const column = index % columnCount;
      const row = Math.floor(index / columnCount);
      const targetX = ((column + 0.5) / columnCount) * 100;
      const targetY = ((row + 0.5) / rowCount) * 100;
      const path = `M100 50 C${82 + targetX * 0.08} 50 ${targetX + 10} ${targetY} ${targetX} ${targetY}`;

      return <path key={project.id} d={path} fill="none" stroke="#c9d6d0" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />;
    });
  }

  return (
    <div className="relative grid h-[100dvh] min-h-[100svh] w-full place-items-center overflow-hidden bg-field-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div ref={canvasRef} className="flex h-full w-full overflow-auto overscroll-contain px-4 py-6 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden md:px-8">
        <div
          ref={compositionRef}
          className={`relative m-auto flex w-full items-center justify-center transition-[gap] duration-300 ${
            pickerMode ? "max-w-[42rem] flex-col gap-7 md:flex-row md:gap-12" : "max-w-[24rem]"
          }`}
        >
          <div
            ref={wheelRef}
            role="group"
            tabIndex={0}
            aria-label="원형 기능 메뉴. 좌우 방향키 또는 드래그로 회전"
            className="relative z-20 aspect-square w-[min(82vw,22rem)] shrink-0 touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-4"
            onPointerDown={handleWheelPointerDown}
            onPointerMove={handleWheelPointerMove}
            onPointerUp={finishWheelPointer}
            onPointerCancel={finishWheelPointer}
            onWheel={handleSpinnerWheel}
            onKeyDown={handleWheelKeyDown}
          >
            <div className="absolute inset-[15%] rounded-full border border-field-border bg-white/45 shadow-[inset_0_0_0_10px_rgba(255,255,255,0.34),0_14px_30px_rgba(15,61,46,0.08)]" aria-hidden />
            <div className="absolute inset-[23%] rounded-full border border-dashed border-field-secondary/40" aria-hidden />
            <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-field-border bg-field-bg shadow-[0_3px_9px_rgba(15,61,46,0.10)]" aria-hidden />
            <div
              className="pointer-events-none absolute left-[85%] top-1/2 h-[6.25rem] w-[6.25rem] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#d7b95f]/70 bg-[#fff7d8]/35 shadow-[0_0_18px_rgba(215,185,95,0.34)]"
              aria-hidden
            />
            {wheelItems.map((item) => {
              const angle = (item.angle + wheelRotation) * (Math.PI / 180);
              const left = Number((50 + Math.cos(angle) * 35).toFixed(4));
              const top = Number((50 + Math.sin(angle) * 35).toFixed(4));
              const isSelected = previewItem === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.label}
                  aria-pressed={isSelected}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    snapToWheelItem(item.id);
                  }}
                  className={`absolute flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border px-2 text-center text-white outline-none will-change-[left,top,transform] sm:h-24 sm:w-24 ${item.colorClass} ${
                    isDraggingWheel
                      ? "transition-none"
                      : "transition-[left,top,transform,opacity,box-shadow,border-color,filter] duration-[260ms] ease-out"
                  } ${
                    isSelected
                      ? "z-20 scale-[0.94] border-[#d7b95f] opacity-100 shadow-[inset_0_5px_10px_rgba(0,0,0,0.22),0_6px_15px_rgba(15,61,46,0.18)] brightness-95"
                      : "z-10 scale-[0.82] border-white/70 opacity-70 shadow-[0_5px_14px_rgba(15,61,46,0.12)] hover:opacity-90"
                  } active:scale-[0.9] focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2`}
                  style={{
                    left: `${left}%`,
                    top: `${top}%`
                  }}
                >
                  <span className="font-display-strong text-[12px] font-black leading-[1.35] sm:text-sm">{item.label}</span>
                </button>
              );
            })}
          </div>

        {pickerMode ? (
          <>
          <div className="h-8 w-px shrink-0 bg-field-secondary/60 motion-safe:animate-[branch-reveal_180ms_ease-out] md:h-px md:w-12" aria-hidden />
          <div
            ref={clusterRef}
            role="region"
            aria-label={pickerTitle}
            className="relative z-10 w-full max-w-[20rem] shrink-0 motion-safe:animate-[branch-reveal_180ms_ease-out] md:w-[14rem]"
          >
            <div className="mb-2 flex items-center justify-center gap-1.5">
              <h1 className="rounded-full border border-field-border bg-field-bg/95 px-3 py-1 text-[11px] font-black text-field-primary shadow-sm">
                <span className="font-display">{pickerTitle}</span>
              </h1>
            </div>
            {pickerMode === "new" ? (
              <form
                onSubmit={handleCreateProject}
                className="relative grid w-full gap-2 rounded-[2rem] border border-field-secondary/50 bg-white p-3 shadow-[0_6px_18px_rgba(15,61,46,0.12)]"
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeInputSubmenu("new");
                  }}
                  className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full text-field-muted transition-transform hover:scale-105 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]"
                  aria-label="새 프로젝트 입력 닫기"
                >
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-field-border bg-white shadow-sm transition-colors hover:border-field-secondary hover:bg-field-soft">
                    <X className="h-3 w-3" aria-hidden />
                  </span>
                </button>
                <input
                  value={newProjectName}
                  onChange={(event) => {
                    setNewProjectName(event.target.value);
                    if (newProjectError) setNewProjectError("");
                  }}
                  placeholder="프로젝트 이름"
                  aria-label="새 프로젝트 이름"
                  className="h-10 min-w-0 rounded-full border border-field-border bg-field-bg px-3 text-center text-xs font-bold text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-light"
                />
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(sanitizePasscode(event.target.value))}
                  placeholder="관리자 비밀번호 4자리"
                  aria-label="관리자 비밀번호"
                  className="h-10 min-w-0 rounded-full border border-field-border bg-field-bg px-3 text-center text-xs font-bold tracking-[0.25em] text-field-text outline-none placeholder:tracking-normal placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-light"
                />
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={progressPassword}
                  onChange={(event) => setProgressPassword(sanitizePasscode(event.target.value))}
                  placeholder="진행도 비밀번호 4자리"
                  aria-label="진행도 비밀번호"
                  className="h-10 min-w-0 rounded-full border border-field-border bg-field-bg px-3 text-center text-xs font-bold tracking-[0.25em] text-field-text outline-none placeholder:tracking-normal placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-light"
                />
                {newProjectError ? <p className="px-2 text-center text-[10px] font-bold leading-4 text-field-danger">{newProjectError}</p> : null}
                <button
                  type="submit"
                  disabled={isCreatingProject}
                  className="h-10 rounded-full bg-field-primary px-3 text-xs font-black text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2"
                >
                  <span className="font-display">{isCreatingProject ? "만드는 중" : "만들기"}</span>
                </button>
              </form>
            ) : pickerMode === "join" ? (
              <form
                onSubmit={handleJoinProject}
                className="relative grid w-full gap-2 rounded-[2rem] border border-field-secondary/50 bg-white p-3 shadow-[0_6px_18px_rgba(15,61,46,0.12)]"
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeInputSubmenu("join");
                  }}
                  className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full text-field-muted transition-transform hover:scale-105 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]"
                  aria-label="프로젝트 참여 입력 닫기"
                >
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-field-border bg-white shadow-sm transition-colors hover:border-field-secondary hover:bg-field-soft">
                    <X className="h-3 w-3" aria-hidden />
                  </span>
                </button>
                <input
                  value={joinProjectName}
                  onChange={(event) => {
                    setJoinProjectName(event.target.value);
                    if (newProjectError) setNewProjectError("");
                  }}
                  placeholder="프로젝트 이름"
                  aria-label="참여할 프로젝트 이름"
                  className="h-10 min-w-0 rounded-full border border-field-border bg-field-bg px-3 text-center text-xs font-bold text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-light"
                />
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={joinPassword}
                  onChange={(event) => setJoinPassword(sanitizePasscode(event.target.value))}
                  placeholder="비밀번호 4자리"
                  aria-label="프로젝트 참여 비밀번호"
                  className="h-10 min-w-0 rounded-full border border-field-border bg-field-bg px-3 text-center text-xs font-bold tracking-[0.25em] text-field-text outline-none placeholder:tracking-normal placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-light"
                />
                {newProjectError ? <p className="px-2 text-center text-[10px] font-bold leading-4 text-field-danger">{newProjectError}</p> : null}
                <button
                  type="submit"
                  disabled={isCreatingProject}
                  className="h-10 rounded-full bg-field-primary px-3 text-xs font-black text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2"
                >
                  <span className="font-display">{isCreatingProject ? "확인 중" : "참여"}</span>
                </button>
              </form>
            ) : (
              <div className="py-1">
                {projects.length === 0 ? (
                  <p className="rounded-full border border-field-border bg-white px-4 py-2 text-center text-[11px] font-black text-field-muted">
                    진행 볼 프로젝트가 없습니다
                  </p>
                ) : <div className="relative grid auto-rows-[5rem] grid-cols-2 justify-items-center gap-2 md:auto-rows-[5.5rem]">
                  <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                    {renderFruitBranches()}
                  </svg>
                  {renderProjectFruits()}
                </div>}
              </div>
            )}
          </div>
          </>
        ) : null}
        {feedback ? (
          <p
            role="status"
            className={`absolute z-30 whitespace-nowrap rounded-full border border-field-border bg-white px-3 py-1.5 text-[11px] font-black text-field-primary shadow-[0_5px_14px_rgba(15,61,46,0.12)] ${
              feedback.target === "progress"
                ? "left-1/2 top-[calc(100%+0.5rem)] -translate-x-1/2"
                : "right-[calc(100%+0.5rem)] top-1/3"
            }`}
          >
            {feedback.message}
          </p>
        ) : null}
        </div>
      </div>
      <style jsx global>{`
        @keyframes branch-reveal {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { listProjects } from "@/lib/data/projects";
import { cleanProjectName, sanitizePasscode } from "@/lib/projectAccess/core";
import { projectFromRow } from "@/lib/data/mappers";
import { getLocalProjectIdCandidates } from "@/lib/projectId";
import type { Project } from "@/lib/types";
import {
  getBubbleTargetMeasurement,
  getSpinnerItemAngle,
  normalizeSpinnerAngle,
  useDragSpinner
} from "@/components/useDragSpinner";

type ProjectPickerMode = "new" | "progress" | "join";
type WheelItemId = (typeof wheelItems)[number]["id"];

const HIDDEN_PROJECT_IDS_KEY = "shotcl:hiddenProjectIds";
const MAIN_SELECTION_FEEDBACK_MS = 140;
const PROJECT_SELECTION_FEEDBACK_MS = 190;

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
    label: "New",
    ariaLabel: "New Project",
    colorClass: "bg-field-primary"
  },
  {
    id: "join",
    label: "Join",
    ariaLabel: "Join Project",
    colorClass: "bg-[#557d6d]"
  },
  {
    id: "progress",
    label: "Go",
    ariaLabel: "Go",
    colorClass: "bg-[#416f5d]"
  }
] as const;

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
  const [selectedMainId, setSelectedMainId] = useState<WheelItemId | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const isProgressMode = pickerMode === "progress";
  const isProjectRingOpen = isProgressMode && projects.length > 0;
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const projectWheelRef = useRef<HTMLDivElement | null>(null);
  const mainTargetRef = useRef<HTMLDivElement | null>(null);
  const projectTargetRef = useRef<HTMLDivElement | null>(null);
  const mainBubbleRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const projectBubbleRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const clusterRef = useRef<HTMLDivElement | null>(null);
  const compositionRef = useRef<HTMLDivElement | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectNavigationRef = useRef(false);
  const measureMainTarget = useCallback(
    (index: number) => getBubbleTargetMeasurement(mainBubbleRefs.current[index], mainTargetRef.current),
    []
  );
  const measureProjectTarget = useCallback(
    (index: number) => getBubbleTargetMeasurement(projectBubbleRefs.current[index], projectTargetRef.current),
    []
  );
  const mainSpinner = useDragSpinner({
    itemCount: wheelItems.length,
    onCommit: (index) => commitWheelItem(wheelItems[index]?.id ?? "new"),
    onReject: () => closeProjectRing(),
    measureTarget: measureMainTarget,
    activationKey: isProjectRingOpen
  });
  const projectSpinner = useDragSpinner({
    itemCount: projects.length,
    onCommit: (index) => openProject(projects[index]),
    onReject: () => closeProjectRing(),
    measureTarget: measureProjectTarget,
    activationKey: isProjectRingOpen
  });
  const previewItem = wheelItems[mainSpinner.activeIndex]?.id ?? "new";
  const activatedWheelItem = mainSpinner.activationIndex === null
    ? null
    : wheelItems[mainSpinner.activationIndex]?.id ?? null;
  const isProjectTargetEngaged = projectSpinner.activationIndex !== null
    && projectSpinner.activationState !== "outside";

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
    if (mainSelectionTimerRef.current) clearTimeout(mainSelectionTimerRef.current);
    if (projectSelectionTimerRef.current) clearTimeout(projectSelectionTimerRef.current);
  }, []);

  useEffect(() => {
    if (!pickerMode) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      const clickedWheel = wheelRef.current?.contains(event.target);
      const clickedSubmenu = clusterRef.current?.contains(event.target);
      const clickedProjectWheel = projectWheelRef.current?.contains(event.target);
      if (!clickedWheel && !clickedSubmenu && !clickedProjectWheel) {
        closeProjectRing();
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeProjectRing();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mainSpinner.cancelPending, pickerMode, projectSpinner.cancelPending]);

  useEffect(() => {
    projectNavigationRef.current = false;
    if (pickerMode !== "progress") {
      projectSpinner.cancelPending();
      setSelectedProjectId(null);
    }
  }, [pickerMode, projectSpinner.cancelPending]);

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
    if (pickerMode === id || mainSelectionTimerRef.current) return;
    setSelectedMainId(id);
    setFeedback(null);
    setNewProjectError("");
    setIsCreatingProject(false);

    mainSelectionTimerRef.current = setTimeout(() => {
      mainSelectionTimerRef.current = null;
      if (id === "new" || id === "join") {
        setPickerMode(id);
        return;
      }

      if (isLoading) {
        showFeedback(id, "프로젝트 확인 중");
        setSelectedMainId(null);
        return;
      }

      if (errorMessage) {
        showFeedback(id, "프로젝트를 불러오지 못했습니다");
        setSelectedMainId(null);
        return;
      }

      setPickerMode(id);
    }, MAIN_SELECTION_FEEDBACK_MS);
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
    setSelectedMainId(null);
    setPickerMode(null);
  }

  function hideProjectFromCurrentList(project: Project) {
    if (!window.confirm("이 프로젝트를 목록에서 삭제할까요?")) return;
    projectSpinner.cancelPending();
    projectNavigationRef.current = false;
    const hiddenProjectIds = readHiddenProjectIds();
    hiddenProjectIds.add(project.id);
    writeHiddenProjectIds(hiddenProjectIds);
    const nextProjects = projects.filter((item) => item.id !== project.id);
    setProjects(nextProjects);
    if (nextProjects.length === 0) setPickerMode(null);
  }

  function handleWheelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (mainSpinner.activationIndex === null) {
        closeProjectRing();
        return;
      }
      mainSpinner.activateIndex(mainSpinner.activationIndex);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const currentIndex = wheelItems.findIndex((item) => item.id === previewItem);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + wheelItems.length) % wheelItems.length;
    mainSpinner.snapToIndex(nextIndex);
  }

  function handleProjectSpinnerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (projects.length === 0) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (projectSpinner.activationIndex === null) {
        closeProjectRing();
        return;
      }
      projectSpinner.activateIndex(projectSpinner.activationIndex);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (projectSpinner.activeIndex + direction + projects.length) % projects.length;
    projectSpinner.snapToIndex(nextIndex);
  }

  function openProject(project: Project | undefined) {
    if (!project || pickerMode !== "progress" || projectNavigationRef.current) return;
    projectNavigationRef.current = true;
    setSelectedProjectId(project.id);
    projectSelectionTimerRef.current = setTimeout(() => {
      projectSelectionTimerRef.current = null;
      try {
        router.push(`/projects/${project.id}`);
      } catch {
        projectNavigationRef.current = false;
        setSelectedProjectId(null);
        showFeedback("progress", "프로젝트를 열지 못했습니다");
      }
    }, PROJECT_SELECTION_FEEDBACK_MS);
  }

  function closeProjectRing() {
    mainSpinner.cancelPending();
    projectSpinner.cancelPending();
    if (mainSelectionTimerRef.current) clearTimeout(mainSelectionTimerRef.current);
    if (projectSelectionTimerRef.current) clearTimeout(projectSelectionTimerRef.current);
    mainSelectionTimerRef.current = null;
    projectSelectionTimerRef.current = null;
    projectNavigationRef.current = false;
    setSelectedMainId(null);
    setSelectedProjectId(null);
    setPickerMode(null);
    setFeedback(null);
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

  function renderProjectSpinner() {
    if (isLoading || errorMessage || projects.length === 0) return null;

    return (
      <div
        ref={projectWheelRef}
        role="group"
        tabIndex={0}
        aria-label="프로젝트 원형 메뉴. 좌우 방향키 또는 드래그로 회전"
        className="absolute inset-0 z-10 touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-4"
        {...projectSpinner.pointerHandlers}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          if (projectSpinner.consumeSuppressedClick()) return;
          closeProjectRing();
        }}
        onKeyDown={handleProjectSpinnerKeyDown}
      >
        <div
          className="pointer-events-none absolute inset-[10%] rounded-full border border-field-border/75 bg-white/15 shadow-[0_14px_34px_rgba(15,61,46,0.06)]"
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-[14%] rounded-full border border-dashed border-field-secondary/45" aria-hidden />
        <div
          ref={projectTargetRef}
          className="pointer-events-none absolute left-[89.5%] top-1/2 h-[4.25rem] w-[4.25rem] -translate-x-1/2 -translate-y-1/2 md:h-[5.5rem] md:w-[5.5rem]"
          aria-hidden
        >
          <div
            className={`absolute inset-0 rounded-full border-2 border-[#d7b95f]/70 bg-[#fff7d8]/35 transition-[transform,box-shadow,background-color] duration-[260ms] ease-out ${
              selectedProjectId
                ? "scale-[1.18] bg-[#fff2b7]/55 shadow-[0_0_28px_rgba(215,185,95,0.62)] motion-safe:animate-[project-target-confirm_420ms_ease-out]"
                : isProjectTargetEngaged
                  ? "scale-[1.1] shadow-[0_0_24px_rgba(215,185,95,0.5)]"
                  : "scale-100 shadow-[0_0_16px_rgba(215,185,95,0.32)]"
            }`}
          />
        </div>
        {projects.map((project, index) => {
          const itemAngle = getSpinnerItemAngle(index, projects.length) + projectSpinner.rotation;
          const radians = itemAngle * (Math.PI / 180);
          const left = Number((50 + Math.cos(radians) * 39.5).toFixed(4));
          const top = Number((50 + Math.sin(radians) * 39.5).toFixed(4));
          const distance = Math.abs(normalizeSpinnerAngle(itemAngle));
          const proximity = Math.max(0, 1 - distance / 180);
          const isActive = projectSpinner.activationIndex === index;
          const isSelectedProject = selectedProjectId === project.id;
          const scale = isActive ? 0.96 : 0.52 + proximity * 0.24;
          const opacity = isActive ? 1 : 0.2 + proximity * 0.52;

          return (
            <div
              key={project.id}
              className={`absolute h-[4.25rem] w-[4.25rem] will-change-[left,top,transform,opacity] md:h-[5.5rem] md:w-[5.5rem] ${
                projectSpinner.isDragging
                  ? "transition-none"
                  : "transition-[left,top,transform,opacity] duration-[260ms] ease-out"
              }`}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                opacity,
                transform: `translate(-50%, -50%) scale(${scale})`,
                zIndex: isActive ? 20 : Math.max(1, Math.round(proximity * 10))
              }}
            >
              <button
                ref={(element) => {
                  projectBubbleRefs.current[index] = element;
                }}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (projectSpinner.consumeSuppressedClick()) return;
                  projectSpinner.activateIndex(index);
                }}
                className={`flex h-full w-full flex-col items-center justify-center rounded-full border bg-white px-2 text-center outline-none transition-[background-color,border-color,box-shadow,filter] duration-[240ms] ease-out ${
                  isSelectedProject
                    ? "border-[#d7b95f] bg-[#fff9df] shadow-[inset_0_5px_10px_rgba(15,61,46,0.12),0_8px_22px_rgba(215,185,95,0.32)] brightness-90 motion-safe:animate-[project-bubble-confirm_240ms_ease-out]"
                    : isActive
                    ? "border-[#d7b95f] bg-[#fffdf4] shadow-[inset_0_4px_9px_rgba(15,61,46,0.08),0_6px_16px_rgba(15,61,46,0.16)] brightness-95"
                    : "border-field-secondary/50 shadow-[0_5px_12px_rgba(15,61,46,0.10)] hover:border-field-primary hover:bg-field-light"
                } active:brightness-90 focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2`}
                aria-label={`${project.name} ${pickerTitle}`}
                aria-pressed={isActive || isSelectedProject}
              >
                <span className="overflow-hidden text-[11px] font-black leading-[1.4] text-field-primary [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] md:text-xs">
                  <span className="font-display">{project.name}</span>
                </span>
                <span className="mt-1 hidden max-w-full truncate text-[9px] font-bold text-field-muted md:block md:text-[10px]">
                  {project.accessRole === "progress" ? "진행도 권한" : project.shareConfigured ? "관리자 권한" : "공유 설정 필요"}
                </span>
              </button>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
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
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative grid h-[100dvh] min-h-[100svh] w-full place-items-center overflow-hidden bg-field-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div ref={canvasRef} className="flex h-full w-full overflow-auto overscroll-contain px-4 py-6 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden md:px-8">
        <div
          ref={compositionRef}
          className={`relative m-auto flex w-full items-center justify-center transition-[gap] duration-[360ms] ease-out ${
            isProjectRingOpen
              ? "max-w-[25rem] md:max-w-[36rem]"
              : isProgressMode
                ? "max-w-[24rem] flex-col gap-4"
                : pickerMode
                  ? "max-w-[42rem] flex-col gap-7 md:flex-row md:gap-12"
                  : "max-w-[24rem]"
          }`}
        >
          <div
            className={
              isProjectRingOpen
                ? "relative flex aspect-square w-[min(94vw,25rem)] shrink-0 items-center justify-center motion-safe:animate-[project-ring-reveal_260ms_ease-out] md:w-[min(92vw,36rem)]"
                : "contents"
            }
          >
            {isProjectRingOpen ? renderProjectSpinner() : null}
            <div
              ref={wheelRef}
              role="group"
              tabIndex={0}
              aria-label="원형 기능 메뉴. 좌우 방향키 또는 드래그로 회전"
              className={`relative z-20 aspect-square shrink-0 touch-none select-none rounded-full outline-none transition-[width,opacity] duration-[360ms] ease-out focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-4 ${
                isProjectRingOpen
                  ? "w-[46%] opacity-80 sm:w-[50%] md:w-[62%] md:opacity-100"
                  : "w-[min(90vw,21rem)] md:w-[min(82vw,22rem)]"
              }`}
              {...mainSpinner.pointerHandlers}
              onClick={(event) => {
                if (event.target !== event.currentTarget) return;
                if (mainSpinner.consumeSuppressedClick()) return;
                closeProjectRing();
              }}
              onKeyDown={handleWheelKeyDown}
            >
              <div className="pointer-events-none absolute inset-[15%] rounded-full border border-field-border bg-white/45 shadow-[inset_0_0_0_10px_rgba(255,255,255,0.34),0_14px_30px_rgba(15,61,46,0.08)]" aria-hidden />
              <div className="pointer-events-none absolute inset-[23%] rounded-full border border-dashed border-field-secondary/40" aria-hidden />
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-field-border bg-field-bg shadow-[0_3px_9px_rgba(15,61,46,0.10)] md:h-8 md:w-8" aria-hidden />
              <div
                ref={mainTargetRef}
                className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#d7b95f]/70 bg-[#fff7d8]/35 shadow-[0_0_18px_rgba(215,185,95,0.34)] ${
                  isProjectRingOpen
                    ? "left-[79%] h-16 w-16 md:h-[6.25rem] md:w-[6.25rem]"
                    : "left-[83%] h-[4.75rem] w-[4.75rem] md:h-[6.25rem] md:w-[6.25rem]"
                }`}
                aria-hidden
              />
              {wheelItems.map((item, index) => {
                const angle = (getSpinnerItemAngle(index, wheelItems.length) + mainSpinner.rotation) * (Math.PI / 180);
                const radius = isProjectRingOpen ? 29 : 33;
                const left = Number((50 + Math.cos(angle) * radius).toFixed(4));
                const top = Number((50 + Math.sin(angle) * radius).toFixed(4));
                const isTargeted = activatedWheelItem === item.id;
                const isSelected = selectedMainId === item.id || pickerMode === item.id;
                const isEmphasized = isTargeted || isSelected;
                return (
                  <button
                    key={item.id}
                    ref={(element) => {
                      mainBubbleRefs.current[index] = element;
                    }}
                    type="button"
                    aria-label={item.ariaLabel}
                    aria-pressed={isTargeted || isSelected}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (mainSpinner.consumeSuppressedClick()) return;
                      mainSpinner.activateIndex(index);
                    }}
                    className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border px-2 text-center text-white outline-none will-change-[left,top,transform] ${item.colorClass} ${
                      isProjectRingOpen
                        ? "h-14 w-14 md:h-20 md:w-20"
                        : "h-[4.25rem] w-[4.25rem] sm:h-24 sm:w-24"
                    } ${
                      mainSpinner.isDragging
                        ? "transition-none"
                        : "transition-[left,top,transform,opacity,box-shadow,border-color,filter] duration-[260ms] ease-out"
                    } ${
                      isEmphasized
                        ? isProjectRingOpen
                          ? "z-20 scale-[0.86] border-[#d7b95f] opacity-85 shadow-[inset_0_4px_8px_rgba(0,0,0,0.18),0_5px_12px_rgba(15,61,46,0.13)] brightness-95 md:scale-[0.94] md:opacity-100"
                          : "z-20 scale-[0.94] border-[#d7b95f] opacity-100 shadow-[inset_0_5px_10px_rgba(0,0,0,0.22),0_6px_15px_rgba(15,61,46,0.18)] brightness-95"
                        : isProjectRingOpen
                          ? "z-10 scale-[0.7] border-white/70 opacity-55 shadow-[0_4px_10px_rgba(15,61,46,0.08)] hover:opacity-75 md:scale-[0.82] md:opacity-70"
                          : "z-10 scale-[0.82] border-white/70 opacity-70 shadow-[0_5px_14px_rgba(15,61,46,0.12)] hover:opacity-90"
                    } ${isSelected ? "motion-safe:animate-[main-selection-confirm_260ms_ease-out]" : ""} active:scale-[0.9] focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2`}
                    style={{
                      left: `${left}%`,
                      top: `${top}%`
                    }}
                  >
                    <span
                      className={`font-display-strong font-black leading-[1.2] transition-[font-size,font-weight,transform] duration-[240ms] ease-out ${
                        isEmphasized
                          ? isProjectRingOpen
                            ? "text-[11px] md:text-sm"
                            : "text-[15px] sm:text-lg"
                          : isProjectRingOpen
                            ? "text-[8px] md:text-[10px]"
                            : "text-[11px] sm:text-[13px]"
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {isProgressMode && projects.length === 0 ? (
            <p className="pointer-events-none whitespace-nowrap rounded-full border border-field-border bg-white/95 px-4 py-2 text-center text-[11px] font-black text-field-muted shadow-sm">
              진행 볼 프로젝트가 없습니다
            </p>
          ) : null}

          {pickerMode && !isProgressMode ? (
          <>
          <div className="h-8 w-px shrink-0 bg-field-secondary/60 motion-safe:animate-[branch-reveal_220ms_ease-out] md:h-px md:w-12" aria-hidden />
          <div
            ref={clusterRef}
            role="region"
            aria-label={pickerTitle}
            className="relative z-10 w-full max-w-[20rem] shrink-0 motion-safe:animate-[branch-reveal_220ms_ease-out] md:w-[14rem]"
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
            ) : null}
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
        @keyframes project-ring-reveal {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes main-selection-confirm {
          0% { filter: brightness(1); }
          45% { filter: brightness(0.86); }
          100% { filter: brightness(0.95); }
        }
        @keyframes project-target-confirm {
          0% { transform: scale(1.1); }
          55% { transform: scale(1.25); }
          100% { transform: scale(1.18); }
        }
        @keyframes project-bubble-confirm {
          0% { filter: brightness(0.95); }
          50% { filter: brightness(0.84); }
          100% { filter: brightness(0.9); }
        }
      `}</style>
    </div>
  );
}

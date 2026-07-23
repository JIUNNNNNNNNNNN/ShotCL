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
    path: "M180 180 L180 24 A156 156 0 0 1 315.1 258 Z",
    textX: 250,
    textY: 116,
    fillClass: "fill-field-primary group-hover:fill-[#174d3b]"
  },
  {
    id: "join",
    label: "Join Project",
    path: "M180 180 L44.9 258 A156 156 0 0 1 180 24 Z",
    textX: 110,
    textY: 116,
    fillClass: "fill-[#557d6d] group-hover:fill-[#628b7a]"
  },
  {
    id: "progress",
    label: "Go",
    path: "M180 180 L315.1 258 A156 156 0 0 1 44.9 258 Z",
    textX: 180,
    textY: 272,
    fillClass: "fill-[#416f5d] group-hover:fill-[#4c7b68]"
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
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const clusterRef = useRef<HTMLDivElement | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, []);

  useEffect(() => {
    if (!pickerMode) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      const clickedWheel = wheelRef.current?.contains(event.target);
      const clickedSubmenu = clusterRef.current?.contains(event.target);
      if (!clickedWheel && !clickedSubmenu) setPickerMode(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPickerMode(null);
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
        clusterRef.current?.scrollIntoView({
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

  function activateWheelItem(id: WheelItemId) {
    setFeedback(null);
    setNewProjectError("");
    setIsCreatingProject(false);

    if (pickerMode === id) {
      setPickerMode(null);
      return;
    }

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

  function handleWheelKeyDown(event: React.KeyboardEvent<SVGGElement>, id: (typeof wheelItems)[number]["id"]) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activateWheelItem(id);
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
      const now = new Date();
      const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
      const response = await fetch("/api/projects/create", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName: name, adminPassword, progressPassword, shootDate: localToday })
      });
      const payload = (await response.json()) as { project?: Record<string, unknown>; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error || "프로젝트를 만들지 못했습니다.");
      const project = projectFromRow(payload.project);
      unhideProject(project.id);
      window.location.assign(`/projects/${project.id}`);
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
          <span className="overflow-hidden text-[11px] font-black leading-[1.4] tracking-[-0.015em] text-field-primary [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] md:text-xs">
            {project.name}
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
      <div ref={canvasRef} className="h-full w-full overflow-auto overscroll-contain [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
        <div
          className={`relative mx-auto transition-[width,height] duration-200 ${
            pickerMode ? "h-[48rem] w-[50rem]" : "h-[min(82vw,21rem)] w-[min(82vw,21rem)]"
          }`}
        >
        <div ref={wheelRef} className={`absolute z-20 ${pickerMode ? "left-[14.5rem] top-[11rem] w-[21rem]" : "inset-0 w-full"}`}>
        <svg viewBox="0 0 360 360" className="block h-auto w-full drop-shadow-[0_12px_24px_rgba(15,61,46,0.12)]" role="group" aria-label="첫 화면 기능 메뉴">
          <circle cx="180" cy="180" r="160" className="fill-white stroke-field-border" strokeWidth="2" />
          {wheelItems.map((item) => {
            const isSelected = pickerMode === item.id;
            return (
              <g
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={item.label}
                aria-pressed={isSelected}
                className="group cursor-pointer outline-none"
                onClick={() => activateWheelItem(item.id)}
                onKeyDown={(event) => handleWheelKeyDown(event, item.id)}
              >
                <path
                  d={item.path}
                  className={`${item.fillClass} stroke-field-bg transition-[filter,transform,fill,stroke] duration-150 [transform-box:fill-box] [transform-origin:center] group-hover:brightness-110 group-active:scale-[0.985] group-active:brightness-90 group-focus-visible:stroke-[#d7b95f] group-focus-visible:drop-shadow-[0_0_5px_rgba(215,185,95,0.8)]`}
                  style={isSelected ? { fill: "#092f23", stroke: "#d7b95f", filter: "drop-shadow(0 0 5px rgba(15, 61, 46, 0.35))" } : undefined}
                  strokeWidth={isSelected ? "7" : "5"}
                />
                <text
                  x={item.textX}
                  y={item.textY}
                  textAnchor="middle"
                  className="pointer-events-none select-none fill-white text-[14px] font-black tracking-[-0.015em] transition-opacity duration-150 group-active:opacity-80"
                >
                  <tspan x={item.textX} dy="0">{item.label}</tspan>
                </text>
              </g>
            );
          })}
          <circle cx="180" cy="180" r="16" className="fill-field-bg stroke-field-border" strokeWidth="2" aria-hidden />
        </svg>
        </div>

        {pickerMode ? (
          <>
          <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full motion-safe:animate-[branch-reveal_180ms_ease-out]" viewBox="0 0 800 768" aria-hidden>
            {pickerMode === "new" ? (
              <>
                <path d="M526 244 C560 228 562 178 604 150" fill="none" stroke="#8ca99d" strokeWidth="2" />
                <path d="M604 150 C626 136 644 132 666 134" fill="none" stroke="#c9d6d0" strokeWidth="1.5" />
              </>
            ) : pickerMode === "join" ? (
              <>
                <path d="M274 244 C236 224 226 180 190 150" fill="none" stroke="#8ca99d" strokeWidth="2" />
                <path d="M190 150 C168 136 150 132 128 134" fill="none" stroke="#c9d6d0" strokeWidth="1.5" />
              </>
            ) : (
              <path d="M292 470 C254 500 226 528 208 558" fill="none" stroke="#8ca99d" strokeWidth="2" />
            )}
          </svg>
          <div
            ref={clusterRef}
            role="region"
            aria-label={pickerTitle}
            className={`absolute z-10 motion-safe:animate-[branch-reveal_180ms_ease-out] ${
              pickerMode === "new"
                ? "left-[36.5rem] top-[4.5rem] w-[12.5rem]"
                : pickerMode === "join"
                  ? "left-2 top-[4.5rem] w-[12.5rem]"
                : "left-2 top-[31rem] w-[12.5rem]"
            }`}
          >
            <div className={`mb-2 flex items-center gap-1.5 ${pickerMode === "new" ? "justify-start" : "justify-end"}`}>
              <h1 className="rounded-full border border-field-border bg-field-bg/95 px-3 py-1 text-[11px] font-black text-field-primary shadow-sm">{pickerTitle}</h1>
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
                  {isCreatingProject ? "만드는 중" : "만들기"}
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
                  {isCreatingProject ? "확인 중" : "참여"}
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

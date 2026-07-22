"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { createProject, listProjects } from "@/lib/data/projects";
import type { Project } from "@/lib/types";

type ProjectPickerMode = "new" | "load" | "progress";
type WheelItemId = (typeof wheelItems)[number]["id"];

const wheelItems = [
  {
    id: "new",
    label: ["새 프로젝트", "만들기"],
    path: "M180 180 L180 24 A156 156 0 0 1 315.1 258 Z",
    textX: 246,
    textY: 134,
    fillClass: "fill-field-primary group-hover:fill-[#174d3b]"
  },
  {
    id: "load",
    label: ["프로젝트", "불러오기"],
    path: "M180 180 L315.1 258 A156 156 0 0 1 44.9 258 Z",
    textX: 180,
    textY: 246,
    fillClass: "fill-[#285d49] group-hover:fill-[#326b55]"
  },
  {
    id: "progress",
    label: ["진행", "보기"],
    path: "M180 180 L44.9 258 A156 156 0 0 1 180 24 Z",
    textX: 114,
    textY: 134,
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
  const [newProjectError, setNewProjectError] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [feedback, setFeedback] = useState<{ target: WheelItemId; message: string } | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const clusterRef = useRef<HTMLDivElement | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSavedProjects() {
      try {
        const data = await listProjects();
        if (isMounted) setProjects(data);
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
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setPickerMode(null);
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
    const animationFrame = window.requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      const cluster = clusterRef.current;
      if (!canvas || !cluster) return;
      const clusterCenterX = cluster.offsetLeft + cluster.offsetWidth / 2;
      const clusterCenterY = cluster.offsetTop + cluster.offsetHeight / 2;
      canvas.scrollTo({
        left: Math.max(0, clusterCenterX - canvas.clientWidth / 2),
        top: Math.max(0, clusterCenterY - canvas.clientHeight / 2),
        behavior: "smooth"
      });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [pickerMode]);

  function showFeedback(target: WheelItemId, message: string) {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedback({ target, message });
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 1500);
  }

  function activateWheelItem(id: WheelItemId) {
    setFeedback(null);
    setNewProjectError("");

    if (id === "new") {
      setPickerMode("new");
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

    if (projects.length === 0) {
      showFeedback(id, id === "load" ? "불러올 프로젝트 없음" : "진행 볼 프로젝트 없음");
      return;
    }

    setPickerMode(id);
  }

  function handleWheelKeyDown(event: React.KeyboardEvent<SVGGElement>, id: (typeof wheelItems)[number]["id"]) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activateWheelItem(id);
  }

  function openProject(projectId: string) {
    if (pickerMode === "load") {
      router.push(`/projects/${projectId}/daily-plans`);
      return;
    }
    router.push(`/projects/${projectId}`);
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name) {
      setNewProjectError("프로젝트 이름을 입력하세요.");
      return;
    }

    setNewProjectError("");
    setIsCreatingProject(true);
    try {
      const now = new Date();
      const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
      const project = await createProject({ name, shootDate: localToday, description: "" });
      router.push(`/projects/${project.id}`);
    } catch (error) {
      setNewProjectError(error instanceof Error ? error.message : "프로젝트를 만들지 못했습니다.");
      setIsCreatingProject(false);
    }
  }

  const pickerTitle = pickerMode === "new" ? "새 프로젝트" : pickerMode === "load" ? "프로젝트 불러오기" : "진행보기";

  function renderProjectFruits() {
    if (isLoading || errorMessage || projects.length === 0) return null;

    return projects.map((project) => (
      <button
        key={project.id}
        type="button"
        onClick={() => openProject(project.id)}
        className="group/fruit relative z-10 flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border border-field-secondary/50 bg-white px-2 text-center shadow-[0_5px_14px_rgba(15,61,46,0.10)] transition-[background-color,border-color,box-shadow,transform] duration-150 hover:border-field-primary hover:bg-field-light hover:shadow-[0_7px_18px_rgba(15,61,46,0.16)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2 md:h-[5.5rem] md:w-[5.5rem]"
        aria-label={`${project.name} ${pickerTitle}`}
      >
        <span className="overflow-hidden text-[11px] font-black leading-[1.25] text-field-primary [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] md:text-xs">
          {project.name}
        </span>
        <span className="mt-1 max-w-full truncate text-[9px] font-bold text-field-muted md:text-[10px]">
          {project.shootDate || "촬영일 미정"}
        </span>
      </button>
    ));
  }

  function renderFruitBranches(mode: Exclude<ProjectPickerMode, "new">) {
    const columnCount = mode === "load" ? 3 : 2;
    const rowCount = Math.max(1, Math.ceil(projects.length / columnCount));

    return projects.map((project, index) => {
      const column = index % columnCount;
      const row = Math.floor(index / columnCount);
      const targetX = ((column + 0.5) / columnCount) * 100;
      const targetY = ((row + 0.5) / rowCount) * 100;
      const path = mode === "load"
        ? `M50 0 C50 ${targetY * 0.32} ${targetX} ${targetY * 0.68} ${targetX} ${targetY}`
        : `M100 50 C${82 + targetX * 0.08} 50 ${targetX + 10} ${targetY} ${targetX} ${targetY}`;

      return <path key={project.id} d={path} fill="none" stroke="#c9d6d0" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />;
    });
  }

  return (
    <div className="relative grid min-h-[100svh] w-full place-items-center overflow-hidden bg-field-bg">
      <div ref={canvasRef} className="w-full max-h-[100svh] overflow-auto overscroll-contain [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
        <div
          ref={pickerRef}
          className={`relative mx-auto transition-[width,height] duration-200 ${
            pickerMode ? "h-[48rem] w-[50rem]" : "h-[min(82vw,21rem)] w-[min(82vw,21rem)]"
          }`}
        >
        <div className={`absolute z-20 ${pickerMode ? "left-[14.5rem] top-[11rem] w-[21rem]" : "inset-0 w-full"}`}>
        <svg viewBox="0 0 360 360" className="block h-auto w-full drop-shadow-[0_12px_24px_rgba(15,61,46,0.12)]" role="group" aria-label="첫 화면 기능 메뉴">
          <circle cx="180" cy="180" r="160" className="fill-white stroke-field-border" strokeWidth="2" />
          {wheelItems.map((item) => {
            const isSelected = pickerMode === item.id;
            return (
              <g
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={item.label.join(" ")}
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
                  className="pointer-events-none select-none fill-white text-[14px] font-black transition-opacity duration-150 group-active:opacity-80"
                >
                  <tspan x={item.textX} dy="0">{item.label[0]}</tspan>
                  <tspan x={item.textX} dy="20">{item.label[1]}</tspan>
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
            ) : pickerMode === "progress" ? (
              <path d="M245 302 C228 294 224 230 208 212" fill="none" stroke="#8ca99d" strokeWidth="2" />
            ) : (
              <path d="M400 500 C400 516 390 528 400 536" fill="none" stroke="#8ca99d" strokeWidth="2" />
            )}
          </svg>
          <div
            ref={clusterRef}
            role="region"
            aria-label={pickerTitle}
            className={`absolute z-10 motion-safe:animate-[branch-reveal_180ms_ease-out] ${
              pickerMode === "new"
                ? "left-[36.5rem] top-[4.5rem] w-[12.5rem]"
                : pickerMode === "progress"
                  ? "left-2 top-[4.5rem] w-[12.5rem]"
                  : "left-[14rem] top-[31rem] w-[22rem]"
            }`}
          >
            <div className={`mb-2 flex items-center gap-1.5 ${pickerMode === "load" ? "justify-center" : pickerMode === "new" ? "justify-start" : "justify-end"}`}>
              <h1 className="rounded-full border border-field-border bg-field-bg/95 px-3 py-1 text-[11px] font-black text-field-primary shadow-sm">{pickerTitle}</h1>
              <button
                type="button"
                onClick={() => setPickerMode(null)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-field-border bg-white text-field-muted transition-colors hover:border-field-secondary hover:bg-field-soft active:bg-field-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]"
                aria-label="프로젝트 선택창 닫기"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            {pickerMode === "new" ? (
              <form
                onSubmit={handleCreateProject}
                className="grid w-full gap-2 rounded-[2rem] border border-field-secondary/50 bg-white p-3 shadow-[0_6px_18px_rgba(15,61,46,0.12)]"
              >
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(event) => {
                    setNewProjectName(event.target.value);
                    if (newProjectError) setNewProjectError("");
                  }}
                  placeholder="프로젝트 이름"
                  aria-label="새 프로젝트 이름"
                  className="h-9 min-w-0 rounded-full border border-field-border bg-field-bg px-3 text-center text-xs font-bold text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-light"
                />
                {newProjectError ? <p className="px-2 text-center text-[10px] font-bold leading-4 text-field-danger">{newProjectError}</p> : null}
                <button
                  type="submit"
                  disabled={isCreatingProject}
                  className="h-9 rounded-full bg-field-primary px-3 text-xs font-black text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2"
                >
                  {isCreatingProject ? "만드는 중" : "만들기"}
                </button>
              </form>
            ) : (
              <div className="py-1">
                <div className={`relative grid auto-rows-[5rem] gap-2 md:auto-rows-[5.5rem] ${
                  pickerMode === "progress" ? "grid-cols-2 justify-items-center" : "grid-cols-3 justify-items-center"
                }`}>
                  <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                    {renderFruitBranches(pickerMode)}
                  </svg>
                  {renderProjectFruits()}
                </div>
              </div>
            )}
          </div>
          </>
        ) : null}
        {feedback ? (
          <p
            role="status"
            className={`absolute z-30 whitespace-nowrap rounded-full border border-field-border bg-white px-3 py-1.5 text-[11px] font-black text-field-primary shadow-[0_5px_14px_rgba(15,61,46,0.12)] ${
              feedback.target === "load"
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

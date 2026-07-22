"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { listProjects } from "@/lib/data/projects";
import type { Project } from "@/lib/types";

type ProjectPickerMode = "load" | "progress";

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
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

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
      const panel = panelRef.current;
      if (!canvas || !panel) return;
      const panelCenter = panel.offsetLeft + panel.offsetWidth / 2;
      canvas.scrollTo({ left: Math.max(0, panelCenter - canvas.clientWidth / 2 - 39), behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [pickerMode]);

  function activateWheelItem(id: (typeof wheelItems)[number]["id"]) {
    if (id === "new") {
      router.push("/projects/new");
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

  const pickerTitle = pickerMode === "load" ? "프로젝트 불러오기" : "진행보기";

  return (
    <div className="relative grid min-h-[100svh] w-full place-items-center overflow-hidden bg-field-bg py-8">
      <div ref={canvasRef} className="w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          ref={pickerRef}
          className={`relative mx-auto grid min-h-[25rem] items-center transition-[width] duration-150 ${
            pickerMode ? "w-[45rem] grid-cols-[21rem_2rem_19rem] pr-12" : "w-[min(82vw,21rem)] grid-cols-1"
          }`}
        >
        <div className="relative w-full">
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
                aria-pressed={item.id === "new" ? undefined : isSelected}
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
          <div className={`relative h-px w-full bg-field-secondary/60 ${pickerMode === "load" ? "-rotate-6" : "rotate-6"}`} aria-hidden>
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-field-secondary bg-field-bg" />
          </div>
          <div
            ref={panelRef}
            role="dialog"
            aria-label={pickerTitle}
            className={`z-20 w-76 rounded-[8px] border border-field-border bg-white p-2 shadow-[0_8px_22px_rgba(28,28,26,0.14)] ${pickerMode === "load" ? "-translate-y-10" : "translate-y-10"}`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-field-border px-1 pb-1.5">
              <h1 className="text-sm font-black text-field-primary">{pickerTitle}</h1>
              <button
                type="button"
                onClick={() => setPickerMode(null)}
                className="flex h-8 w-8 items-center justify-center rounded-[5px] text-field-muted hover:bg-field-soft"
                aria-label="프로젝트 선택창 닫기"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="mt-1.5 grid max-h-64 gap-1 overflow-y-auto">
              {isLoading ? <p className="px-2 py-4 text-center text-xs font-bold text-field-muted">프로젝트를 불러오는 중입니다.</p> : null}
              {!isLoading && errorMessage ? <p className="px-2 py-4 text-center text-xs font-bold text-field-danger">{errorMessage}</p> : null}
              {!isLoading && !errorMessage && projects.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs font-bold text-field-muted">
                  {pickerMode === "load" ? "저장된 프로젝트가 없습니다." : "진행을 볼 프로젝트가 없습니다."}
                </p>
              ) : null}
              {!isLoading && !errorMessage ? projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => openProject(project.id)}
                  className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[5px] border border-field-border bg-field-bg px-2.5 py-1.5 text-left hover:border-field-secondary hover:bg-field-light"
                >
                  <span className="truncate text-sm font-black text-field-text">{project.name}</span>
                  <span className="whitespace-nowrap text-[10px] font-bold text-field-muted">{project.shootDate || "촬영일 미정"}</span>
                </button>
              )) : null}
            </div>
          </div>
          </>
        ) : null}
        </div>
      </div>
    </div>
  );
}

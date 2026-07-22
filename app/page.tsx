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
  const clusterRef = useRef<HTMLDivElement | null>(null);

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

  function renderProjectFruits() {
    if (isLoading) {
      return <div className="grid h-20 w-20 place-items-center rounded-full border border-field-border bg-white text-center text-[11px] font-bold text-field-muted md:h-24 md:w-24">불러오는 중</div>;
    }

    if (errorMessage || projects.length === 0) {
      return (
        <div className="grid h-20 w-20 place-items-center rounded-full border border-field-border bg-white px-2 text-center text-[11px] font-bold text-field-muted md:h-24 md:w-24">
          {errorMessage ? "불러오기 실패" : "프로젝트 없음"}
        </div>
      );
    }

    return projects.map((project) => (
      <button
        key={project.id}
        type="button"
        onClick={() => openProject(project.id)}
        className="group/fruit flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border border-field-secondary/50 bg-white px-2 text-center shadow-[0_5px_14px_rgba(15,61,46,0.10)] transition-[background-color,border-color,box-shadow,transform] duration-150 hover:border-field-primary hover:bg-field-light hover:shadow-[0_7px_18px_rgba(15,61,46,0.16)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2 md:h-24 md:w-24"
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
          <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full" viewBox="0 0 800 768" aria-hidden>
            {pickerMode === "progress" ? (
              <>
                <path d="M245 302 H208" fill="none" stroke="#8ca99d" strokeWidth="2" />
                <path d="M208 156 V386" fill="none" stroke="#b8c9c1" strokeWidth="1.5" />
                <path d="M58 160 H208 M162 160 H208 M58 264 H208 M162 264 H208 M58 368 H208 M162 368 H208" fill="none" stroke="#c9d6d0" strokeWidth="1.5" />
              </>
            ) : (
              <>
                <path d="M400 500 V580" fill="none" stroke="#8ca99d" strokeWidth="2" />
                <path d="M280 580 H520 M280 580 V602 M400 580 V602 M520 580 V602" fill="none" stroke="#c9d6d0" strokeWidth="1.5" />
              </>
            )}
          </svg>
          <div
            ref={clusterRef}
            role="region"
            aria-label={pickerTitle}
            className={`absolute z-10 ${
              pickerMode === "progress" ? "left-2 top-[4.5rem] w-[12.5rem]" : "left-[14rem] top-[32.5rem] w-[22rem]"
            }`}
          >
            <div className={`mb-2 flex items-center gap-1.5 ${pickerMode === "load" ? "justify-center" : "justify-end"}`}>
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
            <div className={`grid gap-2 overflow-y-auto overscroll-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
              pickerMode === "progress" ? "max-h-[13rem] grid-cols-2 justify-items-center" : "max-h-[6.75rem] grid-cols-3 justify-items-center"
            }`}>
              {renderProjectFruits()}
            </div>
          </div>
          </>
        ) : null}
        </div>
      </div>
    </div>
  );
}

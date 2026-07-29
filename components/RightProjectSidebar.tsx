"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  FilePenLine,
  Images,
  ListChecks,
  PanelRight,
  Shirt,
  Table2,
  Users,
  X,
  type LucideIcon
} from "lucide-react";
import type { SharedProjectRole } from "@/lib/projectAccess/core";

type RightProjectSidebarProps = {
  projectId: string;
  projectName: string | null;
  role: SharedProjectRole | null;
};

/** 프로젝트 내부 화면에서 권한별 회차 이동과 관리 기능을 제공하는 공용 패널입니다. */
export function RightProjectSidebar({
  projectId,
  projectName,
  role
}: RightProjectSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ dailyPlanId?: string | string[] }>();
  const routePlanId = Array.isArray(params.dailyPlanId) ? params.dailyPlanId[0] : params.dailyPlanId;
  const currentPlanId = routePlanId || searchParams.get("dailyPlanId") || "";
  const progressOnly = role === "progress";
  const pageType = getProjectPageType(pathname, `/projects/${projectId}`);
  const shouldShowSidebar = progressOnly || pageType !== "other";
  const isProjectEntry = pageType === "progress" && !currentPlanId;
  const [isOpen, setIsOpen] = useState(isProjectEntry);
  const sidebarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setIsOpen(isProjectEntry);
  }, [isProjectEntry, pathname, currentPlanId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !sidebarRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const closePanel = useCallback(() => setIsOpen(false), []);

  if (!shouldShowSidebar) return null;

  return (
    <aside
      ref={sidebarRef}
      aria-label="프로젝트 메뉴"
      className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] md:right-5"
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={isOpen
          ? "프로젝트 메뉴 닫기"
          : "프로젝트 메뉴 열기"}
        aria-expanded={isOpen}
        aria-controls="right-project-menu"
        className="ml-auto grid h-10 w-10 place-items-center rounded-full border border-field-secondary bg-white/95 text-field-primary shadow-[0_3px_10px_rgba(28,28,26,0.08)] transition-[background-color,border-color,transform] hover:border-field-primary hover:bg-field-light active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2 md:h-11 md:w-11"
      >
        {isOpen
          ? <X className="h-[18px] w-[18px] md:h-5 md:w-5" aria-hidden />
          : <PanelRight className="h-[18px] w-[18px] md:h-5 md:w-5" aria-hidden />}
      </button>

      <div
        id="right-project-menu"
        role="dialog"
        aria-modal="false"
        aria-label="프로젝트 메뉴"
        aria-hidden={!isOpen}
        className={`absolute right-0 top-[calc(100%+0.5rem)] w-[min(18rem,calc(100vw-1.5rem))] origin-top-right transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
          isOpen
            ? "visible translate-y-0 scale-y-100 opacity-100"
            : "invisible pointer-events-none -translate-y-2 scale-y-95 opacity-0"
        }`}
      >
        <PanelContent
          projectName={projectName}
          currentPlanId={currentPlanId}
          projectId={projectId}
          progressOnly={progressOnly}
          pageType={pageType}
          onClose={closePanel}
        />
      </div>
    </aside>
  );
}

type PanelContentProps = {
  projectName: string | null;
  currentPlanId: string;
  projectId: string;
  progressOnly: boolean;
  pageType: ProjectPageType;
  onClose?: () => void;
};

const PanelContent = memo(function PanelContent({
  projectName,
  currentPlanId,
  projectId,
  progressOnly,
  pageType,
  onClose
}: PanelContentProps) {
  const projectBasePath = `/projects/${projectId}`;

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-field-border bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-field-border bg-field-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-lg font-black text-field-primary">{projectName || "프로젝트"}</p>
          <p className="mt-0.5 text-xs font-bold text-field-muted">프로젝트 메뉴</p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="프로젝트 패널 닫기"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-field-border bg-white text-field-muted transition active:scale-95"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="max-h-[calc(100dvh-10rem)] overflow-y-auto p-3">
        <p className="mb-2 px-1 text-xs font-bold text-field-muted">작업할 메뉴를 선택하세요.</p>
        <nav className="grid grid-cols-2 gap-2" aria-label="프로젝트 빠른 이동">
          {projectMenuItems
            .filter((item) => !progressOnly || item.progressVisible)
            .map((item) => {
              const selected = item.pageTypes.includes(pageType);
              const href = item.id === "progress"
                ? currentPlanId
                  ? `${projectBasePath}?dailyPlanId=${encodeURIComponent(currentPlanId)}`
                  : projectBasePath
                : `${projectBasePath}${item.path}`;
              return (
                <ProjectMenuLink
                  key={item.id}
                  href={href}
                  icon={item.icon}
                  label={item.label}
                  selected={selected}
                  onSelect={onClose}
                />
              );
            })}
        </nav>
      </div>
    </div>
  );
});

type ProjectPageType =
  | "progress"
  | "dailyPlan"
  | "dailyPlanList"
  | "staffList"
  | "sceneList"
  | "basicInfo"
  | "scenario"
  | "costumes"
  | "storyboardOverhead"
  | "other";

type ProjectMenuItem = {
  id: "basicInfo" | "dailyPlans" | "progress" | "staffList" | "sceneList" | "scenario" | "costumes" | "storyboardOverhead";
  label: string;
  icon: LucideIcon;
  path: string;
  pageTypes: ProjectPageType[];
  progressVisible: boolean;
};

const projectMenuItems: ProjectMenuItem[] = [
  {
    id: "basicInfo",
    label: "기본정보",
    icon: FilePenLine,
    path: "/basic-info",
    pageTypes: ["basicInfo"],
    progressVisible: false
  },
  {
    id: "dailyPlans",
    label: "일촬표",
    icon: CalendarDays,
    path: "/daily-plans",
    pageTypes: ["dailyPlan", "dailyPlanList"],
    progressVisible: false
  },
  {
    id: "progress",
    label: "진행도",
    icon: ListChecks,
    path: "",
    pageTypes: ["progress"],
    progressVisible: true
  },
  {
    id: "staffList",
    label: "스탭리스트",
    icon: Users,
    path: "/staff-list",
    pageTypes: ["staffList"],
    progressVisible: false
  },
  {
    id: "sceneList",
    label: "씬리스트",
    icon: Table2,
    path: "/scene-list",
    pageTypes: ["sceneList"],
    progressVisible: true
  },
  {
    id: "scenario",
    label: "시나리오",
    icon: BookOpen,
    path: "/scenario",
    pageTypes: ["scenario"],
    progressVisible: true
  },
  {
    id: "costumes",
    label: "의상",
    icon: Shirt,
    path: "/costumes",
    pageTypes: ["costumes"],
    progressVisible: true
  },
  {
    id: "storyboardOverhead",
    label: "부감도&콘티",
    icon: Images,
    path: "/storyboard-overhead",
    pageTypes: ["storyboardOverhead"],
    progressVisible: true
  }
];

function ProjectMenuLink({
  href,
  icon: Icon,
  label,
  selected,
  onSelect
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  selected: boolean;
  onSelect?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label}${selected ? " · 현재 페이지" : "로 이동"}`}
      aria-current={selected ? "page" : undefined}
      title={label}
      onClick={(event) => {
        if (selected) event.preventDefault();
        onSelect?.();
      }}
      className={`relative flex min-h-[82px] min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-center transition-[background-color,border-color,transform,box-shadow] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2 ${
        selected
          ? "border-field-primary bg-field-light text-field-primary shadow-[inset_0_0_0_1px_rgba(15,61,46,0.2)]"
          : "border-field-border bg-white text-field-muted hover:border-field-secondary hover:bg-field-soft hover:text-field-primary"
      }`}
    >
      {selected ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-field-primary" aria-hidden /> : null}
      <Icon className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
      <span className="w-full break-keep text-xs font-black leading-[1.35]">{label}</span>
    </Link>
  );
}

function getProjectPageType(pathname: string, projectBasePath: string): ProjectPageType {
  if (pathname === projectBasePath) return "progress";
  if (pathname === `${projectBasePath}/basic-info`) return "basicInfo";
  if (pathname === `${projectBasePath}/staff-list`) return "staffList";
  if (pathname === `${projectBasePath}/scene-list`) return "sceneList";
  if (pathname === `${projectBasePath}/scenario`) return "scenario";
  if (pathname === `${projectBasePath}/costumes`) return "costumes";
  if (pathname === `${projectBasePath}/storyboard-overhead`) return "storyboardOverhead";
  if (pathname === `${projectBasePath}/daily-plans`) return "dailyPlanList";
  if (new RegExp(`^${escapeRegExp(projectBasePath)}/daily-plans/(new|[^/]+)$`).test(pathname)) return "dailyPlan";
  return "other";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

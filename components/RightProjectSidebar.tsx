"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import {
  BookOpen,
  ChevronLeft,
  FilePenLine,
  Files,
  Images,
  ListChecks,
  PanelRight,
  Printer,
  Save,
  Shirt,
  Table2,
  Users,
  X
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
  const projectBasePath = `/projects/${projectId}`;
  const pageType = getProjectPageType(pathname, projectBasePath);
  const isProjectGuide = (
    pathname === projectBasePath
    && !currentPlanId
    && searchParams.get("view") !== "progress"
  );
  const shouldShowSidebar = !isProjectGuide && (progressOnly || pageType !== "other");
  const [isOpen, setIsOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname, currentPlanId]);

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
      aria-label={progressOnly ? "진행도 이동" : "프로젝트 관리"}
      className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] md:right-5"
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={isOpen
          ? "프로젝트 메뉴 닫기"
          : progressOnly
            ? "진행도 이동 메뉴 열기"
            : "프로젝트 관리 메뉴 열기"}
        aria-expanded={isOpen}
        aria-controls="right-project-menu"
        className="ml-auto grid h-10 w-10 place-items-center border border-field-divider bg-field-elevated text-field-subtle transition-[background-color,border-color,transform] hover:border-field-subtle hover:bg-field-hover hover:text-field-text active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 md:h-11 md:w-11"
      >
        {isOpen
          ? <X className="h-[18px] w-[18px] md:h-5 md:w-5" aria-hidden />
          : <PanelRight className="h-[18px] w-[18px] md:h-5 md:w-5" aria-hidden />}
      </button>

      <div
        id="right-project-menu"
        role="dialog"
        aria-modal="false"
        aria-label={progressOnly ? "진행도 이동" : "프로젝트 관리"}
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
    <div className="overflow-hidden border border-field-divider bg-field-elevated">
      <div className="flex items-start gap-3 border-b border-field-divider bg-field-elevated px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-lg font-black text-field-text">{projectName || "프로젝트"}</p>
          <p className="mt-0.5 text-xs font-bold text-field-muted">{progressOnly ? "진행도" : "관리 메뉴"}</p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="프로젝트 패널 닫기"
            className="grid h-8 w-8 shrink-0 place-items-center border border-field-divider bg-field-panel text-field-muted transition hover:border-field-subtle hover:bg-field-hover hover:text-field-text active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="max-h-[calc(100dvh-10rem)] overflow-y-auto p-3">
        {progressOnly ? (
          <nav className="grid gap-2" aria-label="진행도 페이지 이동">
            {pageType !== "progress" ? <SideActionLink href={createProgressPath(projectBasePath, currentPlanId)} icon={ListChecks}>진행도</SideActionLink> : null}
            {pageType !== "staffList" ? <SideActionLink href={`${projectBasePath}/staff-list`} icon={Users}>스탭리스트</SideActionLink> : null}
            {pageType !== "sceneList" ? <SideActionLink href={`${projectBasePath}/scene-list`} icon={Table2}>씬리스트</SideActionLink> : null}
            <ReferencePageLinks pageType={pageType} projectBasePath={projectBasePath} />
          </nav>
        ) : (
          <KeyStaffPageActions
            pageType={pageType}
            projectBasePath={projectBasePath}
            currentPlanId={currentPlanId}
            onAction={onClose}
          />
        )}
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

function KeyStaffPageActions({
  pageType,
  projectBasePath,
  currentPlanId,
  onAction
}: {
  pageType: ProjectPageType;
  projectBasePath: string;
  currentPlanId: string;
  onAction?: () => void;
}) {
  const progressPath = createProgressPath(projectBasePath, currentPlanId);

  return (
    <nav className="grid gap-2" aria-label="관리 페이지 이동">
      {pageType === "progress" ? (
        <>
          <SideActionLink href={`${projectBasePath}/basic-info`} icon={FilePenLine}>기본정보</SideActionLink>
          <SideActionLink href={`${projectBasePath}/staff-list`} icon={Users}>스탭리스트</SideActionLink>
          <SideActionLink href={`${projectBasePath}/scene-list`} icon={Table2}>씬리스트</SideActionLink>
          <SideActionLink href={`${projectBasePath}/daily-plans`} icon={Files}>일촬표</SideActionLink>
        </>
      ) : null}

      {pageType === "dailyPlan" ? (
        <>
          <SideActionLink href={`${projectBasePath}/basic-info`} icon={FilePenLine}>기본정보</SideActionLink>
          <SideActionLink href={`${projectBasePath}/staff-list`} icon={Users}>스탭리스트</SideActionLink>
          <SideActionLink href={`${projectBasePath}/scene-list`} icon={Table2}>씬리스트</SideActionLink>
          <SideActionButton
            icon={Printer}
            onClick={() => {
              window.dispatchEvent(new Event("daily-plan:request-print"));
              onAction?.();
            }}
          >
            PDF 내보내기
          </SideActionButton>
          <SideActionLink href={progressPath} icon={ListChecks}>진행도</SideActionLink>
          <SideActionButton
            icon={Save}
            onClick={() => {
              window.dispatchEvent(new Event("daily-plan:request-save"));
              onAction?.();
            }}
          >
            일촬표 저장
          </SideActionButton>
        </>
      ) : null}

      {pageType === "dailyPlanList" ? (
        <>
          <SideActionLink href={`${projectBasePath}/basic-info`} icon={FilePenLine}>기본정보</SideActionLink>
          <SideActionLink href={`${projectBasePath}/staff-list`} icon={Users}>스탭리스트</SideActionLink>
          <SideActionLink href={`${projectBasePath}/scene-list`} icon={Table2}>씬리스트</SideActionLink>
          <SideActionLink href={progressPath} icon={ListChecks}>진행도</SideActionLink>
        </>
      ) : null}

      {pageType === "staffList" ? (
        <>
          <SideActionLink href={progressPath} icon={ListChecks}>진행도</SideActionLink>
          <SideActionLink href={`${projectBasePath}/basic-info`} icon={FilePenLine}>기본정보</SideActionLink>
          <SideActionLink href={`${projectBasePath}/scene-list`} icon={Table2}>씬리스트</SideActionLink>
          <SideActionLink href={`${projectBasePath}/daily-plans`} icon={Files}>일촬표</SideActionLink>
        </>
      ) : null}

      {pageType === "basicInfo" ? (
        <>
          <SideActionLink href={`${projectBasePath}/staff-list`} icon={Users}>스탭리스트</SideActionLink>
          <SideActionLink href={`${projectBasePath}/scene-list`} icon={Table2}>씬리스트</SideActionLink>
          <SideActionLink href={`${projectBasePath}/daily-plans`} icon={Files}>일촬표</SideActionLink>
          <SideActionLink href={progressPath} icon={ListChecks}>진행도</SideActionLink>
        </>
      ) : null}

      {pageType === "sceneList" ? (
        <>
          <SideActionLink href={progressPath} icon={ListChecks}>진행도</SideActionLink>
          <SideActionLink href={`${projectBasePath}/basic-info`} icon={FilePenLine}>기본정보</SideActionLink>
          <SideActionLink href={`${projectBasePath}/staff-list`} icon={Users}>스탭리스트</SideActionLink>
          <SideActionLink href={`${projectBasePath}/daily-plans`} icon={Files}>일촬표</SideActionLink>
        </>
      ) : null}

      {pageType === "scenario" || pageType === "costumes" || pageType === "storyboardOverhead" ? (
        <>
          <SideActionLink href={`${projectBasePath}/basic-info`} icon={FilePenLine}>기본정보</SideActionLink>
          <SideActionLink href={`${projectBasePath}/staff-list`} icon={Users}>스탭리스트</SideActionLink>
          <SideActionLink href={`${projectBasePath}/scene-list`} icon={Table2}>씬리스트</SideActionLink>
          <SideActionLink href={`${projectBasePath}/daily-plans`} icon={Files}>일촬표</SideActionLink>
          <SideActionLink href={progressPath} icon={ListChecks}>진행도</SideActionLink>
        </>
      ) : null}

      <ReferencePageLinks pageType={pageType} projectBasePath={projectBasePath} />
    </nav>
  );
}

function ReferencePageLinks({
  pageType,
  projectBasePath
}: {
  pageType: ProjectPageType;
  projectBasePath: string;
}) {
  return (
    <>
      {pageType !== "scenario" ? <SideActionLink href={`${projectBasePath}/scenario`} icon={BookOpen}>시나리오</SideActionLink> : null}
      {pageType !== "costumes" ? <SideActionLink href={`${projectBasePath}/costumes`} icon={Shirt}>의상</SideActionLink> : null}
      {pageType !== "storyboardOverhead" ? <SideActionLink href={`${projectBasePath}/storyboard-overhead`} icon={Images}>부감도&콘티</SideActionLink> : null}
    </>
  );
}

function SideActionLink({
  href,
  icon: Icon,
  children
}: {
  href: string;
  icon: typeof ChevronLeft;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-10 items-center gap-2 border border-field-divider bg-field-panel px-3 py-2 text-sm font-black text-field-text transition hover:border-field-subtle hover:bg-field-hover active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {children}
    </Link>
  );
}

function SideActionButton({
  icon: Icon,
  children,
  onClick
}: {
  icon: typeof ChevronLeft;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-10 w-full items-center gap-2 border border-field-divider bg-field-panel px-3 py-2 text-left text-sm font-black text-field-text transition hover:border-field-subtle hover:bg-field-hover active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {children}
    </button>
  );
}

function createProgressPath(projectBasePath: string, currentPlanId: string) {
  return currentPlanId
    ? `${projectBasePath}?dailyPlanId=${encodeURIComponent(currentPlanId)}`
    : `${projectBasePath}?view=progress`;
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

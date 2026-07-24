"use client";

import { memo, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  Files,
  ListChecks,
  PanelRight,
  Printer,
  Save,
  Table2,
  Users,
  X
} from "lucide-react";
import type { SharedProjectRole } from "@/lib/projectAccess/core";

type RightProjectSidebarProps = {
  projectId: string;
  projectName: string | null;
  role: SharedProjectRole | null;
  placement?: "side" | "bottom";
};

/** 프로젝트 내부 화면에서 권한별 회차 이동과 관리 기능을 제공하는 공용 패널입니다. */
export function RightProjectSidebar({
  projectId,
  projectName,
  role,
  placement = "side"
}: RightProjectSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ dailyPlanId?: string | string[] }>();
  const routePlanId = Array.isArray(params.dailyPlanId) ? params.dailyPlanId[0] : params.dailyPlanId;
  const currentPlanId = routePlanId || searchParams.get("dailyPlanId") || "";
  const progressOnly = role === "progress";
  const pageType = getProjectPageType(pathname, `/projects/${projectId}`);
  const shouldShowSidebar = progressOnly || pageType !== "other";
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname, currentPlanId]);

  useEffect(() => {
    if (!isMobileOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMobileOpen]);

  const collapsePanel = useCallback(() => setIsCollapsed(true), []);
  const closeMobilePanel = useCallback(() => setIsMobileOpen(false), []);

  if (!shouldShowSidebar) return null;

  return (
    <>
      <aside
        aria-label={progressOnly ? "진행도 이동" : "프로젝트 관리"}
        className={placement === "bottom"
          ? "mt-5 hidden w-full lg:block"
          : `sticky top-[max(4rem,calc(env(safe-area-inset-top)+3.25rem))] hidden self-start lg:block ${
              isCollapsed ? "w-12" : "w-[280px]"
            }`}
      >
        {placement === "side" && isCollapsed ? (
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            aria-label="프로젝트 사이드 패널 펼치기"
            className="grid h-12 w-12 place-items-center rounded-full border border-field-border bg-white text-field-primary transition hover:border-field-primary hover:bg-field-light active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-field-primary"
          >
            <PanelRight className="h-5 w-5" aria-hidden />
          </button>
        ) : (
          <PanelContent
            projectName={projectName}
            currentPlanId={currentPlanId}
            projectId={projectId}
            progressOnly={progressOnly}
            pageType={pageType}
            layout={placement}
            onCollapse={placement === "side" ? collapsePanel : undefined}
          />
        )}
      </aside>

      <button
        type="button"
        onClick={() => setIsMobileOpen(true)}
        aria-label={progressOnly ? "진행도 이동 패널 열기" : "프로젝트 관리 패널 열기"}
        aria-expanded={isMobileOpen}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 grid h-12 w-12 place-items-center rounded-full border border-field-primary bg-field-primary text-white shadow-sm transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-field-primary lg:hidden"
      >
        <PanelRight className="h-5 w-5" aria-hidden />
      </button>

      {isMobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={progressOnly ? "진행도 이동" : "프로젝트 관리"}>
          <button
            type="button"
            className="absolute inset-0 h-full w-full rounded-none bg-black/25"
            onClick={() => setIsMobileOpen(false)}
            aria-label="패널 닫기"
          />
          <div className="safe-bottom absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[min(78dvh,44rem)] overflow-y-auto rounded-[1.5rem]">
            <PanelContent
              projectName={projectName}
              currentPlanId={currentPlanId}
              projectId={projectId}
              progressOnly={progressOnly}
              pageType={pageType}
              layout="side"
              onClose={closeMobilePanel}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

type PanelContentProps = {
  projectName: string | null;
  currentPlanId: string;
  projectId: string;
  progressOnly: boolean;
  pageType: ProjectPageType;
  layout: "side" | "bottom";
  onCollapse?: () => void;
  onClose?: () => void;
};

const PanelContent = memo(function PanelContent({
  projectName,
  currentPlanId,
  projectId,
  progressOnly,
  pageType,
  layout,
  onCollapse,
  onClose
}: PanelContentProps) {
  const projectBasePath = `/projects/${projectId}`;

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-field-border bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-field-border bg-field-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-lg font-black text-field-primary">{projectName || "프로젝트"}</p>
          <p className="mt-0.5 text-xs font-bold text-field-muted">{progressOnly ? "진행도" : "Key staff"}</p>
        </div>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="프로젝트 사이드 패널 접기"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-field-border bg-white text-field-muted transition hover:text-field-primary active:scale-95"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
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
        {progressOnly ? (
          <nav className="grid gap-2" aria-label="진행도 페이지 이동">
            {pageType === "sceneList" ? (
              <SideActionLink href={projectBasePath} icon={ListChecks}>진행도</SideActionLink>
            ) : (
              <SideActionLink href={`${projectBasePath}/scene-list`} icon={Table2}>씬리스트</SideActionLink>
            )}
          </nav>
        ) : (
          <KeyStaffPageActions
            pageType={pageType}
            projectBasePath={projectBasePath}
            currentPlanId={currentPlanId}
            layout={layout}
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
  | "other";

function KeyStaffPageActions({
  pageType,
  projectBasePath,
  currentPlanId,
  layout,
  onAction
}: {
  pageType: ProjectPageType;
  projectBasePath: string;
  currentPlanId: string;
  layout: "side" | "bottom";
  onAction?: () => void;
}) {
  const progressPath = currentPlanId
    ? `${projectBasePath}?dailyPlanId=${encodeURIComponent(currentPlanId)}`
    : projectBasePath;

  return (
    <nav
      className={layout === "bottom" ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-4" : "grid gap-2"}
      aria-label="Key staff 페이지 이동"
    >
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

    </nav>
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
      className="flex min-h-10 items-center gap-2 rounded-full border border-field-border bg-white px-3 py-2 text-sm font-black text-field-primary transition hover:bg-field-soft active:scale-[0.99]"
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
      className="flex min-h-10 w-full items-center gap-2 rounded-full border border-field-border bg-white px-3 py-2 text-left text-sm font-black text-field-primary transition hover:bg-field-soft active:scale-[0.99]"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {children}
    </button>
  );
}

function getProjectPageType(pathname: string, projectBasePath: string): ProjectPageType {
  if (pathname === projectBasePath) return "progress";
  if (pathname === `${projectBasePath}/basic-info`) return "basicInfo";
  if (pathname === `${projectBasePath}/staff-list`) return "staffList";
  if (pathname === `${projectBasePath}/scene-list`) return "sceneList";
  if (pathname === `${projectBasePath}/daily-plans`) return "dailyPlanList";
  if (new RegExp(`^${escapeRegExp(projectBasePath)}/daily-plans/(new|[^/]+)$`).test(pathname)) return "dailyPlan";
  return "other";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  Files,
  ListChecks,
  PanelRight,
  Printer,
  Settings,
  X
} from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { listDailyPlans } from "@/lib/data/dailyPlans";
import { getProject } from "@/lib/data/projects";
import { listShots } from "@/lib/data/shots";
import { subscribeToShotChanges } from "@/lib/realtime/subscribeToShots";
import type { SharedProjectRole } from "@/lib/projectAccess/core";
import type { DailyPlan, Project, Shot } from "@/lib/types";

type PlanWithCount = DailyPlan & { shotCount: number };

type EpisodeProgress = {
  total: number;
  completed: number;
  percent: number;
};

type RightProjectSidebarProps = {
  projectId: string;
  role: SharedProjectRole | null;
};

const emptyProgress: EpisodeProgress = { total: 0, completed: 0, percent: 0 };

/** 프로젝트 내부 화면에서 권한별 회차 이동과 관리 기능을 제공하는 공용 패널입니다. */
export function RightProjectSidebar({ projectId, role }: RightProjectSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ dailyPlanId?: string | string[] }>();
  const routePlanId = Array.isArray(params.dailyPlanId) ? params.dailyPlanId[0] : params.dailyPlanId;
  const currentPlanId = routePlanId || searchParams.get("dailyPlanId") || "";
  const progressOnly = role === "progress";
  const [project, setProject] = useState<Project | null>(null);
  const [plans, setPlans] = useState<PlanWithCount[]>([]);
  const [progressByPlan, setProgressByPlan] = useState<Record<string, EpisodeProgress>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const loadPanelData = useCallback(async () => {
    try {
      const projectData = await getProject(projectId);
      if (!projectData) {
        setProject(null);
        setPlans([]);
        setProgressByPlan({});
        setErrorMessage("");
        return;
      }

      const planData = sortDailyPlans(await listDailyPlans(projectData.id));
      const progressEntries = await Promise.all(
        planData.map(async (plan) => {
          const shots = await listShots(projectData.id, plan.id);
          return [plan.id, summarizeShots(shots)] as const;
        })
      );

      setProject(projectData);
      setPlans(planData);
      setProgressByPlan(Object.fromEntries(progressEntries));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "회차 정보를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadPanelData();
  }, [loadPanelData, pathname, currentPlanId]);

  useEffect(() => {
    if (!project?.id) return undefined;
    return subscribeToShotChanges(project.id, loadPanelData);
  }, [loadPanelData, project?.id]);

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

  const editorPlanPathPattern = useMemo(
    () => new RegExp(`^/projects/${escapeRegExp(projectId)}/daily-plans/[^/]+$`),
    [projectId]
  );
  const isSavedPlanEditor = Boolean(routePlanId && editorPlanPathPattern.test(pathname));

  if (!project && !isLoading) return null;

  return (
    <>
      <aside
        aria-label={progressOnly ? "회차 이동" : "프로젝트 관리"}
        className={`sticky top-[max(4rem,calc(env(safe-area-inset-top)+3.25rem))] hidden self-start lg:block ${
          isCollapsed ? "w-12" : "w-[280px]"
        }`}
      >
        {isCollapsed ? (
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
            project={project}
            plans={plans}
            progressByPlan={progressByPlan}
            currentPlanId={currentPlanId}
            projectId={projectId}
            progressOnly={progressOnly}
            isLoading={isLoading}
            errorMessage={errorMessage}
            isSavedPlanEditor={isSavedPlanEditor}
            pathname={pathname}
            onCollapse={() => setIsCollapsed(true)}
          />
        )}
      </aside>

      <button
        type="button"
        onClick={() => setIsMobileOpen(true)}
        aria-label={progressOnly ? "회차 이동 패널 열기" : "프로젝트 관리 패널 열기"}
        aria-expanded={isMobileOpen}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 grid h-12 w-12 place-items-center rounded-full border border-field-primary bg-field-primary text-white shadow-sm transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-field-primary lg:hidden"
      >
        <PanelRight className="h-5 w-5" aria-hidden />
      </button>

      {isMobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={progressOnly ? "회차 이동" : "프로젝트 관리"}>
          <button
            type="button"
            className="absolute inset-0 h-full w-full rounded-none bg-black/25"
            onClick={() => setIsMobileOpen(false)}
            aria-label="패널 닫기"
          />
          <div className="safe-bottom absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[min(78dvh,44rem)] overflow-y-auto rounded-[1.5rem]">
            <PanelContent
              project={project}
              plans={plans}
              progressByPlan={progressByPlan}
              currentPlanId={currentPlanId}
              projectId={projectId}
              progressOnly={progressOnly}
              isLoading={isLoading}
              errorMessage={errorMessage}
              isSavedPlanEditor={isSavedPlanEditor}
              pathname={pathname}
              onClose={() => setIsMobileOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

type PanelContentProps = {
  project: Project | null;
  plans: PlanWithCount[];
  progressByPlan: Record<string, EpisodeProgress>;
  currentPlanId: string;
  projectId: string;
  progressOnly: boolean;
  isLoading: boolean;
  errorMessage: string;
  isSavedPlanEditor: boolean;
  pathname: string;
  onCollapse?: () => void;
  onClose?: () => void;
};

function PanelContent({
  project,
  plans,
  progressByPlan,
  currentPlanId,
  projectId,
  progressOnly,
  isLoading,
  errorMessage,
  isSavedPlanEditor,
  pathname,
  onCollapse,
  onClose
}: PanelContentProps) {
  const projectBasePath = `/projects/${projectId}`;
  const inProgressContext = pathname === projectBasePath;

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-field-border bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-field-border bg-field-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-lg font-black text-field-primary">{project?.name || "프로젝트"}</p>
          <p className="mt-0.5 text-xs font-bold text-field-muted">{progressOnly ? "진행 모드" : "관리자"}</p>
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
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="font-display text-sm font-black text-field-primary">회차</p>
          <span className="text-xs font-bold text-field-muted">{plans.length}개</span>
        </div>

        {isLoading ? <PixelDogLoader size="xs" compact className="py-3" /> : null}
        {!isLoading && errorMessage ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold leading-5 text-field-danger">{errorMessage}</p>
        ) : null}
        {!isLoading && !errorMessage && plans.length === 0 ? (
          <p className="rounded-xl border border-field-border bg-field-soft px-3 py-3 text-center text-xs font-bold leading-5 text-field-muted">
            저장된 회차가 없습니다.
          </p>
        ) : null}

        <nav className="grid gap-2" aria-label="회차 목록">
          {plans.map((plan, index) => {
            const progress = progressByPlan[plan.id] ?? emptyProgress;
            const selected = plan.id === currentPlanId;
            const href = progressOnly || inProgressContext
              ? `${projectBasePath}?dailyPlanId=${encodeURIComponent(plan.id)}`
              : `${projectBasePath}/daily-plans/${plan.id}`;

            return (
              <Link
                key={plan.id}
                href={href}
                aria-current={selected ? "page" : undefined}
                className={`block rounded-2xl border px-3 py-2.5 transition active:scale-[0.99] ${
                  selected
                    ? "border-field-primary bg-field-light ring-1 ring-field-primary/20"
                    : "border-field-border bg-white hover:border-field-primary/60 hover:bg-field-soft"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display truncate text-sm font-black text-field-primary">{formatEpisodeLabel(plan, index)}</p>
                    <p className="mt-0.5 truncate text-[11px] font-bold text-field-muted">{plan.shootingDate || "촬영일 미정"}</p>
                  </div>
                  {progress.total > 0 ? (
                    <span className="shrink-0 rounded-full bg-field-soft px-2 py-1 text-[11px] font-black text-field-primary">{progress.percent}%</span>
                  ) : null}
                </div>
                {progress.total > 0 ? (
                  <div className="mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-field-soft">
                      <div className="h-full rounded-full bg-field-primary" style={{ width: `${progress.percent}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] font-bold text-field-muted">
                      완료 {progress.completed} / 총 {progress.total}컷
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] font-bold leading-4 text-field-muted">컷 없음 · 일촬표에서 컷수를 입력하세요</p>
                )}
              </Link>
            );
          })}
        </nav>

        {!progressOnly ? (
          <div className="mt-4 border-t border-field-border pt-3">
            <p className="mb-2 px-1 font-display text-sm font-black text-field-primary">관리</p>
            <div className="grid gap-2">
              {currentPlanId ? (
                <SideActionLink href={`${projectBasePath}/daily-plans/${currentPlanId}`} icon={FilePenLine}>
                  현재 일촬표 수정
                </SideActionLink>
              ) : null}
              <SideActionLink href={`${projectBasePath}/basic-info`} icon={FilePenLine}>
                기본정보 수정
              </SideActionLink>
              <SideActionLink href={`${projectBasePath}/daily-plans/new`} icon={CalendarPlus}>
                새 일촬표 만들기
              </SideActionLink>
              <SideActionLink href={`${projectBasePath}/daily-plans`} icon={Files}>
                저장된 일촬표 목록
              </SideActionLink>
              {isSavedPlanEditor ? (
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event("daily-plan:request-print"))}
                  className="flex min-h-10 w-full items-center gap-2 rounded-full border border-field-border bg-white px-3 py-2 text-left text-sm font-black text-field-primary transition hover:bg-field-soft active:scale-[0.99]"
                >
                  <Printer className="h-4 w-4 shrink-0" aria-hidden />
                  PDF 내보내기
                </button>
              ) : null}
              <SideActionLink
                href={currentPlanId ? `${projectBasePath}?dailyPlanId=${encodeURIComponent(currentPlanId)}` : projectBasePath}
                icon={ListChecks}
              >
                진행도 보기
              </SideActionLink>
              <SideActionLink href={`${projectBasePath}/edit`} icon={Settings}>
                프로젝트 설정
              </SideActionLink>
            </div>
          </div>
        ) : null}
      </div>
    </div>
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

function summarizeShots(shots: Shot[]): EpisodeProgress {
  const completed = shots.filter((shot) => shot.status === "ok" || shot.status === "omit").length;
  const total = shots.length;
  return {
    total,
    completed,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100)
  };
}

function sortDailyPlans(plans: PlanWithCount[]) {
  return [...plans].sort((left, right) => {
    const leftEpisode = parseEpisodeNumber(left.episode);
    const rightEpisode = parseEpisodeNumber(right.episode);
    if (leftEpisode !== null && rightEpisode !== null && leftEpisode !== rightEpisode) return leftEpisode - rightEpisode;
    if (leftEpisode !== null && rightEpisode === null) return -1;
    if (leftEpisode === null && rightEpisode !== null) return 1;
    if (left.shootingDate && right.shootingDate && left.shootingDate !== right.shootingDate) {
      return left.shootingDate.localeCompare(right.shootingDate);
    }
    if (left.shootingDate && !right.shootingDate) return -1;
    if (!left.shootingDate && right.shootingDate) return 1;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function parseEpisodeNumber(value: string) {
  const matched = value.match(/\d+/);
  return matched ? Number(matched[0]) : null;
}

function formatEpisodeLabel(plan: Pick<DailyPlan, "episode" | "shootingDate">, index: number) {
  const episode = plan.episode.trim();
  if (episode) return episode.includes("회차") ? episode : `${episode}회차`;
  return plan.shootingDate || `${index + 1}회차`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

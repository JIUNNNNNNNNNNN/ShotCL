import Link from "next/link";
import {
  BookOpen,
  CalendarDays,
  FilePenLine,
  Images,
  ListChecks,
  Shirt,
  Table2,
  Users,
  type LucideIcon
} from "lucide-react";
import type { SharedProjectRole } from "@/lib/projectAccess/core";
import { ProjectShootingCalendar } from "@/components/ProjectShootingCalendar";
import {
  buildProjectNavigationHref,
  getVisibleProjectNavigationItems,
  type ProjectNavigationItemId
} from "@/lib/projectNavigation";
import type { DailyPlan, ProjectCalendarInfo } from "@/lib/types";

type ProjectGuideMenuProps = {
  projectId: string;
  projectName: string;
  role: SharedProjectRole | null;
  calendarInfo?: ProjectCalendarInfo | null;
  dailyPlans: ReadonlyArray<Pick<DailyPlan, "shootingDate">>;
};

const PROJECT_GUIDE_ICONS: Record<ProjectNavigationItemId, LucideIcon> = {
  basicInfo: FilePenLine,
  dailyPlans: CalendarDays,
  progress: ListChecks,
  sceneList: Table2,
  staffList: Users,
  scenario: BookOpen,
  costumes: Shirt,
  storyboardOverhead: Images
};

/** 모든 진입 경로가 공유하는 프로젝트 홈의 일정과 빠른 이동 메뉴입니다. */
export function ProjectGuideMenu({
  projectId,
  projectName,
  role,
  calendarInfo,
  dailyPlans
}: ProjectGuideMenuProps) {
  return (
    <section className="mx-auto grid w-full max-w-[92rem] min-w-0 gap-7 py-2 sm:gap-8 sm:py-3">
      <header className="min-w-0 border-b border-field-divider pb-4">
        <h1 className="font-display-strong break-words text-2xl text-field-text sm:text-[1.75rem]">
          {projectName}
        </h1>
        <p className="mt-1.5 text-sm text-field-subtle">
          {calendarInfo
            ? `총 ${calendarInfo.totalEpisodes}회차 · 등록 일촬표 ${dailyPlans.length}개`
            : `등록 일촬표 ${dailyPlans.length}개`}
        </p>
      </header>

      <ProjectShootingCalendar
        projectId={projectId}
        calendarInfo={calendarInfo}
        dailyPlans={dailyPlans}
        canEditBasicInfo={role !== "progress"}
      />

      <div className="min-w-0">
        <div className="mb-3 flex items-end justify-between gap-3 px-0.5">
          <h2 className="font-display text-lg font-black text-field-text">프로젝트 메뉴</h2>
          <p className="text-xs text-field-muted">작업할 기능을 선택하세요.</p>
        </div>
        <nav className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3" aria-label="프로젝트 기능 길잡이">
          {getVisibleProjectNavigationItems(role).map((item) => {
            const Icon = PROJECT_GUIDE_ICONS[item.id];
            return (
              <Link
                key={item.id}
                href={buildProjectNavigationHref(projectId, item.id)}
                aria-label={`${item.label}로 이동`}
                className="flex min-h-24 min-w-0 flex-col items-center justify-center gap-2.5 rounded-[20px] border border-field-border bg-field-soft px-2 py-3 text-center text-field-subtle shadow-[0_10px_32px_rgba(0,0,0,0.14)] transition-[background-color,border-color,color,transform] hover:border-field-primary/45 hover:bg-field-hover hover:text-field-text active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg sm:min-h-28"
              >
                <Icon className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" strokeWidth={2} aria-hidden />
                <span className="w-full break-keep text-sm font-bold leading-[1.35]">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </section>
  );
}

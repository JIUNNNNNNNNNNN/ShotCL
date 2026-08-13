import type { SharedProjectRole } from "@/lib/projectAccess/core";
import { ProjectShootingCalendar } from "@/components/ProjectShootingCalendar";
import type { DailyPlanListItem } from "@/lib/data/dailyPlans";
import type { ProjectCalendarInfo } from "@/lib/types";

type ProjectGuideMenuProps = {
  projectId: string;
  projectName: string;
  role: SharedProjectRole | null;
  calendarInfo?: ProjectCalendarInfo | null;
  dailyPlans: readonly DailyPlanListItem[];
};

/** 모든 진입 경로가 공유하는 프로젝트 홈의 요약과 촬영 일정입니다. */
export function ProjectGuideMenu({
  projectId,
  projectName,
  role,
  calendarInfo,
  dailyPlans
}: ProjectGuideMenuProps) {
  return (
    <section className="mx-auto grid w-full max-w-[92rem] min-w-0 gap-4 py-1 sm:gap-5 sm:py-2">
      <header className="min-w-0 border-b border-field-divider pb-3">
        <h1 className="ui-density-heading font-display-strong break-words leading-tight text-field-text">
          {projectName}
        </h1>
        <p className="mt-1 text-sm leading-5 text-field-subtle">
          {calendarInfo
            ? `총 ${calendarInfo.totalEpisodes}회차 · 등록 일촬표 ${dailyPlans.length}개`
            : `등록 일촬표 ${dailyPlans.length}개`}
        </p>
      </header>

      <div
        id={`project-account-permission-slot-${projectId}`}
        data-project-account-permission-slot={projectId}
        className="empty:hidden"
      />

      <ProjectShootingCalendar
        projectId={projectId}
        projectName={projectName}
        calendarInfo={calendarInfo}
        dailyPlans={dailyPlans}
        canManageEvents={role !== "progress"}
        canManageInvites={role === "admin"}
      />
    </section>
  );
}

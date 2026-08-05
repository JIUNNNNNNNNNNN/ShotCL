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
import {
  buildProjectNavigationHref,
  getVisibleProjectNavigationItems,
  type ProjectNavigationItemId
} from "@/lib/projectNavigation";

type ProjectGuideMenuProps = {
  projectId: string;
  role: SharedProjectRole | null;
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

/** Go로 프로젝트에 들어온 직후 표시하는 중앙 빠른 이동 메뉴입니다. */
export function ProjectGuideMenu({ projectId, role }: ProjectGuideMenuProps) {
  return (
    <section className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-4xl items-center justify-center py-4 sm:py-6">
      <div className="w-full max-w-3xl">
        <div className="mb-5 text-center sm:mb-6">
          <h1 className="font-display-strong text-2xl text-field-text sm:text-3xl">프로젝트 메뉴</h1>
          <p className="mt-1.5 text-sm text-field-subtle">작업할 기능을 선택하세요.</p>
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

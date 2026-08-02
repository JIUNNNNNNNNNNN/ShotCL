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

type ProjectGuideMenuProps = {
  projectId: string;
  role: SharedProjectRole | null;
  queryString?: string;
};

type ProjectGuideItem = {
  id: "basicInfo" | "dailyPlans" | "progress" | "staffList" | "sceneList" | "scenario" | "costumes" | "storyboardOverhead";
  label: string;
  icon: LucideIcon;
  path: string;
  progressVisible: boolean;
};

/** 프로젝트 첫 진입 화면과 메뉴 순서를 위한 단일 길잡이 설정입니다. */
const projectGuideItems: ProjectGuideItem[] = [
  { id: "basicInfo", label: "기본정보", icon: FilePenLine, path: "/basic-info", progressVisible: false },
  { id: "dailyPlans", label: "일촬표", icon: CalendarDays, path: "/daily-plans", progressVisible: false },
  { id: "progress", label: "진행도", icon: ListChecks, path: "?view=progress", progressVisible: true },
  { id: "staffList", label: "스탭리스트", icon: Users, path: "/staff-list", progressVisible: false },
  { id: "sceneList", label: "씬리스트", icon: Table2, path: "/scene-list", progressVisible: true },
  { id: "scenario", label: "시나리오", icon: BookOpen, path: "/scenario", progressVisible: true },
  { id: "costumes", label: "의상", icon: Shirt, path: "/costumes", progressVisible: true },
  { id: "storyboardOverhead", label: "부감도&콘티", icon: Images, path: "/storyboard-overhead", progressVisible: true }
];

/** Go로 프로젝트에 들어온 직후 표시하는 중앙 빠른 이동 메뉴입니다. */
export function ProjectGuideMenu({ projectId, role, queryString = "" }: ProjectGuideMenuProps) {
  const projectBasePath = `/projects/${projectId}`;
  const progressOnly = role === "progress";

  return (
    <section className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-4xl items-center justify-center py-4 sm:py-6">
      <div className="w-full max-w-3xl">
        <div className="mb-5 text-center sm:mb-6">
          <h1 className="font-display text-2xl font-black text-field-primary sm:text-3xl">프로젝트 메뉴</h1>
          <p className="mt-1.5 text-sm text-field-muted">작업할 기능을 선택하세요.</p>
        </div>

        <nav className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3" aria-label="프로젝트 기능 길잡이">
          {projectGuideItems
            .filter((item) => !progressOnly || item.progressVisible)
            .map((item) => (
              <Link
                key={item.id}
                href={createGuideHref(projectBasePath, item.path, queryString)}
                aria-label={`${item.label}로 이동`}
                className="flex min-h-24 min-w-0 flex-col items-center justify-center gap-2.5 border border-field-border bg-field-panel px-2 py-3 text-center text-field-muted transition-[background-color,border-color,color,transform] hover:border-field-primary hover:bg-field-primary hover:text-black active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:min-h-28"
              >
                <item.icon className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" strokeWidth={2} aria-hidden />
                <span className="w-full break-keep text-sm font-bold leading-[1.35]">{item.label}</span>
              </Link>
            ))}
        </nav>
      </div>
    </section>
  );
}

function createGuideHref(projectBasePath: string, path: string, queryString: string) {
  const [pathname, itemQuery = ""] = path.split("?");
  const params = new URLSearchParams(queryString);
  new URLSearchParams(itemQuery).forEach((value, key) => params.set(key, value));
  const mergedQuery = params.toString();
  return `${projectBasePath}${pathname}${mergedQuery ? `?${mergedQuery}` : ""}`;
}

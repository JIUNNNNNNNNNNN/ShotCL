import type { SharedProjectRole } from "@/lib/projectAccess/core";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

export type ProjectNavigationItemId =
  | "basicInfo"
  | "dailyPlans"
  | "progress"
  | "sceneList"
  | "staffList"
  | "scenario"
  | "costumes"
  | "storyboardOverhead";

export type ProjectNavigationItem = {
  id: ProjectNavigationItemId;
  label: string;
  path: string;
  progressVisible: boolean;
};

export type ProjectSearchParams = Pick<URLSearchParams, "get"> | null | undefined;

/** 프로젝트 길잡이와 좌측 내비게이션이 공유하는 canonical 메뉴 순서입니다. */
export const PROJECT_NAVIGATION_ITEMS: readonly ProjectNavigationItem[] = [
  { id: "basicInfo", label: "기본정보", path: "/basic-info", progressVisible: false },
  { id: "dailyPlans", label: "일촬표", path: "/daily-plans", progressVisible: false },
  { id: "progress", label: "진행도", path: "?view=progress", progressVisible: true },
  { id: "sceneList", label: "씬리스트", path: "/scene-list", progressVisible: true },
  { id: "staffList", label: "스탭리스트", path: "/staff-list", progressVisible: false },
  { id: "scenario", label: "시나리오", path: "/scenario", progressVisible: true },
  { id: "costumes", label: "의상", path: "/costumes", progressVisible: true },
  { id: "storyboardOverhead", label: "부감도&콘티", path: "/storyboard-overhead", progressVisible: true }
] as const;

/** Staff 권한에서는 기존 프로젝트 길잡이와 동일한 읽기 가능 메뉴만 노출합니다. */
export function getVisibleProjectNavigationItems(role: SharedProjectRole | null) {
  return role === "progress"
    ? PROJECT_NAVIGATION_ITEMS.filter((item) => item.progressVisible)
    : PROJECT_NAVIGATION_ITEMS;
}

/** 메뉴 및 회차 링크가 query를 다른 페이지로 누출하지 않도록 canonical URL만 생성합니다. */
export function buildProjectNavigationHref(
  projectId: string,
  itemId: ProjectNavigationItemId
) {
  const basePath = buildProjectBasePath(projectId);
  const item = PROJECT_NAVIGATION_ITEMS.find((candidate) => candidate.id === itemId);
  if (!item) return basePath;
  return `${basePath}${item.path}`;
}

export function buildDailyPlanRoundHref(projectId: string, dailyPlanId: string) {
  return `${buildProjectBasePath(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}`;
}

export function buildNewDailyPlanHref(projectId: string) {
  return `${buildProjectBasePath(projectId)}/daily-plans/new`;
}

export function buildProgressRoundHref(projectId: string, dailyPlanId: string) {
  const params = new URLSearchParams({ view: "progress", dailyPlanId });
  return `${buildProjectBasePath(projectId)}?${params.toString()}`;
}

export function buildProjectBasePath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}`;
}

/** Guest에게 허용하는 일촬표 URL을 목록과 실제 UUID 상세로만 제한합니다. */
export function isGuestDailyPlanReadPath(pathname: string, projectId: string) {
  const dailyPlansPath = `${buildProjectBasePath(projectId)}/daily-plans`;
  const normalizedPathname = pathname.replace(/\/$/u, "");
  if (normalizedPathname === dailyPlansPath) return true;
  if (!normalizedPathname.startsWith(`${dailyPlansPath}/`)) return false;

  const encodedDailyPlanId = normalizedPathname.slice(dailyPlansPath.length + 1);
  if (!encodedDailyPlanId || encodedDailyPlanId.includes("/")) return false;
  try {
    return isValidDatabaseProjectId(decodeURIComponent(encodedDailyPlanId));
  } catch {
    return false;
  }
}

/** pathname과 진행도 query를 함께 사용해 현재 프로젝트 기능을 판정합니다. */
export function resolveActiveProjectNavigationItem(
  pathname: string,
  searchParams: ProjectSearchParams,
  projectId?: string | null
): ProjectNavigationItemId | null {
  const route = parseProjectPath(pathname);
  if (!route || (projectId && normalizeProjectId(route.projectId) !== normalizeProjectId(projectId))) return null;

  if (!route.remainder) {
    return isProgressQuery(searchParams) ? "progress" : null;
  }
  if (route.remainder === "basic-info") return "basicInfo";
  if (route.remainder === "daily-plans" || route.remainder.startsWith("daily-plans/")) return "dailyPlans";
  if (route.remainder === "scene-list") return "sceneList";
  if (route.remainder === "staff-list") return "staffList";
  if (route.remainder === "scenario") return "scenario";
  if (route.remainder === "costumes") return "costumes";
  if (route.remainder === "storyboard-overhead") return "storyboardOverhead";
  return null;
}

/** 프로젝트 shell 상단 제목을 route에서 일관되게 계산합니다. */
export function getProjectPageTitle(pathname: string, searchParams: ProjectSearchParams) {
  const route = parseProjectPath(pathname);
  if (!route) return "프로젝트";
  if (!route.remainder) return isProgressQuery(searchParams) ? "진행도" : "Home";
  if (route.remainder === "basic-info") return "기본정보";
  if (route.remainder === "daily-plans") return "일촬표";
  if (route.remainder === "daily-plans/new") return "새 일촬표";
  if (route.remainder.startsWith("daily-plans/")) return "일촬표";
  if (route.remainder === "scene-list") return "씬리스트";
  if (route.remainder === "staff-list") return "스탭리스트";
  if (route.remainder === "scenario") return "시나리오";
  if (route.remainder === "costumes") return "의상";
  if (route.remainder === "storyboard-overhead") return "부감도&콘티";
  if (route.remainder === "edit") return "컷 편집";
  return "프로젝트";
}

export function isDailyPlanRoundActive(pathname: string, dailyPlanId: string) {
  const route = parseProjectPath(pathname);
  if (!route) return false;
  const match = route.remainder.match(/^daily-plans\/([^/]+)$/u);
  if (!match) return false;
  try {
    return decodeURIComponent(match[1]) === dailyPlanId;
  } catch {
    return false;
  }
}

export function isProgressRoundActive(searchParams: ProjectSearchParams, dailyPlanId: string) {
  return searchParams?.get("dailyPlanId") === dailyPlanId;
}

function isProgressQuery(searchParams: ProjectSearchParams) {
  return searchParams?.get("view") === "progress" || Boolean(searchParams?.get("dailyPlanId"));
}

function parseProjectPath(pathname: string) {
  const match = pathname.match(/^\/projects\/([^/]+)(?:\/(.*?))?\/?$/u);
  if (!match || match[1] === "new") return null;
  try {
    return {
      projectId: decodeURIComponent(match[1]),
      remainder: (match[2] ?? "").replace(/\/$/u, "")
    };
  } catch {
    return null;
  }
}

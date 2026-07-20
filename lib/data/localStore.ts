import type { AnalysisRun, AnalysisRunItem, DailyPlan, DailyPlanShot, Project, Shot, ShotStatusLog, StoryboardFile } from "@/lib/types";

const PROJECTS_KEY = "today-storyboard-projects";
const FILES_KEY = "today-storyboard-files";
const SHOTS_KEY = "today-storyboard-shots";
const LOGS_KEY = "today-storyboard-status-logs";
const ANALYSIS_RUNS_KEY = "today-storyboard-analysis-runs";
const ANALYSIS_RUN_ITEMS_KEY = "today-storyboard-analysis-run-items";
const DAILY_PLANS_KEY = "today-storyboard-daily-plans";
const DAILY_PLAN_SHOTS_KEY = "today-storyboard-daily-plan-shots";
const REVISION_KEY = "today-storyboard-revision";
const LOCAL_CHANGE_EVENT = "today-storyboard-local-change";

type LocalBuckets = {
  projects: Project[];
  files: StoryboardFile[];
  shots: Shot[];
  logs: ShotStatusLog[];
  analysisRuns: AnalysisRun[];
  analysisRunItems: AnalysisRunItem[];
  dailyPlans: DailyPlan[];
  dailyPlanShots: DailyPlanShot[];
};

/** 브라우저 저장소에 접근할 수 없는 서버 렌더링 순간을 안전하게 피합니다. */
function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** localStorage의 JSON 값을 읽고, 깨진 값이면 빈 배열로 복구합니다. */
function readArray<T>(key: string): T[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    window.localStorage.removeItem(key);
    return [];
  }
}

/** localStorage에 배열을 저장합니다. */
function writeArray<T>(key: string, value: T[]) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

/** 로컬 개발 모드에서 쓸 모든 컬렉션을 한 번에 읽습니다. */
export function readLocalBuckets(): LocalBuckets {
  return {
    projects: readArray<Project>(PROJECTS_KEY),
    files: readArray<StoryboardFile>(FILES_KEY),
    shots: readArray<Shot>(SHOTS_KEY),
    logs: readArray<ShotStatusLog>(LOGS_KEY),
    analysisRuns: readArray<AnalysisRun>(ANALYSIS_RUNS_KEY),
    analysisRunItems: readArray<AnalysisRunItem>(ANALYSIS_RUN_ITEMS_KEY),
    dailyPlans: readArray<DailyPlan>(DAILY_PLANS_KEY),
    dailyPlanShots: readArray<DailyPlanShot>(DAILY_PLAN_SHOTS_KEY)
  };
}

/** 부분 변경된 컬렉션만 저장하고, 같은 브라우저의 다른 화면에도 변경을 알립니다. */
export function writeLocalBuckets(next: Partial<LocalBuckets>, projectId?: string) {
  if (next.projects) writeArray(PROJECTS_KEY, next.projects);
  if (next.files) writeArray(FILES_KEY, next.files);
  if (next.shots) writeArray(SHOTS_KEY, next.shots);
  if (next.logs) writeArray(LOGS_KEY, next.logs);
  if (next.analysisRuns) writeArray(ANALYSIS_RUNS_KEY, next.analysisRuns);
  if (next.analysisRunItems) writeArray(ANALYSIS_RUN_ITEMS_KEY, next.analysisRunItems);
  if (next.dailyPlans) writeArray(DAILY_PLANS_KEY, next.dailyPlans);
  if (next.dailyPlanShots) writeArray(DAILY_PLAN_SHOTS_KEY, next.dailyPlanShots);
  notifyLocalProjectChange(projectId);
}

/** crypto API가 없는 환경까지 고려한 간단한 ID 생성기입니다. */
export function createLocalId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${prefix}_${randomId}`;
}

/** localStorage 기반 개발 모드에서 탭 간 변경과 현재 탭 변경을 모두 알립니다. */
export function notifyLocalProjectChange(projectId?: string) {
  if (!canUseStorage()) {
    return;
  }

  const detail = { projectId, revision: String(Date.now()) };
  window.localStorage.setItem(REVISION_KEY, JSON.stringify(detail));
  window.dispatchEvent(new CustomEvent(LOCAL_CHANGE_EVENT, { detail }));
}

/** 로컬 개발 모드에서 Supabase Realtime과 비슷한 구독 인터페이스를 제공합니다. */
export function subscribeToLocalProjectChanges(projectId: string, onChange: () => void) {
  if (!canUseStorage()) {
    return () => undefined;
  }

  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ projectId?: string }>).detail;
    if (!detail.projectId || detail.projectId === projectId) {
      onChange();
    }
  };

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== REVISION_KEY || !event.newValue) {
      return;
    }

    try {
      const detail = JSON.parse(event.newValue) as { projectId?: string };
      if (!detail.projectId || detail.projectId === projectId) {
        onChange();
      }
    } catch {
      onChange();
    }
  };

  window.addEventListener(LOCAL_CHANGE_EVENT, handleCustomEvent);
  window.addEventListener("storage", handleStorageEvent);

  return () => {
    window.removeEventListener(LOCAL_CHANGE_EVENT, handleCustomEvent);
    window.removeEventListener("storage", handleStorageEvent);
  };
}

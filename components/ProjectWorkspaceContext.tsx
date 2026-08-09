"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { listDailyPlans, type DailyPlanListItem } from "@/lib/data/dailyPlans";
import { getProject } from "@/lib/data/projects";
import type { DailyPlan, Project, ProjectBasicInfo } from "@/lib/types";

type DailyPlanSummaryPatch = Partial<Pick<
  DailyPlanListItem,
  "shotCount" | "progressTotal" | "progressCompleted" | "sceneNumbers"
>>;

type ProjectWorkspaceValue = {
  projectId: string;
  project: Project | null;
  projectName: string;
  dailyPlans: DailyPlanListItem[];
  isLoading: boolean;
  error: string;
  refreshDailyPlans: () => Promise<DailyPlanListItem[]>;
  updateProjectBasicInfo: (basicInfo: ProjectBasicInfo) => void;
  upsertDailyPlan: (plan: DailyPlan, summary?: DailyPlanSummaryPatch) => void;
  removeDailyPlan: (dailyPlanId: string) => void;
};

const ProjectWorkspaceContext = createContext<ProjectWorkspaceValue | null>(null);

/** 프로젝트 shell이 페이지·회차 navigation에 필요한 읽기 데이터를 한 번만 소유합니다. */
export function ProjectWorkspaceProvider({
  projectId,
  initialProjectName,
  children
}: {
  projectId: string;
  initialProjectName: string | null;
  children: React.ReactNode;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [dailyPlans, setDailyPlans] = useState<DailyPlanListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const loadVersionRef = useRef(0);

  const loadWorkspace = useCallback(async () => {
    const version = loadVersionRef.current + 1;
    loadVersionRef.current = version;
    setIsLoading(true);

    const [projectResult, planResult] = await Promise.allSettled([
      getProject(projectId),
      listDailyPlans(projectId)
    ]);
    if (loadVersionRef.current !== version) return;

    if (projectResult.status === "fulfilled") setProject(projectResult.value);
    if (planResult.status === "fulfilled") setDailyPlans(planResult.value);

    const messages = [projectResult, planResult].flatMap((result) => (
      result.status === "rejected"
        ? [result.reason instanceof Error ? result.reason.message : "프로젝트 메뉴를 불러오지 못했습니다."]
        : []
    ));
    setError(messages[0] ?? "");
    setIsLoading(false);
  }, [projectId]);

  useEffect(() => {
    void loadWorkspace();
    return () => {
      loadVersionRef.current += 1;
    };
  }, [loadWorkspace]);

  const refreshDailyPlans = useCallback(async () => {
    const plans = await listDailyPlans(projectId);
    setDailyPlans(plans);
    setError("");
    return plans;
  }, [projectId]);

  const updateProjectBasicInfo = useCallback((basicInfo: ProjectBasicInfo) => {
    setProject((current) => current ? {
      ...current,
      basicInfo,
      calendarInfo: {
        totalEpisodes: basicInfo.totalEpisodes,
        shootingStartDate: basicInfo.shootingStartDate,
        shootingEndDate: basicInfo.shootingEndDate
      }
    } : current);
  }, []);

  const upsertDailyPlan = useCallback((plan: DailyPlan, summary: DailyPlanSummaryPatch = {}) => {
    setDailyPlans((current) => {
      const previous = current.find((item) => item.id === plan.id);
      // Independent autosaves can resolve out of order. Never let an older
      // server echo replace a plan version that the workspace already knows.
      if (previous && compareUpdatedAt(plan.updatedAt, previous.updatedAt) < 0) return current;
      const next: DailyPlanListItem = {
        ...plan,
        shotCount: summary.shotCount ?? previous?.shotCount ?? 0,
        progressTotal: summary.progressTotal ?? previous?.progressTotal ?? 0,
        progressCompleted: summary.progressCompleted ?? previous?.progressCompleted ?? 0,
        sceneNumbers: summary.sceneNumbers ?? previous?.sceneNumbers ?? []
      };
      return [next, ...current.filter((item) => item.id !== plan.id)];
    });
  }, []);

  const removeDailyPlan = useCallback((dailyPlanId: string) => {
    setDailyPlans((current) => current.filter((item) => item.id !== dailyPlanId));
  }, []);

  const value = useMemo<ProjectWorkspaceValue>(() => ({
    projectId,
    project,
    projectName: project?.name || initialProjectName || "프로젝트",
    dailyPlans,
    isLoading,
    error,
    refreshDailyPlans,
    updateProjectBasicInfo,
    upsertDailyPlan,
    removeDailyPlan
  }), [
    dailyPlans,
    error,
    initialProjectName,
    isLoading,
    project,
    projectId,
    refreshDailyPlans,
    removeDailyPlan,
    updateProjectBasicInfo,
    upsertDailyPlan
  ]);

  return (
    <ProjectWorkspaceContext.Provider value={value}>
      {children}
    </ProjectWorkspaceContext.Provider>
  );
}

export function useProjectWorkspace() {
  const value = useContext(ProjectWorkspaceContext);
  if (!value) throw new Error("useProjectWorkspace must be used inside ProjectWorkspaceProvider.");
  return value;
}

function compareUpdatedAt(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.localeCompare(right);
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";
import { listDailyPlans, type DailyPlanListItem } from "@/lib/data/dailyPlans";
import type { ProjectWorkspaceSnapshot } from "@/lib/projectWorkspaceSnapshot";
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
  initialProgress: ProjectWorkspaceSnapshot["initialProgress"];
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
  initialWorkspace,
  children
}: {
  projectId: string;
  initialProjectName: string | null;
  initialWorkspace: ProjectWorkspaceSnapshot;
  children: React.ReactNode;
}) {
  const [project, setProject] = useState<Project | null>(initialWorkspace.project);
  const [dailyPlans, setDailyPlans] = useState<DailyPlanListItem[]>(initialWorkspace.dailyPlans);
  const [error, setError] = useState(initialWorkspace.error);
  const isLoading = false;

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
    initialProgress: initialWorkspace.initialProgress,
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
    initialWorkspace.initialProgress,
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

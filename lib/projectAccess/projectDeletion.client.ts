"use client";

import { clearAutosaveDraftsForProject } from "@/lib/client/autosaveDraftCache";
import { clearDailyPlanReadCache } from "@/lib/data/dailyPlans";
import { clearLocalProjectBuckets } from "@/lib/data/localStore";
import { clearProjectCalendarClientCache } from "@/lib/data/projectCalendarEvents";
import { clearProjectReadCache } from "@/lib/data/projects";
import { clearLocalProjectSceneList } from "@/lib/data/sceneList";
import { clearLocalProjectShotDiagrams } from "@/lib/data/shotDiagrams";
import { forgetDismissedProjectEverywhere } from "@/lib/projectAccess/dismissedProjects";
import { clearPendingProjectJoinNotice } from "@/lib/projectAccess/joinNotice.client";
import { forgetProjectSelection } from "@/lib/projectAccess/recentProject";
import {
  getLocalProjectIdCandidates
} from "@/lib/projectId";

/**
 * Canonical server deletion 성공 뒤 browser에 남은 해당 프로젝트 state만 폐기합니다.
 * 각 cleanup은 best-effort로 격리해 한 legacy storage 오류가 Main 이동을 막지 않게 합니다.
 */
export function clearDeletedProjectClientState(projectId: string) {
  const cleanupSteps = [
    () => clearProjectReadCache(projectId),
    () => clearDailyPlanReadCache(projectId),
    () => clearProjectCalendarClientCache(projectId),
    () => clearAutosaveDraftsForProject(projectId),
    () => clearLocalProjectBuckets(projectId),
    () => clearLocalProjectSceneList(projectId),
    () => clearLocalProjectShotDiagrams(projectId),
    () => forgetProjectSelection(projectId),
    () => forgetDismissedProjectEverywhere(projectId),
    () => clearPendingProjectJoinNotice(projectId),
    () => clearProjectSessionDrafts(projectId)
  ];
  for (const cleanup of cleanupSteps) {
    try {
      cleanup();
    } catch {
      // A stale browser cache must never turn a completed server deletion into a client error.
    }
  }
}

function clearProjectSessionDrafts(projectId: string) {
  if (typeof window === "undefined") return;
  for (const candidate of getLocalProjectIdCandidates(projectId)) {
    window.sessionStorage.removeItem(`shotcl:autosave:project-basic-info:${candidate}`);
  }
}

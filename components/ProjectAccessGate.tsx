"use client";

import { createContext, useContext, useEffect, useLayoutEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ProjectPageActionsProvider } from "@/components/ProjectPageActions";
import { ProjectWorkspaceProvider } from "@/components/ProjectWorkspaceContext";
import { ProjectWorkspaceShell } from "@/components/ProjectWorkspaceShell";
import { ContextualGuideProvider } from "@/components/guides/ContextualGuideProvider";
import { clearProjectReadCache } from "@/lib/data/projects";
import type { SharedProjectRole } from "@/lib/projectAccess/core";
import { rememberProjectSelection } from "@/lib/projectAccess/recentProject";
import {
  resolveDismissedProjectOwnerId,
  restoreDismissedProject
} from "@/lib/projectAccess/dismissedProjects";

const ProjectAccessContext = createContext<{ role: SharedProjectRole | null; isShared: boolean }>({
  role: null,
  isShared: false
});

export function ProjectAccessGate({
  projectId,
  projectName,
  role,
  accessPreferenceScope,
  children
}: {
  projectId: string;
  projectName: string | null;
  role: SharedProjectRole | null;
  accessPreferenceScope: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const progressPath = `/projects/${projectId}`;
  const progressReadablePaths = new Set([
    progressPath,
    `${progressPath}/staff-list`,
    `${progressPath}/scene-list`,
    `${progressPath}/scenario`,
    `${progressPath}/costumes`,
    `${progressPath}/storyboard-overhead`
  ]);
  const denied = role === "progress" && !progressReadablePaths.has(pathname);

  // 서버 layout이 확정한 현재 권한을 cache보다 우선합니다. layout effect는
  // 자식 페이지의 일반 data-loading effect보다 먼저 실행되며 render도 순수하게 유지합니다.
  useLayoutEffect(() => {
    clearProjectReadCache(projectId);
  }, [projectId, role]);

  useEffect(() => {
    if (!role) return;
    rememberProjectSelection(projectId);

    let isCurrent = true;
    void resolveDismissedProjectOwnerId(accessPreferenceScope).then((ownerId) => {
      if (isCurrent && ownerId) restoreDismissedProject(ownerId, projectId);
    });
    return () => {
      isCurrent = false;
    };
  }, [accessPreferenceScope, projectId, role]);

  useEffect(() => {
    if (denied) router.replace(progressPath);
  }, [denied, progressPath, router]);

  if (denied) {
    return (
      <div className="border border-field-divider bg-field-soft p-5 text-center">
        <p className="font-bold text-field-text">Key staff 권한이 필요합니다.</p>
        <p className="mt-2 text-sm font-normal text-field-subtle">Staff 권한은 진행도와 프로젝트 자료를 읽기 전용으로 이용할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <ProjectAccessContext.Provider value={{ role, isShared: role !== null }}>
      <ContextualGuideProvider userNamespace={accessPreferenceScope} role={role}>
        <ProjectPageActionsProvider>
          <ProjectWorkspaceProvider projectId={projectId} initialProjectName={projectName}>
            <ProjectWorkspaceShell>{children}</ProjectWorkspaceShell>
          </ProjectWorkspaceProvider>
        </ProjectPageActionsProvider>
      </ContextualGuideProvider>
    </ProjectAccessContext.Provider>
  );
}

export function useProjectAccess() {
  return useContext(ProjectAccessContext);
}

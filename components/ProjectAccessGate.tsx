"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ProjectPageActionsProvider } from "@/components/ProjectPageActions";
import { ProjectWorkspaceProvider } from "@/components/ProjectWorkspaceContext";
import { ProjectWorkspaceShell } from "@/components/ProjectWorkspaceShell";
import { ContextualGuideProvider } from "@/components/guides/ContextualGuideProvider";
import { clearProjectReadCache } from "@/lib/data/projects";
import {
  isKeyStaffProjectRole,
  resolveProjectScopedRole,
  type ProjectScopedRoleOverride,
  type SharedProjectRole
} from "@/lib/projectAccess/core";
import { rememberProjectSelection } from "@/lib/projectAccess/recentProject";
import {
  resolveDismissedProjectOwnerId,
  restoreDismissedProject
} from "@/lib/projectAccess/dismissedProjects";

type ProjectAccessContextValue = {
  role: SharedProjectRole | null;
  isShared: boolean;
  applyVerifiedRole: (role: SharedProjectRole) => void;
};

const ProjectAccessContext = createContext<ProjectAccessContextValue>({
  role: null,
  isShared: false,
  applyVerifiedRole: () => undefined
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
  const [verifiedRoleOverride, setVerifiedRoleOverride] = useState<ProjectScopedRoleOverride>(null);
  const currentRole = resolveProjectScopedRole(projectId, role, verifiedRoleOverride);
  const applyVerifiedRole = useCallback((nextRole: SharedProjectRole) => {
    // 이 client callback은 서버 승격 성공 응답만 반영하며 downgrade는 허용하지 않습니다.
    if (!isKeyStaffProjectRole(nextRole)) return;
    setVerifiedRoleOverride({ projectId, role: nextRole });
  }, [projectId]);
  const progressPath = `/projects/${projectId}`;
  const progressReadablePaths = new Set([
    progressPath,
    `${progressPath}/staff-list`,
    `${progressPath}/scene-list`,
    `${progressPath}/scenario`,
    `${progressPath}/costumes`,
    `${progressPath}/storyboard-overhead`
  ]);
  const denied = currentRole === "progress" && !progressReadablePaths.has(pathname);

  useEffect(() => {
    setVerifiedRoleOverride((current) => {
      if (current?.projectId !== projectId) return null;
      // 서버 layout이 admin을 확인했거나 grant가 사라지면 로컬 임시 override를 폐기합니다.
      // 최초 Staff prop(progress)은 승격 직후 server tree를 새로 요청하지 않기 위해 유지합니다.
      return role === "admin" || role === null ? null : current;
    });
  }, [projectId, role]);

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

  const accessValue = useMemo<ProjectAccessContextValue>(() => ({
    role: currentRole,
    isShared: currentRole !== null,
    applyVerifiedRole
  }), [applyVerifiedRole, currentRole]);

  if (denied) {
    return (
      <div className="border border-field-divider bg-field-soft p-5 text-center">
        <p className="font-bold text-field-text">Key staff 권한이 필요합니다.</p>
        <p className="mt-2 text-sm font-normal text-field-subtle">Staff 권한은 진행도와 프로젝트 자료를 읽기 전용으로 이용할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <ProjectAccessContext.Provider value={accessValue}>
      <ContextualGuideProvider
        userNamespace={accessPreferenceScope}
        // A project opened without a shared-project grant is the legacy/direct
        // owner flow. The product itself treats that flow as editable, so guide
        // permissions must use the same effective Key staff capability.
        role={currentRole ?? "admin"}
      >
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

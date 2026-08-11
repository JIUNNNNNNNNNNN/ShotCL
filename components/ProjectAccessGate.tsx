"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  accessMode: ProjectAccessMode | null;
  isGuest: boolean;
  editorEligible: boolean;
  canEditProgressStatus: boolean;
  applyVerifiedRole: (role: SharedProjectRole) => void;
};

export type ProjectAccessMode = "member" | "guest" | "legacy";

const ProjectAccessContext = createContext<ProjectAccessContextValue>({
  role: null,
  isShared: false,
  accessMode: null,
  isGuest: false,
  editorEligible: false,
  canEditProgressStatus: false,
  applyVerifiedRole: () => undefined
});

export function ProjectAccessGate({
  projectId,
  projectName,
  role,
  accessMode,
  editorEligible,
  accessPreferenceScope,
  children
}: {
  projectId: string;
  projectName: string | null;
  role: SharedProjectRole | null;
  accessMode: ProjectAccessMode | null;
  editorEligible: boolean;
  accessPreferenceScope: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [verifiedRoleOverride, setVerifiedRoleOverride] = useState<ProjectScopedRoleOverride>(null);
  const currentRole = accessMode === "guest"
    ? "progress"
    : resolveProjectScopedRole(projectId, role, verifiedRoleOverride);
  const isGuest = accessMode === "guest";
  const canEditProgressStatus = currentRole === "admin"
    || (accessMode === "member" && editorEligible && currentRole === "progress");
  const applyVerifiedRole = useCallback((nextRole: SharedProjectRole) => {
    // 이 client callback은 서버 승격 성공 응답만 반영하며 downgrade는 허용하지 않습니다.
    if (isGuest || !isKeyStaffProjectRole(nextRole)) return;
    setVerifiedRoleOverride({ projectId, role: nextRole });
  }, [isGuest, projectId]);
  const progressPath = `/projects/${projectId}`;
  const progressHref = `${progressPath}?view=progress`;
  const progressReadablePaths = new Set([
    progressPath,
    `${progressPath}/staff-list`,
    `${progressPath}/scene-list`,
    `${progressPath}/scenario`,
    `${progressPath}/costumes`,
    `${progressPath}/storyboard-overhead`
  ]);
  const guestProgressRoute = pathname === progressPath
    && (searchParams.get("view") === "progress" || Boolean(searchParams.get("dailyPlanId")));
  const guestRouteAllowed = guestProgressRoute || pathname === `${progressPath}/scenario`;
  const missingAccess = currentRole === null || accessMode === null;
  const denied = missingAccess
    || (isGuest && !guestRouteAllowed)
    || (!isGuest && currentRole === "progress" && !progressReadablePaths.has(pathname));
  const deniedDestination = missingAccess ? "/" : isGuest ? progressHref : progressPath;

  useEffect(() => {
    setVerifiedRoleOverride((current) => {
      if (current?.projectId !== projectId) return null;
      if (isGuest) return null;
      // 서버 layout이 admin을 확인했거나 grant가 사라지면 로컬 임시 override를 폐기합니다.
      // 최초 Staff prop(progress)은 승격 직후 server tree를 새로 요청하지 않기 위해 유지합니다.
      return role === "admin" || role === null ? null : current;
    });
  }, [isGuest, projectId, role]);

  // 서버 layout이 확정한 현재 권한을 cache보다 우선합니다. layout effect는
  // 자식 페이지의 일반 data-loading effect보다 먼저 실행되며 render도 순수하게 유지합니다.
  useLayoutEffect(() => {
    clearProjectReadCache(projectId);
  }, [accessMode, projectId, role]);

  useEffect(() => {
    if (!role || isGuest) return;
    rememberProjectSelection(projectId);

    let isCurrent = true;
    void resolveDismissedProjectOwnerId(accessPreferenceScope).then((ownerId) => {
      if (isCurrent && ownerId) restoreDismissedProject(ownerId, projectId);
    });
    return () => {
      isCurrent = false;
    };
  }, [accessPreferenceScope, isGuest, projectId, role]);

  useEffect(() => {
    if (denied) router.replace(deniedDestination);
  }, [denied, deniedDestination, router]);

  const accessValue = useMemo<ProjectAccessContextValue>(() => ({
    role: currentRole,
    isShared: currentRole !== null,
    accessMode,
    isGuest,
    editorEligible: accessMode === "member" && editorEligible,
    canEditProgressStatus,
    applyVerifiedRole
  }), [accessMode, applyVerifiedRole, canEditProgressStatus, currentRole, editorEligible, isGuest]);

  if (denied) {
    return (
      <div className="border border-field-divider bg-field-soft p-5 text-center">
        <p className="font-bold text-field-text">
          {missingAccess ? "프로젝트 접근 권한을 확인할 수 없습니다." : "이 링크에서는 열 수 없는 페이지입니다."}
        </p>
        <p className="mt-2 text-sm font-normal text-field-subtle">
          {missingAccess
            ? "Main에서 프로젝트를 다시 선택하거나 유효한 초대 링크를 열어주세요."
            : isGuest
              ? "게스트 초대 링크에서는 진행도와 시나리오만 읽을 수 있습니다."
              : "Staff 권한은 진행도와 프로젝트 자료를 읽기 전용으로 이용할 수 있습니다."}
        </p>
        <Link
          href={deniedDestination}
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-[var(--radius-control)] border border-field-divider bg-field-panel px-4 py-2 text-sm font-bold text-field-text hover:bg-field-hover"
        >
          {missingAccess ? "Main으로" : "진행도로"}
        </Link>
      </div>
    );
  }

  return (
    <ProjectAccessContext.Provider value={accessValue}>
      <ContextualGuideProvider
        userNamespace={accessPreferenceScope}
        role={currentRole}
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

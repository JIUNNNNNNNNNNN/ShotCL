"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuthSession } from "@/components/AuthSessionProvider";
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
import {
  isMemberReadOnlyFallback,
  resolveLiveProjectCapability
} from "@/lib/projectAccess/clientCapability";
import type { ProjectWorkspaceSnapshot } from "@/lib/projectWorkspaceSnapshot";
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
  accountUserId,
  accessPreferenceScope,
  initialWorkspace,
  children
}: {
  projectId: string;
  projectName: string | null;
  role: SharedProjectRole | null;
  accessMode: ProjectAccessMode | null;
  editorEligible: boolean;
  accountUserId: string | null;
  accessPreferenceScope: string;
  initialWorkspace: ProjectWorkspaceSnapshot;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    isEditorEligible: liveAccountEditorEligible,
    isGoogle,
    status: accountStatus,
    user: liveAccountUser
  } = useAuthSession();
  const [verifiedRoleOverride, setVerifiedRoleOverride] = useState<ProjectScopedRoleOverride>(null);
  const serverScopedRole = accessMode === "guest"
    ? "progress"
    : resolveProjectScopedRole(projectId, role, verifiedRoleOverride);
  // server layout이 확인한 계정 ID와 현재 Supabase 사용자 ID가 일치한 뒤에만 쓰기
  // capability를 노출합니다. 인증 복원·로그아웃·계정 전환 중에는 fail-closed이며,
  // DB membership 자체를 client에서 변경하지는 않습니다.
  const liveCapability = resolveLiveProjectCapability({
    accessMode,
    scopedRole: serverScopedRole,
    accountStatus,
    serverAccountUserId: accountUserId,
    liveAccountUserId: liveAccountUser?.id ?? null,
    isGoogle,
    liveAccountEditorEligible
  });
  const effectiveEditorEligible = liveCapability.editorEligible;
  const currentRole = liveCapability.role;
  const isGuest = accessMode === "guest";
  const memberReadOnlyFallback = isMemberReadOnlyFallback({
    accessMode,
    serverRole: serverScopedRole,
    resolvedRole: currentRole,
    accountStatus
  });
  const canEditProgressStatus = currentRole === "admin"
    || (effectiveEditorEligible && currentRole === "progress");
  const applyVerifiedRole = useCallback((nextRole: SharedProjectRole) => {
    // 이 client callback은 서버 승격 성공 응답만 반영하며 downgrade는 허용하지 않습니다.
    if (isGuest || !effectiveEditorEligible || !isKeyStaffProjectRole(nextRole)) return;
    setVerifiedRoleOverride({ projectId, role: nextRole });
  }, [effectiveEditorEligible, isGuest, projectId]);
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
  const memberRestrictedFallback = memberReadOnlyFallback
    && !progressReadablePaths.has(pathname);
  const guestProgressRoute = pathname === progressPath
    && (searchParams.get("view") === "progress" || Boolean(searchParams.get("dailyPlanId")));
  const guestRouteAllowed = guestProgressRoute || pathname === `${progressPath}/scenario`;
  const missingAccess = currentRole === null || accessMode === null;
  const denied = missingAccess
    || (isGuest && !guestRouteAllowed)
    || (
      !isGuest
      && currentRole === "progress"
      && !memberReadOnlyFallback
      && !progressReadablePaths.has(pathname)
    );
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
  }, [accessMode, effectiveEditorEligible, projectId, role]);

  useEffect(() => {
    if (!currentRole || isGuest) return;
    rememberProjectSelection(projectId);

    let isCurrent = true;
    void resolveDismissedProjectOwnerId(accessPreferenceScope).then((ownerId) => {
      if (isCurrent && ownerId) restoreDismissedProject(ownerId, projectId);
    });
    return () => {
      isCurrent = false;
    };
  }, [accessPreferenceScope, currentRole, isGuest, projectId]);

  useEffect(() => {
    if (denied) router.replace(deniedDestination);
  }, [denied, deniedDestination, router]);

  const accessValue = useMemo<ProjectAccessContextValue>(() => ({
    role: currentRole,
    isShared: currentRole !== null,
    accessMode,
    isGuest,
    editorEligible: effectiveEditorEligible,
    canEditProgressStatus,
    applyVerifiedRole
  }), [accessMode, applyVerifiedRole, canEditProgressStatus, currentRole, effectiveEditorEligible, isGuest]);

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
          <ProjectWorkspaceProvider
            key={projectId}
            projectId={projectId}
            initialProjectName={projectName}
            initialWorkspace={initialWorkspace}
          >
            <ProjectWorkspaceShell>
              {memberRestrictedFallback ? (
                <section className="mx-auto flex min-h-[35dvh] w-full max-w-lg items-center justify-center px-4 py-8 text-center">
                  <div className="rounded-[var(--radius-card)] border border-field-divider bg-field-panel p-5 shadow-card">
                    <p
                      role={accountStatus === "error" || accountStatus === "unavailable" ? "alert" : "status"}
                      className="text-sm font-black text-field-text"
                    >
                      {accountStatus === "error" || accountStatus === "unavailable"
                        ? "Google 계정 권한을 확인할 수 없어 수정 화면을 잠갔습니다."
                        : "Google 계정 권한을 확인하는 중입니다."}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-field-muted">
                      왼쪽 계정 영역에서 상태를 확인해 주세요. 계정 확인 전에는 이 화면의 저장 기능이 실행되지 않습니다.
                    </p>
                  </div>
                </section>
              ) : children}
            </ProjectWorkspaceShell>
          </ProjectWorkspaceProvider>
        </ProjectPageActionsProvider>
      </ContextualGuideProvider>
    </ProjectAccessContext.Provider>
  );
}

export function useProjectAccess() {
  return useContext(ProjectAccessContext);
}

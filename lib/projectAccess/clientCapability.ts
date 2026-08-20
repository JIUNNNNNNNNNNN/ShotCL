import type { SharedProjectRole } from "@/lib/projectAccess/core";

export type ClientProjectAccessMode = "member" | "guest" | "legacy";

/**
 * 영구 삭제 entry point의 좁은 creator capability입니다. 기존 owner는 서버가
 * 계산한 immutable owner flag와 현재 live account가 일치해야 하고, legacy
 * 복구 직후에는 서버가 서명한 exact project claim만 stale RSC를 보완합니다.
 */
export function resolveProjectCreatorCapability({
  projectId,
  accessMode,
  serverRole,
  serverEditorEligible,
  serverAccountUserId,
  serverIsOwner,
  accountStatus,
  liveAccountUserId,
  isGoogle,
  liveAccountEditorEligible,
  creatorClaimedProjectId
}: {
  projectId: string;
  accessMode: ClientProjectAccessMode | null;
  serverRole: SharedProjectRole | null;
  serverEditorEligible: boolean;
  serverAccountUserId: string | null;
  serverIsOwner: boolean;
  accountStatus: string;
  liveAccountUserId: string | null;
  isGoogle: boolean;
  liveAccountEditorEligible: boolean;
  creatorClaimedProjectId: string | null;
}) {
  const liveEditorAccountVerified = accountStatus === "authenticated"
    && Boolean(liveAccountUserId)
    && isGoogle
    && liveAccountEditorEligible;
  const serverResolvedCreator = serverIsOwner
    && accessMode === "member"
    && serverRole === "admin"
    && serverEditorEligible
    && Boolean(serverAccountUserId)
    && liveEditorAccountVerified
    && liveAccountUserId === serverAccountUserId;
  const freshlyClaimedCreator = (
    accessMode === "member" || accessMode === "legacy"
  )
    && creatorClaimedProjectId === projectId
    && liveEditorAccountVerified;
  return serverResolvedCreator || freshlyClaimedCreator;
}

/**
 * 진행 컷의 canonical OK/OMIT toggle만 허용하는 좁은 client capability입니다.
 * Guest invite는 전체 editor eligibility 없이 이 상태 변경만 사용할 수 있습니다.
 */
export function canUpdateProjectProgressStatus({
  accessMode,
  role,
  editorEligible
}: {
  accessMode: ClientProjectAccessMode | null;
  role: SharedProjectRole | null;
  editorEligible: boolean;
}) {
  if (role === "admin") return true;
  if (role !== "progress") return false;
  return accessMode === "guest" || editorEligible;
}

export function isMemberReadOnlyFallback({
  accessMode,
  serverRole,
  resolvedRole,
  accountStatus
}: {
  accessMode: ClientProjectAccessMode | null;
  serverRole: SharedProjectRole | null;
  resolvedRole: SharedProjectRole | null;
  accountStatus: string;
}) {
  return accessMode === "member"
    && serverRole === "admin"
    && resolvedRole === "progress"
    && (
      accountStatus === "loading"
      || accountStatus === "syncing"
      || accountStatus === "error"
      || accountStatus === "unavailable"
    );
}

export function resolveLiveProjectCapability({
  accessMode,
  scopedRole,
  accountStatus,
  serverAccountUserId,
  liveAccountUserId,
  isGoogle,
  liveAccountEditorEligible
}: {
  accessMode: ClientProjectAccessMode | null;
  scopedRole: SharedProjectRole | null;
  accountStatus: string;
  serverAccountUserId: string | null;
  liveAccountUserId: string | null;
  isGoogle: boolean;
  liveAccountEditorEligible: boolean;
}) {
  if (accessMode !== "member") return { role: scopedRole, editorEligible: false } as const;
  // 서버 layout이 유효한 account membership을 확인한 뒤 client Supabase session을
  // 복원하는 동안에는 Shell과 읽기 기능을 유지하되, admin을 절대 선반영하지 않습니다.
  // 네트워크/환경 오류도 같은 read-only fallback으로 두고 재인증 UI를 노출합니다.
  if (
    accountStatus === "loading"
    || accountStatus === "syncing"
    || accountStatus === "error"
    || accountStatus === "unavailable"
  ) {
    const serverMemberKnown = Boolean(serverAccountUserId);
    const visibleAccountMismatch = Boolean(liveAccountUserId)
      && serverAccountUserId !== liveAccountUserId;
    return {
      role: scopedRole && serverMemberKnown && !visibleAccountMismatch
        ? "progress" as const
        : null,
      editorEligible: false
    } as const;
  }
  const accountMatched = accountStatus === "authenticated"
    && Boolean(serverAccountUserId)
    && serverAccountUserId === liveAccountUserId;
  if (!accountMatched) return { role: null, editorEligible: false } as const;
  const editorEligible = isGoogle && liveAccountEditorEligible;
  const role = scopedRole === "admin" && !editorEligible ? "progress" : scopedRole;
  return { role, editorEligible } as const;
}

import type { SharedProjectRole } from "@/lib/projectAccess/core";

export type ClientProjectAccessMode = "member" | "guest" | "legacy";

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

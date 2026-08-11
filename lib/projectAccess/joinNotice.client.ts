import type { JoinAccessReason } from "@/lib/projectAccess/core";

export type ProjectJoinNotice = {
  projectId: string;
  reason: Exclude<JoinAccessReason, null>;
};

const JOIN_NOTICE_TTL_MS = 60_000;
let pendingNotice: (ProjectJoinNotice & { expiresAt: number }) | null = null;

/**
 * Join 직후 같은 client navigation에서만 전달하는 일회성 UX 신호입니다.
 * 비밀번호나 권한 capability는 저장하지 않으며 reload 시 복원되지 않습니다.
 */
export function setPendingProjectJoinNotice(notice: ProjectJoinNotice | null) {
  pendingNotice = notice ? { ...notice, expiresAt: Date.now() + JOIN_NOTICE_TTL_MS } : null;
}

export function peekPendingProjectJoinNotice(projectId: string) {
  const notice = readPendingNotice(projectId);
  return notice ? { projectId: notice.projectId, reason: notice.reason } : null;
}

export function consumePendingProjectJoinNotice(projectId: string) {
  const current = readPendingNotice(projectId);
  if (!current) return null;
  const notice = pendingNotice;
  pendingNotice = null;
  return notice ? { projectId: notice.projectId, reason: notice.reason } : null;
}

function readPendingNotice(projectId: string) {
  if (pendingNotice && pendingNotice.expiresAt <= Date.now()) pendingNotice = null;
  return pendingNotice?.projectId === projectId ? pendingNotice : null;
}

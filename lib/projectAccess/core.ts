import type { ProjectRole } from "@/lib/types";

export type SharedProjectRole = Extract<ProjectRole, "admin" | "progress">;

export type ProjectAccessGrant = {
  projectId: string;
  projectName: string;
  role: SharedProjectRole;
  joinedAt: string;
};

export type ProjectScopedRoleOverride = {
  projectId: string;
  role: SharedProjectRole;
} | null;

export type KeyStaffUpgradeDecision =
  | "forbidden"
  | "already-key-staff"
  | "invalid-password"
  | "upgrade";

export type JoinAccessReason = "key_staff_google_required" | null;

/** 이름 비교와 DB unique key에 동일하게 쓰는 정규화 규칙입니다. */
export function normalizeProjectName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

export function cleanProjectName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function sanitizePasscode(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

export function isValidPasscode(value: string) {
  return /^\d{4}$/.test(value);
}

/** 공유 프로젝트에서 일반 Staff로 취급되는 canonical role 판정입니다. */
export function isStaffProjectRole(role: SharedProjectRole | null): role is "progress" {
  return role === "progress";
}

/** 공유 프로젝트에서 Key staff/생성자로 취급되는 canonical role 판정입니다. */
export function isKeyStaffProjectRole(role: SharedProjectRole | null): role is "admin" {
  return role === "admin";
}

/** 서버가 확인한 현재 role과 비밀번호 결과만으로 승격 동작을 결정합니다. */
export function getKeyStaffUpgradeDecision(
  role: SharedProjectRole | null,
  passwordMatches: boolean
): KeyStaffUpgradeDecision {
  if (isKeyStaffProjectRole(role)) return "already-key-staff";
  if (!isStaffProjectRole(role)) return "forbidden";
  return passwordMatches ? "upgrade" : "invalid-password";
}

/**
 * Key staff 비밀번호가 맞더라도 Google 계정이 없으면 관리 권한을 만들지 않고,
 * Staff fallback의 이유만 응답에 노출합니다. 비밀번호나 검증 intent는 보존하지 않습니다.
 */
export function getJoinAccessReason(
  passwordRole: SharedProjectRole,
  accountAuthenticated: boolean
): JoinAccessReason {
  return passwordRole === "admin" && !accountAuthenticated
    ? "key_staff_google_required"
    : null;
}

/** 한 프로젝트의 로컬 승격 결과가 다른 프로젝트 role에 섞이지 않게 합니다. */
export function resolveProjectScopedRole(
  projectId: string,
  serverRole: SharedProjectRole | null,
  override: ProjectScopedRoleOverride
) {
  if (override?.projectId !== projectId) return serverRole;
  // admin 확인 또는 grant 소멸은 최신 server source를 우선합니다. progress prop만
  // 승격 직후 server tree refetch 없이 UI를 갱신하기 위한 임시 baseline으로 봅니다.
  if (serverRole === "admin" || serverRole === null) return serverRole;
  return override.role;
}

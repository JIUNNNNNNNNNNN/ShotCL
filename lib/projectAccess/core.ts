import type { ProjectRole } from "@/lib/types";

export type SharedProjectRole = Extract<ProjectRole, "admin" | "progress">;

export type ProjectAccessGrant = {
  projectId: string;
  projectName: string;
  role: SharedProjectRole;
  joinedAt: string;
};

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

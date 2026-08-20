"use client";

import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

const DELETED_PROJECT_IDS_KEY = "shotcl:deletedProjectIds";

/** 같은 탭의 이전 soft-navigation history가 stale project tree를 복원하지 못하게 합니다. */
export function isProjectDeletedInThisTab(projectId: string) {
  const stableProjectId = normalizeProjectId(projectId);
  if (typeof window === "undefined" || !isValidDatabaseProjectId(stableProjectId)) return false;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(DELETED_PROJECT_IDS_KEY) ?? "[]") as unknown;
    return Array.isArray(stored) && stored.some((value) => (
      typeof value === "string" && normalizeProjectId(value) === stableProjectId
    ));
  } catch {
    return false;
  }
}

export function markProjectDeletedInThisTab(projectId: string) {
  const stableProjectId = normalizeProjectId(projectId);
  if (typeof window === "undefined" || !isValidDatabaseProjectId(stableProjectId)) return;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(DELETED_PROJECT_IDS_KEY) ?? "[]") as unknown;
    const current = Array.isArray(stored)
      ? stored.filter((value): value is string => typeof value === "string")
      : [];
    const ids = new Set(current.map(normalizeProjectId).filter(isValidDatabaseProjectId));
    ids.add(stableProjectId);
    window.sessionStorage.setItem(DELETED_PROJECT_IDS_KEY, JSON.stringify([...ids]));
  } catch {
    // The server remains the source of truth when sessionStorage is unavailable.
  }
}

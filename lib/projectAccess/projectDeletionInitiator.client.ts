"use client";

import { normalizeProjectId } from "@/lib/projectId";

const activeDeletionAttempts = new Set<string>();

/**
 * 같은 document에서 DELETE를 시작한 dialog만 remote terminal signal을 잠시
 * 무시합니다. 다른 탭/기기에는 공유되지 않으며 dialog가 닫히면 해제됩니다.
 */
export function beginProjectPermanentDeletionHere(projectId: string) {
  const stableProjectId = normalizeProjectId(projectId);
  if (stableProjectId) activeDeletionAttempts.add(stableProjectId);
}

export function endProjectPermanentDeletionHere(projectId: string) {
  activeDeletionAttempts.delete(normalizeProjectId(projectId));
}

export function isProjectPermanentDeletionInitiatedHere(projectId: string) {
  return activeDeletionAttempts.has(normalizeProjectId(projectId));
}

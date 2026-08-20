import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

const DISMISSED_PROJECT_IDS_KEY_PREFIX = "shotcl:dismissedJoinedProjectIds";

/**
 * UI preference를 실제 접근 권한과 분리된 server-resolved 범위에 묶습니다.
 * Member scope는 기존 `auth:<uid>` key를 보존하고, guest/legacy scope는
 * 원본 cookie를 노출하지 않는 opaque hash로 전달됩니다.
 */
export async function resolveDismissedProjectOwnerId(accessPreferenceScope: string) {
  const safeScope = accessPreferenceScope.trim();
  if (!safeScope) return "";
  if (/^(?:auth|access):[^\s:]+$/u.test(safeScope)) return safeScope;
  return `access:${safeScope}`;
}

export function readDismissedProjectIds(ownerId: string) {
  if (typeof window === "undefined" || !ownerId) return new Set<string>();

  try {
    const storedValue = JSON.parse(
      window.localStorage.getItem(getDismissedProjectStorageKey(ownerId)) ?? "[]"
    ) as unknown;
    if (!Array.isArray(storedValue)) return new Set<string>();
    return new Set(
      storedValue
        .map((value) => normalizeStableProjectId(typeof value === "string" ? value : ""))
        .filter((value): value is string => Boolean(value))
    );
  } catch {
    return new Set<string>();
  }
}

export function dismissJoinedProject(ownerId: string, projectId: string) {
  const stableProjectId = normalizeStableProjectId(projectId);
  if (!ownerId || !stableProjectId) return readDismissedProjectIds(ownerId);
  const dismissedProjectIds = readDismissedProjectIds(ownerId);
  dismissedProjectIds.add(stableProjectId);
  writeDismissedProjectIds(ownerId, dismissedProjectIds);
  return dismissedProjectIds;
}

export function restoreDismissedProject(ownerId: string, projectId: string) {
  const stableProjectId = normalizeStableProjectId(projectId);
  if (!ownerId || !stableProjectId) return readDismissedProjectIds(ownerId);
  const dismissedProjectIds = readDismissedProjectIds(ownerId);
  if (dismissedProjectIds.delete(stableProjectId)) {
    writeDismissedProjectIds(ownerId, dismissedProjectIds);
  }
  return dismissedProjectIds;
}

export function isProjectDismissed(dismissedProjectIds: Set<string>, projectId: string) {
  const stableProjectId = normalizeStableProjectId(projectId);
  return Boolean(stableProjectId && dismissedProjectIds.has(stableProjectId));
}

export function getDismissedProjectStorageKey(ownerId: string) {
  return `${DISMISSED_PROJECT_IDS_KEY_PREFIX}:${ownerId}`;
}

/** 계정/초대 scope별 목록에서 삭제된 ID만 제거하고 다른 프로젝트 preference는 유지합니다. */
export function forgetDismissedProjectEverywhere(projectId: string) {
  const stableProjectId = normalizeStableProjectId(projectId);
  if (typeof window === "undefined" || !stableProjectId) return;
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => (
      window.localStorage.key(index) ?? ""
    )).filter((key) => key.startsWith(`${DISMISSED_PROJECT_IDS_KEY_PREFIX}:`));
    for (const key of keys) {
      const storedValue = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
      if (!Array.isArray(storedValue)) continue;
      const remaining = storedValue.filter((value) => (
        normalizeStableProjectId(typeof value === "string" ? value : "") !== stableProjectId
      ));
      if (remaining.length === storedValue.length) continue;
      if (remaining.length > 0) window.localStorage.setItem(key, JSON.stringify(remaining));
      else window.localStorage.removeItem(key);
    }
  } catch {
    // 저장소가 차단되어도 서버의 영구 삭제 결과는 유지됩니다.
  }
}

function writeDismissedProjectIds(ownerId: string, projectIds: Set<string>) {
  if (typeof window === "undefined" || !ownerId) return;
  try {
    window.localStorage.setItem(
      getDismissedProjectStorageKey(ownerId),
      JSON.stringify([...projectIds].sort())
    );
  } catch {
    // 저장소가 차단되어도 호출부의 현재 화면 상태는 계속 갱신합니다.
  }
}

function normalizeStableProjectId(projectId: string) {
  const normalized = normalizeProjectId(projectId);
  return isValidDatabaseProjectId(normalized) ? normalized : "";
}

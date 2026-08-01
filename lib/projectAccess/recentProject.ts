import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

const ACTIVE_PROJECT_ID_KEY = "shotcl:activeProjectId";
const LAST_PROJECT_ID_KEY = "shotcl:lastProjectId";

export type RememberedProjectSelection = {
  activeProjectId: string;
  lastProjectId: string;
};

/** 편의용 project ID만 보관합니다. 실제 접근 여부는 항상 서버에서 다시 확인합니다. */
export function readRememberedProjectSelection(): RememberedProjectSelection {
  if (typeof window === "undefined") {
    return { activeProjectId: "", lastProjectId: "" };
  }
  return {
    activeProjectId: normalizeStoredProjectId(readStorageValue(window.sessionStorage, ACTIVE_PROJECT_ID_KEY)),
    lastProjectId: normalizeStoredProjectId(readStorageValue(window.localStorage, LAST_PROJECT_ID_KEY))
  };
}

/** 현재 탭의 active project와 브라우저의 최근 project를 같은 stable ID로 갱신합니다. */
export function rememberProjectSelection(projectId: string) {
  const stableProjectId = normalizeStoredProjectId(projectId);
  if (!stableProjectId || typeof window === "undefined") return;
  writeStorageValue(window.sessionStorage, ACTIVE_PROJECT_ID_KEY, stableProjectId);
  writeStorageValue(window.localStorage, LAST_PROJECT_ID_KEY, stableProjectId);
}

/** 권한이 사라진 ID만 지웁니다. 다른 유효한 최근 project 기록은 보존합니다. */
export function forgetProjectSelection(projectId: string) {
  const stableProjectId = normalizeStoredProjectId(projectId);
  if (!stableProjectId || typeof window === "undefined") return;
  removeMatchingStorageValue(window.sessionStorage, ACTIVE_PROJECT_ID_KEY, stableProjectId);
  removeMatchingStorageValue(window.localStorage, LAST_PROJECT_ID_KEY, stableProjectId);
}

function normalizeStoredProjectId(value: string) {
  const normalized = normalizeProjectId(value);
  return isValidDatabaseProjectId(normalized) ? normalized : "";
}

function readStorageValue(storage: Storage, key: string) {
  try {
    return storage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeStorageValue(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // 저장소가 차단되어도 현재 navigation 자체는 계속 허용합니다.
  }
}

function removeMatchingStorageValue(storage: Storage, key: string, value: string) {
  try {
    if (normalizeStoredProjectId(storage.getItem(key) ?? "") === value) storage.removeItem(key);
  } catch {
    // 저장소가 차단된 브라우저에서는 서버 접근 검증 결과만 사용합니다.
  }
}

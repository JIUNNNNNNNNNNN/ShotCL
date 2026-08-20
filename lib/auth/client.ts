const ACCOUNT_SESSION_ENDPOINT = "/api/auth/session";
const SAFE_PATH_ORIGIN = "https://shotcl.local";
const CANONICAL_PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type AccountSessionSyncResult = {
  editorEligible: boolean;
  destination: string | null;
  creatorClaimedProjectId: string | null;
};

/** OAuth의 next 값은 현재 앱 안의 절대 경로만 허용합니다. */
export function getSafeInternalPath(value: unknown, fallback = "/") {
  const safeFallback = isSafeInternalPath(fallback) ? fallback : "/";
  if (typeof value !== "string") return safeFallback;
  const candidate = value.trim();
  return isSafeInternalPath(candidate) ? normalizeInternalPath(candidate) : safeFallback;
}

export function buildGoogleOAuthCallbackUrl(origin: string, nextPath = "/") {
  const safeOrigin = new URL(origin).origin;
  const callback = new URL("/auth/callback", safeOrigin);
  callback.searchParams.set("next", getSafeInternalPath(nextPath));
  return callback.toString();
}

/** OAuth return path가 가리키는 현재 프로젝트 UUID만 session sync hint로 사용합니다. */
export function getProjectIdFromInternalPath(value: unknown) {
  const safePath = getSafeInternalPath(value, "/");
  const pathname = new URL(safePath, SAFE_PATH_ORIGIN).pathname;
  const match = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/u);
  if (!match) return null;
  let candidate = "";
  try {
    candidate = decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return null;
  }
  return getCanonicalProjectId(candidate);
}

export function getAccountSessionSyncKey(
  accessToken: string,
  projectId: string | null,
  returnTo: string | null = null
) {
  return `${accessToken.trim()}\u0000${projectId?.trim().toLowerCase() || ""}\u0000${returnTo ? getSafeInternalPath(returnTo) : ""}`;
}

/** 유효한 Supabase JWT를 서버의 HttpOnly account session으로 교환합니다. */
export async function syncAccountSession(
  accessToken: string,
  projectId: string | null = null,
  returnTo: string | null = null
): Promise<AccountSessionSyncResult> {
  const token = accessToken.trim();
  if (!token) throw new Error("로그인 세션을 확인할 수 없습니다.");

  const response = await fetch(ACCOUNT_SESSION_ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "sync",
      ...(projectId ? { projectId } : {}),
      ...(returnTo ? { returnTo: getSafeInternalPath(returnTo) } : {})
    })
  });
  const payload = await readAccountPayload(response);
  if (!response.ok) {
    throw new Error(payload.error || "계정 세션을 연결하지 못했습니다.");
  }
  return {
    editorEligible: payload.editorEligible === true,
    destination: payload.destination
      ? getSafeInternalPath(payload.destination, "/")
      : null,
    creatorClaimedProjectId: getCanonicalProjectId(payload.creatorClaimedProjectId)
  };
}

/** 로그아웃 시 서버의 account cookie도 함께 폐기합니다. */
export async function clearAccountSession() {
  const response = await fetch(ACCOUNT_SESSION_ENDPOINT, {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store"
  });
  if (!response.ok) {
    const payload = await readAccountPayload(response);
    throw new Error(payload.error || "서버 계정 세션을 종료하지 못했습니다.");
  }
}

function isSafeInternalPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const parsed = new URL(value, SAFE_PATH_ORIGIN);
    const normalizedPathname = parsed.pathname.replace(/\/+$/u, "") || "/";
    return parsed.origin === SAFE_PATH_ORIGIN
      && !parsed.username
      && !parsed.password
      && normalizedPathname !== "/auth/callback";
  } catch {
    return false;
  }
}

function normalizeInternalPath(value: string) {
  const parsed = new URL(value, SAFE_PATH_ORIGIN);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function getCanonicalProjectId(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return CANONICAL_PROJECT_ID_PATTERN.test(candidate) ? candidate : null;
}

async function readAccountPayload(response: Response) {
  try {
    const value = await response.json() as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const payload = value as Record<string, unknown>;
    return {
      editorEligible: payload.editorEligible,
      destination: typeof payload.destination === "string" ? payload.destination : "",
      creatorClaimedProjectId: payload.creatorClaimedProjectId,
      error: typeof payload.error === "string" ? payload.error : ""
    };
  } catch {
    return {};
  }
}

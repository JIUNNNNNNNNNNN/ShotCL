export type GuestProjectApiRequest = {
  method: string;
  pathname: string;
  projectId: string;
  searchParams: URLSearchParams;
};

export type GuestProgressStatus = "pending" | "ok" | "omit";

const LEGACY_PROJECT_ID_PATTERN = /^project_([0-9a-f-]{36})$/i;
const DATABASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_ARCHIVE_DAILY_PLAN_ID = "__project_archive__";
const PROJECT_SPACE_PRESETS_DAILY_PLAN_ID = "__project_space_presets__";

function normalizeGuestProjectId(value: string) {
  const trimmed = String(value ?? "").trim();
  return trimmed.match(LEGACY_PROJECT_ID_PATTERN)?.[1] ?? trimmed;
}

/**
 * 가입 전 초대 링크 guest가 읽을 수 있는 최소 API 표면입니다.
 * server layout은 이 판정을 거치지 않고 token 기반 resolver로 프로젝트 shell만 엽니다.
 */
export function isGuestProjectApiRequestAllowed(input: GuestProjectApiRequest) {
  const matched = input.pathname.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
  if (!matched) return false;

  let pathProjectId = "";
  try {
    pathProjectId = decodeURIComponent(matched[1] ?? "");
  } catch {
    return false;
  }
  if (normalizeGuestProjectId(pathProjectId) !== normalizeGuestProjectId(input.projectId)) return false;

  const suffix = (matched[2] || "").replace(/\/$/, "");
  const method = input.method.toUpperCase();
  if (method === "PATCH") {
    const statusMutationMatch = suffix.match(/^\/shots\/([^/]+)\/status$/);
    if (!statusMutationMatch || input.searchParams.size !== 0) return false;
    try {
      return DATABASE_UUID_PATTERN.test(decodeURIComponent(statusMutationMatch[1] ?? ""));
    } catch {
      return false;
    }
  }
  if (method !== "GET") return false;

  if (!suffix) return true;
  if (suffix === "/daily-plans") return input.searchParams.size === 0;

  const dailyPlanDetailMatch = suffix.match(/^\/daily-plans\/([^/]+)$/);
  if (dailyPlanDetailMatch) {
    let dailyPlanId = "";
    try {
      dailyPlanId = decodeURIComponent(dailyPlanDetailMatch[1] ?? "");
    } catch {
      return false;
    }
    // Round switching needs one full plan, but never an unbounded nested
    // collection or a client-selected project scope.
    const hasNoQuery = input.searchParams.size === 0;
    const hasProgressQuery = input.searchParams.size === 1
      && input.searchParams.get("progress") === "1";
    return DATABASE_UUID_PATTERN.test(dailyPlanId)
      && (hasNoQuery || hasProgressQuery);
  }

  if (suffix === "/shots") {
    return Boolean(input.searchParams.get("dailyPlanId")?.trim());
  }

  if (suffix === "/progress-events") {
    const dailyPlanId = input.searchParams.get("dailyPlanId")?.trim() ?? "";
    return DATABASE_UUID_PATTERN.test(dailyPlanId)
      && input.searchParams.size === 1;
  }

  if (suffix === "/reference-assets") {
    if (input.searchParams.get("media") === "1") {
      return Boolean(input.searchParams.get("dailyPlanId")?.trim());
    }
    return input.searchParams.get("type") === "scenario"
      && !input.searchParams.has("types");
  }

  if (suffix === "/shot-diagrams") {
    const dailyPlanId = input.searchParams.get("dailyPlanId")?.trim() ?? "";
    return Boolean(dailyPlanId)
      && dailyPlanId !== PROJECT_ARCHIVE_DAILY_PLAN_ID
      && dailyPlanId !== PROJECT_SPACE_PRESETS_DAILY_PLAN_ID
      && input.searchParams.get("archive") !== "1";
  }

  return false;
}

/** Status endpoint가 허용하는 유일한 JSON shape입니다. */
export function parseProgressStatusMutationPayload(value: unknown): GuestProgressStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "status") return null;
  return record.status === "pending" || record.status === "ok" || record.status === "omit"
    ? record.status
    : null;
}

/** Guest는 OK/OMIT 지정과 기존 terminal status의 canonical 해제만 할 수 있습니다. */
export function isGuestProgressStatusTransitionAllowed(
  currentStatus: unknown,
  requestedStatus: GuestProgressStatus
) {
  if (requestedStatus === "ok" || requestedStatus === "omit") return true;
  return currentStatus === "ok" || currentStatus === "omit";
}

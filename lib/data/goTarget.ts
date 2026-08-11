export type GoTargetReason =
  | "overdue-incomplete"
  | "today"
  | "before-first"
  | "next"
  | "after-last"
  | "undated-fallback"
  | "no-valid-date"
  | "empty";

export type GoTargetResolution = {
  targetDailyPlanId: string | null;
  reason: GoTargetReason;
};

type GoTargetPayload = Partial<GoTargetResolution> & {
  ok?: boolean;
  error?: string;
};

/** access-list 조회 직후 권한이 회수된 race를 일반 네트워크 오류와 구분합니다. */
export class GoTargetAccessDeniedError extends Error {}

/** Go 클릭 시점의 최신 회차·진행 상태를 서버에서 다시 판정합니다. */
export async function getGoTarget(projectId: string): Promise<GoTargetResolution> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/go-target`,
    {
      cache: "no-store",
      credentials: "same-origin"
    }
  );
  const payload = (await response.json().catch(() => ({}))) as GoTargetPayload;

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new GoTargetAccessDeniedError(
      payload.error || "프로젝트 접근 권한이 만료되었습니다."
    );
  }
  if (!response.ok || payload.ok !== true || !isGoTargetReason(payload.reason)) {
    throw new Error(payload.error || "열어야 할 회차를 확인하지 못했습니다.");
  }

  const targetDailyPlanId = typeof payload.targetDailyPlanId === "string"
    ? payload.targetDailyPlanId.trim()
    : null;
  const isFallback = payload.reason === "empty" || payload.reason === "no-valid-date";
  if ((!isFallback && !targetDailyPlanId) || (isFallback && targetDailyPlanId)) {
    throw new Error("열어야 할 회차 정보가 올바르지 않습니다.");
  }

  return {
    targetDailyPlanId: targetDailyPlanId || null,
    reason: payload.reason
  };
}

function isGoTargetReason(value: unknown): value is GoTargetReason {
  return value === "overdue-incomplete"
    || value === "today"
    || value === "before-first"
    || value === "next"
    || value === "after-last"
    || value === "undated-fallback"
    || value === "no-valid-date"
    || value === "empty";
}

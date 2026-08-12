import "server-only";

import { getKoreaDateOnly } from "@/lib/koreaDate";
import { requireProjectAccessDb } from "@/lib/projectAccess/server";
import {
  calculateDailyProgress,
  calculateDailyProgressByPlan
} from "@/lib/progress/dailyProgress";
import {
  resolveRelevantProgressRound,
  type RelevantProgressRoundResolutionReason
} from "@/lib/progress/resolveRelevantRound";

type InviteProgressPlanRow = {
  id?: unknown;
  shooting_date?: unknown;
  episode?: unknown;
};

type InviteProgressShotRow = {
  id?: unknown;
  daily_plan_id?: unknown;
  status?: unknown;
};

export type InviteProgressTarget = {
  dailyPlanId: string | null;
  reason: RelevantProgressRoundResolutionReason | "empty";
};

const EMPTY_PROGRESS = calculateDailyProgress([]);

/**
 * An invite landing needs only round identity/date/order and the canonical cut
 * completion summary. Both project-wide reads are batched before selecting one
 * round; selected-round detail and media deliberately remain outside this path.
 */
export async function resolveInviteProgressTarget(
  projectId: string
): Promise<InviteProgressTarget> {
  const supabase = requireProjectAccessDb();
  const [planResult, progressResult] = await Promise.all([
    supabase
      .from("daily_plans")
      .select("id,shooting_date,episode")
      .eq("project_id", projectId),
    supabase
      .from("shots")
      .select("id,daily_plan_id,status")
      .eq("project_id", projectId)
  ]);
  if (planResult.error) throw planResult.error;
  if (progressResult.error) throw progressResult.error;

  const plans = ((planResult.data ?? []) as InviteProgressPlanRow[]).flatMap((row) => {
    const id = cleanText(row.id);
    return id ? [{
      id,
      shootingDate: cleanText(row.shooting_date),
      episode: cleanText(row.episode)
    }] : [];
  });
  const accessiblePlanIds = new Set(plans.map((plan) => plan.id));
  const progressByPlan = calculateDailyProgressByPlan(
    ((progressResult.data ?? []) as InviteProgressShotRow[]).flatMap((row, index) => {
      const dailyPlanId = cleanText(row.daily_plan_id);
      if (!accessiblePlanIds.has(dailyPlanId)) return [];
      return [{
        id: cleanText(row.id) || `${dailyPlanId}:invite-progress:${index}`,
        dailyPlanId,
        status: row.status
      }];
    })
  );
  const todayKorea = getKoreaDateOnly();
  if (!todayKorea) throw new Error("대한민국 현재 날짜를 계산하지 못했습니다.");

  const resolution = resolveRelevantProgressRound(
    plans.map((plan) => ({
      ...plan,
      progress: progressByPlan.get(plan.id) ?? EMPTY_PROGRESS
    })),
    todayKorea
  );
  if (resolution.status === "invalid-today") {
    throw new Error("대한민국 현재 날짜가 올바르지 않습니다.");
  }
  return resolution.status === "resolved"
    ? { dailyPlanId: resolution.round.id, reason: resolution.reason }
    : { dailyPlanId: null, reason: "empty" };
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

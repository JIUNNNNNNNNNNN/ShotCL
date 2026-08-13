import { dailyPlanFromRow, dailyPlanShotFromRow } from "@/lib/data/mappers";
import type { DailyPlanWithShots } from "@/lib/types";

type DailyPlanDetailApiOptions = {
  signal?: AbortSignal;
};

/**
 * 서버가 invite/project/plan scope를 확인한 단일 상세 API만 사용합니다.
 * 열람 경로는 실패 시 browser Supabase/local storage로 우회하지 않습니다.
 */
export async function getDailyPlanWithShotsFromApi(
  projectId: string,
  dailyPlanId: string,
  options: DailyPlanDetailApiOptions = {}
): Promise<DailyPlanWithShots | null> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      signal: options.signal
    }
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    plan?: Record<string, unknown>;
    shots?: Record<string, unknown>[];
  };
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(payload.error || "일촬표를 불러오지 못했습니다.");
  }
  if (!payload.plan) return null;
  return {
    plan: dailyPlanFromRow(payload.plan),
    shots: (payload.shots ?? []).map(dailyPlanShotFromRow)
  };
}

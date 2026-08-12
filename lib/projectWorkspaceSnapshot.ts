import { dailyPlanFromRow } from "@/lib/data/mappers";
import type { DailyPlanListItem } from "@/lib/data/dailyPlans";
import { calculateDailyProgressByPlan } from "@/lib/progress/dailyProgress";
import {
  buildProjectWorkspaceSummaryByPlan,
  type DailyPlanShotSummaryRow
} from "@/lib/projectWorkspaceSummary";
import type { Project } from "@/lib/types";

type DailyPlanRow = Record<string, unknown>;
type ProgressShotSummaryRow = {
  id?: unknown;
  daily_plan_id?: unknown;
  status?: unknown;
};

export type ProjectWorkspaceSnapshot = {
  project: Project | null;
  dailyPlans: DailyPlanListItem[];
  error: string;
};

/** 서버 layout과 client refresh가 같은 회차 요약 의미를 유지하도록 만드는 순수 변환입니다. */
export function buildProjectWorkspaceDailyPlanSummaries(
  planRows: DailyPlanRow[],
  dailyPlanShotRows: DailyPlanShotSummaryRow[],
  progressShotRows: ProgressShotSummaryRow[]
): DailyPlanListItem[] {
  const progressByPlan = calculateDailyProgressByPlan(progressShotRows.map((row, index) => {
    const dailyPlanId = String(row.daily_plan_id ?? "").trim();
    return {
      id: String(row.id ?? `${dailyPlanId}:workspace-summary:${index}`),
      dailyPlanId,
      status: row.status
    };
  }));
  const summaries = buildProjectWorkspaceSummaryByPlan(dailyPlanShotRows, progressByPlan);

  return planRows.map(dailyPlanFromRow).map((plan) => {
    const summary = summaries.get(plan.id);
    return {
      ...plan,
      shotCount: summary?.shotCount ?? 0,
      progressTotal: summary?.progressTotal ?? 0,
      progressCompleted: summary?.progressCompleted ?? 0,
      sceneNumbers: summary?.sceneNumbers ?? []
    };
  });
}

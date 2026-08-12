export type DailyPlanShotSummaryRow = {
  daily_plan_id?: unknown;
  scene_number?: unknown;
};

export type ProjectWorkspaceProgressSummary = {
  totalCutCount: number;
  processedCutCount: number;
};

export type ProjectWorkspacePlanSummary = {
  shotCount: number;
  progressTotal: number;
  progressCompleted: number;
  sceneNumbers: string[];
};

/** Layout seed가 client 목록 API와 같은 회차별 컷·진행도 의미를 쓰게 합니다. */
export function buildProjectWorkspaceSummaryByPlan(
  dailyPlanShotRows: DailyPlanShotSummaryRow[],
  progressByPlan: ReadonlyMap<string, ProjectWorkspaceProgressSummary>
) {
  const shotCounts = new Map<string, number>();
  const sceneNumbersByPlan = new Map<string, Set<string>>();
  dailyPlanShotRows.forEach((row) => {
    const dailyPlanId = String(row.daily_plan_id ?? "").trim();
    if (!dailyPlanId) return;
    shotCounts.set(dailyPlanId, (shotCounts.get(dailyPlanId) ?? 0) + 1);
    const sceneNumber = String(row.scene_number ?? "").trim();
    if (!sceneNumber) return;
    const sceneNumbers = sceneNumbersByPlan.get(dailyPlanId) ?? new Set<string>();
    sceneNumbers.add(sceneNumber);
    sceneNumbersByPlan.set(dailyPlanId, sceneNumbers);
  });

  const planIds = new Set([
    ...shotCounts.keys(),
    ...sceneNumbersByPlan.keys(),
    ...progressByPlan.keys()
  ]);

  return new Map<string, ProjectWorkspacePlanSummary>([...planIds].map((dailyPlanId) => {
    const progress = progressByPlan.get(dailyPlanId);
    return [dailyPlanId, {
      shotCount: shotCounts.get(dailyPlanId) ?? 0,
      progressTotal: progress?.totalCutCount ?? 0,
      progressCompleted: progress?.processedCutCount ?? 0,
      sceneNumbers: [...(sceneNumbersByPlan.get(dailyPlanId) ?? [])]
    }];
  }));
}

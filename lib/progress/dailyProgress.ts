import type { ShotStatus } from "@/lib/types";

type DailyProgressCut = {
  id: string;
  status: unknown;
};

export type DailyPlanProgressCut = DailyProgressCut & {
  dailyPlanId: string;
};

export type DailyProgressSummary = {
  totalCutCount: number;
  okCutCount: number;
  omitCutCount: number;
  processedCutCount: number;
  remainingCutCount: number;
  progressPercent: number;
};

/** 저장값과 레거시 표기를 진행표의 실제 status enum으로 정규화합니다. */
export function normalizeProgressCutStatus(status: unknown): ShotStatus {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "ok") return "ok";
  if (normalized === "omit") return "omit";
  return "pending";
}

/** OK와 OMIT은 촬영 방식은 다르지만 둘 다 더 처리할 필요가 없는 상태입니다. */
export function isProcessedCutStatus(status: unknown) {
  const normalized = normalizeProgressCutStatus(status);
  return normalized === "ok" || normalized === "omit";
}

/** 사용자에게 표시하는 퍼센트를 정수 0~100으로 한 번만 정규화합니다. */
export function normalizeProgressPercent(value: number) {
  const rounded = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.min(100, Math.max(0, rounded));
}

/** 화면에 표시되는 퍼센트와 동일한 경계값으로 진행 상태 문구를 결정합니다. */
export function getDailyProgressMessage(progressPercent: number) {
  const normalized = normalizeProgressPercent(progressPercent);
  if (normalized === 100) return "고생하셨습니다!";
  if (normalized >= 95) return "슬바합시다,";
  return "집에 가기까지";
}

/** 상세 화면과 회차 카드가 같은 반올림·0컷·clamp 규칙을 공유합니다. */
export function calculateProgressPercent(totalCutCount: number, processedCutCount: number) {
  const safeTotal = Math.max(0, Number.isFinite(totalCutCount) ? totalCutCount : 0);
  const safeProcessed = Math.max(0, Number.isFinite(processedCutCount) ? processedCutCount : 0);
  const rawPercent = safeTotal > 0
    ? (safeProcessed / safeTotal) * 100
    : 0;
  return normalizeProgressPercent(rawPercent);
}

/** 현재 진행표에 실제로 렌더링되는 컷을 stable id로 중복 제거해 진행률을 계산합니다. */
export function calculateDailyProgress(cuts: readonly DailyProgressCut[]): DailyProgressSummary {
  const uniqueCuts = new Map<string, ShotStatus>();

  cuts.forEach((cut) => {
    const cutId = String(cut.id ?? "").trim();
    if (!cutId || uniqueCuts.has(cutId)) return;
    uniqueCuts.set(cutId, normalizeProgressCutStatus(cut.status));
  });

  let okCutCount = 0;
  let omitCutCount = 0;
  uniqueCuts.forEach((status) => {
    if (status === "ok") okCutCount += 1;
    if (status === "omit") omitCutCount += 1;
  });

  const totalCutCount = uniqueCuts.size;
  const processedCutCount = okCutCount + omitCutCount;
  const remainingCutCount = Math.max(0, totalCutCount - processedCutCount);
  const progressPercent = calculateProgressPercent(totalCutCount, processedCutCount);

  return {
    totalCutCount,
    okCutCount,
    omitCutCount,
    processedCutCount,
    remainingCutCount,
    progressPercent
  };
}

/** 한 프로젝트에서 일괄 조회한 컷을 회차별로 묶되 상세 진행률 helper를 그대로 재사용합니다. */
export function calculateDailyProgressByPlan(cuts: readonly DailyPlanProgressCut[]) {
  const cutsByPlan = new Map<string, DailyProgressCut[]>();
  cuts.forEach((cut) => {
    const dailyPlanId = String(cut.dailyPlanId ?? "").trim();
    if (!dailyPlanId) return;
    const values = cutsByPlan.get(dailyPlanId) ?? [];
    values.push({ id: cut.id, status: cut.status });
    cutsByPlan.set(dailyPlanId, values);
  });

  return new Map(
    [...cutsByPlan].map(([dailyPlanId, planCuts]) => [dailyPlanId, calculateDailyProgress(planCuts)])
  );
}

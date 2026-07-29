import type { ShotStatus } from "@/lib/types";

type DailyProgressCut = {
  id: string;
  status: unknown;
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
  const rawPercent = totalCutCount > 0
    ? Math.round((processedCutCount / totalCutCount) * 100)
    : 0;
  const progressPercent = Math.min(100, Math.max(0, rawPercent));

  return {
    totalCutCount,
    okCutCount,
    omitCutCount,
    processedCutCount,
    remainingCutCount,
    progressPercent
  };
}

import { decodeDailyPlanMemo } from "@/lib/dailyPlan/printMeta";
import type { DailyPlanDraft } from "@/lib/types";

type DailyPlanIdentity = Pick<DailyPlanDraft, "episode" | "shootingDate" | "memo">;

/** 회차 전용 컬럼이 비어 있는 예전 저장본은 메모 메타데이터의 회차를 사용합니다. */
export function getDailyPlanEpisodeKey(plan: Pick<DailyPlanDraft, "episode" | "memo">) {
  return plan.episode.trim() || decodeDailyPlanMemo(plan.memo).day.trim();
}

/** 신규 저장에만 사용하는 중복 기준: 같은 프로젝트 안의 동일 회차 + 동일 촬영일. */
export function isSameDailyPlanIdentity(left: DailyPlanIdentity, right: DailyPlanIdentity) {
  const leftEpisode = getDailyPlanEpisodeKey(left);
  const rightEpisode = getDailyPlanEpisodeKey(right);
  const leftDate = left.shootingDate.trim();
  const rightDate = right.shootingDate.trim();
  return Boolean(leftEpisode && rightEpisode && leftDate && rightDate && leftEpisode === rightEpisode && leftDate === rightDate);
}

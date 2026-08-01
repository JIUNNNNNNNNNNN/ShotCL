import type { DailyPlan } from "@/lib/types";

type CarouselPlanIdentity = Pick<DailyPlan, "id" | "episode">;

const episodeCollator = new Intl.Collator("ko-KR", {
  numeric: true,
  sensitivity: "base"
});

/** 기존 일촬표 카드와 같은 규칙으로 회차 라벨을 만듭니다. */
export function formatDailyPlanEpisodeLabel(value: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "회차 미입력";
  if (/회차$/u.test(normalized)) return normalized;
  const episodeNumber = normalized.match(/\d+(?:\.\d+)?/u)?.[0];
  return episodeNumber ? `${episodeNumber}회차` : `${normalized}회차`;
}

/** 촬영일·진행률과 무관하게 회차를 natural sort하고 stable id로 순서를 고정합니다. */
export function compareDailyPlanEpisodes(left: CarouselPlanIdentity, right: CarouselPlanIdentity) {
  const leftNumber = Number(left.episode.match(/\d+(?:\.\d+)?/u)?.[0]);
  const rightNumber = Number(right.episode.match(/\d+(?:\.\d+)?/u)?.[0]);
  const leftHasNumber = Number.isFinite(leftNumber);
  const rightHasNumber = Number.isFinite(rightNumber);
  if (leftHasNumber && rightHasNumber && leftNumber !== rightNumber) return leftNumber - rightNumber;
  if (leftHasNumber !== rightHasNumber) return leftHasNumber ? -1 : 1;
  const episodeComparison = episodeCollator.compare(left.episode.trim(), right.episode.trim());
  if (episodeComparison !== 0) return episodeComparison;
  return left.id.localeCompare(right.id);
}

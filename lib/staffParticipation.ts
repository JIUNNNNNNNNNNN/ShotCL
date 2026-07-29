import type { ProjectStaffMember } from "@/lib/types";

const maximumStoredEpisodeNumber = 10_000;

/** 구버전·중복·범위 밖 값을 안전하게 정리해 비참여 회차만 보존합니다. */
export function normalizeExcludedEpisodeNumbers(
  value: unknown,
  totalEpisodes?: number | null
): number[] {
  if (!Array.isArray(value)) return [];

  const normalizedTotal = normalizeStaffTotalEpisodes(totalEpisodes);
  const shouldEnforceTotal = totalEpisodes !== undefined && totalEpisodes !== null;
  return [...new Set(
    value
      .map((episode) => Number(episode))
      .filter((episode) => (
        Number.isInteger(episode)
        && episode >= 1
        && episode <= maximumStoredEpisodeNumber
        && (!shouldEnforceTotal || (normalizedTotal > 0 && episode <= normalizedTotal))
      ))
  )].sort((left, right) => left - right);
}

/** 비참여 정보가 없는 구버전 스태프는 모든 회차 참여로 판정합니다. */
export function isStaffParticipatingInEpisode(
  staff: Pick<ProjectStaffMember, "excludedEpisodeNumbers">,
  episodeNumber: unknown
) {
  const normalizedEpisode = Number(episodeNumber);
  if (!Number.isInteger(normalizedEpisode) || normalizedEpisode < 1) return true;
  return !normalizeExcludedEpisodeNumbers(staff.excludedEpisodeNumbers).includes(normalizedEpisode);
}

export function normalizeStaffTotalEpisodes(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1
    ? Math.min(parsed, maximumStoredEpisodeNumber)
    : 0;
}

import { KOREA_TIME_ZONE } from "@/lib/koreaDate";

/** @deprecated 새 호출부는 neutral progress resolver를 직접 사용합니다. */
export {
  resolveRelevantProgressRound as resolveGoRound,
  sortRelevantProgressRoundsByCanonicalOrder as sortGoRoundsByCanonicalOrder
} from "@/lib/progress/resolveRelevantRound";
export type {
  RelevantProgressRoundCandidate as GoRoundCandidate,
  RelevantProgressRoundResolution as GoRoundResolution,
  RelevantProgressRoundResolutionReason as GoRoundResolutionReason
} from "@/lib/progress/resolveRelevantRound";

export const GO_ROUND_TIME_ZONE = KOREA_TIME_ZONE;
export { getKoreaDateOnly } from "@/lib/koreaDate";

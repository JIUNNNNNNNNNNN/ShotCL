import { compareDailyPlanEpisodes } from "@/lib/dailyPlan/carouselPresentation";
import { normalizeDailyPlanDateOnly } from "@/lib/dailyPlan/dateOnly";
import {
  isDailyProgressComplete,
  type DailyProgressCompletion
} from "@/lib/progress/dailyProgress";

export const GO_ROUND_TIME_ZONE = "Asia/Seoul" as const;

export type GoRoundCandidate = {
  id: string;
  shootingDate: string;
  episode: string;
  progress: DailyProgressCompletion;
};

export type GoRoundResolutionReason =
  | "overdue-incomplete"
  | "today"
  | "before-first"
  | "next"
  | "after-last";

export type GoRoundResolution<T extends GoRoundCandidate> =
  | {
      status: "resolved";
      round: T;
      reason: GoRoundResolutionReason;
    }
  | {
      status: "empty";
    }
  | {
      status: "no-valid-date";
    }
  | {
      status: "invalid-today";
    };

type DatedGoRound<T extends GoRoundCandidate> = {
  round: T;
  date: string;
};

/**
 * 클릭 순간의 시각을 대한민국 표준시 기준 date-only 값으로 변환합니다.
 * device·Node/Vercel local timezone과 UTC 날짜 문자열에 의존하지 않습니다.
 */
export function getKoreaDateOnly(now: Date = new Date()) {
  if (!Number.isFinite(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GO_ROUND_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return normalizeDailyPlanDateOnly(
    `${values.get("year") ?? ""}-${values.get("month") ?? ""}-${values.get("day") ?? ""}`
  );
}

/** 날짜 → canonical 회차 순서 → stable id 순으로 복사 정렬합니다. */
export function sortGoRoundsByCanonicalOrder<T extends GoRoundCandidate>(rounds: readonly T[]) {
  return collectDatedGoRounds(rounds).map(({ round }) => round);
}

function collectDatedGoRounds<T extends GoRoundCandidate>(rounds: readonly T[]) {
  return rounds
    .flatMap<DatedGoRound<T>>((round) => {
      const date = normalizeDailyPlanDateOnly(round.shootingDate);
      return date ? [{ round, date }] : [];
    })
    .sort(compareDatedGoRounds);
}

/**
 * 날짜가 도래한 가장 이른 미완료 회차를 먼저 선택하고, 없으면 오늘·다음·
 * 마지막 회차 순서로 해결합니다. 날짜가 없거나 잘못된 회차는 날짜 비교에서
 * 제외하며, 모두 제외된 경우 caller가 기존 Go fallback을 유지할 수 있도록
 * no-valid-date를 반환합니다.
 */
export function resolveGoRound<T extends GoRoundCandidate>(
  rounds: readonly T[],
  todayKorea: string
): GoRoundResolution<T> {
  if (rounds.length === 0) return { status: "empty" };

  const today = normalizeDailyPlanDateOnly(todayKorea);
  if (!today) return { status: "invalid-today" };

  const datedRounds = collectDatedGoRounds(rounds);
  if (datedRounds.length === 0) return { status: "no-valid-date" };

  const overdueIncomplete = datedRounds.find(({ round, date }) => (
    date <= today && !isDailyProgressComplete(round.progress)
  ));
  if (overdueIncomplete) {
    return {
      status: "resolved",
      round: overdueIncomplete.round,
      reason: "overdue-incomplete"
    };
  }

  const todayRound = datedRounds.find(({ date }) => date === today);
  if (todayRound) {
    return { status: "resolved", round: todayRound.round, reason: "today" };
  }

  const nextRound = datedRounds.find(({ date }) => date > today);
  if (nextRound) {
    return {
      status: "resolved",
      round: nextRound.round,
      reason: today < datedRounds[0].date ? "before-first" : "next"
    };
  }

  return {
    status: "resolved",
    round: datedRounds[datedRounds.length - 1].round,
    reason: "after-last"
  };
}

function compareDatedGoRounds<T extends GoRoundCandidate>(
  left: DatedGoRound<T>,
  right: DatedGoRound<T>
) {
  const dateComparison = left.date.localeCompare(right.date);
  if (dateComparison !== 0) return dateComparison;
  const episodeComparison = compareDailyPlanEpisodes(left.round, right.round);
  if (episodeComparison !== 0) return episodeComparison;
  return left.round.id.localeCompare(right.round.id);
}

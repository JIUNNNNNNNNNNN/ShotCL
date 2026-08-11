import { compareDailyPlanEpisodes } from "@/lib/dailyPlan/carouselPresentation";
import { normalizeDailyPlanDateOnly } from "@/lib/dailyPlan/dateOnly";
import {
  isDailyProgressComplete,
  type DailyProgressCompletion
} from "@/lib/progress/dailyProgress";

export type RelevantProgressRoundCandidate = {
  id: string;
  shootingDate: string;
  episode: string;
  progress: DailyProgressCompletion;
};

export type RelevantProgressRoundResolutionReason =
  | "overdue-incomplete"
  | "today"
  | "before-first"
  | "next"
  | "after-last"
  | "undated-fallback";

export type RelevantProgressRoundResolution<T extends RelevantProgressRoundCandidate> =
  | {
      status: "resolved";
      round: T;
      reason: RelevantProgressRoundResolutionReason;
    }
  | {
      status: "empty";
    }
  | {
      status: "invalid-today";
    };

type DatedRelevantProgressRound<T extends RelevantProgressRoundCandidate> = {
  round: T;
  date: string;
};

/** 촬영일이 유효한 회차만 남겨 촬영일 → canonical 회차 → stable id 순으로 복사 정렬합니다. */
export function sortRelevantProgressRoundsByCanonicalOrder<T extends RelevantProgressRoundCandidate>(
  rounds: readonly T[]
) {
  return collectDatedRounds(rounds).map(({ round }) => round);
}

/**
 * 가장 오래된 도래 미완료 회차를 우선하고, 없으면 오늘·다음·마지막 회차를
 * 선택합니다. 일부 잘못된 촬영일은 비교에서 제외하며, 촬영일이 전부 없으면
 * 기존 회차 natural order의 첫 회차를 안정적인 fallback으로 사용합니다.
 */
export function resolveRelevantProgressRound<T extends RelevantProgressRoundCandidate>(
  rounds: readonly T[],
  todayKorea: string
): RelevantProgressRoundResolution<T> {
  if (rounds.length === 0) return { status: "empty" };

  const today = normalizeDailyPlanDateOnly(todayKorea);
  if (!today) return { status: "invalid-today" };

  const datedRounds = collectDatedRounds(rounds);
  if (datedRounds.length === 0) {
    const fallbackRound = [...rounds].sort(compareDailyPlanEpisodes)[0];
    return fallbackRound
      ? { status: "resolved", round: fallbackRound, reason: "undated-fallback" }
      : { status: "empty" };
  }

  const overdueIncomplete = datedRounds.find(({ round, date }) => (
    date < today && !isDailyProgressComplete(round.progress)
  ));
  if (overdueIncomplete) {
    return {
      status: "resolved",
      round: overdueIncomplete.round,
      reason: "overdue-incomplete"
    };
  }

  const todayRounds = datedRounds.filter(({ date }) => date === today);
  const todayRound = todayRounds.find(({ round }) => (
    !isDailyProgressComplete(round.progress)
  )) ?? todayRounds[0];
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

function collectDatedRounds<T extends RelevantProgressRoundCandidate>(rounds: readonly T[]) {
  return rounds
    .flatMap<DatedRelevantProgressRound<T>>((round) => {
      const date = normalizeDailyPlanDateOnly(round.shootingDate);
      return date ? [{ round, date }] : [];
    })
    .sort(compareDatedRounds);
}

function compareDatedRounds<T extends RelevantProgressRoundCandidate>(
  left: DatedRelevantProgressRound<T>,
  right: DatedRelevantProgressRound<T>
) {
  const dateComparison = left.date.localeCompare(right.date);
  if (dateComparison !== 0) return dateComparison;
  return compareDailyPlanEpisodes(left.round, right.round);
}

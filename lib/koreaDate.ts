export const KOREA_TIME_ZONE = "Asia/Seoul" as const;

/** 실행 환경의 timezone과 무관하게 현재 시각을 대한민국 date-only 값으로 변환합니다. */
export function getKoreaDateOnly(now: Date = new Date()) {
  if (!Number.isFinite(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}


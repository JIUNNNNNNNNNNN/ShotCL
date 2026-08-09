import {
  y2018,
  y2019,
  y2020,
  y2021,
  y2022,
  y2023,
  y2024,
  y2025,
  y2026,
  y2027
} from "@hyunbinseo/holidays-kr/all";

type KoreanHolidayPreset = Readonly<Record<string, readonly string[]>>;

const KOREAN_HOLIDAY_PRESETS: Readonly<Record<string, KoreanHolidayPreset>> = {
  "2018": y2018,
  "2019": y2019,
  "2020": y2020,
  "2021": y2021,
  "2022": y2022,
  "2023": y2023,
  "2024": y2024,
  "2025": y2025,
  "2026": y2026,
  "2027": y2027
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type KoreanCalendarDayTone = "holiday" | "saturday" | "weekday";

export const KOREAN_HOLIDAY_DATA_RANGE = {
  startYear: 2018,
  endYear: 2027
} as const;

/**
 * 우주항공청 월력요항 기반 정적 preset에서 대한민국 공휴일 명칭을 찾습니다.
 * Date/UTC 변환과 네트워크 요청을 사용하지 않아 한국 date-only 값이 밀리지 않습니다.
 */
export function getKoreanHolidayNames(dateKey: string): readonly string[] {
  const match = DATE_ONLY_PATTERN.exec(dateKey);
  if (!match) return [];
  return KOREAN_HOLIDAY_PRESETS[match[1]]?.[dateKey] ?? [];
}

/** 표시 중인 달력 범위만 한 번 색인하여 각 날짜 셀의 반복 계산을 피합니다. */
export function buildKoreanHolidayIndex(dateKeys: readonly string[]) {
  const holidays = new Map<string, readonly string[]>();
  for (const dateKey of dateKeys) {
    const names = getKoreanHolidayNames(dateKey);
    if (names.length > 0) holidays.set(dateKey, names);
  }
  return holidays;
}

/** 공휴일·일요일 red가 토요일 blue보다 우선하도록 한 곳에서 분류합니다. */
export function getKoreanCalendarDayTone(
  dateKey: string,
  weekday: number,
  holidayNames: readonly string[] = getKoreanHolidayNames(dateKey)
): KoreanCalendarDayTone {
  if (holidayNames.length > 0 || weekday === 0) return "holiday";
  if (weekday === 6) return "saturday";
  return "weekday";
}

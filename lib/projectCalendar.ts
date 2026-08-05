import type { DailyPlan, ProjectCalendarInfo } from "@/lib/types";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export type ProjectCalendarMonth = {
  key: string;
  year: number;
  month: number;
  label: string;
};

export type ProjectCalendarDay = {
  key: string;
  year: number;
  month: number;
  day: number;
  inCurrentMonth: boolean;
};

export type ProjectCalendarModel = {
  rangeStart: string;
  rangeEnd: string;
  months: ProjectCalendarMonth[];
  shootingDates: Set<string>;
  shootingDateCounts: Map<string, number>;
  rangeSource: "basic-info" | "daily-plans" | "none";
};

type CalendarSource = {
  calendarInfo?: Pick<ProjectCalendarInfo, "shootingStartDate" | "shootingEndDate"> | null;
  dailyPlans: ReadonlyArray<Pick<DailyPlan, "shootingDate">>;
  explicitShootingDates?: readonly string[];
};

/**
 * 기본정보의 촬영 기간을 표시 범위로, 일촬표 촬영일을 실제 강조 날짜로 정리합니다.
 * 날짜 문자열은 로컬/UTC Date로 왕복시키지 않아 타임존에 따른 하루 이동을 막습니다.
 */
export function buildProjectCalendarModel({
  calendarInfo,
  dailyPlans,
  explicitShootingDates = []
}: CalendarSource): ProjectCalendarModel {
  const shootingDateCounts = new Map<string, number>();
  [...explicitShootingDates, ...dailyPlans.map((plan) => plan.shootingDate)].forEach((value) => {
    const date = normalizeDateOnly(value);
    if (!date) return;
    shootingDateCounts.set(date, (shootingDateCounts.get(date) ?? 0) + 1);
  });
  const shootingDates = new Set(shootingDateCounts.keys());

  const basicStart = normalizeDateOnly(calendarInfo?.shootingStartDate);
  const basicEnd = normalizeDateOnly(calendarInfo?.shootingEndDate);
  if (basicStart && basicEnd && basicStart <= basicEnd) {
    return {
      rangeStart: basicStart,
      rangeEnd: basicEnd,
      months: enumerateCalendarMonths(basicStart, basicEnd),
      shootingDates,
      shootingDateCounts,
      rangeSource: "basic-info"
    };
  }

  const actualDates = [...shootingDates].sort();
  const rangeStart = actualDates[0] ?? "";
  const rangeEnd = actualDates.at(-1) ?? "";
  return {
    rangeStart,
    rangeEnd,
    months: rangeStart && rangeEnd ? enumerateCalendarMonths(rangeStart, rangeEnd) : [],
    shootingDates,
    shootingDateCounts,
    rangeSource: rangeStart ? "daily-plans" : "none"
  };
}

/** 시작월부터 종료월까지 연도 경계를 포함해 빠짐없이 생성합니다. */
export function enumerateCalendarMonths(startDate: string, endDate: string) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || startDate > endDate) return [];

  const startOrdinal = start.year * 12 + start.month - 1;
  const endOrdinal = end.year * 12 + end.month - 1;
  const months: ProjectCalendarMonth[] = [];
  for (let ordinal = startOrdinal; ordinal <= endOrdinal; ordinal += 1) {
    const year = Math.floor(ordinal / 12);
    const month = ordinal % 12 + 1;
    months.push({
      key: `${year}-${pad2(month)}`,
      year,
      month,
      label: `${year}년 ${month}월`
    });
  }
  return months;
}

/** 항상 6주(42일)를 생성해 어떤 달의 마지막 주도 생략하지 않습니다. */
export function buildCalendarMonthDays(month: Pick<ProjectCalendarMonth, "year" | "month">) {
  const firstWeekday = new Date(Date.UTC(month.year, month.month - 1, 1)).getUTCDay();
  return Array.from({ length: 42 }, (_, index): ProjectCalendarDay => {
    const date = new Date(Date.UTC(month.year, month.month - 1, index - firstWeekday + 1));
    const year = date.getUTCFullYear();
    const resolvedMonth = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return {
      key: formatDateKey(year, resolvedMonth, day),
      year,
      month: resolvedMonth,
      day,
      inCurrentMonth: year === month.year && resolvedMonth === month.month
    };
  });
}

export function normalizeDateOnly(value: unknown) {
  const parsed = parseDateOnly(value);
  return parsed ? formatDateKey(parsed.year, parsed.month, parsed.day) : "";
}

export function getLocalTodayDateKey(now = new Date()) {
  return formatDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function formatCalendarPeriod(startDate: string, endDate: string) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) return "";
  return `${start.year}. ${start.month}. ${start.day}. – ${end.year}. ${end.month}. ${end.day}.`;
}

function parseDateOnly(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(DATE_ONLY_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() + 1 !== month
    || check.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function formatDateKey(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

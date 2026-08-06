import type { DailyPlan, ProjectCalendarInfo } from "@/lib/types";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_ONLY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;

export const CALENDAR_GRID_DAY_COUNT = 42;

export const CALENDAR_EVENT_COLORS = [
  { key: "lime", label: "라임", hex: "#D5FF40", text: "#11140A" },
  { key: "yellow", label: "노랑", hex: "#FFF45C", text: "#16150A" },
  { key: "cyan", label: "시안", hex: "#45F5D2", text: "#071412" },
  { key: "blue", label: "파랑", hex: "#5B9CFF", text: "#081225" },
  { key: "magenta", label: "마젠타", hex: "#FF62C8", text: "#210A19" }
] as const;

export type CalendarEventColorKey = typeof CALENDAR_EVENT_COLORS[number]["key"];

export type DateOnlyParts = {
  year: number;
  month: number;
  day: number;
};

export type DateOnlyRange = {
  startDate: string;
  endDate: string;
};

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
  weekday: number;
  weekIndex: number;
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

export type CalendarDailyPlanLike = {
  id?: string | null;
  shootingDate: string;
  episode?: string | number | null;
  episodeLabel?: string | null;
};

export type IndexedCalendarDailyPlan<Plan extends CalendarDailyPlanLike = CalendarDailyPlanLike> = {
  id: string;
  dateKey: string;
  episodeLabel: string;
  plan: Plan;
};

export type CalendarEventLike = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  colorKey?: string | null;
  createdAt?: string | null;
};

export type IndexedCalendarEvent<Event extends CalendarEventLike = CalendarEventLike> = {
  event: Event;
  dateKey: string;
  isEventStart: boolean;
  isEventEnd: boolean;
  startsSegment: boolean;
  endsSegment: boolean;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type CalendarEventSegment<Event extends CalendarEventLike = CalendarEventLike> = {
  key: string;
  event: Event;
  startDate: string;
  endDate: string;
  isEventStart: boolean;
  isEventEnd: boolean;
  startsAtWeekBoundary: boolean;
  endsAtWeekBoundary: boolean;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type CalendarEventInputLike = {
  title: unknown;
  startDate: unknown;
  endDate: unknown;
  startTime?: unknown;
  endTime?: unknown;
  location?: unknown;
  colorKey: unknown;
};

export type NormalizedCalendarEventInput = {
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  colorKey: CalendarEventColorKey;
};

export type CalendarEventValidationResult =
  | { ok: true; value: NormalizedCalendarEventInput }
  | { ok: false; errors: Record<string, string> };

type CalendarSource = {
  calendarInfo?: Pick<ProjectCalendarInfo, "shootingStartDate" | "shootingEndDate"> | null;
  dailyPlans: ReadonlyArray<Pick<DailyPlan, "shootingDate">>;
  explicitShootingDates?: readonly string[];
};

/**
 * 기존 달력 호출과의 호환을 위한 요약 모델입니다. 새 월간 UI는 한 달만 표시하되,
 * 기본정보 촬영기간과 실제 일촬표 날짜를 서로 다른 source로 계속 유지합니다.
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

  const basicRange = normalizeDateRange(
    calendarInfo?.shootingStartDate,
    calendarInfo?.shootingEndDate
  );
  if (basicRange) {
    return {
      rangeStart: basicRange.startDate,
      rangeEnd: basicRange.endDate,
      months: enumerateCalendarMonths(basicRange.startDate, basicRange.endDate),
      shootingDates,
      shootingDateCounts,
      rangeSource: "basic-info"
    };
  }

  const actualDates = [...shootingDates].sort(compareDateOnly);
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
  if (!start || !end || compareDateOnly(startDate, endDate) > 0) return [];

  const startOrdinal = start.year * 12 + start.month - 1;
  const endOrdinal = end.year * 12 + end.month - 1;
  const months: ProjectCalendarMonth[] = [];
  for (let ordinal = startOrdinal; ordinal <= endOrdinal; ordinal += 1) {
    const year = Math.floor(ordinal / 12);
    const month = ordinal % 12 + 1;
    months.push(buildCalendarMonth(year, month));
  }
  return months;
}

/** 일요일부터 토요일까지, 항상 6주(42일)를 생성합니다. */
export function buildCalendarMonthDays(month: Pick<ProjectCalendarMonth, "year" | "month">) {
  const normalizedMonth = normalizeMonth(month.year, month.month);
  const firstWeekday = getDateOnlyWeekday(formatDateOnly({ ...normalizedMonth, day: 1 }));
  return Array.from({ length: CALENDAR_GRID_DAY_COUNT }, (_, index): ProjectCalendarDay => {
    const key = addDateOnlyDays(
      formatDateOnly({ ...normalizedMonth, day: 1 }),
      index - firstWeekday
    );
    const date = parseDateOnly(key)!;
    return {
      key,
      ...date,
      weekday: index % 7,
      weekIndex: Math.floor(index / 7),
      inCurrentMonth: date.year === normalizedMonth.year && date.month === normalizedMonth.month
    };
  });
}

/** YYYY-MM-DD를 Date 객체로 왕복시키지 않고 숫자 조각으로 검증합니다. */
export function parseDateOnly(value: unknown): DateOnlyParts | null {
  const raw = String(value ?? "").trim();
  const match = raw.match(DATE_ONLY_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // HTML date input과 Postgres `date`에 안전한 네 자리 양의 연도만 허용합니다.
  // 특히 0000은 client에서는 문자열처럼 보이지만 DB write에서 실패합니다.
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > getDaysInMonth(year, month)) return null;
  return { year, month, day };
}

export function formatDateOnly(parts: DateOnlyParts) {
  return `${String(parts.year).padStart(4, "0")}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function normalizeDateOnly(value: unknown) {
  const parsed = parseDateOnly(value);
  return parsed ? formatDateOnly(parsed) : "";
}

export function compareDateOnly(firstValue: unknown, secondValue: unknown) {
  const first = normalizeDateOnly(firstValue);
  const second = normalizeDateOnly(secondValue);
  if (!first && !second) return 0;
  if (!first) return 1;
  if (!second) return -1;
  return first.localeCompare(second);
}

export function addDateOnlyDays(value: unknown, amount: number) {
  const parsed = parseDateOnly(value);
  if (!parsed || !Number.isFinite(amount)) return "";
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + Math.trunc(amount)));
  return formatDateOnly({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  });
}

/** 월 이동 시 원래 day를 해당 월의 마지막 날 안으로 clamp합니다. */
export function addDateOnlyMonths(value: unknown, amount: number) {
  const parsed = parseDateOnly(value);
  if (!parsed || !Number.isFinite(amount)) return "";
  const monthOrdinal = parsed.year * 12 + parsed.month - 1 + Math.trunc(amount);
  const year = Math.floor(monthOrdinal / 12);
  const month = ((monthOrdinal % 12) + 12) % 12 + 1;
  return formatDateOnly({ year, month, day: Math.min(parsed.day, getDaysInMonth(year, month)) });
}

export function getDateOnlyWeekday(value: unknown) {
  const parsed = parseDateOnly(value);
  if (!parsed) return -1;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

export function normalizeDateRange(startValue: unknown, endValue: unknown): DateOnlyRange | null {
  const startDate = normalizeDateOnly(startValue);
  const endDate = normalizeDateOnly(endValue);
  if (!startDate || !endDate || startDate > endDate) return null;
  return { startDate, endDate };
}

export function normalizeUnorderedDateRange(firstValue: unknown, secondValue: unknown): DateOnlyRange | null {
  const firstDate = normalizeDateOnly(firstValue);
  const secondDate = normalizeDateOnly(secondValue);
  if (!firstDate || !secondDate) return null;
  return firstDate <= secondDate
    ? { startDate: firstDate, endDate: secondDate }
    : { startDate: secondDate, endDate: firstDate };
}

export function isDateInRange(value: unknown, startValue: unknown, endValue: unknown) {
  const date = normalizeDateOnly(value);
  const range = normalizeDateRange(startValue, endValue);
  return Boolean(date && range && date >= range.startDate && date <= range.endDate);
}

export function getLocalTodayDateKey(now = new Date()) {
  return formatDateOnly({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/**
 * 초기 월/선택일 공통 우선순위: 촬영기간 안의 오늘 → 촬영 시작일 →
 * 오늘과 가장 가까운 일정/일촬표 날짜 → 오늘.
 */
export function getInitialCalendarDate({
  today = getLocalTodayDateKey(),
  shootingStartDate,
  shootingEndDate,
  eventDates = [],
  eventRanges = []
}: {
  today?: string;
  shootingStartDate?: unknown;
  shootingEndDate?: unknown;
  eventDates?: readonly unknown[];
  eventRanges?: ReadonlyArray<{ startDate: unknown; endDate: unknown }>;
}) {
  const todayKey = normalizeDateOnly(today) || getLocalTodayDateKey();
  const shootingRange = normalizeDateRange(shootingStartDate, shootingEndDate);
  if (shootingRange && isDateInRange(todayKey, shootingRange.startDate, shootingRange.endDate)) {
    return todayKey;
  }

  const shootingStart = normalizeDateOnly(shootingStartDate);
  if (shootingStart) return shootingStart;

  const eventRangeDates = eventRanges.flatMap((candidate) => {
    const range = normalizeDateRange(candidate.startDate, candidate.endDate);
    if (!range) return [];
    if (todayKey < range.startDate) return [range.startDate];
    if (todayKey > range.endDate) return [range.endDate];
    return [todayKey];
  });
  const nearestEventDate = findNearestDateOnly(todayKey, [...eventDates, ...eventRangeDates]);
  return nearestEventDate || todayKey;
}

export function getInitialCalendarMonth(input: Parameters<typeof getInitialCalendarDate>[0]) {
  return buildCalendarMonthFromDate(getInitialCalendarDate(input));
}

export function buildCalendarMonthFromDate(value: unknown) {
  const parsed = parseDateOnly(value);
  return parsed ? buildCalendarMonth(parsed.year, parsed.month) : null;
}

export function buildDailyPlanDateIndex<Plan extends CalendarDailyPlanLike>(plans: readonly Plan[]) {
  const index = new Map<string, IndexedCalendarDailyPlan<Plan>[]>();
  plans.forEach((plan, planIndex) => {
    const dateKey = normalizeDateOnly(plan.shootingDate);
    if (!dateKey) return;
    const episodeLabel = formatCalendarEpisodeLabel(plan.episodeLabel ?? plan.episode);
    const item: IndexedCalendarDailyPlan<Plan> = {
      id: String(plan.id ?? `${dateKey}:${episodeLabel}:${planIndex}`),
      dateKey,
      episodeLabel,
      plan
    };
    index.set(dateKey, [...(index.get(dateKey) ?? []), item]);
  });
  index.forEach((items) => items.sort(compareIndexedDailyPlans));
  return index;
}

export function formatCalendarEpisodeLabel(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "회차 미정";
  if (/회차$/u.test(raw)) return raw;
  return `${raw}회차`;
}

export function compareCalendarEvents<Event extends CalendarEventLike>(first: Event, second: Event) {
  const firstTime = normalizeCalendarTime(first.startTime) || "99:99";
  const secondTime = normalizeCalendarTime(second.startTime) || "99:99";
  return firstTime.localeCompare(secondTime)
    || String(first.createdAt ?? "").localeCompare(String(second.createdAt ?? ""))
    || first.id.localeCompare(second.id);
}

/** 선택 범위 안에서 날짜별 event membership과 week segment 경계를 한 번에 계산합니다. */
export function buildCalendarEventDateIndex<Event extends CalendarEventLike>(
  events: readonly Event[],
  visibleRange?: DateOnlyRange | null
) {
  const index = new Map<string, IndexedCalendarEvent<Event>[]>();
  events.forEach((event) => {
    const eventRange = normalizeDateRange(event.startDate, event.endDate);
    if (!eventRange) return;
    const range = clampDateRange(eventRange, visibleRange);
    if (!range) return;
    forEachDateOnly(range, (dateKey) => {
      const weekday = getDateOnlyWeekday(dateKey);
      const isEventStart = dateKey === eventRange.startDate;
      const isEventEnd = dateKey === eventRange.endDate;
      const item: IndexedCalendarEvent<Event> = {
        event,
        dateKey,
        isEventStart,
        isEventEnd,
        startsSegment: isEventStart || weekday === 0 || dateKey === range.startDate,
        endsSegment: isEventEnd || weekday === 6 || dateKey === range.endDate,
        continuesBefore: dateKey > eventRange.startDate,
        continuesAfter: dateKey < eventRange.endDate
      };
      index.set(dateKey, [...(index.get(dateKey) ?? []), item]);
    });
  });
  index.forEach((items) => items.sort((first, second) => compareCalendarEvents(first.event, second.event)));
  return index;
}

/** 다일 일정을 일~토 week row 경계마다 하나의 시각 segment로 나눕니다. */
export function buildCalendarEventSegments<Event extends CalendarEventLike>(
  event: Event,
  visibleRange?: DateOnlyRange | null
): CalendarEventSegment<Event>[] {
  const eventRange = normalizeDateRange(event.startDate, event.endDate);
  if (!eventRange) return [];
  const range = clampDateRange(eventRange, visibleRange);
  if (!range) return [];

  const segments: CalendarEventSegment<Event>[] = [];
  let segmentStart = range.startDate;
  while (segmentStart <= range.endDate) {
    const weekday = getDateOnlyWeekday(segmentStart);
    const weekEnd = addDateOnlyDays(segmentStart, 6 - weekday);
    const segmentEnd = weekEnd < range.endDate ? weekEnd : range.endDate;
    const isEventStart = segmentStart === eventRange.startDate;
    const isEventEnd = segmentEnd === eventRange.endDate;
    segments.push({
      key: `${event.id}:${segmentStart}:${segmentEnd}`,
      event,
      startDate: segmentStart,
      endDate: segmentEnd,
      isEventStart,
      isEventEnd,
      startsAtWeekBoundary: weekday === 0,
      endsAtWeekBoundary: getDateOnlyWeekday(segmentEnd) === 6,
      continuesBefore: segmentStart > eventRange.startDate,
      continuesAfter: segmentEnd < eventRange.endDate
    });
    segmentStart = addDateOnlyDays(segmentEnd, 1);
  }
  return segments;
}

export function isCalendarEventColorKey(value: unknown): value is CalendarEventColorKey {
  return CALENDAR_EVENT_COLORS.some((color) => color.key === value);
}

export function normalizeCalendarTime(value: unknown) {
  const raw = String(value ?? "").trim();
  return TIME_ONLY_PATTERN.test(raw) ? raw : "";
}

/** UI의 명시적 저장 직전에 사용하는 순수 validation입니다. 빈 시간 쌍은 종일 일정으로 허용합니다. */
export function validateCalendarEventInput(value: CalendarEventInputLike): CalendarEventValidationResult {
  const title = String(value.title ?? "").trim();
  const startDate = normalizeDateOnly(value.startDate);
  const endDate = normalizeDateOnly(value.endDate);
  const rawStartTime = String(value.startTime ?? "").trim();
  const rawEndTime = String(value.endTime ?? "").trim();
  const startTime = normalizeCalendarTime(rawStartTime);
  const endTime = normalizeCalendarTime(rawEndTime);
  const location = String(value.location ?? "").trim();
  const errors: Record<string, string> = {};

  if (!title) errors.title = "일정 이름을 입력해주세요.";
  else if (title.length > 120) errors.title = "일정 이름은 120자 이하로 입력해주세요.";
  if (!startDate) errors.startDate = "올바른 시작 날짜를 선택해주세요.";
  if (!endDate) errors.endDate = "올바른 종료 날짜를 선택해주세요.";
  if (startDate && endDate && endDate < startDate) errors.endDate = "종료 날짜는 시작 날짜보다 빠를 수 없습니다.";
  if (rawStartTime && !startTime) errors.startTime = "시작 시간을 HH:MM 형식으로 입력해주세요.";
  if (rawEndTime && !endTime) errors.endTime = "종료 시간을 HH:MM 형식으로 입력해주세요.";
  if (Boolean(rawStartTime) !== Boolean(rawEndTime)) {
    const field = rawStartTime ? "endTime" : "startTime";
    errors[field] = "시작 시간과 종료 시간을 함께 입력해주세요.";
  }
  if (startDate && endDate && startDate === endDate && startTime && endTime && endTime < startTime) {
    errors.endTime = "종료 시간은 시작 시간보다 빠를 수 없습니다.";
  }
  if (location.length > 120) errors.location = "장소는 120자 이하로 입력해주세요.";
  if (!isCalendarEventColorKey(value.colorKey)) errors.colorKey = "제공된 일정 색상 중 하나를 선택해주세요.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      startDate,
      endDate,
      startTime,
      endTime,
      location,
      colorKey: value.colorKey as CalendarEventColorKey
    }
  };
}

export function formatCalendarPeriod(startDate: string, endDate: string) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) return "";
  return `${start.year}. ${start.month}. ${start.day}. – ${end.year}. ${end.month}. ${end.day}.`;
}

function buildCalendarMonth(year: number, month: number): ProjectCalendarMonth {
  const normalized = normalizeMonth(year, month);
  return {
    key: `${normalized.year}-${pad2(normalized.month)}`,
    year: normalized.year,
    month: normalized.month,
    label: `${normalized.year}년 ${normalized.month}월`
  };
}

function normalizeMonth(year: number, month: number) {
  const ordinal = year * 12 + month - 1;
  return {
    year: Math.floor(ordinal / 12),
    month: ((ordinal % 12) + 12) % 12 + 1
  };
}

function getDaysInMonth(year: number, month: number) {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function findNearestDateOnly(anchorValue: unknown, values: readonly unknown[]) {
  const anchor = normalizeDateOnly(anchorValue);
  if (!anchor) return "";
  const anchorOrdinal = dateOnlyToOrdinal(anchor);
  const candidates = [...new Set(values.map(normalizeDateOnly).filter(Boolean))];
  candidates.sort((first, second) => {
    const firstDistance = Math.abs(dateOnlyToOrdinal(first) - anchorOrdinal);
    const secondDistance = Math.abs(dateOnlyToOrdinal(second) - anchorOrdinal);
    return firstDistance - secondDistance || first.localeCompare(second);
  });
  return candidates[0] ?? "";
}

function dateOnlyToOrdinal(value: string) {
  const parsed = parseDateOnly(value);
  return parsed ? Math.floor(Date.UTC(parsed.year, parsed.month - 1, parsed.day) / 86_400_000) : Number.NaN;
}

function compareIndexedDailyPlans<Plan extends CalendarDailyPlanLike>(
  first: IndexedCalendarDailyPlan<Plan>,
  second: IndexedCalendarDailyPlan<Plan>
) {
  return first.episodeLabel.localeCompare(second.episodeLabel, "ko", { numeric: true })
    || first.id.localeCompare(second.id);
}

function clampDateRange(range: DateOnlyRange, visibleRange?: DateOnlyRange | null): DateOnlyRange | null {
  if (!visibleRange) return range;
  const normalizedVisible = normalizeDateRange(visibleRange.startDate, visibleRange.endDate);
  if (!normalizedVisible) return null;
  const startDate = range.startDate > normalizedVisible.startDate ? range.startDate : normalizedVisible.startDate;
  const endDate = range.endDate < normalizedVisible.endDate ? range.endDate : normalizedVisible.endDate;
  return startDate <= endDate ? { startDate, endDate } : null;
}

function forEachDateOnly(range: DateOnlyRange, visit: (dateKey: string) => void) {
  let cursor = range.startDate;
  while (cursor <= range.endDate) {
    visit(cursor);
    const next = addDateOnlyDays(cursor, 1);
    if (!next || next <= cursor) break;
    cursor = next;
  }
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

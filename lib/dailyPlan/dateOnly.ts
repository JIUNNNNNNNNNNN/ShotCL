type DateOnlyParts = {
  year: number;
  month: number;
  day: number;
};

/** 로컬 타임존 변환 없이 YYYY-MM-DD의 숫자 조각만 검증해 촬영일을 표시합니다. */
export function formatDailyPlanCardDate(value: string) {
  const parts = parseDateOnly(value);
  if (!parts) return "날짜 미정";
  return `${parts.year}.${padDatePart(parts.month)}.${padDatePart(parts.day)}`;
}

/**
 * 일촬표 촬영일을 브라우저 타임존 변환 없이 canonical YYYY-MM-DD로 정규화합니다.
 * 날짜 기반 회차 선택에서도 카드 표시와 같은 윤년·월별 일수 검증을 재사용합니다.
 */
export function normalizeDailyPlanDateOnly(value: unknown) {
  const parts = parseDateOnly(String(value ?? ""));
  if (!parts) return null;
  return `${String(parts.year).padStart(4, "0")}-${padDatePart(parts.month)}-${padDatePart(parts.day)}`;
}

/** 카드의 접근성 이름에 사용할 한국어 촬영일을 만듭니다. */
export function formatDailyPlanCardDateAria(value: string) {
  const parts = parseDateOnly(value);
  if (!parts) return "미정";
  return `${parts.year}년 ${parts.month}월 ${parts.day}일`;
}

function parseDateOnly(value: string): DateOnlyParts | null {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/u);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || year > 9999 || month < 1 || month > 12) return null;
  const daysInMonth = getDaysInMonth(year, month);
  if (day < 1 || day > daysInMonth) return null;
  return { year, month, day };
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function getDaysInMonth(year: number, month: number) {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

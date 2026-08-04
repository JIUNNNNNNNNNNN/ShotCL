export const APP_MOBILE_BREAKPOINT_PX = 768;
export const APP_MOBILE_MEDIA_QUERY = `(max-width: ${APP_MOBILE_BREAKPOINT_PX - 1}px)`;

export type DailyPlanDocumentOrientation = "portrait" | "landscape";

export const DAILY_PLAN_DOCUMENT_DENSITY_STEPS = [
  "normal",
  "compact",
  "dense"
] as const;

export type DailyPlanDocumentDensity =
  (typeof DAILY_PLAN_DOCUMENT_DENSITY_STEPS)[number];

/** 세로 문서에서 짧은 값 열을 줄이고 긴 정보 열에 폭을 배분한 상대 폭입니다. */
export const DAILY_PLAN_TIMETABLE_PORTRAIT_COLUMN_WEIGHTS = [
  38, 38, 38,
  30, 30,
  26,
  34,
  50,
  70, 70, 70,
  76,
  46, 46,
  57, 57
] as const;

export function getAutomaticDailyPlanOrientation(
  isMobile: boolean
): DailyPlanDocumentOrientation {
  return isMobile ? "portrait" : "landscape";
}

/** 현재 단계보다 한 단계 더 조밀한 문서 밀도를 반환하며, 마지막 단계면 null입니다. */
export function getNextDailyPlanDocumentDensity(
  density: DailyPlanDocumentDensity
): DailyPlanDocumentDensity | null {
  const currentIndex = DAILY_PLAN_DOCUMENT_DENSITY_STEPS.indexOf(density);
  return DAILY_PLAN_DOCUMENT_DENSITY_STEPS[currentIndex + 1] ?? null;
}

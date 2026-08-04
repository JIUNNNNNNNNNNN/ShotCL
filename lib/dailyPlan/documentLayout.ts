export const APP_MOBILE_BREAKPOINT_PX = 768;
export const APP_MOBILE_MEDIA_QUERY = `(max-width: ${APP_MOBILE_BREAKPOINT_PX - 1}px)`;

export type DailyPlanDocumentOrientation = "portrait" | "landscape";

/** 한 장 우선, 넘칠 때 Notice 직전에서만 두 장으로 나누는 문서 페이지 구성입니다. */
export type DailyPlanPageLayout = "single" | "two";

export const DAILY_PLAN_DOCUMENT_DENSITY_STEPS = [
  "normal",
  "compact",
  "dense"
] as const;

export type DailyPlanDocumentDensity =
  (typeof DAILY_PLAN_DOCUMENT_DENSITY_STEPS)[number];

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

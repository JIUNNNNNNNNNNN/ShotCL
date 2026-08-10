/** 일촬표와 씬리스트가 공유하는 canonical D/N 값입니다. */
export const DAILY_PLAN_DAY_NIGHT_OPTIONS = ["D", "N"] as const;

export type DailyPlanDayNight = (typeof DAILY_PLAN_DAY_NIGHT_OPTIONS)[number] | "";

/**
 * 기존 데이터의 영문/한글 별칭을 일촬표에서 사용하는 D/N 값으로 정규화합니다.
 * 알 수 없거나 비어 있는 값은 이전 씬의 값을 남기지 않고 빈 상태로 만듭니다.
 */
export function normalizeDailyPlanDayNight(value: unknown): DailyPlanDayNight {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "D" || normalized === "DAY" || normalized === "데이") return "D";
  if (normalized === "N" || normalized === "NIGHT" || normalized === "나잇") return "N";
  return "";
}

/** 이미 로드된 canonical Scene 객체에서 타임테이블 D/N 스냅샷을 만듭니다. */
export function resolveTimetableDayNightFromScene(scene: { dayNight: unknown }): DailyPlanDayNight {
  return normalizeDailyPlanDayNight(scene.dayNight);
}

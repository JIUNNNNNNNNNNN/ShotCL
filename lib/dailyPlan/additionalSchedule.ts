import type {
  DailyPlanAdditionalScheduleType,
  DailyPlanMealTime
} from "@/lib/types";

const legacyDailyPlanAdditionalScheduleTypes = [
  "집합장소",
  "이동",
  "식사",
  "준비",
  "휴식",
  "기타"
] as const satisfies readonly DailyPlanAdditionalScheduleType[];

export function isDailyPlanAdditionalScheduleType(
  value: unknown
): value is DailyPlanAdditionalScheduleType {
  return legacyDailyPlanAdditionalScheduleTypes.includes(
    String(value ?? "").trim() as DailyPlanAdditionalScheduleType
  );
}

export function normalizeDailyPlanAdditionalScheduleType(
  value: unknown
): DailyPlanAdditionalScheduleType {
  const normalized = String(value ?? "").trim();
  return isDailyPlanAdditionalScheduleType(normalized) ? normalized : "기타";
}

/** 화면에는 legacy 종류를 노출하지 않고 사용자가 입력한 메모만 표시합니다. */
export function getDailyPlanAdditionalScheduleDisplay(
  item: Pick<DailyPlanMealTime, "memo">
) {
  return item.memo.trim() || "기타 일정";
}

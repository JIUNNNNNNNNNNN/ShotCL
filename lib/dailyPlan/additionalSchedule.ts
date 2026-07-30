import type {
  DailyPlanAdditionalScheduleType,
  DailyPlanMealTime
} from "@/lib/types";

export const dailyPlanAdditionalScheduleTypes = [
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
  return dailyPlanAdditionalScheduleTypes.includes(
    String(value ?? "").trim() as DailyPlanAdditionalScheduleType
  );
}

export function normalizeDailyPlanAdditionalScheduleType(
  value: unknown
): DailyPlanAdditionalScheduleType {
  const normalized = String(value ?? "").trim();
  return isDailyPlanAdditionalScheduleType(normalized) ? normalized : "기타";
}

/** 기존 memo-only 일정과 새 scheduleType 일정을 같은 제목 정책으로 표시합니다. */
export function getDailyPlanAdditionalScheduleDisplay(
  item: Pick<DailyPlanMealTime, "scheduleType" | "memo">
) {
  const memo = item.memo.trim();
  const storedType = isDailyPlanAdditionalScheduleType(item.scheduleType)
    ? item.scheduleType
    : null;

  if (!storedType) return memo || "기타 일정";
  if (!memo || memo === storedType) return storedType;
  return `${storedType} · ${memo}`;
}

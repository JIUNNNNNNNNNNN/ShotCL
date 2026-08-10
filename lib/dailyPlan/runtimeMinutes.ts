export const MAX_DAILY_PLAN_RUNTIME_MINUTES = 1440;

export function parseDailyPlanRuntimeMinutesInput(value: string): number | null {
  if (!/^\d{1,4}$/.test(value)) return null;
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_DAILY_PLAN_RUNTIME_MINUTES
    ? minutes
    : null;
}

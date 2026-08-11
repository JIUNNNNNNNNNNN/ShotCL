export type TimetableTimeChainRow = {
  rowKey: string;
  startTime: string;
  endTime?: string | null;
  runtimeMinutes?: number | null;
  runtime?: string | null;
  canReceiveAutomaticTime?: boolean;
};

export type TimetableStartTimeState = {
  actualStartTime: string | null;
  expectedStartTime: string | null;
  isMismatch: boolean;
};

export type TimetableTimeChainResult = {
  states: Map<string, TimetableStartTimeState>;
  automaticUpdates: Map<string, string>;
  consumedAutomaticRowKeys: Set<string>;
};

const MINUTES_PER_DAY = 24 * 60;
const MAX_TIMETABLE_RUNTIME_MINUTES = 1440;

/** Timetable HH:mm values are compared as local minute-of-day values, never as raw strings. */
export function parseTimetableTimeMinutes(value: string): number | null {
  const source = String(value ?? "").trim();
  if (!source) return null;

  const separated = source.match(/^(\d{1,2}):(\d{2})$/);
  const compact = source.match(/^\d{3,4}$/);
  const hour = separated
    ? Number(separated[1])
    : compact
      ? Number(source.slice(0, -2))
      : Number.NaN;
  const minute = separated
    ? Number(separated[2])
    : compact
      ? Number(source.slice(-2))
      : Number.NaN;

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function formatTimetableTimeMinutes(value: number): string {
  const normalized = ((value % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function normalizeTimetableTime(value: string): string | null {
  const minutes = parseTimetableTimeMinutes(value);
  return minutes == null ? null : formatTimetableTimeMinutes(minutes);
}

export function shiftTimetableTime(value: string, offsetMinutes: number): string {
  const source = parseTimetableTimeMinutes(value);
  if (source == null || !Number.isFinite(offsetMinutes)) return value;
  return formatTimetableTimeMinutes(source + offsetMinutes);
}

export function calculateTimetableRuntimeMinutes(startTime: string, endTime: string): number | null {
  const start = parseTimetableTimeMinutes(startTime);
  const end = parseTimetableTimeMinutes(endTime);
  if (start == null || end == null) return null;
  const diff = end >= start ? end - start : end + MINUTES_PER_DAY - start;
  return diff > 0 ? diff : null;
}

export function parseTimetableRuntimeMinutes(value: string): number | null {
  const normalized = String(value ?? "").toUpperCase().replace(/\s+/g, "");
  const numericMinutes = normalized.match(/^(\d+)(?:분)?$/);
  if (numericMinutes) {
    const minutes = Number(numericMinutes[1]);
    return Number.isFinite(minutes) && minutes >= 0 && minutes <= MAX_TIMETABLE_RUNTIME_MINUTES
      ? minutes
      : null;
  }

  const match = normalized.match(/^(?:(\d+)(?:H|시간))?(?:(\d+)(?:M|분))?$/);
  if (!match || (!match[1] && !match[2])) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const totalMinutes = hours * 60 + minutes;
  return totalMinutes >= 0 && totalMinutes <= MAX_TIMETABLE_RUNTIME_MINUTES
    ? totalMinutes
    : null;
}

export function getTimetableRuntimeMinutes(
  runtimeMinutes: number | null | undefined,
  legacyRuntime: string | null | undefined,
  startTime: string,
  endTime: string
): number | null {
  if (
    runtimeMinutes != null
    && Number.isInteger(runtimeMinutes)
    && runtimeMinutes >= 0
    && runtimeMinutes <= MAX_TIMETABLE_RUNTIME_MINUTES
  ) {
    return runtimeMinutes;
  }
  return parseTimetableRuntimeMinutes(legacyRuntime ?? "")
    ?? calculateTimetableRuntimeMinutes(startTime, endTime);
}

/** This is the single expected-start calculation consumed by auto-fill and mismatch state. */
export function getExpectedTimetableStartTime(
  previousStartTime: string,
  previousRuntimeMinutes: number | null
): string | null {
  if (
    previousRuntimeMinutes == null
    || !Number.isInteger(previousRuntimeMinutes)
    || previousRuntimeMinutes < 0
    || previousRuntimeMinutes > MAX_TIMETABLE_RUNTIME_MINUTES
  ) return null;
  const normalizedStart = normalizeTimetableTime(previousStartTime);
  return normalizedStart == null
    ? null
    : shiftTimetableTime(normalizedStart, previousRuntimeMinutes);
}

/**
 * Evaluates the ordered timetable in one pass. Every row starts a fresh chain
 * from its actual value, so an intentional mismatch does not cascade.
 */
export function deriveTimetableTimeChain(
  rows: readonly TimetableTimeChainRow[],
  pendingAutomaticRowKeys: ReadonlySet<string> = new Set()
): TimetableTimeChainResult {
  const states = new Map<string, TimetableStartTimeState>();
  const automaticUpdates = new Map<string, string>();
  const consumedAutomaticRowKeys = new Set<string>();
  let previousStartTime = "";
  let previousRuntimeMinutes: number | null = null;

  rows.forEach((row) => {
    const actualStartTime = normalizeTimetableTime(row.startTime);
    const expectedStartTime = getExpectedTimetableStartTime(
      previousStartTime,
      previousRuntimeMinutes
    );
    states.set(row.rowKey, {
      actualStartTime,
      expectedStartTime,
      isMismatch: actualStartTime != null
        && expectedStartTime != null
        && parseTimetableTimeMinutes(actualStartTime) !== parseTimetableTimeMinutes(expectedStartTime)
    });

    const isPendingAutomatic = pendingAutomaticRowKeys.has(row.rowKey);
    if (isPendingAutomatic) consumedAutomaticRowKeys.add(row.rowKey);
    const automaticStartTime = isPendingAutomatic
      && row.startTime.trim() === ""
      && row.canReceiveAutomaticTime !== false
      ? expectedStartTime
      : null;
    if (automaticStartTime != null) {
      automaticUpdates.set(row.rowKey, automaticStartTime);
    }

    const effectiveStartTime = automaticStartTime ?? row.startTime;
    previousStartTime = effectiveStartTime;
    previousRuntimeMinutes = getTimetableRuntimeMinutes(
      row.runtimeMinutes,
      row.runtime,
      effectiveStartTime,
      row.endTime ?? ""
    );
  });

  return { states, automaticUpdates, consumedAutomaticRowKeys };
}

export function getTimetableStartTimeStates(
  rows: readonly TimetableTimeChainRow[]
): Map<string, TimetableStartTimeState> {
  return deriveTimetableTimeChain(rows).states;
}

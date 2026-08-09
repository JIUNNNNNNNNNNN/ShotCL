import { normalizeDateOnly } from "@/lib/projectCalendar";

export const PROJECT_CALENDAR_EVENT_COLOR_KEYS = [
  "lime",
  "yellow",
  "cyan",
  "blue",
  "magenta"
] as const;

export type ProjectCalendarEventColorKey = typeof PROJECT_CALENDAR_EVENT_COLOR_KEYS[number];

export type ProjectCalendarEvent = {
  id: string;
  projectId: string;
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  colorKey: ProjectCalendarEventColorKey;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectCalendarEventInput = {
  title: string;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  colorKey: ProjectCalendarEventColorKey;
};

export type NormalizedProjectCalendarEventInput = {
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  colorKey: ProjectCalendarEventColorKey;
};

export type ProjectCalendarEventValidation =
  | { ok: true; value: NormalizedProjectCalendarEventInput }
  | { ok: false; error: string; field?: keyof ProjectCalendarEventInput };

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** DB와 editor가 공유하는 일정 입력 검증입니다. 날짜는 Date 객체로 왕복하지 않습니다. */
export function validateProjectCalendarEventInput(value: unknown): ProjectCalendarEventValidation {
  if (!isRecord(value)) return { ok: false, error: "일정 정보가 올바르지 않습니다." };

  const title = normalizeText(value.title);
  if (!title) return { ok: false, error: "일정 이름을 입력해주세요.", field: "title" };
  if (title.length > 120) return { ok: false, error: "일정 이름은 120자 이하로 입력해주세요.", field: "title" };

  const startDate = normalizeDateOnly(value.startDate);
  if (!startDate) return { ok: false, error: "시작 날짜가 올바르지 않습니다.", field: "startDate" };

  const endDate = normalizeDateOnly(value.endDate);
  if (!endDate) return { ok: false, error: "종료 날짜가 올바르지 않습니다.", field: "endDate" };
  if (endDate < startDate) {
    return { ok: false, error: "종료 날짜는 시작 날짜보다 빠를 수 없습니다.", field: "endDate" };
  }

  const startTime = normalizeTime(value.startTime);
  if (String(value.startTime ?? "").trim() && !startTime) {
    return { ok: false, error: "시작 시간이 올바르지 않습니다.", field: "startTime" };
  }

  const endTime = normalizeTime(value.endTime);
  if (String(value.endTime ?? "").trim() && !endTime) {
    return { ok: false, error: "종료 시간이 올바르지 않습니다.", field: "endTime" };
  }
  if (startDate === endDate && startTime && endTime && endTime < startTime) {
    return { ok: false, error: "종료 시간은 시작 시간보다 빠를 수 없습니다.", field: "endTime" };
  }
  if (Boolean(startTime) !== Boolean(endTime)) {
    return {
      ok: false,
      error: "시작 시간과 종료 시간을 함께 입력해주세요.",
      field: startTime ? "endTime" : "startTime"
    };
  }

  const colorKey = normalizeProjectCalendarEventColorKey(value.colorKey);
  if (!colorKey) {
    return { ok: false, error: "일정 부서를 선택해주세요.", field: "colorKey" };
  }

  const location = normalizeText(value.location);
  if (location.length > 120) {
    return { ok: false, error: "장소는 120자 이하로 입력해주세요.", field: "location" };
  }

  return {
    ok: true,
    value: {
      title,
      startDate,
      endDate,
      startTime,
      endTime,
      location,
      colorKey
    }
  };
}

export function projectCalendarEventFromRow(value: unknown): ProjectCalendarEvent | null {
  if (!isRecord(value)) return null;
  const id = String(value.id ?? "").trim();
  const projectId = String(value.project_id ?? value.projectId ?? "").trim();
  const createdAt = normalizeTimestamp(value.created_at ?? value.createdAt);
  const updatedAt = normalizeTimestamp(value.updated_at ?? value.updatedAt);
  const validation = validateProjectCalendarEventInput({
    title: value.title,
    startDate: value.start_date ?? value.startDate,
    endDate: value.end_date ?? value.endDate,
    startTime: normalizeDatabaseTime(value.start_time ?? value.startTime),
    endTime: normalizeDatabaseTime(value.end_time ?? value.endTime),
    location: value.location,
    colorKey: value.color_key ?? value.colorKey
  });
  if (!UUID_PATTERN.test(id) || !projectId || !createdAt || !updatedAt || !validation.ok) return null;
  const createdBy = String(value.created_by ?? value.createdBy ?? "").trim();
  return {
    id,
    projectId,
    ...validation.value,
    createdBy: UUID_PATTERN.test(createdBy) ? createdBy : null,
    createdAt,
    updatedAt
  };
}

export function projectCalendarEventInputToRow(value: NormalizedProjectCalendarEventInput) {
  return {
    title: value.title,
    start_date: value.startDate,
    end_date: value.endDate,
    start_time: value.startTime || null,
    end_time: value.endTime || null,
    location: value.location,
    color_key: value.colorKey
  };
}

export function normalizeProjectCalendarEventColorKey(value: unknown): ProjectCalendarEventColorKey | "" {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("en-US");
  return PROJECT_CALENDAR_EVENT_COLOR_KEYS.find((entry) => entry === normalized) ?? "";
}

export function isProjectCalendarEventId(value: unknown) {
  return UUID_PATTERN.test(String(value ?? "").trim());
}

function normalizeTime(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return TIME_PATTERN.test(raw) ? raw : "";
}

/** Supabase time 컬럼의 HH:MM:SS 응답만 UI canonical HH:MM으로 축약합니다. */
function normalizeDatabaseTime(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/^((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/u);
  return match?.[1] ?? raw;
}

function normalizeTimestamp(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

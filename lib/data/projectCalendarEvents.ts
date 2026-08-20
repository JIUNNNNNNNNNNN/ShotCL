import { createLocalId, notifyLocalProjectChange, readLocalBuckets } from "@/lib/data/localStore";
import { getLocalProjectIdCandidates, isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import {
  projectCalendarEventFromRow,
  validateProjectCalendarEventInput,
  type ProjectCalendarEvent,
  type ProjectCalendarEventInput
} from "@/lib/projectCalendarEvents";

type CalendarApiPayload = {
  ok?: boolean;
  events?: unknown[];
  event?: unknown;
  deletedId?: string;
  receipt?: string;
  canEdit?: boolean;
  error?: string;
  code?: string;
  field?: keyof ProjectCalendarEventInput;
};

export type ProjectCalendarEventList = {
  events: ProjectCalendarEvent[];
  canEdit: boolean;
};

type ProjectCalendarReadCacheEntry = {
  projectKey: string;
  expiresAt: number;
  value: ProjectCalendarEventList;
};

type ProjectCalendarReadRequestEntry = {
  projectKey: string;
  request: Promise<ProjectCalendarEventList>;
};

const PROJECT_CALENDAR_READ_CACHE_TTL_MS = 10_000;
const projectCalendarReadCache = new Map<string, ProjectCalendarReadCacheEntry>();
const projectCalendarReadRequests = new Map<string, ProjectCalendarReadRequestEntry>();
const projectCalendarReadGeneration = new Map<string, number>();

export class ProjectCalendarEventRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: keyof ProjectCalendarEventInput;

  constructor(message: string, status: number, code = "", field?: keyof ProjectCalendarEventInput) {
    super(message);
    this.name = "ProjectCalendarEventRequestError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** 프로젝트 일정은 한 번에 읽고 월 이동·날짜 선택은 client derived data로 처리합니다. */
export async function listProjectCalendarEvents(
  projectId: string,
  range?: { startDate: string; endDate: string }
): Promise<ProjectCalendarEventList> {
  if (usesLocalCalendarStorage(projectId)) {
    const events = readLocalEvents().filter((event) => (
      getLocalProjectIdCandidates(projectId).includes(event.projectId)
      && (!range || (event.startDate <= range.endDate && event.endDate >= range.startDate))
    ));
    return { events, canEdit: true };
  }

  const projectKey = calendarReadProjectKey(projectId);
  const readKey = calendarReadKey(projectKey, range);
  const cached = projectCalendarReadCache.get(readKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) projectCalendarReadCache.delete(readKey);

  const inFlight = projectCalendarReadRequests.get(readKey);
  if (inFlight) return inFlight.request;

  const generation = projectCalendarReadGeneration.get(projectKey) ?? 0;
  const request = fetchProjectCalendarEvents(projectId, range)
    .then((value) => {
      if ((projectCalendarReadGeneration.get(projectKey) ?? 0) === generation) {
        projectCalendarReadCache.set(readKey, {
          projectKey,
          expiresAt: Date.now() + PROJECT_CALENDAR_READ_CACHE_TTL_MS,
          value
        });
      }
      return value;
    })
    .finally(() => {
      if (projectCalendarReadRequests.get(readKey)?.request === request) {
        projectCalendarReadRequests.delete(readKey);
      }
    });
  projectCalendarReadRequests.set(readKey, { projectKey, request });
  return request;
}

async function fetchProjectCalendarEvents(
  projectId: string,
  range?: { startDate: string; endDate: string }
): Promise<ProjectCalendarEventList> {
  const endpoint = getCalendarEndpoint(projectId);
  const query = new URLSearchParams();
  if (range) {
    query.set("startDate", range.startDate);
    query.set("endDate", range.endDate);
  }
  const response = await fetchProjectCalendarApi(`${endpoint}${query.size ? `?${query}` : ""}`, {
    cache: "no-store"
  });
  const payload = await readPayload(response);
  if (!response.ok) throw requestError(payload, response.status, "프로젝트 일정을 불러오지 못했습니다.");
  return {
    events: (payload.events ?? []).flatMap((value) => {
      const event = projectCalendarEventFromRow(value);
      return event ? [event] : [];
    }),
    canEdit: payload.canEdit === true
  };
}

export async function createProjectCalendarEvent(
  projectId: string,
  input: ProjectCalendarEventInput
): Promise<ProjectCalendarEvent> {
  const event = validateInput(input);
  if (usesLocalCalendarStorage(projectId)) {
    const now = new Date().toISOString();
    const created: ProjectCalendarEvent = {
      id: createLocalId("calendar_event"),
      projectId: normalizeProjectId(projectId),
      ...event,
      createdBy: null,
      createdAt: now,
      updatedAt: now
    };
    writeLocalEvents([created, ...readLocalEvents()], projectId);
    invalidateProjectCalendarReadCache(projectId);
    return created;
  }
  const response = await fetchProjectCalendarApi(getCalendarEndpoint(projectId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event })
  });
  const created = await readMutationEvent(response, "프로젝트 일정을 저장하지 못했습니다.");
  invalidateProjectCalendarReadCache(projectId);
  return created;
}

export async function updateProjectCalendarEvent(
  projectId: string,
  eventId: string,
  input: ProjectCalendarEventInput
): Promise<ProjectCalendarEvent> {
  const event = validateInput(input);
  if (usesLocalCalendarStorage(projectId)) {
    const candidates = getLocalProjectIdCandidates(projectId);
    const current = readLocalEvents();
    const existing = current.find((candidate) => candidate.id === eventId && candidates.includes(candidate.projectId));
    if (!existing) throw new ProjectCalendarEventRequestError("일정을 찾을 수 없습니다.", 404, "CALENDAR_EVENT_NOT_FOUND");
    const updated: ProjectCalendarEvent = { ...existing, ...event, updatedAt: new Date().toISOString() };
    writeLocalEvents(current.map((candidate) => candidate.id === eventId ? updated : candidate), projectId);
    invalidateProjectCalendarReadCache(projectId);
    return updated;
  }
  const response = await fetchProjectCalendarApi(getCalendarEndpoint(projectId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: eventId, event })
  });
  const updated = await readMutationEvent(response, "프로젝트 일정을 수정하지 못했습니다.");
  invalidateProjectCalendarReadCache(projectId);
  return updated;
}

export async function deleteProjectCalendarEvent(projectId: string, eventId: string): Promise<string | null> {
  if (usesLocalCalendarStorage(projectId)) {
    const candidates = getLocalProjectIdCandidates(projectId);
    const current = readLocalEvents();
    const exists = current.some((candidate) => candidate.id === eventId && candidates.includes(candidate.projectId));
    if (!exists) throw new ProjectCalendarEventRequestError("일정을 찾을 수 없습니다.", 404, "CALENDAR_EVENT_NOT_FOUND");
    writeLocalEvents(current.filter((candidate) => candidate.id !== eventId), projectId);
    invalidateProjectCalendarReadCache(projectId);
    return null;
  }
  const query = new URLSearchParams({ id: eventId });
  const response = await fetchProjectCalendarApi(`${getCalendarEndpoint(projectId)}?${query}`, {
    method: "DELETE"
  });
  const payload = await readPayload(response);
  if (!response.ok) throw requestError(payload, response.status, "프로젝트 일정을 삭제하지 못했습니다.");
  const receipt = payload.receipt?.trim();
  if (!receipt) {
    throw new ProjectCalendarEventRequestError(
      "일정 삭제 복원 정보를 받지 못했습니다.",
      500,
      "CALENDAR_EVENT_DELETE_RECEIPT_MISSING"
    );
  }
  invalidateProjectCalendarReadCache(projectId);
  return receipt;
}

/** 삭제 Undo는 새 ID를 만들지 않고 원래 일정 row를 그대로 복원합니다. */
export async function restoreProjectCalendarEvent(
  projectId: string,
  receipt: string | null,
  event: ProjectCalendarEvent
) {
  if (usesLocalCalendarStorage(projectId)) {
    const current = readLocalEvents();
    writeLocalEvents([
      event,
      ...current.filter((candidate) => candidate.id !== event.id)
    ], projectId);
    invalidateProjectCalendarReadCache(projectId);
    return event;
  }
  if (!receipt) {
    throw new ProjectCalendarEventRequestError(
      "일정 삭제 복원 정보가 없습니다.",
      400,
      "CALENDAR_EVENT_DELETE_RECEIPT_MISSING"
    );
  }
  const response = await fetchProjectCalendarApi(getCalendarEndpoint(projectId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "restore_deleted", receipt })
  });
  const restored = await readMutationEvent(response, "프로젝트 일정을 복원하지 못했습니다.");
  invalidateProjectCalendarReadCache(projectId);
  return restored;
}

export async function finalizeDeletedProjectCalendarEvent(
  projectId: string,
  receipt: string | null
) {
  if (!receipt || usesLocalCalendarStorage(projectId)) return;
  const response = await fetchProjectCalendarApi(getCalendarEndpoint(projectId), {
    method: "POST",
    keepalive: receipt.length <= 48_000,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "finalize_deleted", receipt })
  });
  const payload = await readPayload(response);
  if (!response.ok) throw requestError(payload, response.status, "일정 삭제를 확정하지 못했습니다.");
}

function calendarReadProjectKey(projectId: string) {
  return normalizeProjectId(projectId);
}

function calendarReadKey(
  projectKey: string,
  range?: { startDate: string; endDate: string }
) {
  return JSON.stringify([
    projectKey,
    range?.startDate ?? "",
    range?.endDate ?? ""
  ]);
}

function invalidateProjectCalendarReadCache(projectId: string) {
  const projectKey = calendarReadProjectKey(projectId);
  projectCalendarReadGeneration.set(
    projectKey,
    (projectCalendarReadGeneration.get(projectKey) ?? 0) + 1
  );
  for (const [key, entry] of projectCalendarReadCache) {
    if (entry.projectKey === projectKey) projectCalendarReadCache.delete(key);
  }
  for (const [key, entry] of projectCalendarReadRequests) {
    if (entry.projectKey === projectKey) projectCalendarReadRequests.delete(key);
  }
}

/** 영구 삭제 뒤 해당 프로젝트의 calendar read와 legacy local rows만 폐기합니다. */
export function clearProjectCalendarClientCache(projectId: string) {
  invalidateProjectCalendarReadCache(projectId);
  if (typeof window === "undefined") return;
  const candidates = new Set(getLocalProjectIdCandidates(projectId));
  const remaining = readLocalEvents().filter((event) => !candidates.has(event.projectId));
  try {
    if (remaining.length > 0) {
      window.localStorage.setItem(LOCAL_CALENDAR_EVENTS_KEY, JSON.stringify(remaining));
    } else {
      window.localStorage.removeItem(LOCAL_CALENDAR_EVENTS_KEY);
    }
  } catch {
    // Storage availability must not block the canonical server deletion result.
  }
}

async function readMutationEvent(response: Response, fallback: string) {
  const payload = await readPayload(response);
  if (!response.ok) throw requestError(payload, response.status, fallback);
  const event = projectCalendarEventFromRow(payload.event);
  if (!event) throw new ProjectCalendarEventRequestError(fallback, 500, "CALENDAR_EVENT_RESPONSE_INVALID");
  return event;
}

function validateInput(input: ProjectCalendarEventInput) {
  const validation = validateProjectCalendarEventInput(input);
  if (!validation.ok) {
    throw new ProjectCalendarEventRequestError(validation.error, 400, "CALENDAR_EVENT_INVALID", validation.field);
  }
  return validation.value;
}

function getCalendarEndpoint(projectId: string) {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!isValidDatabaseProjectId(normalizedProjectId)) {
    throw new ProjectCalendarEventRequestError("프로젝트 ID가 올바르지 않습니다.", 400, "INVALID_PROJECT_ID");
  }
  return `/api/projects/${encodeURIComponent(normalizedProjectId)}/calendar-events`;
}

async function fetchProjectCalendarApi(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, credentials: "same-origin" });
}

async function readPayload(response: Response): Promise<CalendarApiPayload> {
  try {
    return await response.json() as CalendarApiPayload;
  } catch {
    return {};
  }
}

function requestError(payload: CalendarApiPayload, status: number, fallback: string) {
  return new ProjectCalendarEventRequestError(
    payload.error || fallback,
    status,
    payload.code ?? "",
    payload.field
  );
}

const LOCAL_CALENDAR_EVENTS_KEY = "today-storyboard-project-calendar-events";

/**
 * `project_<uuid>`도 DB UUID로 normalize될 수 있으므로 ID 모양만으로 저장소를 고르지 않습니다.
 * 실제 로컬 프로젝트 bucket에 있는 프로젝트는 다른 project data helper와 같은 localStorage에 저장합니다.
 */
function usesLocalCalendarStorage(projectId: string) {
  if (!isValidDatabaseProjectId(projectId)) return true;
  if (typeof window === "undefined") return false;
  const candidates = getLocalProjectIdCandidates(projectId);
  return readLocalBuckets().projects.some((project) => candidates.includes(project.id));
}

function readLocalEvents(): ProjectCalendarEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_CALENDAR_EVENTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const source = value as Partial<ProjectCalendarEvent>;
      const validation = validateProjectCalendarEventInput(source);
      const id = String(source.id ?? "").trim();
      const storedProjectId = String(source.projectId ?? "").trim();
      if (!id || !storedProjectId || !validation.ok) return [];
      return [{
        id,
        projectId: storedProjectId,
        ...validation.value,
        createdBy: source.createdBy ?? null,
        createdAt: String(source.createdAt ?? ""),
        updatedAt: String(source.updatedAt ?? "")
      } satisfies ProjectCalendarEvent];
    });
  } catch {
    window.localStorage.removeItem(LOCAL_CALENDAR_EVENTS_KEY);
    return [];
  }
}

function writeLocalEvents(events: ProjectCalendarEvent[], projectId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_CALENDAR_EVENTS_KEY, JSON.stringify(events));
  notifyLocalProjectChange(projectId);
}

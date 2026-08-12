import { NextRequest, NextResponse } from "next/server";
import {
  getProjectRequestAccess,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import {
  isProjectCalendarEventId,
  projectCalendarEventFromRow,
  projectCalendarEventInputToRow,
  validateProjectCalendarEventInput
} from "@/lib/projectCalendarEvents";
import { normalizeDateOnly } from "@/lib/projectCalendar";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type RouteContext = { params: Promise<{ projectId: string }> };

const SELECT_COLUMNS = [
  "id",
  "project_id",
  "title",
  "start_date",
  "end_date",
  "start_time",
  "end_time",
  "location",
  "color_key",
  "created_by",
  "created_at",
  "updated_at"
].join(",");

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) return invalidProjectResponse();
    const role = (await getProjectRequestAccess(request, projectId))?.grant.role ?? null;
    if (!role) return forbiddenResponse("프로젝트 일정을 확인할 권한이 없습니다.");

    const range = getOptionalDateRange(request);
    if (range instanceof NextResponse) return range;

    const supabase = requireProjectAccessDb();
    let query = supabase
      .from("project_calendar_events")
      .select(SELECT_COLUMNS)
      .eq("project_id", projectId)
      .order("start_date", { ascending: true })
      .order("start_time", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });
    if (range) {
      query = query.lte("start_date", range.endDate).gte("end_date", range.startDate);
    }
    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      events: (data ?? []).flatMap((row) => {
        const event = projectCalendarEventFromRow(row);
        return event ? [event] : [];
      }),
      canEdit: role === "admin"
    });
  } catch (error) {
    return calendarEventErrorResponse(error, "프로젝트 일정을 불러오지 못했습니다.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const access = await requireCalendarEditAccess(request, context);
    if (access instanceof NextResponse) return access;
    const body = await readRequestBody(request);
    if (!body) return invalidJsonResponse();
    const validation = validateProjectCalendarEventInput(body.event ?? body);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error, code: "CALENDAR_EVENT_INVALID", field: validation.field },
        { status: 400 }
      );
    }

    const { data, error } = await access.supabase
      .from("project_calendar_events")
      .insert({
        project_id: access.projectId,
        ...projectCalendarEventInputToRow(validation.value),
        created_by: access.accountUserId
      })
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
    const event = projectCalendarEventFromRow(data);
    if (!event) throw new Error("저장된 일정 데이터 형식이 올바르지 않습니다.");
    return NextResponse.json({ ok: true, status: "created", event }, { status: 201 });
  } catch (error) {
    return calendarEventErrorResponse(error, "프로젝트 일정을 저장하지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const access = await requireCalendarEditAccess(request, context);
    if (access instanceof NextResponse) return access;
    const body = await readRequestBody(request);
    if (!body) return invalidJsonResponse();
    const eventId = String(body.id ?? body.eventId ?? "").trim();
    if (!isProjectCalendarEventId(eventId)) {
      return NextResponse.json({ error: "일정 ID가 올바르지 않습니다.", code: "CALENDAR_EVENT_ID_INVALID" }, { status: 400 });
    }
    const validation = validateProjectCalendarEventInput(body.event ?? body);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error, code: "CALENDAR_EVENT_INVALID", field: validation.field },
        { status: 400 }
      );
    }

    const { data, error } = await access.supabase
      .from("project_calendar_events")
      .update(projectCalendarEventInputToRow(validation.value))
      .eq("project_id", access.projectId)
      .eq("id", eventId)
      .select(SELECT_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "일정을 찾을 수 없습니다.", code: "CALENDAR_EVENT_NOT_FOUND" }, { status: 404 });
    const event = projectCalendarEventFromRow(data);
    if (!event) throw new Error("수정된 일정 데이터 형식이 올바르지 않습니다.");
    return NextResponse.json({ ok: true, status: "updated", event });
  } catch (error) {
    return calendarEventErrorResponse(error, "프로젝트 일정을 수정하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const access = await requireCalendarEditAccess(request, context);
    if (access instanceof NextResponse) return access;
    const eventId = request.nextUrl.searchParams.get("id")?.trim() ?? "";
    if (!isProjectCalendarEventId(eventId)) {
      return NextResponse.json({ error: "일정 ID가 올바르지 않습니다.", code: "CALENDAR_EVENT_ID_INVALID" }, { status: 400 });
    }

    const { data, error } = await access.supabase
      .from("project_calendar_events")
      .delete()
      .eq("project_id", access.projectId)
      .eq("id", eventId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "일정을 찾을 수 없습니다.", code: "CALENDAR_EVENT_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ ok: true, status: "deleted", deletedId: eventId });
  } catch (error) {
    return calendarEventErrorResponse(error, "프로젝트 일정을 삭제하지 못했습니다.");
  }
}

async function requireCalendarEditAccess(request: NextRequest, context: RouteContext) {
  const projectId = await getValidatedProjectId(context);
  if (!projectId) return invalidProjectResponse();
  const access = await getProjectRequestAccess(request, projectId);
  if (!access) return forbiddenResponse("프로젝트 접근 권한이 없습니다.");
  if (
    access.grant.role !== "admin"
    || access.mode !== "member"
    || !access.editorEligible
    || !access.accountUserId
  ) {
    return forbiddenResponse("프로젝트 일정은 Key staff만 수정할 수 있습니다.");
  }
  return {
    projectId,
    supabase: requireProjectAccessDb(),
    accountUserId: access.accountUserId
  };
}

async function getValidatedProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : null;
}

function getOptionalDateRange(request: NextRequest) {
  const rawStartDate = request.nextUrl.searchParams.get("startDate")?.trim() ?? "";
  const rawEndDate = request.nextUrl.searchParams.get("endDate")?.trim() ?? "";
  if (!rawStartDate && !rawEndDate) return null;
  const startDate = normalizeDateOnly(rawStartDate);
  const endDate = normalizeDateOnly(rawEndDate);
  if (!startDate || !endDate || endDate < startDate) {
    return NextResponse.json(
      { error: "조회할 일정 날짜 범위가 올바르지 않습니다.", code: "CALENDAR_EVENT_RANGE_INVALID" },
      { status: 400 }
    );
  }
  return { startDate, endDate };
}

async function readRequestBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function calendarEventErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: fallbackMessage, code: "CALENDAR_EVENT_UNAVAILABLE" }, { status: 503 });
  }
  const databaseError = getDatabaseError(error);
  if (isMissingCalendarEventsTable(databaseError)) {
    return NextResponse.json(
      errorBody(error, "프로젝트 일정 migration을 먼저 적용해주세요.", "CALENDAR_EVENT_MIGRATION_REQUIRED"),
      { status: 503 }
    );
  }
  if (databaseError?.code === "42501" || databaseError?.code === "PGRST301") {
    return NextResponse.json(
      errorBody(error, "프로젝트 일정에 접근할 권한이 없습니다.", "CALENDAR_EVENT_FORBIDDEN"),
      { status: 403 }
    );
  }
  console.error("[project-calendar-events]", databaseError ?? { message: error instanceof Error ? error.message : "Unknown error" });
  return NextResponse.json(errorBody(error, fallbackMessage, "CALENDAR_EVENT_REQUEST_FAILED"), { status: 500 });
}

function isMissingCalendarEventsTable(error: ReturnType<typeof getDatabaseError>) {
  if (!error || (error.code !== "42P01" && error.code !== "PGRST205")) return false;
  return `${error.message} ${error.details} ${error.hint}`.includes("project_calendar_events");
}

function invalidProjectResponse() {
  return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다.", code: "INVALID_PROJECT_ID" }, { status: 400 });
}

function forbiddenResponse(message: string) {
  return NextResponse.json({ error: message, code: "CALENDAR_EVENT_FORBIDDEN" }, { status: 403 });
}

function invalidJsonResponse() {
  return NextResponse.json({ error: "요청 본문이 올바르지 않습니다.", code: "INVALID_JSON" }, { status: 400 });
}

function errorBody(error: unknown, message: string, code: string) {
  return {
    error: message,
    code,
    ...(process.env.NODE_ENV !== "production" ? { debug: getDatabaseError(error) } : {})
  };
}

function getDatabaseError(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const source = error as Record<string, unknown>;
  return {
    code: String(source.code ?? ""),
    message: String(source.message ?? ""),
    details: String(source.details ?? ""),
    hint: String(source.hint ?? "")
  };
}

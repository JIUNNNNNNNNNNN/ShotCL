import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { normalizeProjectBasicInfo, validateProjectBasicInfo } from "@/lib/projectBasicInfo";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type RouteContext = { params: Promise<{ projectId: string }> };

const PROJECT_BASIC_INFO_COLUMNS = [
  "project_id",
  "total_episodes",
  "shooting_start_date",
  "shooting_end_date",
  "main_staff",
  "actors"
].join(",");

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) {
      return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    }
    if (!(await canAdministerProject(request, projectId))) {
      return NextResponse.json({ error: "프로젝트 기본정보는 Key staff만 확인할 수 있습니다." }, { status: 403 });
    }

    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("project_basic_info")
      .select(PROJECT_BASIC_INFO_COLUMNS)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      basicInfo: data ? projectBasicInfoFromRow(data) : {}
    });
  } catch (error) {
    return basicInfoErrorResponse(
      error,
      "프로젝트 기본정보를 불러오지 못했습니다.",
      "프로젝트 기본정보를 확인할 권한이 없습니다."
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) {
      return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    }
    if (!(await canAdministerProject(request, projectId))) {
      return NextResponse.json({ error: "프로젝트 기본정보는 Key staff만 수정할 수 있습니다." }, { status: 403 });
    }

    const body = (await request.json()) as { basicInfo?: unknown };
    const validation = validateProjectBasicInfo(body.basicInfo);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("project_basic_info")
      .upsert(
        {
          project_id: projectId,
          total_episodes: validation.value.totalEpisodes,
          shooting_start_date: validation.value.shootingStartDate || null,
          shooting_end_date: validation.value.shootingEndDate || null,
          main_staff: validation.value.mainStaff,
          actors: validation.value.actors
        },
        { onConflict: "project_id" }
      )
      .select(PROJECT_BASIC_INFO_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      status: "saved",
      basicInfo: projectBasicInfoFromRow(data)
    });
  } catch (error) {
    return basicInfoErrorResponse(
      error,
      "프로젝트 기본정보를 저장하지 못했습니다.",
      "기본정보를 수정할 권한이 없습니다."
    );
  }
}

async function getValidatedProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : null;
}

function projectBasicInfoFromRow(value: unknown) {
  const row = isRecord(value) ? value : {};
  return normalizeProjectBasicInfo({
    totalEpisodes: row.total_episodes,
    shootingStartDate: row.shooting_start_date,
    shootingEndDate: row.shooting_end_date,
    mainStaff: row.main_staff,
    actors: row.actors
  });
}

function basicInfoErrorResponse(error: unknown, fallbackMessage: string, permissionMessage: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json(
      { error: fallbackMessage, code: "PROJECT_BASIC_INFO_UNAVAILABLE" },
      { status: 503 }
    );
  }
  if (isMissingProjectBasicInfoTable(error)) {
    return NextResponse.json(
      { error: "프로젝트 기본정보 migration을 먼저 적용해주세요.", code: "PROJECT_BASIC_INFO_MIGRATION_REQUIRED" },
      { status: 503 }
    );
  }
  if (isProjectBasicInfoSchemaMismatch(error)) {
    logBasicInfoError(error);
    return NextResponse.json(
      {
        error: "프로젝트 기본정보 테이블의 컬럼 구성을 확인해주세요.",
        code: "PROJECT_BASIC_INFO_SCHEMA_MISMATCH"
      },
      { status: 503 }
    );
  }
  if (isPermissionError(error)) {
    logBasicInfoError(error);
    return NextResponse.json({ error: permissionMessage, code: "PROJECT_BASIC_INFO_FORBIDDEN" }, { status: 403 });
  }

  logBasicInfoError(error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

function isMissingProjectBasicInfoTable(error: unknown) {
  const source = getDatabaseError(error);
  if (!source) return false;
  const isMissingRelationCode = source.code === "42P01" || source.code === "PGRST205";
  if (!isMissingRelationCode) return false;

  return (
    /relation\s+["']?public\.project_basic_info["']?\s+does not exist/i.test(source.message) ||
    /could not find the table\s+["']?public\.project_basic_info["']?\s+in the schema cache/i.test(source.message) ||
    source.message.includes("project_basic_info")
  );
}

function isProjectBasicInfoSchemaMismatch(error: unknown) {
  const source = getDatabaseError(error);
  return source?.code === "42703" || source?.code === "PGRST204";
}

function isPermissionError(error: unknown) {
  const source = getDatabaseError(error);
  return source?.code === "42501" || source?.code === "PGRST301";
}

function getDatabaseError(error: unknown) {
  if (!isRecord(error)) return null;
  return {
    code: String(error.code ?? ""),
    message: String(error.message ?? ""),
    details: String(error.details ?? ""),
    hint: String(error.hint ?? "")
  };
}

function logBasicInfoError(error: unknown) {
  const source = getDatabaseError(error);
  console.error("[project-basic-info]", source ?? { message: "Unknown project basic info error" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

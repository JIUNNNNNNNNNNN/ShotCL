import { NextRequest, NextResponse } from "next/server";
import {
  canAdministerProject,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { validateProjectBasicInfo } from "@/lib/projectBasicInfo";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) {
      return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    }
    if (!(await canAdministerProject(request, projectId))) {
      return NextResponse.json({ error: "프로젝트 기본정보는 관리자만 확인할 수 있습니다." }, { status: 403 });
    }

    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("projects")
      .select("project_basic_info")
      .eq("id", projectId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

    return NextResponse.json({ ok: true, basicInfo: data.project_basic_info ?? {} });
  } catch (error) {
    return basicInfoErrorResponse(error, "프로젝트 기본정보를 불러오지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getValidatedProjectId(context);
    if (!projectId) {
      return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    }
    if (!(await canAdministerProject(request, projectId))) {
      return NextResponse.json({ error: "프로젝트 기본정보는 관리자만 수정할 수 있습니다." }, { status: 403 });
    }

    const body = (await request.json()) as { basicInfo?: unknown };
    const validation = validateProjectBasicInfo(body.basicInfo);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("projects")
      .update({
        project_basic_info: validation.value,
        shoot_date: validation.value.shootingStartDate
      })
      .eq("id", projectId)
      .select("project_basic_info")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

    return NextResponse.json({ ok: true, status: "saved", basicInfo: data.project_basic_info });
  } catch (error) {
    return basicInfoErrorResponse(error, "프로젝트 기본정보를 저장하지 못했습니다.");
  }
}

async function getValidatedProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : null;
}

function basicInfoErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  if (isMissingProjectBasicInfoColumn(error)) {
    return NextResponse.json(
      { error: "프로젝트 기본정보 migration을 먼저 적용해주세요.", code: "PROJECT_BASIC_INFO_MIGRATION_REQUIRED" },
      { status: 503 }
    );
  }
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

function isMissingProjectBasicInfoColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const source = error as { code?: unknown; message?: unknown };
  return source.code === "42703" || String(source.message ?? "").includes("project_basic_info");
}

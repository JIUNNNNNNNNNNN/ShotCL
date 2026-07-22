import { NextRequest, NextResponse } from "next/server";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) {
      return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다.", code: "INVALID_PROJECT_ID" }, { status: 400 });
    }
    const supabase = requireProjectAccessDb();
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id,name,shoot_date,description,created_at,share_enabled")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다.", code: "PROJECT_NOT_FOUND" }, { status: 404 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "이 프로젝트에 접근할 권한이 없습니다.", code: "PROJECT_ACCESS_DENIED" }, { status: 403 });
    return NextResponse.json({ project: { ...project, access_role: grant.role } });
  } catch (error) {
    return NextResponse.json({ error: "프로젝트 정보를 불러오지 못했습니다.", code: "PROJECT_LOOKUP_FAILED" }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

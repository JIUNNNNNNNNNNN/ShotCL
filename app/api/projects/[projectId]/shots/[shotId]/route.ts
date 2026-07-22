import { NextRequest, NextResponse } from "next/server";
import { shotPatchToRow } from "@/lib/data/mappers";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import type { Shot } from "@/lib/types";

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; shotId: string }> }) {
  try {
    const { projectId: routeProjectId, shotId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const body = (await request.json()) as { patch?: Partial<Shot> };
    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase.from("shots").update(shotPatchToRow(body.patch ?? {})).eq("project_id", projectId).eq("id", shotId).select("*").single();
    if (error) throw error;
    return NextResponse.json({ shot: data });
  } catch (error) {
    return NextResponse.json({ error: "컷을 수정하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; shotId: string }> }) {
  try {
    const { projectId: routeProjectId, shotId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const supabase = requireProjectAccessDb();
    const { error } = await supabase.from("shots").delete().eq("project_id", projectId).eq("id", shotId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "컷을 삭제하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import type { ShotStatus } from "@/lib/types";

const statuses: ShotStatus[] = ["pending", "ok", "omit"];

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; shotId: string }> }) {
  try {
    const { projectId: routeProjectId, shotId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const body = (await request.json()) as { status?: ShotStatus };
    if (!body.status || !statuses.includes(body.status)) return NextResponse.json({ error: "허용되지 않은 상태입니다." }, { status: 400 });

    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    const supabase = requireProjectAccessDb();
    const { data: current, error: currentError } = await supabase.from("shots").select("id,status").eq("id", shotId).eq("project_id", projectId).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ error: "컷을 찾을 수 없습니다." }, { status: 404 });

    const { data, error } = await supabase.from("shots").update({ status: body.status }).eq("id", shotId).eq("project_id", projectId).select("*").single();
    if (error) throw error;
    return NextResponse.json({ shot: data });
  } catch (error) {
    return NextResponse.json({ error: "컷 상태를 변경하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

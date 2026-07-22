import { NextRequest, NextResponse } from "next/server";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase.from("projects").select("id,name,shoot_date,description,created_at,share_enabled").eq("id", projectId).single();
    if (error) throw error;
    return NextResponse.json({ project: { ...data, access_role: grant.role } });
  } catch (error) {
    return NextResponse.json({ error: "프로젝트를 불러오지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

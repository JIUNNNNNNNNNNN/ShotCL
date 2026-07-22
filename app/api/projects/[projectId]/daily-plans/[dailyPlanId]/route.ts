import { NextRequest, NextResponse } from "next/server";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  try {
    const { projectId: routeProjectId, dailyPlanId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    if (grant.role !== "admin") return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    const supabase = requireProjectAccessDb();
    const [{ data: plan, error: planError }, { data: shots, error: shotError }] = await Promise.all([
      supabase.from("daily_plans").select("*").eq("project_id", projectId).eq("id", dailyPlanId).maybeSingle(),
      supabase.from("daily_plan_shots").select("*").eq("project_id", projectId).eq("daily_plan_id", dailyPlanId).order("order_index")
    ]);
    if (planError) throw planError;
    if (shotError) throw shotError;
    if (!plan) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ plan, shots });
  } catch (error) {
    return NextResponse.json({ error: "일촬표를 불러오지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  try {
    const { projectId: routeProjectId, dailyPlanId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const supabase = requireProjectAccessDb();
    const { error } = await supabase.from("daily_plans").delete().eq("project_id", projectId).eq("id", dailyPlanId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "일촬표를 삭제하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

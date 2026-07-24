import { NextRequest, NextResponse } from "next/server";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string; shotId: string }> }) {
  try {
    const { projectId: routeProjectId, shotId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const { direction, dailyPlanId } = (await request.json()) as { direction?: "up" | "down"; dailyPlanId?: string | null };
    if (direction !== "up" && direction !== "down") return NextResponse.json({ error: "이동 방향이 올바르지 않습니다." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    let query = supabase.from("shots").select("id,order_index").eq("project_id", projectId).order("order_index").order("created_at");
    if (dailyPlanId) query = query.eq("daily_plan_id", dailyPlanId);
    const { data: shots, error } = await query;
    if (error) throw error;
    const currentIndex = shots.findIndex((shot) => shot.id === shotId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= shots.length) return NextResponse.json({ success: true });
    const current = shots[currentIndex];
    const target = shots[targetIndex];
    const [first, second] = await Promise.all([
      supabase.from("shots").update({ order_index: target.order_index }).eq("project_id", projectId).eq("id", current.id),
      supabase.from("shots").update({ order_index: current.order_index }).eq("project_id", projectId).eq("id", target.id)
    ]);
    if (first.error) throw first.error;
    if (second.error) throw second.error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "컷 순서를 변경하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

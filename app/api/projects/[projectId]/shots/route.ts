import { NextRequest, NextResponse } from "next/server";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { shotDraftToInsertRow } from "@/lib/data/mappers";
import type { ShotDraft } from "@/lib/types";

const shotListColumns = "id,project_id,daily_plan_id,analysis_run_id,scene_number,cut_number,shot_number,title,description,location,characters,memo,notes,order_index,status,storyboard_image_url,source_file_id,source_page,source_row,created_at,updated_at";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    const dailyPlanId = request.nextUrl.searchParams.get("dailyPlanId");
    if (grant.role === "progress" && !dailyPlanId) return NextResponse.json({ error: "회차를 먼저 선택하세요." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    let query = supabase.from("shots").select(shotListColumns).eq("project_id", projectId).order("order_index").order("created_at");
    if (dailyPlanId) query = query.eq("daily_plan_id", dailyPlanId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ shots: data });
  } catch (error) {
    return NextResponse.json({ error: "컷 목록을 불러오지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const body = (await request.json()) as { drafts?: ShotDraft[]; dailyPlanId?: string | null };
    const drafts = body.drafts ?? [];
    const supabase = requireProjectAccessDb();
    if (body.dailyPlanId) {
      const { data: plan, error: planError } = await supabase.from("daily_plans").select("id").eq("project_id", projectId).eq("id", body.dailyPlanId).maybeSingle();
      if (planError) throw planError;
      if (!plan) return NextResponse.json({ error: "선택한 회차를 찾을 수 없습니다." }, { status: 404 });
    }
    let lastQuery = supabase.from("shots").select("order_index").eq("project_id", projectId).order("order_index", { ascending: false }).limit(1);
    if (body.dailyPlanId) lastQuery = lastQuery.eq("daily_plan_id", body.dailyPlanId);
    const { data: lastRows, error: lastError } = await lastQuery;
    if (lastError) throw lastError;
    const maxOrder = lastRows?.[0]?.order_index ?? 0;
    if (!drafts.length) return NextResponse.json({ shots: [] });
    const rows = drafts.map((draft, index) => shotDraftToInsertRow(projectId, draft, maxOrder + index + 1, body.dailyPlanId));
    const { data, error } = await supabase.from("shots").insert(rows).select("*").order("order_index");
    if (error) throw error;
    return NextResponse.json({ shots: data });
  } catch (error) {
    return NextResponse.json({ error: "컷을 추가하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const supabase = requireProjectAccessDb();
    const dailyPlanId = request.nextUrl.searchParams.get("dailyPlanId");
    let query = supabase.from("shots").delete().eq("project_id", projectId);
    if (dailyPlanId) query = query.eq("daily_plan_id", dailyPlanId);
    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "컷 목록을 삭제하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

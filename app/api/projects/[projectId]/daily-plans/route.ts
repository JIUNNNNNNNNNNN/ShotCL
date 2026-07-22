import { NextRequest, NextResponse } from "next/server";
import { dailyPlanDraftToRow, dailyPlanShotDraftToRow } from "@/lib/data/mappers";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import type { DailyPlanDraft, DailyPlanShotDraft } from "@/lib/types";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    const supabase = requireProjectAccessDb();
    const planColumns = grant.role === "progress"
      ? "id,project_id,title,source_type,source_file_name,shooting_date,episode,created_at,updated_at"
      : "*";
    const [{ data: plans, error: planError }, { data: shots, error: shotError }] = await Promise.all([
      supabase.from("daily_plans").select(planColumns).eq("project_id", projectId).order("updated_at", { ascending: false }),
      supabase.from("daily_plan_shots").select("daily_plan_id").eq("project_id", projectId)
    ]);
    if (planError) throw planError;
    if (shotError) throw shotError;
    return NextResponse.json({ plans, shotPlanIds: (shots ?? []).map((shot) => shot.daily_plan_id) });
  } catch (error) {
    return NextResponse.json({ error: "일촬표 목록을 불러오지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    if (grant.role !== "admin") return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    const body = (await request.json()) as { dailyPlanId?: string | null; plan: DailyPlanDraft; shots: DailyPlanShotDraft[] };
    const supabase = requireProjectAccessDb();
    let planRow: Record<string, unknown>;
    if (body.dailyPlanId) {
      const { data, error } = await supabase.from("daily_plans").update(dailyPlanDraftToRow(projectId, body.plan)).eq("id", body.dailyPlanId).eq("project_id", projectId).select("*").single();
      if (error) throw error;
      planRow = data;
      const { error: deleteError } = await supabase.from("daily_plan_shots").delete().eq("daily_plan_id", body.dailyPlanId).eq("project_id", projectId);
      if (deleteError) throw deleteError;
    } else {
      const { data, error } = await supabase.from("daily_plans").insert(dailyPlanDraftToRow(projectId, body.plan)).select("*").single();
      if (error) throw error;
      planRow = data;
    }
    const planId = String(planRow.id);
    let shotRows: Record<string, unknown>[] = [];
    if (body.shots.length) {
      const rows = body.shots.map((shot, index) => dailyPlanShotDraftToRow(projectId, planId, shot, index + 1));
      const { data, error } = await supabase.from("daily_plan_shots").insert(rows).select("*").order("order_index");
      if (error) throw error;
      shotRows = data;
    }
    return NextResponse.json({ plan: planRow, shots: shotRows });
  } catch (error) {
    return NextResponse.json({ error: "일촬표를 저장하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

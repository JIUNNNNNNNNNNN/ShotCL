import { NextRequest, NextResponse } from "next/server";
import { dailyPlanDraftToRow, dailyPlanShotDraftToRow } from "@/lib/data/mappers";
import { isSameDailyPlanIdentity } from "@/lib/dailyPlan/identity";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import type { DailyPlanDraft, DailyPlanShotDraft } from "@/lib/types";

type DailyPlanSaveBody = {
  dailyPlanId?: string | null;
  plan: DailyPlanDraft;
  shots: DailyPlanShotDraft[];
  allowDuplicate?: boolean;
};

const SAVED_MESSAGE = "일촬표가 저장되었습니다.";
const DUPLICATE_MESSAGE = "이미 저장된 일촬표입니다.";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
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
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ ok: false, status: "failed", error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    if (grant.role !== "admin") return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    const body = (await request.json()) as DailyPlanSaveBody;
    if (!body.plan || !Array.isArray(body.shots)) {
      return NextResponse.json({ ok: false, status: "failed", error: "저장할 일촬표 정보가 올바르지 않습니다." }, { status: 400 });
    }
    const supabase = requireProjectAccessDb();

    if (!body.dailyPlanId && !body.allowDuplicate) {
      const duplicate = await findDuplicateDailyPlan(supabase, projectId, body.plan);
      if (duplicate) {
        return NextResponse.json(
          { ok: false, status: "duplicate", message: DUPLICATE_MESSAGE, dailyPlan: duplicate.plan, shots: duplicate.shots },
          { status: 409 }
        );
      }
    }

    let planRow: Record<string, unknown>;
    let shotRows: Record<string, unknown>[] = [];
    if (body.dailyPlanId) {
      const { data: existingPlan, error: existingPlanError } = await supabase
        .from("daily_plans")
        .select("*")
        .eq("id", body.dailyPlanId)
        .eq("project_id", projectId)
        .maybeSingle();
      if (existingPlanError) throw existingPlanError;
      if (!existingPlan) {
        return NextResponse.json({ ok: false, status: "failed", error: "수정할 일촬표를 찾을 수 없습니다." }, { status: 404 });
      }

      const { data: oldShots, error: oldShotsError } = await supabase
        .from("daily_plan_shots")
        .select("*")
        .eq("daily_plan_id", body.dailyPlanId)
        .eq("project_id", projectId);
      if (oldShotsError) throw oldShotsError;

      const newRows = body.shots.map((shot, index) => dailyPlanShotDraftToRow(projectId, body.dailyPlanId!, shot, index + 1));
      const insertedIds: string[] = [];
      try {
        if (newRows.length) {
          const { data, error } = await supabase.from("daily_plan_shots").insert(newRows).select("*").order("order_index");
          if (error) throw error;
          shotRows = data;
          insertedIds.push(...data.map((row) => String(row.id)));
        }
        if (oldShots.length) {
          const { error } = await supabase.from("daily_plan_shots").delete().in("id", oldShots.map((row) => row.id));
          if (error) throw error;
        }
        const { data, error } = await supabase
          .from("daily_plans")
          .update(dailyPlanDraftToRow(projectId, body.plan))
          .eq("id", body.dailyPlanId)
          .eq("project_id", projectId)
          .select("*")
          .single();
        if (error) throw error;
        planRow = data;
      } catch (error) {
        if (insertedIds.length) await supabase.from("daily_plan_shots").delete().in("id", insertedIds);
        if (oldShots.length) {
          const { data: remainingOldShots } = await supabase.from("daily_plan_shots").select("id").in("id", oldShots.map((row) => row.id));
          if ((remainingOldShots?.length ?? 0) < oldShots.length) await supabase.from("daily_plan_shots").insert(oldShots);
        }
        throw error;
      }
    } else {
      const { data, error } = await supabase.from("daily_plans").insert(dailyPlanDraftToRow(projectId, body.plan)).select("*").single();
      if (error) throw error;
      planRow = data;
      const planId = String(planRow.id);
      try {
        if (body.shots.length) {
          const rows = body.shots.map((shot, index) => dailyPlanShotDraftToRow(projectId, planId, shot, index + 1));
          const { data: insertedShots, error: shotError } = await supabase.from("daily_plan_shots").insert(rows).select("*").order("order_index");
          if (shotError) throw shotError;
          shotRows = insertedShots;
        }
      } catch (error) {
        await supabase.from("daily_plans").delete().eq("id", planId).eq("project_id", projectId);
        throw error;
      }
    }

    return NextResponse.json({ ok: true, status: "saved", message: SAVED_MESSAGE, dailyPlan: planRow, shots: shotRows }, { status: body.dailyPlanId ? 200 : 201 });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      return NextResponse.json({ ok: false, status: "duplicate", message: DUPLICATE_MESSAGE }, { status: 409 });
    }
    return NextResponse.json({ ok: false, status: "failed", error: "일촬표를 저장하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

async function findDuplicateDailyPlan(supabase: ReturnType<typeof requireProjectAccessDb>, projectId: string, plan: DailyPlanDraft) {
  const { data, error } = await supabase.from("daily_plans").select("*").eq("project_id", projectId);
  if (error) throw error;
  const duplicate = data.find((row) => isSameDailyPlanIdentity({
    episode: String(row.episode ?? ""),
    shootingDate: String(row.shooting_date ?? ""),
    memo: String(row.memo ?? "")
  }, plan));
  if (!duplicate) return null;

  const { data: shots, error: shotError } = await supabase
    .from("daily_plan_shots")
    .select("*")
    .eq("project_id", projectId)
    .eq("daily_plan_id", duplicate.id)
    .order("order_index");
  if (shotError) throw shotError;
  return { plan: duplicate, shots };
}

function isPostgresUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

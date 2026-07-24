import { NextRequest, NextResponse } from "next/server";
import { normalizeDailyPlanMealTimes } from "@/lib/data/mappers";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  try {
    const { projectId: routeProjectId, dailyPlanId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    if (grant.role !== "admin") return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: 403 });
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

/** 진행도 화면에서 기타일정의 그림/메모만 명시적으로 저장합니다. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  try {
    const { projectId: routeProjectId, dailyPlanId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") {
      return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    }
    const body = (await request.json()) as {
      scheduleItem?: { id?: unknown; progressMemo?: unknown; imageUrl?: unknown };
    };
    const itemId = String(body.scheduleItem?.id ?? "").trim();
    if (!itemId) return NextResponse.json({ error: "수정할 기타일정 정보가 없습니다." }, { status: 400 });

    const supabase = requireProjectAccessDb();
    const { data: plan, error: selectError } = await supabase
      .from("daily_plans")
      .select("meal_times")
      .eq("project_id", projectId)
      .eq("id", dailyPlanId)
      .maybeSingle();
    if (selectError) throw selectError;
    if (!plan) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });

    const mealTimes = normalizeDailyPlanMealTimes(plan.meal_times);
    if (!mealTimes.some((item) => item.id === itemId)) {
      return NextResponse.json({ error: "기타일정을 찾을 수 없습니다." }, { status: 404 });
    }
    const progressMemo = String(body.scheduleItem?.progressMemo ?? "").slice(0, 2000);
    const rawImageUrl = String(body.scheduleItem?.imageUrl ?? "").trim();
    const imageUrl = rawImageUrl ? rawImageUrl.slice(0, 4000) : null;
    const nextMealTimes = mealTimes.map((item) => (
      item.id === itemId ? { ...item, progressMemo, imageUrl } : item
    ));

    const { data: savedPlan, error: updateError } = await supabase
      .from("daily_plans")
      .update({ meal_times: nextMealTimes })
      .eq("project_id", projectId)
      .eq("id", dailyPlanId)
      .select("meal_times")
      .single();
    if (updateError) throw updateError;
    return NextResponse.json({ mealTimes: normalizeDailyPlanMealTimes(savedPlan.meal_times) });
  } catch (error) {
    return NextResponse.json({ error: "기타일정 정보를 저장하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  try {
    const { projectId: routeProjectId, dailyPlanId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const supabase = requireProjectAccessDb();
    const { error } = await supabase.from("daily_plans").delete().eq("project_id", projectId).eq("id", dailyPlanId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "일촬표를 삭제하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

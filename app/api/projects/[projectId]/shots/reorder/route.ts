import { NextRequest, NextResponse } from "next/server";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type ReorderRequest = {
  dailyPlanId?: string;
  shotIds?: string[];
};

const shotListColumns = "id,project_id,daily_plan_id,analysis_run_id,scene_number,cut_number,shot_number,title,description,location,characters,memo,notes,order_index,status,storyboard_image_url,source_file_id,source_page,source_row,created_at,updated_at";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) {
      return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    }

    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") {
      return NextResponse.json(
        { error: "Key staff 권한이 필요합니다." },
        { status: grant ? 403 : 401 }
      );
    }

    const { dailyPlanId, shotIds } = (await request.json()) as ReorderRequest;
    if (!dailyPlanId?.trim() || !Array.isArray(shotIds) || shotIds.length === 0) {
      return NextResponse.json({ error: "회차와 컷 순서가 필요합니다." }, { status: 400 });
    }

    const uniqueShotIds = [...new Set(shotIds)];
    if (uniqueShotIds.length !== shotIds.length || uniqueShotIds.some((id) => typeof id !== "string" || !id.trim())) {
      return NextResponse.json({ error: "컷 순서 데이터가 올바르지 않습니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const { data: scopedShots, error: selectError } = await supabase
      .from("shots")
      .select(shotListColumns)
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId);
    if (selectError) throw selectError;

    const scopedIds = new Set((scopedShots ?? []).map((shot) => shot.id));
    const isExactScope = scopedIds.size === shotIds.length && shotIds.every((id) => scopedIds.has(id));
    if (!isExactScope) {
      return NextResponse.json(
        { error: "현재 프로젝트와 회차의 전체 컷만 정렬할 수 있습니다." },
        { status: 409 }
      );
    }

    const rowById = new Map((scopedShots ?? []).map((shot) => [shot.id, shot]));
    const rows = shotIds.map((id, index) => ({
      ...rowById.get(id),
      order_index: index + 1
    }));
    const { error: updateError } = await supabase
      .from("shots")
      .upsert(rows, { onConflict: "id" });
    if (updateError) throw updateError;

    return NextResponse.json({ success: true, shots: rows });
  } catch (error) {
    console.error("[shots/reorder] failed", error);
    return NextResponse.json(
      { error: "컷 순서를 저장하지 못했습니다." },
      { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 }
    );
  }
}

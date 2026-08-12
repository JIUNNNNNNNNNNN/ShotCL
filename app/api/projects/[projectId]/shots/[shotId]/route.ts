import { NextRequest, NextResponse } from "next/server";
import { shotPatchToRow } from "@/lib/data/mappers";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { createProjectDeleteReceipt } from "@/lib/projectDeleteReceipt.server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import type { Shot } from "@/lib/types";

const SHOTS_DELETE_RECEIPT_KIND = "shots";
const SHOT_LOG_PAGE_SIZE = 1_000;
const MAX_SHOT_DELETE_STATUS_LOG_ROWS = 20_000;

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; shotId: string }> }) {
  try {
    const { projectId: routeProjectId, shotId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
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
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const supabase = requireProjectAccessDb();
    const { data: shot, error: shotError } = await supabase
      .from("shots")
      .select("*")
      .eq("project_id", projectId)
      .eq("id", shotId)
      .maybeSingle();
    if (shotError) throw shotError;
    if (!shot) {
      return NextResponse.json({ success: true, deleted: false, receipt: null });
    }
    const statusLogs: Record<string, unknown>[] = [];
    let pageStart = 0;
    while (true) {
      const { data, error: logError } = await supabase
        .from("shot_status_logs")
        .select("*")
        .eq("shot_id", shotId)
        .order("created_at")
        .order("id")
        .range(pageStart, pageStart + SHOT_LOG_PAGE_SIZE - 1);
      if (logError) throw logError;
      const rows = data ?? [];
      statusLogs.push(...rows);
      if (statusLogs.length > MAX_SHOT_DELETE_STATUS_LOG_ROWS) {
        return NextResponse.json({ error: "복원 정보를 안전하게 만들 수 있는 컷 상태 기록 수를 초과했습니다." }, { status: 413 });
      }
      if (rows.length < SHOT_LOG_PAGE_SIZE) break;
      pageStart += rows.length;
    }
    // Receipt construction must succeed before the irreversible DB delete.
    const receipt = createProjectDeleteReceipt({
      projectId,
      kind: SHOTS_DELETE_RECEIPT_KIND,
      payload: {
        mode: "single",
        dailyPlanId: shot.daily_plan_id ?? null,
        shots: [shot],
        statusLogs
      }
    });

    // updated_at guard prevents a status/title edit that completed after the
    // snapshot from being silently deleted and later overwritten by Undo.
    const { data: deleted, error: deleteError } = await supabase
      .from("shots")
      .delete()
      .eq("project_id", projectId)
      .eq("id", shotId)
      .eq("updated_at", shot.updated_at)
      .select("id")
      .maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) {
      return NextResponse.json(
        { error: "컷이 다른 화면에서 변경되었습니다. 최신 내용을 확인해주세요." },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: true, deleted: true, receipt });
  } catch (error) {
    return NextResponse.json({ error: "컷을 삭제하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

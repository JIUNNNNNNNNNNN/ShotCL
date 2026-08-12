import { NextRequest, NextResponse } from "next/server";
import {
  getAccessGrant,
  getProjectRequestAccess,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import {
  createProjectDeleteReceipt,
  ProjectDeleteReceiptError,
  verifyProjectDeleteReceipt
} from "@/lib/projectDeleteReceipt.server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { shotDraftToInsertRow } from "@/lib/data/mappers";
import type { ShotDraft } from "@/lib/types";

const shotListColumns = "id,project_id,daily_plan_id,analysis_run_id,scene_number,cut_number,shot_number,title,description,location,characters,memo,notes,order_index,status,storyboard_image_url,source_file_id,source_page,source_row,created_at,updated_at";
const guestShotListColumns = "id,project_id,daily_plan_id,analysis_run_id,scene_number,cut_number,shot_number,title,description,location,characters,memo,notes,order_index,status,source_file_id,source_page,source_row,created_at,updated_at";
const SHOTS_DELETE_RECEIPT_KIND = "shots";
const SHOT_DELETE_CAS_BATCH_SIZE = 50;
const SHOT_LOG_READ_BATCH_SIZE = 100;
const SHOT_LOG_PAGE_SIZE = 1_000;
const MAX_SHOT_DELETE_STATUS_LOG_ROWS = 20_000;
const SHOT_RESTORE_BATCH_SIZE = 100;
const SHOT_LOG_RESTORE_BATCH_SIZE = 500;

type DatabaseRow = Record<string, unknown>;
type DeletedShotsReceiptPayload = {
  mode: "single" | "batch";
  dailyPlanId: string | null;
  shots: DatabaseRow[];
  statusLogs: DatabaseRow[];
};

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const access = await getProjectRequestAccess(request, projectId);
    const grant = access?.grant ?? null;
    if (!access || !grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    const dailyPlanId = request.nextUrl.searchParams.get("dailyPlanId");
    if (grant.role === "progress" && !dailyPlanId) return NextResponse.json({ error: "회차를 먼저 선택하세요." }, { status: 400 });
    const supabase = requireProjectAccessDb();
    if (access.mode === "guest") {
      let guestQuery = supabase
        .from("shots")
        .select(guestShotListColumns)
        .eq("project_id", projectId)
        .order("order_index")
        .order("created_at");
      if (dailyPlanId) guestQuery = guestQuery.eq("daily_plan_id", dailyPlanId);
      const { data, error } = await guestQuery;
      if (error) throw error;
      return NextResponse.json({ shots: data });
    }

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
  let failureMessage = "컷을 추가하지 못했습니다.";
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const body = (await request.json()) as {
      operation?: string;
      drafts?: ShotDraft[];
      dailyPlanId?: string | null;
      receipt?: unknown;
    };
    if (body.operation === "restore_deleted" || body.operation === "finalize_deleted") {
      failureMessage = body.operation === "restore_deleted"
        ? "컷을 복원하지 못했습니다."
        : "컷 삭제를 확정하지 못했습니다.";
      const restored = readDeletedShotsReceipt(projectId, body.receipt);
      if (body.operation === "finalize_deleted") {
        // DB-only entity: validating and forgetting the receipt is the entire
        // irreversible finalize step. Repeated calls are intentionally no-op.
        return NextResponse.json({ success: true, finalized: true });
      }
      const supabase = requireProjectAccessDb();
      for (let start = 0; start < restored.shots.length; start += SHOT_RESTORE_BATCH_SIZE) {
        const { error } = await supabase
          .from("shots")
          .upsert(restored.shots.slice(start, start + SHOT_RESTORE_BATCH_SIZE), {
            onConflict: "id",
            ignoreDuplicates: true
          });
        if (error) throw error;
      }
      for (let start = 0; start < restored.statusLogs.length; start += SHOT_LOG_RESTORE_BATCH_SIZE) {
        const { error: logError } = await supabase
          .from("shot_status_logs")
          .upsert(restored.statusLogs.slice(start, start + SHOT_LOG_RESTORE_BATCH_SIZE), {
            onConflict: "id",
            ignoreDuplicates: true
          });
        if (logError) throw logError;
      }
      return NextResponse.json({
        success: true,
        restoredIds: restored.shots.map((row) => String(row.id))
      });
    }
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
    return NextResponse.json(
      { error: error instanceof ProjectDeleteReceiptError ? error.message : failureMessage },
      { status: error instanceof ProjectDeleteReceiptError ? 400 : error instanceof ProjectAccessUnavailableError ? 503 : 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const supabase = requireProjectAccessDb();
    const dailyPlanId = request.nextUrl.searchParams.get("dailyPlanId")?.trim() ?? "";
    if (!isValidDatabaseProjectId(dailyPlanId)) {
      return NextResponse.json({ error: "삭제할 회차 ID가 올바르지 않습니다." }, { status: 400 });
    }
    const { data: shots, error: shotError } = await supabase
      .from("shots")
      .select("*")
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId)
      .order("order_index")
      .order("created_at");
    if (shotError) throw shotError;
    if (!shots || shots.length === 0) {
      return NextResponse.json({ error: "삭제할 컷이 없습니다." }, { status: 404 });
    }
    if (shots.length > 500) {
      return NextResponse.json({ error: "한 번에 삭제할 수 있는 컷 수를 초과했습니다." }, { status: 413 });
    }
    const shotIds = shots.map((shot) => String(shot.id));
    const statusLogs: DatabaseRow[] = [];
    for (let start = 0; start < shotIds.length; start += SHOT_LOG_READ_BATCH_SIZE) {
      let pageStart = 0;
      while (true) {
        const { data, error } = await supabase
          .from("shot_status_logs")
          .select("*")
          .in("shot_id", shotIds.slice(start, start + SHOT_LOG_READ_BATCH_SIZE))
          .order("created_at")
          .order("id")
          .range(pageStart, pageStart + SHOT_LOG_PAGE_SIZE - 1);
        if (error) throw error;
        const rows = data ?? [];
        statusLogs.push(...rows);
        if (statusLogs.length > MAX_SHOT_DELETE_STATUS_LOG_ROWS) {
          return NextResponse.json({ error: "복원 정보를 안전하게 만들 수 있는 컷 상태 기록 수를 초과했습니다." }, { status: 413 });
        }
        if (rows.length < SHOT_LOG_PAGE_SIZE) break;
        pageStart += rows.length;
      }
    }
    const receipt = createProjectDeleteReceipt({
      projectId,
      kind: SHOTS_DELETE_RECEIPT_KIND,
      payload: {
        mode: "batch",
        dailyPlanId,
        shots,
        statusLogs
      } satisfies DeletedShotsReceiptPayload
    });

    // A fixed number of bounded queries applies per-row updated_at guards;
    // this is not an entity-count N+1 loop. Concurrent inserts survive and a
    // concurrent edit turns the whole reset into a conflict with rollback.
    const deletedIds = new Set<string>();
    let deleteFailure: unknown = null;
    for (let start = 0; start < shots.length; start += SHOT_DELETE_CAS_BATCH_SIZE) {
      const batch = shots.slice(start, start + SHOT_DELETE_CAS_BATCH_SIZE);
      const versionFilter = batch.map((row) => (
        `and(id.eq.${String(row.id)},updated_at.eq.${JSON.stringify(String(row.updated_at ?? ""))})`
      )).join(",");
      const { data: deletedRows, error: deleteError } = await supabase
        .from("shots")
        .delete()
        .eq("project_id", projectId)
        .in("id", batch.map((row) => String(row.id)))
        .or(versionFilter)
        .select("id");
      if (deleteError) {
        deleteFailure = deleteError;
        break;
      }
      (deletedRows ?? []).forEach((row) => deletedIds.add(String(row.id)));
      if ((deletedRows ?? []).length !== batch.length) break;
    }
    if (deleteFailure || deletedIds.size !== shots.length) {
      const rollbackShots = shots.filter((row) => deletedIds.has(String(row.id)));
      const rollbackLogs = statusLogs.filter((row) => deletedIds.has(String(row.shot_id)));
      if (rollbackShots.length > 0) {
        const { error: rollbackShotError } = await supabase
          .from("shots")
          .upsert(rollbackShots, { onConflict: "id", ignoreDuplicates: true });
        if (rollbackShotError) throw rollbackShotError;
        if (rollbackLogs.length > 0) {
          const { error: rollbackLogError } = await supabase
            .from("shot_status_logs")
            .upsert(rollbackLogs, { onConflict: "id", ignoreDuplicates: true });
          if (rollbackLogError) throw rollbackLogError;
        }
      }
      if (deleteFailure) throw deleteFailure;
      return NextResponse.json(
        { error: "컷 목록이 다른 화면에서 변경되었습니다. 최신 내용을 확인해주세요." },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: true, deleted: shots.length, receipt });
  } catch (error) {
    return NextResponse.json({ error: "컷 목록을 삭제하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

function readDeletedShotsReceipt(projectId: string, receipt: unknown): DeletedShotsReceiptPayload {
  const value = verifyProjectDeleteReceipt<unknown>(receipt, {
    projectId,
    kind: SHOTS_DELETE_RECEIPT_KIND
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectDeleteReceiptError();
  const payload = value as Partial<DeletedShotsReceiptPayload>;
  if (
    (payload.mode !== "single" && payload.mode !== "batch")
    || !Array.isArray(payload.shots)
    || payload.shots.length === 0
    || payload.shots.length > 500
    || !Array.isArray(payload.statusLogs)
    || payload.statusLogs.length > MAX_SHOT_DELETE_STATUS_LOG_ROWS
  ) {
    throw new ProjectDeleteReceiptError();
  }
  const shotIds = new Set<string>();
  for (const row of payload.shots) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new ProjectDeleteReceiptError();
    const id = String(row.id ?? "").trim();
    if (!isValidDatabaseProjectId(id) || row.project_id !== projectId || shotIds.has(id)) {
      throw new ProjectDeleteReceiptError();
    }
    shotIds.add(id);
  }
  for (const row of payload.statusLogs) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new ProjectDeleteReceiptError();
    const id = String(row.id ?? "").trim();
    const shotId = String(row.shot_id ?? "").trim();
    if (!isValidDatabaseProjectId(id) || !shotIds.has(shotId)) throw new ProjectDeleteReceiptError();
  }
  const dailyPlanId = payload.dailyPlanId === null
    ? null
    : String(payload.dailyPlanId ?? "").trim();
  if (dailyPlanId !== null && !isValidDatabaseProjectId(dailyPlanId)) {
    throw new ProjectDeleteReceiptError();
  }
  return {
    mode: payload.mode,
    dailyPlanId,
    shots: payload.shots,
    statusLogs: payload.statusLogs
  };
}

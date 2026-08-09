import { NextRequest, NextResponse } from "next/server";
import {
  dailyPlanDraftToRow,
  dailyPlanFromRow,
  dailyPlanShotDraftToRow,
  dailyPlanShotFromRow,
  normalizeDailyPlanMealTimes
} from "@/lib/data/mappers";
import { buildDailyPlanDuplicateDraft } from "@/lib/dailyPlan/duplicate";
import { mergeLatestGatheringPhotoMetadata } from "@/lib/dailyPlan/gatheringPoints";
import { buildProgressShotDrafts } from "@/lib/dailyPlan/progressShots";
import { decodeDailyPlanMemo, encodeDailyPlanMemo } from "@/lib/dailyPlan/printMeta";
import { ProgressShotsSyncError, syncProgressShotsForDailyPlan } from "@/lib/dailyPlan/syncProgressShots.server";
import { isSameDailyPlanIdentity } from "@/lib/dailyPlan/identity";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import type { DailyPlanDraft, DailyPlanMealTime, DailyPlanShotDraft } from "@/lib/types";

type DailyPlanSaveBody = {
  dailyPlanId?: string | null;
  expectedUpdatedAt?: string | null;
  plan: DailyPlanDraft;
  shots: DailyPlanShotDraft[];
  allowDuplicate?: boolean;
};

type DailyPlanSaveRequestBody = Partial<DailyPlanSaveBody> & {
  duplicateSourceDailyPlanId?: string;
};

const SAVED_MESSAGE = "일촬표가 저장되었습니다.";
const DUPLICATE_MESSAGE = "이미 저장된 일촬표입니다.";
const dailyPlanListColumns = "id,project_id,title,source_type,source_file_name,shooting_date,episode,call_time,meeting_location,shooting_locations,meal_times,memo,created_at,updated_at";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    const supabase = requireProjectAccessDb();
    const [
      { data: plans, error: planError },
      { data: dailyPlanShots, error: dailyPlanShotError },
      { data: progressShots, error: progressShotError }
    ] = await Promise.all([
      supabase.from("daily_plans").select(dailyPlanListColumns).eq("project_id", projectId).order("updated_at", { ascending: false }),
      supabase.from("daily_plan_shots").select("daily_plan_id,scene_number").eq("project_id", projectId),
      supabase.from("shots").select("id,daily_plan_id,status").eq("project_id", projectId)
    ]);
    if (planError) throw planError;
    if (dailyPlanShotError) throw dailyPlanShotError;
    if (progressShotError) throw progressShotError;
    return NextResponse.json({
      plans,
      shotPlanIds: (dailyPlanShots ?? []).map((shot) => shot.daily_plan_id),
      dailyPlanShots: dailyPlanShots ?? [],
      progressShots: progressShots ?? []
    });
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
    if (grant.role !== "admin") return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: 403 });
    const requestBody = (await request.json()) as DailyPlanSaveRequestBody;
    const supabase = requireProjectAccessDb();
    let body: DailyPlanSaveBody;

    if (requestBody.duplicateSourceDailyPlanId) {
      const duplicateSourceDailyPlanId = String(requestBody.duplicateSourceDailyPlanId).trim();
      const [
        { data: sourcePlanRow, error: sourcePlanError },
        { data: sourceShotRows, error: sourceShotError },
        { data: episodeRows, error: episodeError }
      ] = await Promise.all([
        supabase
          .from("daily_plans")
          .select("*")
          .eq("project_id", projectId)
          .eq("id", duplicateSourceDailyPlanId)
          .maybeSingle(),
        supabase
          .from("daily_plan_shots")
          .select("*")
          .eq("project_id", projectId)
          .eq("daily_plan_id", duplicateSourceDailyPlanId)
          .order("order_index", { ascending: true }),
        supabase
          .from("daily_plans")
          .select("episode")
          .eq("project_id", projectId)
      ]);
      if (sourcePlanError) throw sourcePlanError;
      if (sourceShotError) throw sourceShotError;
      if (episodeError) throw episodeError;
      if (!sourcePlanRow) {
        return NextResponse.json(
          { ok: false, status: "failed", error: "복사할 일촬표를 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      const duplicate = buildDailyPlanDuplicateDraft({
        plan: dailyPlanFromRow(sourcePlanRow),
        shots: (sourceShotRows ?? []).map(dailyPlanShotFromRow),
        existingEpisodes: (episodeRows ?? []).map((row) => row.episode),
        canonicalProjectTitle: grant.projectName
      });
      body = {
        plan: duplicate.plan,
        shots: duplicate.shots,
        allowDuplicate: true
      };
    } else {
      if (!requestBody.plan || !Array.isArray(requestBody.shots)) {
        return NextResponse.json({ ok: false, status: "failed", error: "저장할 일촬표 정보가 올바르지 않습니다." }, { status: 400 });
      }
      body = {
        dailyPlanId: requestBody.dailyPlanId,
        expectedUpdatedAt: requestBody.expectedUpdatedAt,
        plan: requestBody.plan,
        shots: requestBody.shots,
        allowDuplicate: requestBody.allowDuplicate
      };
    }
    body.plan = {
      ...body.plan,
      // 신규/수정 저장 모두 같은 정규화를 거쳐 허용된 광역 지역만 memo에 남깁니다.
      // 알 수 없는 지역 문자열은 서울 등 임의 지역으로 대체하지 않고 미선택으로 저장합니다.
      memo: encodeDailyPlanMemo(decodeDailyPlanMemo(body.plan.memo))
    };
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
      const expectedUpdatedAt = String(body.expectedUpdatedAt ?? "").trim();
      if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
        return NextResponse.json(
          { ok: false, status: "failed", error: "최신 일촬표 저장 시각이 필요합니다." },
          { status: 400 }
        );
      }
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
      if (String(existingPlan.updated_at ?? "") !== expectedUpdatedAt) {
        return dailyPlanSaveConflict(existingPlan.updated_at);
      }
      body.plan = {
        ...body.plan,
        mealTimes: mergeLatestProgressScheduleFields(body.plan.mealTimes, existingPlan.meal_times),
        memo: encodeDailyPlanMemo(mergeLatestGatheringPhotoMetadata(
          decodeDailyPlanMemo(body.plan.memo),
          decodeDailyPlanMemo(String(existingPlan.memo ?? "")),
          body.plan.shootingLocations
        ))
      };

      const { data: oldShots, error: oldShotsError } = await supabase
        .from("daily_plan_shots")
        .select("*")
        .eq("daily_plan_id", body.dailyPlanId)
        .eq("project_id", projectId);
      if (oldShotsError) throw oldShotsError;

      const newRows = body.shots.map((shot, index) => dailyPlanShotDraftToRow(projectId, body.dailyPlanId!, shot, index + 1));
      const insertedIds: string[] = [];
      let claimedPlanRow: Record<string, unknown> | null = null;
      try {
        // Claim the document version before touching child rows. Two editors
        // can otherwise both replace shots and the later CAS loser may restore
        // stale rows over the winner's result.
        const { data: savedPlan, error: planError } = await supabase
          .from("daily_plans")
          .update(dailyPlanDraftToRow(projectId, body.plan))
          .eq("id", body.dailyPlanId)
          .eq("project_id", projectId)
          .eq("updated_at", expectedUpdatedAt)
          .select("*")
          .maybeSingle();
        if (planError) throw planError;
        if (!savedPlan) {
          const { data: latest, error: latestError } = await supabase
            .from("daily_plans")
            .select("updated_at")
            .eq("id", body.dailyPlanId)
            .eq("project_id", projectId)
            .maybeSingle();
          if (latestError) throw latestError;
          throw new DailyPlanSaveConflictError(latest?.updated_at);
        }
        planRow = savedPlan;
        claimedPlanRow = savedPlan;

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
      } catch (error) {
        if (insertedIds.length) await supabase.from("daily_plan_shots").delete().in("id", insertedIds);
        if (oldShots.length) {
          const { data: remainingOldShots } = await supabase.from("daily_plan_shots").select("id").in("id", oldShots.map((row) => row.id));
          const remainingIds = new Set((remainingOldShots ?? []).map((row) => String(row.id)));
          const missingOldShots = oldShots.filter((row) => !remainingIds.has(String(row.id)));
          if (missingOldShots.length) await supabase.from("daily_plan_shots").insert(missingOldShots);
        }
        if (claimedPlanRow?.updated_at) {
          // Revert the document only when no later progress/editor mutation
          // advanced it after our claim. A failed rollback never overwrites a
          // newer mutation.
          const { error: rollbackError } = await supabase
            .from("daily_plans")
            .update(dailyPlanDraftToRow(projectId, dailyPlanFromRow(existingPlan)))
            .eq("id", body.dailyPlanId)
            .eq("project_id", projectId)
            .eq("updated_at", claimedPlanRow.updated_at);
          if (rollbackError) console.error("[daily-plan:rollback]", rollbackError);
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

    const dailyPlanId = String(planRow.id);
    const targetShotCount = buildProgressShotDrafts(body.plan, body.shots).length;
    try {
      const progressSync = await syncProgressShotsForDailyPlan(supabase, projectId, dailyPlanId, body.plan, body.shots);
      return NextResponse.json(
        {
          ok: true,
          status: "saved",
          message: SAVED_MESSAGE,
          dailyPlan: planRow,
          shots: shotRows,
          shotsSync: {
            ok: true,
            step: "complete",
            projectIdPresent: Boolean(projectId),
            dailyPlanIdPresent: Boolean(dailyPlanId),
            targetShotCount: progressSync.count
          }
        },
        { status: body.dailyPlanId ? 200 : 201 }
      );
    } catch (syncError) {
      const diagnostic = getShotsSyncDiagnostic(syncError);
      console.error("[daily-plan-shots-sync]", {
        projectId,
        dailyPlanId,
        targetShotCount,
        ...diagnostic
      });
      return NextResponse.json(
        {
          ok: true,
          status: "saved_shots_failed",
          message: "일촬표는 저장됐지만 진행표 동기화에 실패했습니다.",
          dailyPlan: planRow,
          shots: shotRows,
          shotsSync: {
            ok: false,
            step: diagnostic.step,
            projectIdPresent: Boolean(projectId),
            dailyPlanIdPresent: Boolean(dailyPlanId),
            targetShotCount,
            errorCode: diagnostic.errorCode,
            errorMessage: diagnostic.errorMessage,
            details: diagnostic.details,
            hint: diagnostic.hint
          }
        },
        { status: body.dailyPlanId ? 200 : 201 }
      );
    }
  } catch (error) {
    if (error instanceof DailyPlanSaveConflictError) {
      return dailyPlanSaveConflict(error.latestUpdatedAt);
    }
    if (isPostgresUniqueViolation(error)) {
      return NextResponse.json({ ok: false, status: "duplicate", message: DUPLICATE_MESSAGE }, { status: 409 });
    }
    return NextResponse.json({ ok: false, status: "failed", error: "일촬표를 저장하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

class DailyPlanSaveConflictError extends Error {
  readonly latestUpdatedAt: string | null;

  constructor(updatedAt: unknown) {
    super("일촬표가 다른 화면에서 변경되었습니다.");
    this.name = "DailyPlanSaveConflictError";
    this.latestUpdatedAt = String(updatedAt ?? "") || null;
  }
}

function dailyPlanSaveConflict(updatedAt: unknown) {
  return NextResponse.json(
    {
      ok: false,
      status: "conflict",
      error: "일촬표가 다른 화면에서 변경되었습니다. 현재 입력은 유지되며, 최신 내용을 확인한 뒤 다시 저장해주세요.",
      latestUpdatedAt: String(updatedAt ?? "") || null
    },
    { status: 409 }
  );
}

/** 진행도에서만 편집하는 필드는 whole-document 재시도에도 최신값을 보존합니다. */
function mergeLatestProgressScheduleFields(
  incomingValue: unknown,
  latestValue: unknown
): DailyPlanMealTime[] {
  const incoming = normalizeDailyPlanMealTimes(incomingValue);
  const latestById = new Map(normalizeDailyPlanMealTimes(latestValue).map((item) => [item.id, item]));
  return incoming.map((item) => {
    const latest = latestById.get(item.id);
    return latest
      ? {
          ...item,
          progressMemo: latest.progressMemo ?? "",
          imageUrl: latest.imageUrl ?? null
        }
      : item;
  });
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

function getShotsSyncDiagnostic(error: unknown) {
  if (error instanceof ProgressShotsSyncError) {
    return {
      step: error.step,
      errorCode: error.code,
      errorMessage: error.message,
      details: error.details,
      hint: error.hint
    };
  }
  return {
    step: "unknown",
    errorCode: "UNKNOWN",
    errorMessage: safeDiagnosticValue(error instanceof Error ? error.message : error, "컷 진행 데이터를 동기화하지 못했습니다."),
    details: "",
    hint: ""
  };
}

function safeDiagnosticValue(value: unknown, fallback = "") {
  return String(value ?? fallback).replace(/[\r\n]+/g, " ").slice(0, 500);
}

import { NextRequest, NextResponse } from "next/server";
import { dailyPlanFromRow, normalizeDailyPlanMealTimes } from "@/lib/data/mappers";
import {
  createGatheringPointId,
  normalizeGatheringLocationName,
  reconcileDailyPlanGatheringPoints
} from "@/lib/dailyPlan/gatheringPoints";
import {
  decodeDailyPlanMemo,
  encodeDailyPlanMemo,
  normalizeDailyPlanPrintMeta
} from "@/lib/dailyPlan/printMeta";
import { getAccessGrant, ProjectAccessUnavailableError, requireProjectAccessDb } from "@/lib/projectAccess/server";
import {
  createProjectDeleteReceipt,
  ProjectDeleteReceiptError,
  verifyProjectDeleteReceipt
} from "@/lib/projectDeleteReceipt.server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { applyProgressOrderToTimetableScenes } from "@/lib/progress/shootingOrderMutation";
import type { DailyPlanLocation } from "@/lib/types";

type DailyPlanPatchBody = {
  scheduleItem?: {
    id?: unknown;
    progressMemo?: unknown;
    imageUrl?: unknown;
    expectedUpdatedAt?: unknown;
  };
  gatheringAddress?: {
    gatheringPointId?: unknown;
    locationId?: unknown;
    locationName?: unknown;
    departmentIds?: unknown;
    address?: unknown;
    expectedUpdatedAt?: unknown;
  };
  sceneDuration?: {
    rowId?: unknown;
    runtimeMinutes?: unknown;
    expectedUpdatedAt?: unknown;
  };
  shootingOrder?: {
    shotIds?: unknown;
    expectedUpdatedAt?: unknown;
  };
};

const PROGRESS_DAILY_PLAN_COLUMNS = "id,project_id,title,source_type,source_file_name,shooting_date,episode,call_time,meeting_location,shooting_locations,meal_times,memo,created_at,updated_at";
const DAILY_PLAN_DELETE_RECEIPT_KIND = "daily-plan-round";
const MAX_DAILY_PLAN_DELETE_CHILD_ROWS = 2_000;
const DAILY_PLAN_RELATION_RESTORE_BATCH_SIZE = 100;
const DAILY_PLAN_DELETE_CAS_BATCH_SIZE = 50;
const DAILY_PLAN_STORAGE_SCAN_PAGE_SIZE = 500;
const MAX_DAILY_PLAN_STORAGE_SCAN_ROWS = 20_000;
const STORAGE_DELETE_BATCH_SIZE = 100;
const STORAGE_BUCKET = "storyboards";

type DatabaseRow = Record<string, unknown>;
type DeletedDailyPlanReceiptPayload = {
  plan: DatabaseRow;
  dailyPlanShots: DatabaseRow[];
  dailyPlanStaffMembers: DatabaseRow[];
  progressShotIds: string[];
};

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  try {
    const { projectId: routeProjectId, dailyPlanId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if (!isValidDatabaseProjectId(dailyPlanId)) return NextResponse.json({ error: "일촬표 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
    const supabase = requireProjectAccessDb();
    if (request.nextUrl.searchParams.get("progress") === "1") {
      const { data: plan, error } = await supabase
        .from("daily_plans")
        .select(PROGRESS_DAILY_PLAN_COLUMNS)
        .eq("project_id", projectId)
        .eq("id", dailyPlanId)
        .maybeSingle();
      if (error) throw error;
      if (!plan) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });
      return NextResponse.json({ plan });
    }
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

/** 진행도 화면의 독립적인 명시적 저장 작업만 처리합니다. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  let failureMessage = "일촬표 정보를 저장하지 못했습니다.";
  try {
    const { projectId: routeProjectId, dailyPlanId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if (!isValidDatabaseProjectId(dailyPlanId)) return NextResponse.json({ error: "일촬표 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") {
      return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    }
    const body = (await request.json()) as DailyPlanPatchBody;
    const actionCount = [body.scheduleItem, body.gatheringAddress, body.sceneDuration, body.shootingOrder]
      .filter((value) => value !== undefined).length;
    if (actionCount !== 1) {
      return NextResponse.json({ error: "한 번에 하나의 일촬표 정보만 저장할 수 있습니다." }, { status: 400 });
    }
    const supabase = requireProjectAccessDb();

    if (body.shootingOrder) {
      failureMessage = "촬영 순서를 저장하지 못했습니다.";
      const expectedUpdatedAt = requireExpectedUpdatedAt(body.shootingOrder.expectedUpdatedAt);
      const shotIds = normalizeShotIdOrder(body.shootingOrder.shotIds);
      const [{ data: planRow, error: planError }, { data: shotRows, error: shotsError }] = await Promise.all([
        supabase
          .from("daily_plans")
          .select("memo,updated_at")
          .eq("project_id", projectId)
          .eq("id", dailyPlanId)
          .maybeSingle(),
        supabase
          .from("shots")
          .select("id,scene_number,cut_number")
          .eq("project_id", projectId)
          .eq("daily_plan_id", dailyPlanId)
      ]);
      if (planError) throw planError;
      if (shotsError) throw shotsError;
      if (!planRow) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });
      if (String(planRow.updated_at ?? "") !== expectedUpdatedAt) {
        return NextResponse.json({
          error: "일촬표가 다른 화면에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.",
          latestUpdatedAt: String(planRow.updated_at ?? "") || null
        }, { status: 409 });
      }
      const rows = (shotRows ?? []) as Array<Record<string, unknown>>;
      const rowById = new Map(rows.map((row) => [String(row.id ?? "").trim(), row]));
      if (shotIds.length !== rows.length || shotIds.some((id) => !rowById.has(id))) {
        return NextResponse.json({ error: "현재 회차의 컷 순서가 올바르지 않습니다." }, { status: 409 });
      }
      const meta = decodeDailyPlanMemo(String(planRow.memo ?? ""));
      const timetableScenes = applyProgressOrderToTimetableScenes(
        meta.timetableScenes,
        shotIds.map((id) => {
          const row = rowById.get(id)!;
          return { id, sceneNumber: row.scene_number, cutNumber: row.cut_number };
        })
      );
      const memo = encodeDailyPlanMemo(normalizeDailyPlanPrintMeta({ ...meta, timetableScenes }));
      const saved = await saveDailyPlanPatchWithCas({
        supabase,
        projectId,
        dailyPlanId,
        expectedUpdatedAt,
        values: { memo },
        columns: "memo,updated_at"
      });
      return NextResponse.json({
        memo: String(saved.memo ?? ""),
        updatedAt: String(saved.updated_at ?? "")
      });
    }

    if (body.scheduleItem) {
      failureMessage = "기타일정 정보를 저장하지 못했습니다.";
      const itemId = String(body.scheduleItem.id ?? "").trim();
      if (!itemId) return NextResponse.json({ error: "수정할 기타일정 정보가 없습니다." }, { status: 400 });
      const expectedUpdatedAt = String(body.scheduleItem.expectedUpdatedAt ?? "").trim();
      if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
        return NextResponse.json({ error: "기타일정 버전 정보가 올바르지 않습니다." }, { status: 400 });
      }
      const { data: plan, error: selectError } = await supabase
        .from("daily_plans")
        .select("meal_times,updated_at")
        .eq("project_id", projectId)
        .eq("id", dailyPlanId)
        .maybeSingle();
      if (selectError) throw selectError;
      if (!plan) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });

      if (String(plan.updated_at ?? "") !== expectedUpdatedAt) {
        return NextResponse.json({
          error: "기타일정이 다른 화면에서 변경되었습니다. 최신 값에 다시 적용합니다.",
          mealTimes: normalizeDailyPlanMealTimes(plan.meal_times),
          latestUpdatedAt: String(plan.updated_at ?? "") || null
        }, { status: 409 });
      }

      const mealTimes = normalizeDailyPlanMealTimes(plan.meal_times);
      if (!mealTimes.some((item) => item.id === itemId)) {
        return NextResponse.json({ error: "기타일정을 찾을 수 없습니다." }, { status: 404 });
      }
      const hasProgressMemo = Object.prototype.hasOwnProperty.call(body.scheduleItem, "progressMemo");
      const hasImageUrl = Object.prototype.hasOwnProperty.call(body.scheduleItem, "imageUrl");
      if (!hasProgressMemo && !hasImageUrl) {
        return NextResponse.json({ error: "수정할 기타일정 정보가 없습니다." }, { status: 400 });
      }
      const nextMealTimes = mealTimes.map((item) => (
        item.id === itemId
          ? {
              ...item,
              ...(hasProgressMemo
                ? { progressMemo: String(body.scheduleItem!.progressMemo ?? "").slice(0, 2000) }
                : {}),
              ...(hasImageUrl
                ? {
                    imageUrl: (() => {
                      const raw = String(body.scheduleItem!.imageUrl ?? "").trim();
                      return raw ? raw.slice(0, 4000) : null;
                    })()
                  }
                : {})
            }
          : item
      ));

      const { data: savedPlan, error: updateError } = await supabase
        .from("daily_plans")
        .update({ meal_times: nextMealTimes })
        .eq("project_id", projectId)
        .eq("id", dailyPlanId)
        .eq("updated_at", expectedUpdatedAt)
        .select("meal_times,updated_at")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!savedPlan) {
        const { data: latest, error: latestError } = await supabase
          .from("daily_plans")
          .select("meal_times,updated_at")
          .eq("project_id", projectId)
          .eq("id", dailyPlanId)
          .maybeSingle();
        if (latestError) throw latestError;
        return NextResponse.json({
          error: "기타일정이 다른 화면에서 변경되었습니다. 최신 값에 다시 적용합니다.",
          mealTimes: normalizeDailyPlanMealTimes(latest?.meal_times),
          latestUpdatedAt: String(latest?.updated_at ?? "") || null
        }, { status: 409 });
      }
      return NextResponse.json({
        mealTimes: normalizeDailyPlanMealTimes(savedPlan.meal_times),
        updatedAt: String(savedPlan.updated_at ?? "")
      });
    }

    const planResult = body.gatheringAddress
      ? await supabase
        .from("daily_plans")
        .select("shooting_locations,memo,updated_at")
        .eq("project_id", projectId)
        .eq("id", dailyPlanId)
        .maybeSingle()
      : await supabase
        .from("daily_plans")
        .select("memo,updated_at")
        .eq("project_id", projectId)
        .eq("id", dailyPlanId)
        .maybeSingle();
    const { data: planRow, error: selectError } = planResult;
    if (selectError) throw selectError;
    if (!planRow) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });

    if (body.gatheringAddress) {
      failureMessage = "집합장소 주소를 저장하지 못했습니다.";
      const result = buildGatheringAddressUpdate(planRow, body.gatheringAddress);
      const saved = await saveDailyPlanPatchWithCas({
        supabase,
        projectId,
        dailyPlanId,
        expectedUpdatedAt: result.expectedUpdatedAt,
        values: {
          shooting_locations: result.shootingLocations,
          memo: result.memo
        },
        columns: "shooting_locations,memo,updated_at"
      });
      const savedPlan = dailyPlanFromRow({ ...planRow, ...saved });
      return NextResponse.json({
        memo: savedPlan.memo,
        shootingLocations: savedPlan.shootingLocations,
        updatedAt: savedPlan.updatedAt,
        gatheringPointId: result.gatheringPointId
      });
    }

    failureMessage = "씬 예정 소요시간을 저장하지 못했습니다.";
    const result = buildSceneDurationUpdate(planRow, body.sceneDuration!);
    const saved = await saveDailyPlanPatchWithCas({
      supabase,
      projectId,
      dailyPlanId,
      expectedUpdatedAt: result.expectedUpdatedAt,
      values: { memo: result.memo },
      columns: "memo,updated_at"
    });
    return NextResponse.json({
      memo: String(saved.memo ?? ""),
      updatedAt: String(saved.updated_at ?? ""),
      rowId: result.rowId,
      runtimeMinutes: result.runtimeMinutes
    });
  } catch (error) {
    return dailyPlanPatchError(error, failureMessage);
  }
}

function buildGatheringAddressUpdate(
  planRow: Record<string, unknown>,
  input: NonNullable<DailyPlanPatchBody["gatheringAddress"]>
) {
  const expectedUpdatedAt = requireExpectedUpdatedAt(input.expectedUpdatedAt);
  const address = cleanBoundedText(input.address, 1000, "집합장소 주소는 1000자 이내로 입력해주세요.");
  const requestedPointId = cleanOptionalReferenceId(input.gatheringPointId, "집합장소 ID가 올바르지 않습니다.");
  const requestedLocationId = cleanOptionalReferenceId(input.locationId, "위치 ID가 올바르지 않습니다.");
  const requestedDepartmentIds = cleanReferenceIdArray(input.departmentIds);
  const rawLocationName = String(input.locationName ?? "").trim();
  if (rawLocationName.length > 500) throw createRouteError("집합장소 이름은 500자 이내로 입력해주세요.", 400);
  const locationName = normalizeGatheringLocationName(rawLocationName);
  const plan = dailyPlanFromRow(planRow);
  const location = requestedLocationId
    ? plan.shootingLocations.find((item) => item.id === requestedLocationId) ?? null
    : null;
  if (requestedLocationId && !location) throw createRouteError("집합장소 위치 정보를 찾을 수 없습니다.", 404);

  let meta = reconcileDailyPlanGatheringPoints(decodeDailyPlanMemo(plan.memo), plan.shootingLocations);
  if (requestedDepartmentIds.some((id) => !meta.teams.some((team) => team.id === id))) {
    throw createRouteError("집합장소와 연결된 부서 정보를 찾을 수 없습니다.", 404);
  }
  let point = resolveGatheringPointForMutation(meta, {
    requestedPointId,
    requestedLocationId,
    requestedDepartmentIds,
    locationName
  });
  if (requestedPointId && !point) throw createRouteError("집합장소 정보를 찾을 수 없습니다.", 404);
  if (point?.locationId && requestedLocationId && point.locationId !== requestedLocationId) {
    throw createRouteError("집합장소와 위치 정보가 일치하지 않습니다.", 400);
  }

  const pointId = point?.id ?? createGatheringPointId();
  if (!point) {
    if (!locationName) throw createRouteError("집합장소 이름이 없습니다.", 400);
    meta = ensureGatheringPointForMutation(meta, {
      pointId,
      requestedLocationId,
      requestedDepartmentIds,
      locationName,
      address
    }, plan.shootingLocations);
    point = meta.gatheringPoints.find((item) => item.id === pointId) ?? null;
  }
  if (!point) throw createRouteError("집합장소 정보를 만들지 못했습니다.", 500);

  const effectiveLocationId = requestedLocationId || point.locationId || "";
  const shootingLocations = plan.shootingLocations.map((item) => (
    item.id === effectiveLocationId
      ? { ...item, inputMode: "manual" as const, manualAddress: address }
      : item
  ));
  meta = reconcileDailyPlanGatheringPoints(meta, shootingLocations);
  if (!meta.gatheringPoints.some((item) => item.id === pointId)) {
    meta = ensureGatheringPointForMutation(meta, {
      pointId,
      requestedLocationId: effectiveLocationId,
      requestedDepartmentIds,
      locationName: locationName || point.locationName,
      address
    }, shootingLocations);
  }
  meta = normalizeDailyPlanPrintMeta({
    ...meta,
    gatheringPoints: meta.gatheringPoints.map((item) => (
      item.id === pointId ? { ...item, address: address || undefined } : item
    ))
  });

  return {
    expectedUpdatedAt,
    gatheringPointId: pointId,
    shootingLocations,
    memo: encodeDailyPlanMemo(meta)
  };
}

function normalizeShotIdOrder(value: unknown) {
  if (!Array.isArray(value) || value.length > 2_000) {
    throw createRouteError("현재 회차의 컷 순서가 올바르지 않습니다.", 400);
  }
  const ids = value.map((item) => String(item ?? "").trim());
  if (ids.some((id) => !isValidDatabaseProjectId(id)) || new Set(ids).size !== ids.length) {
    throw createRouteError("현재 회차의 컷 순서가 올바르지 않습니다.", 400);
  }
  return ids;
}

function buildSceneDurationUpdate(
  planRow: Record<string, unknown>,
  input: NonNullable<DailyPlanPatchBody["sceneDuration"]>
) {
  const expectedUpdatedAt = requireExpectedUpdatedAt(input.expectedUpdatedAt);
  const rowId = cleanOptionalReferenceId(input.rowId, "씬 촬영 행 ID가 올바르지 않습니다.");
  if (!rowId) throw createRouteError("수정할 씬 촬영 행 정보가 없습니다.", 400);
  const runtimeMinutes = input.runtimeMinutes === null
    ? null
    : typeof input.runtimeMinutes === "number"
      ? input.runtimeMinutes
      : Number.NaN;
  if (runtimeMinutes !== null && (
    !Number.isInteger(runtimeMinutes)
    || runtimeMinutes < 0
    || runtimeMinutes > 1440
  )) {
    throw createRouteError("예정 소요시간은 0~1440분 사이의 정수로 입력해주세요.", 400);
  }

  const meta = decodeDailyPlanMemo(String(planRow.memo ?? ""));
  if (!meta.timetableScenes.some((scene) => scene.rowId === rowId)) {
    throw createRouteError("씬 촬영 행을 찾을 수 없습니다.", 404);
  }
  const nextMeta = normalizeDailyPlanPrintMeta({
    ...meta,
    timetableScenes: meta.timetableScenes.map((scene) => (
      scene.rowId === rowId
        ? {
            ...scene,
            rowSnapshot: {
              ...scene.rowSnapshot,
              runtimeMinutes,
              runtime: formatRuntimeMinutes(runtimeMinutes)
            }
          }
        : scene
    ))
  });
  return {
    expectedUpdatedAt,
    rowId,
    runtimeMinutes,
    memo: encodeDailyPlanMemo(nextMeta)
  };
}

async function saveDailyPlanPatchWithCas(input: {
  supabase: ReturnType<typeof requireProjectAccessDb>;
  projectId: string;
  dailyPlanId: string;
  expectedUpdatedAt: string;
  values: Record<string, unknown>;
  columns: string;
}) {
  const { data, error } = await input.supabase
    .from("daily_plans")
    .update(input.values)
    .eq("project_id", input.projectId)
    .eq("id", input.dailyPlanId)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(input.columns)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: latest, error: latestError } = await input.supabase
      .from("daily_plans")
      .select("updated_at")
      .eq("project_id", input.projectId)
      .eq("id", input.dailyPlanId)
      .maybeSingle();
    if (latestError) throw latestError;
    throw Object.assign(createRouteError(
      "일촬표가 다른 화면에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.",
      409
    ), { latestUpdatedAt: String(latest?.updated_at ?? "") || null });
  }
  return data as unknown as Record<string, unknown>;
}

function resolveGatheringPointForMutation(
  meta: ReturnType<typeof decodeDailyPlanMemo>,
  input: {
    requestedPointId: string;
    requestedLocationId: string;
    requestedDepartmentIds: string[];
    locationName: string;
  }
) {
  if (input.requestedPointId) {
    return meta.gatheringPoints.find((point) => point.id === input.requestedPointId) ?? null;
  }
  if (input.requestedDepartmentIds.length > 0) {
    const departmentMatch = meta.gatheringPoints.find((point) => (
      input.requestedDepartmentIds.some((id) => point.departmentIds.includes(id))
    ));
    if (departmentMatch) return departmentMatch;
  }
  if (input.requestedLocationId) {
    const locationMatch = meta.gatheringPoints.find((point) => point.locationId === input.requestedLocationId);
    if (locationMatch) return locationMatch;
  }
  const normalizedName = normalizeGatheringLocationName(input.locationName).toLocaleLowerCase("ko-KR");
  if (!normalizedName) return null;
  return meta.gatheringPoints.find((point) => (
    normalizeGatheringLocationName(point.locationName).toLocaleLowerCase("ko-KR") === normalizedName
  )) ?? null;
}

function ensureGatheringPointForMutation(
  meta: ReturnType<typeof decodeDailyPlanMemo>,
  input: {
    pointId: string;
    requestedLocationId: string;
    requestedDepartmentIds: string[];
    locationName: string;
    address: string;
  },
  locations: DailyPlanLocation[]
) {
  const normalizedName = normalizeGatheringLocationName(input.locationName);
  const matchingTeams = meta.teams.filter((team) => (
    input.requestedDepartmentIds.includes(team.id)
    || Boolean(input.requestedLocationId && team.callLocationId === input.requestedLocationId)
    || Boolean(normalizedName && normalizeGatheringLocationName(team.callLocation) === normalizedName)
  ));
  const departmentIds = matchingTeams.map((team) => team.id);
  const seeded = normalizeDailyPlanPrintMeta({
    ...meta,
    teams: meta.teams.map((team) => (
      departmentIds.includes(team.id) ? { ...team, gatheringPointId: input.pointId } : team
    )),
    gatheringPoints: [
      ...meta.gatheringPoints.filter((point) => point.id !== input.pointId),
      {
        id: input.pointId,
        locationName: normalizedName,
        locationId: input.requestedLocationId || undefined,
        address: input.address || undefined,
        departmentIds,
        departmentTimes: matchingTeams.map((team) => ({
          departmentId: team.id,
          time: String(team.callTime ?? "").trim()
        })),
        photos: []
      }
    ]
  });
  const reconciled = reconcileDailyPlanGatheringPoints(seeded, locations);
  if (reconciled.gatheringPoints.some((point) => point.id === input.pointId)) return reconciled;
  const orphan = seeded.gatheringPoints.find((point) => point.id === input.pointId);
  return orphan
    ? normalizeDailyPlanPrintMeta({
        ...reconciled,
        gatheringPoints: [...reconciled.gatheringPoints, orphan]
      })
    : reconciled;
}

function requireExpectedUpdatedAt(value: unknown) {
  const expectedUpdatedAt = String(value ?? "").trim();
  if (!expectedUpdatedAt || expectedUpdatedAt.length > 100) {
    throw createRouteError("최신 일촬표 저장 시각이 필요합니다.", 400);
  }
  return expectedUpdatedAt;
}

function cleanBoundedText(value: unknown, maxLength: number, message: string) {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) throw createRouteError(message, 400);
  return text;
}

function cleanOptionalReferenceId(value: unknown, message: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length > 180 || /[\u0000-\u001f\u007f]/.test(raw)) throw createRouteError(message, 400);
  return raw;
}

function cleanReferenceIdArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  const ids = value.map((item) => cleanOptionalReferenceId(item, "부서 ID가 올바르지 않습니다.")).filter(Boolean);
  return [...new Set(ids)].slice(0, 200);
}

function formatRuntimeMinutes(value: number | null) {
  if (value === null) return "";
  if (value === 0) return "0M";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (minutes === 0) return `${hours}H`;
  if (hours === 0) return `${minutes}M`;
  return `${hours}H${minutes}M`;
}

function createRouteError(message: string, status: number) {
  return Object.assign(new Error(message), { status, safe: true });
}

function dailyPlanPatchError(error: unknown, fallbackMessage: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: fallbackMessage }, { status: 503 });
  }
  const value = error && typeof error === "object"
    ? error as { message?: unknown; status?: unknown; safe?: unknown; latestUpdatedAt?: unknown }
    : null;
  const isSafe = value?.safe === true;
  const status = isSafe && typeof value?.status === "number" ? value.status : 500;
  const message = typeof value?.message === "string" ? value.message : "";
  if (status >= 500) console.error("[daily-plan:patch]", error);
  return NextResponse.json(
    {
      error: isSafe ? message : fallbackMessage,
      ...(status === 409 && typeof value?.latestUpdatedAt === "string"
        ? { latestUpdatedAt: value.latestUpdatedAt }
        : {})
    },
    { status }
  );
}

/** 삭제 영수증으로 원래 ID의 회차와 cascade child를 canonical하게 복원합니다. */
export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  let failureMessage = "일촬표를 복원하지 못했습니다.";
  try {
    const { projectId: routeProjectId, dailyPlanId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId) || !isValidDatabaseProjectId(dailyPlanId)) {
      return NextResponse.json({ error: "프로젝트 또는 일촬표 ID가 올바르지 않습니다." }, { status: 400 });
    }
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") {
      return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    }
    const body = (await request.json()) as { operation?: unknown; receipt?: unknown };
    if (body.operation !== "restore_deleted" && body.operation !== "finalize_deleted") {
      return NextResponse.json({ error: "지원하지 않는 일촬표 복원 작업입니다." }, { status: 400 });
    }
    const snapshot = readDeletedDailyPlanReceipt(projectId, dailyPlanId, body.receipt);
    const supabase = requireProjectAccessDb();
    if (body.operation === "finalize_deleted") {
      failureMessage = "일촬표 삭제를 확정하지 못했습니다.";
      const finalizedPaths = await finalizeDeletedDailyPlanStorage(
        supabase,
        projectId,
        dailyPlanId,
        snapshot.plan
      );
      return NextResponse.json({ success: true, finalized: true, finalizedPaths });
    }

    const { error: planError } = await supabase
      .from("daily_plans")
      .upsert([snapshot.plan], { onConflict: "id", ignoreDuplicates: true });
    if (planError) throw planError;
    await restoreDailyPlanChildRows(supabase, "daily_plan_shots", snapshot.dailyPlanShots);
    await restoreDailyPlanChildRows(supabase, "daily_plan_staff_members", snapshot.dailyPlanStaffMembers);
    if (snapshot.progressShotIds.length > 0) {
      // Deleting the plan sets this FK to NULL. Do not steal a cut that another
      // editor deliberately attached to a different round while it was absent.
      for (let start = 0; start < snapshot.progressShotIds.length; start += DAILY_PLAN_RELATION_RESTORE_BATCH_SIZE) {
        const { error: relationError } = await supabase
          .from("shots")
          .update({ daily_plan_id: dailyPlanId })
          .eq("project_id", projectId)
          .in("id", snapshot.progressShotIds.slice(start, start + DAILY_PLAN_RELATION_RESTORE_BATCH_SIZE))
          .is("daily_plan_id", null);
        if (relationError) throw relationError;
      }
    }
    return NextResponse.json({
      success: true,
      restoredDailyPlanId: dailyPlanId,
      restoredShotIds: snapshot.dailyPlanShots.map((row) => String(row.id))
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof ProjectDeleteReceiptError ? error.message : failureMessage },
      { status: error instanceof ProjectDeleteReceiptError ? 400 : error instanceof ProjectAccessUnavailableError ? 503 : 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  try {
    const { projectId: routeProjectId, dailyPlanId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId) || !isValidDatabaseProjectId(dailyPlanId)) {
      return NextResponse.json({ error: "프로젝트 또는 일촬표 ID가 올바르지 않습니다." }, { status: 400 });
    }
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    const supabase = requireProjectAccessDb();
    const [planResult, shotResult, progressShotResult] = await Promise.all([
      supabase.from("daily_plans").select("*").eq("project_id", projectId).eq("id", dailyPlanId).maybeSingle(),
      supabase.from("daily_plan_shots").select("*").eq("project_id", projectId).eq("daily_plan_id", dailyPlanId).order("order_index").order("created_at"),
      supabase.from("shots").select("id").eq("project_id", projectId).eq("daily_plan_id", dailyPlanId)
    ]);
    if (planResult.error) throw planResult.error;
    if (shotResult.error) throw shotResult.error;
    if (progressShotResult.error) throw progressShotResult.error;
    if (!planResult.data) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });

    const staffResult = await supabase
      .from("daily_plan_staff_members")
      .select("*")
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId)
      .order("sort_order")
      .order("created_at");
    if (staffResult.error && !isMissingDailyPlanStaffTableError(staffResult.error)) throw staffResult.error;
    if (
      (shotResult.data ?? []).length > MAX_DAILY_PLAN_DELETE_CHILD_ROWS
      || (staffResult.data ?? []).length > MAX_DAILY_PLAN_DELETE_CHILD_ROWS
      || (progressShotResult.data ?? []).length > MAX_DAILY_PLAN_DELETE_CHILD_ROWS
    ) {
      return NextResponse.json({ error: "복원 정보를 안전하게 만들 수 있는 회차 크기를 초과했습니다." }, { status: 413 });
    }
    const receipt = createProjectDeleteReceipt({
      projectId,
      kind: DAILY_PLAN_DELETE_RECEIPT_KIND,
      payload: {
        plan: planResult.data,
        dailyPlanShots: shotResult.data ?? [],
        dailyPlanStaffMembers: staffResult.error ? [] : staffResult.data ?? [],
        progressShotIds: (progressShotResult.data ?? []).map((row) => String(row.id))
      } satisfies DeletedDailyPlanReceiptPayload
    });

    const dailyPlanShotRows = (shotResult.data ?? []) as DatabaseRow[];
    const staffRows = (staffResult.error ? [] : staffResult.data ?? []) as DatabaseRow[];
    const deletedShotRows = await deleteDailyPlanChildRowsWithVersions(
      supabase,
      "daily_plan_shots",
      projectId,
      dailyPlanId,
      dailyPlanShotRows
    );
    if (deletedShotRows.error || deletedShotRows.rows.length !== dailyPlanShotRows.length) {
      await restoreDailyPlanChildRows(supabase, "daily_plan_shots", deletedShotRows.rows);
      if (deletedShotRows.error) throw deletedShotRows.error;
      return dailyPlanDeleteConflictResponse();
    }
    const deletedStaffRows = await deleteDailyPlanChildRowsWithVersions(
      supabase,
      "daily_plan_staff_members",
      projectId,
      dailyPlanId,
      staffRows
    );
    if (deletedStaffRows.error || deletedStaffRows.rows.length !== staffRows.length) {
      await restoreDailyPlanChildRows(supabase, "daily_plan_shots", dailyPlanShotRows);
      await restoreDailyPlanChildRows(supabase, "daily_plan_staff_members", deletedStaffRows.rows);
      if (deletedStaffRows.error) throw deletedStaffRows.error;
      return dailyPlanDeleteConflictResponse();
    }

    // Do not cascade rows or detach progress shots created/reassigned after the
    // receipt snapshot. This closes the practical non-transactional race while
    // preserving all unrelated progress-shot edits.
    const [remainingShotResult, remainingStaffResult, remainingProgressResult] = await Promise.all([
      supabase
        .from("daily_plan_shots")
        .select("id")
        .eq("project_id", projectId)
        .eq("daily_plan_id", dailyPlanId)
        .limit(1),
      supabase
        .from("daily_plan_staff_members")
        .select("id")
        .eq("project_id", projectId)
        .eq("daily_plan_id", dailyPlanId)
        .limit(1),
      supabase
        .from("shots")
        .select("id")
        .eq("project_id", projectId)
        .eq("daily_plan_id", dailyPlanId)
    ]);
    const remainingStaffError = remainingStaffResult.error
      && !isMissingDailyPlanStaffTableError(remainingStaffResult.error)
      ? remainingStaffResult.error
      : null;
    if (remainingShotResult.error || remainingStaffError || remainingProgressResult.error) {
      await restoreDailyPlanChildRows(supabase, "daily_plan_shots", dailyPlanShotRows);
      await restoreDailyPlanChildRows(supabase, "daily_plan_staff_members", staffRows);
      throw remainingShotResult.error ?? remainingStaffError ?? remainingProgressResult.error;
    }
    const expectedProgressIds = new Set((progressShotResult.data ?? []).map((row) => String(row.id)));
    const currentProgressIds = new Set((remainingProgressResult.data ?? []).map((row) => String(row.id)));
    const progressRelationChanged = expectedProgressIds.size !== currentProgressIds.size
      || [...expectedProgressIds].some((id) => !currentProgressIds.has(id));
    if (
      (remainingShotResult.data ?? []).length > 0
      || (!remainingStaffResult.error && (remainingStaffResult.data ?? []).length > 0)
      || progressRelationChanged
    ) {
      await restoreDailyPlanChildRows(supabase, "daily_plan_shots", dailyPlanShotRows);
      await restoreDailyPlanChildRows(supabase, "daily_plan_staff_members", staffRows);
      return dailyPlanDeleteConflictResponse();
    }

    const { data: deleted, error: deleteError } = await supabase
      .from("daily_plans")
      .delete()
      .eq("project_id", projectId)
      .eq("id", dailyPlanId)
      .eq("updated_at", planResult.data.updated_at)
      .select("id")
      .maybeSingle();
    if (deleteError) {
      await restoreDailyPlanChildRows(supabase, "daily_plan_shots", dailyPlanShotRows);
      await restoreDailyPlanChildRows(supabase, "daily_plan_staff_members", staffRows);
      throw deleteError;
    }
    if (!deleted) {
      await restoreDailyPlanChildRows(supabase, "daily_plan_shots", dailyPlanShotRows);
      await restoreDailyPlanChildRows(supabase, "daily_plan_staff_members", staffRows);
      return dailyPlanDeleteConflictResponse();
    }
    return NextResponse.json({ success: true, deleted: true, receipt });
  } catch (error) {
    return NextResponse.json({ error: "일촬표를 삭제하지 못했습니다." }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

async function deleteDailyPlanChildRowsWithVersions(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  table: "daily_plan_shots" | "daily_plan_staff_members",
  projectId: string,
  dailyPlanId: string,
  rows: DatabaseRow[]
) {
  const deletedRows: DatabaseRow[] = [];
  for (let start = 0; start < rows.length; start += DAILY_PLAN_DELETE_CAS_BATCH_SIZE) {
    const batch = rows.slice(start, start + DAILY_PLAN_DELETE_CAS_BATCH_SIZE);
    const versionFilter = batch.map((row) => (
      `and(id.eq.${String(row.id)},updated_at.eq.${JSON.stringify(String(row.updated_at ?? ""))})`
    )).join(",");
    const { data, error } = await supabase
      .from(table)
      .delete()
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId)
      .in("id", batch.map((row) => String(row.id)))
      .or(versionFilter)
      .select("*");
    if (error) return { rows: deletedRows, error };
    deletedRows.push(...((data ?? []) as DatabaseRow[]));
    if ((data ?? []).length !== batch.length) break;
  }
  return { rows: deletedRows, error: null };
}

async function restoreDailyPlanChildRows(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  table: "daily_plan_shots" | "daily_plan_staff_members",
  rows: DatabaseRow[]
) {
  for (let start = 0; start < rows.length; start += DAILY_PLAN_DELETE_CAS_BATCH_SIZE) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(start, start + DAILY_PLAN_DELETE_CAS_BATCH_SIZE), {
        onConflict: "id",
        ignoreDuplicates: true
      });
    if (error && !(table === "daily_plan_staff_members" && isMissingDailyPlanStaffTableError(error))) {
      throw error;
    }
  }
}

function dailyPlanDeleteConflictResponse() {
  return NextResponse.json(
    { error: "일촬표가 다른 화면에서 변경되었습니다. 최신 내용을 확인해주세요." },
    { status: 409 }
  );
}

async function finalizeDeletedDailyPlanStorage(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  dailyPlanId: string,
  plan: DatabaseRow
) {
  const candidates = dailyPlanStorageReferences(plan, projectId, dailyPlanId, true);
  if (candidates.paths.size === 0) return 0;

  const liveReferences = { paths: new Set<string>(), urls: new Set<string>() };
  let scanned = 0;
  while (scanned < MAX_DAILY_PLAN_STORAGE_SCAN_ROWS) {
    const { data, error } = await supabase
      .from("daily_plans")
      .select("id,memo,meal_times")
      .eq("project_id", projectId)
      .order("id")
      .range(scanned, scanned + DAILY_PLAN_STORAGE_SCAN_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as DatabaseRow[];
    for (const row of rows) {
      const rowId = String(row.id ?? "");
      const references = dailyPlanStorageReferences(row, projectId, rowId, false);
      references.paths.forEach((path) => liveReferences.paths.add(path));
      references.urls.forEach((url) => liveReferences.urls.add(url));
    }
    scanned += rows.length;
    if (rows.length < DAILY_PLAN_STORAGE_SCAN_PAGE_SIZE) break;
  }
  if (scanned >= MAX_DAILY_PLAN_STORAGE_SCAN_ROWS) {
    throw new Error("프로젝트 파일 참조 범위가 너무 커서 안전하게 정리할 수 없습니다.");
  }

  const removable = [...candidates.paths].filter((path) => (
    !liveReferences.paths.has(path)
    && ![...candidates.urlsByPath.get(path) ?? []].some((url) => liveReferences.urls.has(url))
  ));
  for (let start = 0; start < removable.length; start += STORAGE_DELETE_BATCH_SIZE) {
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(removable.slice(start, start + STORAGE_DELETE_BATCH_SIZE));
    if (error) throw error;
  }
  return removable.length;
}

function dailyPlanStorageReferences(
  plan: DatabaseRow,
  projectId: string,
  dailyPlanId: string,
  strictOwner: boolean
) {
  const paths = new Set<string>();
  const urls = new Set<string>();
  const urlsByPath = new Map<string, Set<string>>();
  const add = (pathValue: unknown, urlValue?: unknown, expectedPrefix?: string) => {
    const path = String(pathValue ?? "").trim();
    const url = String(urlValue ?? "").trim();
    if (url) urls.add(url);
    if (!path || path.includes("..") || (expectedPrefix && !path.startsWith(expectedPrefix))) return;
    paths.add(path);
    if (url) {
      const linked = urlsByPath.get(path) ?? new Set<string>();
      linked.add(url);
      urlsByPath.set(path, linked);
    }
  };

  const meta = decodeDailyPlanMemo(String(plan.memo ?? ""));
  for (const point of meta.gatheringPoints) {
    for (const photo of point.photos) {
      const expectedPrefix = strictOwner
        ? `projects/${projectId}/daily-plans/${dailyPlanId}/gathering-points/${point.id}/${photo.id}/`
        : undefined;
      add(photo.storagePath, photo.url, expectedPrefix);
      add(photo.thumbnailPath, photo.thumbnailUrl, expectedPrefix);
      add(storagePathFromPublicUrl(photo.url), photo.url, expectedPrefix);
      add(storagePathFromPublicUrl(photo.thumbnailUrl), photo.thumbnailUrl, expectedPrefix);
    }
  }
  for (const item of normalizeDailyPlanMealTimes(plan.meal_times)) {
    const imageUrl = String(item.imageUrl ?? "").trim();
    if (!imageUrl) continue;
    const path = storagePathFromPublicUrl(imageUrl);
    const expectedPrefix = strictOwner
      ? `storyboard-files/${projectId}/schedule-items/${safeStorageName(`${dailyPlanId}-${item.id}`)}/`
      : undefined;
    add(path, imageUrl, expectedPrefix);
  }
  return { paths, urls, urlsByPath };
}

function storagePathFromPublicUrl(value: unknown) {
  try {
    const pathname = new URL(String(value ?? "")).pathname;
    const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return "";
    return decodeURIComponent(pathname.slice(markerIndex + marker.length));
  } catch {
    return "";
  }
}

function safeStorageName(value: string) {
  return value.normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "storyboard-file";
}

function readDeletedDailyPlanReceipt(
  projectId: string,
  dailyPlanId: string,
  receipt: unknown
): DeletedDailyPlanReceiptPayload {
  const value = verifyProjectDeleteReceipt<unknown>(receipt, {
    projectId,
    kind: DAILY_PLAN_DELETE_RECEIPT_KIND
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectDeleteReceiptError();
  const payload = value as Partial<DeletedDailyPlanReceiptPayload>;
  if (
    !payload.plan
    || typeof payload.plan !== "object"
    || Array.isArray(payload.plan)
    || payload.plan.id !== dailyPlanId
    || payload.plan.project_id !== projectId
    || !Array.isArray(payload.dailyPlanShots)
    || !Array.isArray(payload.dailyPlanStaffMembers)
    || !Array.isArray(payload.progressShotIds)
    || payload.dailyPlanShots.length > MAX_DAILY_PLAN_DELETE_CHILD_ROWS
    || payload.dailyPlanStaffMembers.length > MAX_DAILY_PLAN_DELETE_CHILD_ROWS
    || payload.progressShotIds.length > MAX_DAILY_PLAN_DELETE_CHILD_ROWS
  ) {
    throw new ProjectDeleteReceiptError();
  }
  const validateChildRows = (rows: DatabaseRow[]) => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new ProjectDeleteReceiptError();
      const id = String(row.id ?? "").trim();
      if (
        !isValidDatabaseProjectId(id)
        || ids.has(id)
        || row.project_id !== projectId
        || row.daily_plan_id !== dailyPlanId
      ) {
        throw new ProjectDeleteReceiptError();
      }
      ids.add(id);
    }
  };
  validateChildRows(payload.dailyPlanShots);
  validateChildRows(payload.dailyPlanStaffMembers);
  const progressShotIds = payload.progressShotIds.map((id) => String(id ?? "").trim());
  if (
    progressShotIds.some((id) => !isValidDatabaseProjectId(id))
    || new Set(progressShotIds).size !== progressShotIds.length
  ) {
    throw new ProjectDeleteReceiptError();
  }
  return {
    plan: payload.plan,
    dailyPlanShots: payload.dailyPlanShots,
    dailyPlanStaffMembers: payload.dailyPlanStaffMembers,
    progressShotIds
  };
}

function isMissingDailyPlanStaffTableError(error: { code?: string; message?: string }) {
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("daily_plan_staff_members")
    && (message.includes("does not exist") || message.includes("could not find"));
}

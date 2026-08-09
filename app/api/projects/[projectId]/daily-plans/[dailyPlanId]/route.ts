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
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
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
};

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  try {
    const { projectId: routeProjectId, dailyPlanId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "프로젝트 접근 권한이 없습니다." }, { status: 401 });
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

/** 진행도 화면의 독립적인 명시적 저장 작업만 처리합니다. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string; dailyPlanId: string }> }) {
  let failureMessage = "일촬표 정보를 저장하지 못했습니다.";
  try {
    const { projectId: routeProjectId, dailyPlanId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const grant = await getAccessGrant(request, projectId);
    if (!grant || grant.role !== "admin") {
      return NextResponse.json({ error: "Key staff 권한이 필요합니다." }, { status: grant ? 403 : 401 });
    }
    const body = (await request.json()) as DailyPlanPatchBody;
    const actionCount = [body.scheduleItem, body.gatheringAddress, body.sceneDuration]
      .filter((value) => value !== undefined).length;
    if (actionCount !== 1) {
      return NextResponse.json({ error: "한 번에 하나의 일촬표 정보만 저장할 수 있습니다." }, { status: 400 });
    }
    const supabase = requireProjectAccessDb();

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

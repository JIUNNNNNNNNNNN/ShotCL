import {
  dailyPlanDraftToRow,
  dailyPlanFromRow,
  dailyPlanShotDraftToRow,
  dailyPlanShotFromRow,
  normalizeDailyPlanMealTimes,
  normalizeDailyPlanShotStatus
} from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import { AutosaveConflictError } from "@/lib/data/autosaveConflict";
import { buildProgressShotDrafts } from "@/lib/dailyPlan/progressShots";
import {
  getSplitShotAllocationSaveError,
  getSplitShootingOrderSaveError
} from "@/lib/dailyPlan/shootingOrder";
import { buildDailyPlanDuplicateDraft } from "@/lib/dailyPlan/duplicate";
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
import { isSameDailyPlanIdentity } from "@/lib/dailyPlan/identity";
import { isValidDatabaseProjectId } from "@/lib/projectId";
import { calculateDailyProgressByPlan } from "@/lib/progress/dailyProgress";
import { applyProgressOrderToTimetableScenes } from "@/lib/progress/shootingOrderMutation";
import type {
  DailyPlan,
  DailyPlanDraft,
  DailyPlanMealTime,
  DailyPlanLocation,
  DailyPlanShot,
  DailyPlanShotDraft,
  DailyPlanSourceType,
  DailyPlanWithShots,
  Project,
  ShotDraft
} from "@/lib/types";

export type SaveDailyPlanInput = {
  projectId: string;
  dailyPlanId?: string | null;
  expectedUpdatedAt?: string | null;
  plan: DailyPlanDraft;
  shots: DailyPlanShotDraft[];
  allowDuplicate?: boolean;
};

export type DailyPlanListItem = DailyPlan & {
  shotCount: number;
  progressTotal: number;
  progressCompleted: number;
  sceneNumbers: string[];
};

export type DeletedDailyPlanMutation = {
  receipt: string | null;
  fallback: DailyPlanWithShots | null;
  progressShotIds: string[];
};

const dailyPlanListRequests = new Map<string, Promise<DailyPlanListItem[]>>();
const dailyPlanListColumns = "id,project_id,title,source_type,source_file_name,shooting_date,episode,call_time,meeting_location,shooting_locations,meal_times,memo,created_at,updated_at";

async function loadFallbackSupabaseClient() {
  const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
  return getSupabaseBrowserClient();
}

export type UpdateDailyPlanGatheringAddressInput = {
  projectId: string;
  dailyPlanId: string;
  gatheringPointId: string | null;
  locationId: string | null;
  locationName: string;
  departmentIds: string[];
  address: string;
  expectedUpdatedAt: string;
};

export type DailyPlanGatheringAddressMutationResult = {
  memo: string;
  shootingLocations: DailyPlanLocation[];
  updatedAt: string;
  gatheringPointId: string;
};

export type UpdateDailyPlanSceneDurationInput = {
  projectId: string;
  dailyPlanId: string;
  rowId: string;
  runtimeMinutes: number | null;
  expectedUpdatedAt: string;
};

export type DailyPlanSceneDurationMutationResult = {
  memo: string;
  updatedAt: string;
  rowId: string;
  runtimeMinutes: number | null;
};

export type DailyPlanScheduleItemMutationResult = {
  mealTimes: DailyPlanMealTime[];
  updatedAt: string;
};

export type DailyPlanProgressOrderMutationResult = {
  memo: string;
  updatedAt: string;
};

export type SaveDailyPlanResult = DailyPlanWithShots & {
  saveStatus: "saved" | "duplicate";
  message: string;
  progressSyncStatus?: "synced" | "failed";
  progressShotCount?: number;
  progressSyncError?: string;
  progressSyncStep?: string;
  progressSyncErrorCode?: string;
};

export class DailyPlanDuplicateError extends Error {
  constructor(message = "이미 저장된 일촬표입니다.") {
    super(message);
    this.name = "DailyPlanDuplicateError";
  }
}

type SaveDailyPlanApiPayload = {
  ok?: boolean;
  status?: "saved" | "saved_shots_failed" | "duplicate" | "conflict" | "failed";
  message?: string;
  dailyPlan?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  shots?: Record<string, unknown>[];
  latestUpdatedAt?: string | null;
  progressSync?: {
    status?: "synced" | "failed";
    shotCount?: number;
    error?: string;
  };
  shotsSync?: {
    ok?: boolean;
    step?: string;
    projectIdPresent?: boolean;
    dailyPlanIdPresent?: boolean;
    targetShotCount?: number;
    errorCode?: string;
    errorMessage?: string;
    details?: string;
    hint?: string;
  };
  error?: string;
};

/** 새 일촬표 기본값을 프로젝트 정보로 채웁니다. */
export function createBlankDailyPlanDraft(project: Project | null, sourceType: DailyPlanSourceType = "web_editor", sourceFileName = ""): DailyPlanDraft {
  return {
    title: project?.name || "새 일촬표",
    sourceType,
    sourceFileName,
    shootingDate: project?.shootDate ?? "",
    episode: "",
    director: "",
    dop: "",
    assistantDirector: "",
    production: "",
    callTime: "",
    shootStartTime: "",
    shootEndTime: "",
    meetingLocation: "",
    shootingLocation: "",
    shootingLocations: [],
    mealTime: "",
    mealTimes: [],
    safetyNotice: "",
    memo: ""
  };
}

/** 표에 바로 보여줄 빈 컷 행을 만듭니다. */
export function createBlankDailyPlanShotDraft(orderIndex: number, sceneNumber = "1", cutNumber = String(orderIndex)): DailyPlanShotDraft {
  return {
    orderIndex,
    startTime: "",
    endTime: "",
    sceneNumber,
    sceneTitle: "",
    locationId: "",
    locationName: "",
    cutNumber,
    subject: "",
    subLocation: "",
    dayNight: "",
    liveSync: "",
    cutType: "",
    storyDay: "",
    description: "",
    props: "",
    costumeMakeup: "",
    sceneMemo: "",
    memo: "",
    status: "촬영 전"
  };
}

/** 빈 행은 저장과 출력에서 제외합니다. */
export function isMeaningfulDailyPlanShot(shot: DailyPlanShotDraft | DailyPlanShot) {
  const values = [
    shot.startTime,
    shot.endTime,
    shot.sceneNumber,
    shot.sceneTitle,
    shot.locationName,
    shot.cutNumber,
    shot.subject,
    shot.subLocation,
    shot.dayNight,
    shot.liveSync,
    shot.cutType,
    shot.storyDay,
    shot.description,
    shot.props,
    shot.costumeMakeup,
    shot.sceneMemo,
    shot.memo
  ];

  return values.some((value) => String(value ?? "").trim()) || normalizeDailyPlanShotStatus(shot.status) !== "촬영 전";
}

/** 저장 전 순서를 1부터 다시 정렬하고 빈 행을 제외합니다. */
export function normalizeDailyPlanShotDrafts(shots: DailyPlanShotDraft[]) {
  return shots
    .filter(isMeaningfulDailyPlanShot)
    .map((shot, index) => ({
      ...shot,
      orderIndex: index + 1,
      status: normalizeDailyPlanShotStatus(shot.status)
    }));
}

/** 프로젝트의 저장된 일촬표 목록을 최신순으로 가져옵니다. */
export function listDailyPlans(projectId: string): Promise<DailyPlanListItem[]> {
  const existingRequest = dailyPlanListRequests.get(projectId);
  if (existingRequest) return existingRequest;

  const request = loadDailyPlans(projectId);
  dailyPlanListRequests.set(projectId, request);
  const clearRequest = () => {
    if (dailyPlanListRequests.get(projectId) === request) dailyPlanListRequests.delete(projectId);
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

/** 삭제된 프로젝트의 완료 전 목록 요청이 이후 화면에 재사용되지 않게 합니다. */
export function clearDailyPlanReadCache(projectId: string) {
  dailyPlanListRequests.delete(projectId);
}

async function loadDailyPlans(projectId: string): Promise<DailyPlanListItem[]> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/daily-plans`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as {
        plans: Record<string, unknown>[];
        shotPlanIds: string[];
        dailyPlanShots?: Array<{ daily_plan_id?: unknown; scene_number?: unknown }>;
        progressShots?: Array<{ id?: unknown; daily_plan_id?: unknown; status?: unknown }>;
      };
      const counts = new Map<string, number>();
      payload.shotPlanIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
      const sceneNumbers = collectSceneNumbersByPlan(payload.dailyPlanShots ?? []);
      const progress = summarizeProgressRows(payload.progressShots ?? []);
      return payload.plans.map(dailyPlanFromRow).map((plan) => ({
        ...plan,
        shotCount: counts.get(plan.id) ?? 0,
        progressTotal: progress.get(plan.id)?.total ?? 0,
        progressCompleted: progress.get(plan.id)?.completed ?? 0,
        sceneNumbers: sceneNumbers.get(plan.id) ?? []
      }));
    }
    if (response.status === 403) throw new Error("Key staff 권한이 필요합니다.");
  } catch (error) {
    if (error instanceof Error && error.message === "Key staff 권한이 필요합니다.") throw error;
  }
  const supabase = await loadFallbackSupabaseClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("daily_plans")
      .select(dailyPlanListColumns)
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const plans = data.map(dailyPlanFromRow);
    const [
      { data: shotRows, error: shotError },
      { data: progressRows, error: progressError }
    ] = await Promise.all([
      supabase.from("daily_plan_shots").select("daily_plan_id,scene_number").eq("project_id", projectId),
      supabase.from("shots").select("id,daily_plan_id,status").eq("project_id", projectId)
    ]);
    if (shotError) throw shotError;
    if (progressError) throw progressError;

    const counts = new Map<string, number>();
    shotRows.forEach((row) => counts.set(row.daily_plan_id, (counts.get(row.daily_plan_id) ?? 0) + 1));
    const sceneNumbers = collectSceneNumbersByPlan(shotRows);
    const progress = summarizeProgressRows(progressRows ?? []);
    return plans.map((plan) => ({
      ...plan,
      shotCount: counts.get(plan.id) ?? 0,
      progressTotal: progress.get(plan.id)?.total ?? 0,
      progressCompleted: progress.get(plan.id)?.completed ?? 0,
      sceneNumbers: sceneNumbers.get(plan.id) ?? []
    }));
  }

  const { dailyPlans, dailyPlanShots, shots } = readLocalBuckets();
  const progress = summarizeProgressRows(
    shots
      .filter((shot) => shot.projectId === projectId)
      .map((shot) => ({
        id: shot.id,
        daily_plan_id: shot.dailyPlanId,
        status: shot.status
      }))
  );
  return dailyPlans
    .filter((plan) => plan.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((plan) => ({
      ...plan,
      shotCount: dailyPlanShots.filter((shot) => shot.dailyPlanId === plan.id).length,
      progressTotal: progress.get(plan.id)?.total ?? 0,
      progressCompleted: progress.get(plan.id)?.completed ?? 0,
      sceneNumbers: Array.from(new Set(
        dailyPlanShots
          .filter((shot) => shot.dailyPlanId === plan.id)
          .map((shot) => shot.sceneNumber.trim())
          .filter(Boolean)
      ))
    }));
}

function collectSceneNumbersByPlan(
  rows: Array<{ daily_plan_id?: unknown; scene_number?: unknown }>
) {
  const byPlan = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const dailyPlanId = String(row.daily_plan_id ?? "");
    const sceneNumber = String(row.scene_number ?? "").trim();
    if (!dailyPlanId || !sceneNumber) return;
    const values = byPlan.get(dailyPlanId) ?? new Set<string>();
    values.add(sceneNumber);
    byPlan.set(dailyPlanId, values);
  });
  return new Map([...byPlan].map(([dailyPlanId, values]) => [dailyPlanId, [...values]]));
}

function summarizeProgressRows(rows: Array<{ id?: unknown; daily_plan_id?: unknown; status?: unknown }>) {
  const progressByPlan = calculateDailyProgressByPlan(rows.map((row, index) => {
    const dailyPlanId = String(row.daily_plan_id ?? "").trim();
    return {
      id: String(row.id ?? `${dailyPlanId}:summary-row:${index}`),
      dailyPlanId,
      status: row.status
    };
  }));
  return new Map([...progressByPlan].map(([dailyPlanId, summary]) => [dailyPlanId, {
    total: summary.totalCutCount,
    completed: summary.processedCutCount
  }]));
}

/** 일촬표와 컷 행을 함께 가져옵니다. */
export async function getDailyPlanWithShots(projectId: string, dailyPlanId: string): Promise<DailyPlanWithShots | null> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { plan: Record<string, unknown>; shots: Record<string, unknown>[] };
      return { plan: dailyPlanFromRow(payload.plan), shots: payload.shots.map(dailyPlanShotFromRow) };
    }
    if (response.status === 403) throw new Error("Key staff 권한이 필요합니다.");
  } catch (error) {
    if (error instanceof Error && error.message === "Key staff 권한이 필요합니다.") throw error;
  }
  const supabase = await loadFallbackSupabaseClient();

  if (supabase) {
    const { data: planRow, error: planError } = await supabase
      .from("daily_plans")
      .select("*")
      .eq("project_id", projectId)
      .eq("id", dailyPlanId)
      .maybeSingle();

    if (planError) throw planError;
    if (!planRow) return null;

    const { data: shotRows, error: shotError } = await supabase
      .from("daily_plan_shots")
      .select("*")
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId)
      .order("order_index", { ascending: true });

    if (shotError) throw shotError;
    return { plan: dailyPlanFromRow(planRow), shots: shotRows.map(dailyPlanShotFromRow) };
  }

  const { dailyPlans, dailyPlanShots } = readLocalBuckets();
  const plan = dailyPlans.find((item) => item.projectId === projectId && item.id === dailyPlanId);
  if (!plan) return null;

  return {
    plan,
    shots: dailyPlanShots.filter((shot) => shot.dailyPlanId === dailyPlanId).sort((a, b) => a.orderIndex - b.orderIndex)
  };
}

/** Progress 회차 전환용: 편집기 daily_plan_shots 없이 표시 메타데이터만 읽습니다. */
export async function getProgressDailyPlan(
  projectId: string,
  dailyPlanId: string
): Promise<DailyPlan | null> {
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}?progress=1`,
      { cache: "no-store" }
    );
    if (response.ok) {
      const payload = (await response.json()) as { plan?: Record<string, unknown> };
      return payload.plan ? dailyPlanFromRow(payload.plan) : null;
    }
    if (response.status === 403) throw new Error("Key staff 권한이 필요합니다.");
  } catch (error) {
    if (error instanceof Error && error.message === "Key staff 권한이 필요합니다.") throw error;
  }

  const supabase = await loadFallbackSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("daily_plans")
      .select(dailyPlanListColumns)
      .eq("project_id", projectId)
      .eq("id", dailyPlanId)
      .maybeSingle();
    if (error) throw error;
    return data ? dailyPlanFromRow(data) : null;
  }

  return readLocalBuckets().dailyPlans.find((plan) => (
    plan.projectId === projectId && plan.id === dailyPlanId
  )) ?? null;
}

/** 기타일정의 진행용 메모와 그림만 저장하며 컷/진행표 데이터는 변경하지 않습니다. */
export async function updateDailyPlanScheduleItem(
  projectId: string,
  dailyPlanId: string,
  itemId: string,
  patch: Partial<Pick<DailyPlanMealTime, "progressMemo" | "imageUrl">>,
  expectedUpdatedAt: string
): Promise<DailyPlanScheduleItemMutationResult> {
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleItem: { id: itemId, ...patch, expectedUpdatedAt } })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as {
      mealTimes?: unknown;
      updatedAt?: unknown;
      latestUpdatedAt?: unknown;
      error?: string;
    };
    if (response.ok && payload.mealTimes && typeof payload.updatedAt === "string") {
      return {
        mealTimes: normalizeDailyPlanMealTimes(payload.mealTimes),
        updatedAt: payload.updatedAt
      };
    }
    if (response.status === 409 && isValidDatabaseProjectId(projectId)) {
      throw new AutosaveConflictError<DailyPlanScheduleItemMutationResult>(
        "daily-plan",
        payload.error || "기타일정이 다른 화면에서 변경되었습니다.",
        typeof payload.latestUpdatedAt === "string"
          ? {
              mealTimes: normalizeDailyPlanMealTimes(payload.mealTimes),
              updatedAt: payload.latestUpdatedAt
            }
          : null
      );
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "기타일정 정보를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  const buckets = readLocalBuckets();
  const plan = buckets.dailyPlans.find((item) => item.projectId === projectId && item.id === dailyPlanId);
  if (!plan) throw new Error("일촬표를 찾을 수 없습니다.");
  if (!plan.mealTimes.some((item) => item.id === itemId)) throw new Error("기타일정을 찾을 수 없습니다.");
  const mealTimes = plan.mealTimes.map((item) => (
    item.id === itemId
      ? {
          ...item,
          ...("progressMemo" in patch
            ? { progressMemo: String(patch.progressMemo ?? "").slice(0, 2000) }
            : {}),
          ...("imageUrl" in patch ? { imageUrl: patch.imageUrl || null } : {})
        }
      : item
  ));
  writeLocalBuckets({
    dailyPlans: buckets.dailyPlans.map((item) => (
      item.id === dailyPlanId && item.projectId === projectId
        ? { ...item, mealTimes, updatedAt: new Date().toISOString() }
        : item
    ))
  }, projectId);
  const updatedAt = new Date().toISOString();
  return { mealTimes, updatedAt };
}

/** Progress long-press reorder를 canonical 일촬표 촬영 순서에 저장합니다. */
export async function updateDailyPlanProgressOrder(
  projectId: string,
  dailyPlanId: string,
  orderedShots: readonly Pick<import("@/lib/types").Shot, "id" | "sceneNumber" | "cutNumber">[],
  expectedUpdatedAt: string
): Promise<DailyPlanProgressOrderMutationResult> {
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shootingOrder: {
            shotIds: orderedShots.map((shot) => shot.id),
            expectedUpdatedAt
          }
        })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as {
      memo?: unknown;
      updatedAt?: unknown;
      latestUpdatedAt?: unknown;
      error?: string;
    };
    if (response.ok && typeof payload.memo === "string" && typeof payload.updatedAt === "string") {
      return { memo: payload.memo, updatedAt: payload.updatedAt };
    }
    if (response.status === 409 && isValidDatabaseProjectId(projectId)) {
      throw new AutosaveConflictError<DailyPlanProgressOrderMutationResult>(
        "daily-plan",
        payload.error || "촬영 순서가 다른 화면에서 변경되었습니다.",
        typeof payload.latestUpdatedAt === "string"
          ? { memo: "", updatedAt: payload.latestUpdatedAt }
          : null
      );
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "촬영 순서를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  const buckets = readLocalBuckets();
  const plan = buckets.dailyPlans.find((item) => item.projectId === projectId && item.id === dailyPlanId);
  if (!plan) throw new Error("일촬표를 찾을 수 없습니다.");
  if (plan.updatedAt !== expectedUpdatedAt) throw new Error("일촬표가 다른 화면에서 변경되었습니다.");
  const meta = decodeDailyPlanMemo(plan.memo);
  const memo = encodeDailyPlanMemo(normalizeDailyPlanPrintMeta({
    ...meta,
    timetableScenes: applyProgressOrderToTimetableScenes(meta.timetableScenes, orderedShots)
  }));
  const updatedAt = new Date().toISOString();
  writeLocalBuckets({
    dailyPlans: buckets.dailyPlans.map((item) => (
      item.id === dailyPlanId && item.projectId === projectId
        ? { ...item, memo, updatedAt }
        : item
    ))
  }, projectId);
  return { memo, updatedAt };
}

/** 진행도 화면에서 canonical 집합장소 주소를 명시적으로 저장합니다. */
export async function updateDailyPlanGatheringAddress(
  input: UpdateDailyPlanGatheringAddressInput
): Promise<DailyPlanGatheringAddressMutationResult> {
  if (!isValidDatabaseProjectId(input.projectId)) return updateLocalDailyPlanGatheringAddress(input);

  const response = await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/daily-plans/${encodeURIComponent(input.dailyPlanId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gatheringAddress: {
          gatheringPointId: input.gatheringPointId,
          locationId: input.locationId,
          locationName: input.locationName,
          departmentIds: input.departmentIds,
          address: input.address,
          expectedUpdatedAt: input.expectedUpdatedAt
        }
      })
    }
  );
  const payload = (await response.json().catch(() => ({}))) as {
    memo?: unknown;
    shootingLocations?: unknown;
    updatedAt?: unknown;
    gatheringPointId?: unknown;
    latestUpdatedAt?: unknown;
    error?: string;
  };
  if (
    !response.ok
    || typeof payload.memo !== "string"
    || !Array.isArray(payload.shootingLocations)
    || typeof payload.updatedAt !== "string"
    || typeof payload.gatheringPointId !== "string"
  ) {
    if (response.status === 409) {
      throw new AutosaveConflictError(
        "daily-plan",
        payload.error || "집합장소 주소가 다른 화면에서 변경되었습니다.",
        typeof payload.latestUpdatedAt === "string"
          ? { updatedAt: payload.latestUpdatedAt }
          : null
      );
    }
    throw new Error(payload.error || "집합장소 주소를 저장하지 못했습니다.");
  }
  return {
    memo: payload.memo,
    shootingLocations: payload.shootingLocations as DailyPlanLocation[],
    updatedAt: payload.updatedAt,
    gatheringPointId: payload.gatheringPointId
  };
}

/** 진행도 화면에서 daily plan timetable scene row의 예정 소요시간을 저장합니다. */
export async function updateDailyPlanSceneDuration(
  input: UpdateDailyPlanSceneDurationInput
): Promise<DailyPlanSceneDurationMutationResult> {
  validateSceneRuntimeMinutes(input.runtimeMinutes);
  if (!isValidDatabaseProjectId(input.projectId)) return updateLocalDailyPlanSceneDuration(input);

  const response = await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/daily-plans/${encodeURIComponent(input.dailyPlanId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sceneDuration: {
          rowId: input.rowId,
          runtimeMinutes: input.runtimeMinutes,
          expectedUpdatedAt: input.expectedUpdatedAt
        }
      })
    }
  );
  const payload = (await response.json().catch(() => ({}))) as {
    memo?: unknown;
    updatedAt?: unknown;
    latestUpdatedAt?: unknown;
    rowId?: unknown;
    runtimeMinutes?: unknown;
    error?: string;
  };
  const runtimeMinutes = payload.runtimeMinutes === null
    ? null
    : typeof payload.runtimeMinutes === "number"
      ? payload.runtimeMinutes
      : undefined;
  if (
    !response.ok
    || typeof payload.memo !== "string"
    || typeof payload.updatedAt !== "string"
    || typeof payload.rowId !== "string"
    || runtimeMinutes === undefined
  ) {
    if (response.status === 409) {
      throw new AutosaveConflictError(
        "daily-plan",
        payload.error || "씬 예정 소요시간이 다른 화면에서 변경되었습니다.",
        typeof payload.latestUpdatedAt === "string"
          ? { updatedAt: payload.latestUpdatedAt }
          : null
      );
    }
    throw new Error(payload.error || "씬 예정 소요시간을 저장하지 못했습니다.");
  }
  return {
    memo: payload.memo,
    updatedAt: payload.updatedAt,
    rowId: payload.rowId,
    runtimeMinutes
  };
}

function updateLocalDailyPlanGatheringAddress(
  input: UpdateDailyPlanGatheringAddressInput
): Promise<DailyPlanGatheringAddressMutationResult> {
  const address = normalizeAddressInput(input.address);
  const buckets = readLocalBuckets();
  const planIndex = buckets.dailyPlans.findIndex((plan) => (
    plan.projectId === input.projectId && plan.id === input.dailyPlanId
  ));
  if (planIndex < 0) throw new Error("일촬표를 찾을 수 없습니다.");
  const plan = buckets.dailyPlans[planIndex];
  if (input.expectedUpdatedAt && plan.updatedAt !== input.expectedUpdatedAt) {
    throw new Error("일촬표가 다른 화면에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.");
  }

  const requestedLocationId = cleanReferenceId(input.locationId);
  const requestedPointId = cleanReferenceId(input.gatheringPointId);
  const requestedDepartmentIds = uniqueReferenceIds(input.departmentIds);
  const locationName = normalizeGatheringLocationName(input.locationName).slice(0, 500);
  const location = requestedLocationId
    ? plan.shootingLocations.find((item) => item.id === requestedLocationId) ?? null
    : null;
  if (requestedLocationId && !location) throw new Error("집합장소 위치 정보를 찾을 수 없습니다.");

  let meta = reconcileDailyPlanGatheringPoints(decodeDailyPlanMemo(plan.memo), plan.shootingLocations);
  if (requestedDepartmentIds.some((id) => !meta.teams.some((team) => team.id === id))) {
    throw new Error("집합장소와 연결된 부서 정보를 찾을 수 없습니다.");
  }
  let point = resolveGatheringPointForMutation(meta, {
    requestedPointId,
    requestedLocationId,
    requestedDepartmentIds,
    locationName
  });
  if (requestedPointId && !point) throw new Error("집합장소 정보를 찾을 수 없습니다.");
  if (point?.locationId && requestedLocationId && point.locationId !== requestedLocationId) {
    throw new Error("집합장소와 위치 정보가 일치하지 않습니다.");
  }

  const pointId = point?.id ?? createGatheringPointId();
  if (!point) {
    meta = ensureGatheringPointForMutation(meta, {
      pointId,
      requestedLocationId,
      requestedDepartmentIds,
      locationName,
      address
    }, plan.shootingLocations);
    point = meta.gatheringPoints.find((item) => item.id === pointId) ?? null;
  }
  if (!point) throw new Error("집합장소 정보를 만들지 못했습니다.");

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

  const now = new Date().toISOString();
  const memo = encodeDailyPlanMemo(meta);
  writeLocalBuckets({
    dailyPlans: buckets.dailyPlans.map((item, index) => (
      index === planIndex ? { ...item, shootingLocations, memo, updatedAt: now } : item
    ))
  }, input.projectId);
  return Promise.resolve({ memo, shootingLocations, updatedAt: now, gatheringPointId: pointId });
}

function updateLocalDailyPlanSceneDuration(
  input: UpdateDailyPlanSceneDurationInput
): Promise<DailyPlanSceneDurationMutationResult> {
  validateSceneRuntimeMinutes(input.runtimeMinutes);
  const rowId = cleanReferenceId(input.rowId);
  if (!rowId) throw new Error("수정할 씬 행 정보가 없습니다.");
  const buckets = readLocalBuckets();
  const planIndex = buckets.dailyPlans.findIndex((plan) => (
    plan.projectId === input.projectId && plan.id === input.dailyPlanId
  ));
  if (planIndex < 0) throw new Error("일촬표를 찾을 수 없습니다.");
  const plan = buckets.dailyPlans[planIndex];
  if (input.expectedUpdatedAt && plan.updatedAt !== input.expectedUpdatedAt) {
    throw new Error("일촬표가 다른 화면에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.");
  }
  const meta = decodeDailyPlanMemo(plan.memo);
  if (!meta.timetableScenes.some((scene) => scene.rowId === rowId)) {
    throw new Error("씬 촬영 행을 찾을 수 없습니다.");
  }
  const nextMeta = normalizeDailyPlanPrintMeta({
    ...meta,
    timetableScenes: meta.timetableScenes.map((scene) => (
      scene.rowId === rowId
        ? {
            ...scene,
            rowSnapshot: {
              ...scene.rowSnapshot,
              runtimeMinutes: input.runtimeMinutes,
              runtime: formatRuntimeMinutes(input.runtimeMinutes)
            }
          }
        : scene
    ))
  });
  const memo = encodeDailyPlanMemo(nextMeta);
  const now = new Date().toISOString();
  writeLocalBuckets({
    dailyPlans: buckets.dailyPlans.map((item, index) => (
      index === planIndex ? { ...item, memo, updatedAt: now } : item
    ))
  }, input.projectId);
  return Promise.resolve({ memo, updatedAt: now, rowId, runtimeMinutes: input.runtimeMinutes });
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
  // 부서 metadata가 없는 과거 일촬표에서도 주소 자체는 잃지 않도록 orphan point를 보존합니다.
  return normalizeDailyPlanPrintMeta({
    ...reconciled,
    gatheringPoints: [
      ...reconciled.gatheringPoints,
      seeded.gatheringPoints.find((point) => point.id === input.pointId)!
    ]
  });
}

function validateSceneRuntimeMinutes(value: number | null) {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 0 || value > 1440) {
    throw new Error("예정 소요시간은 0~1440분 사이의 정수로 입력해주세요.");
  }
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

function normalizeAddressInput(value: unknown) {
  const address = String(value ?? "").trim();
  if (address.length > 1000) throw new Error("집합장소 주소는 1000자 이내로 입력해주세요.");
  return address;
}

function cleanReferenceId(value: unknown) {
  const id = String(value ?? "").trim();
  return id && id.length <= 180 && !/[\u0000-\u001f\u007f]/.test(id) ? id : "";
}

function uniqueReferenceIds(values: unknown[]) {
  return [...new Set(values.map(cleanReferenceId).filter(Boolean))].slice(0, 200);
}

/** 새 일촬표를 만들거나 기존 일촬표를 저장합니다. */
export async function saveDailyPlanWithShots(input: SaveDailyPlanInput): Promise<SaveDailyPlanResult> {
  const submittedPrintMeta = decodeDailyPlanMemo(input.plan.memo);
  const splitConsistencyError = getSplitShootingOrderSaveError(submittedPrintMeta.timetableScenes)
    || getSplitShotAllocationSaveError(submittedPrintMeta.timetableScenes, input.shots);
  if (splitConsistencyError) throw new Error(splitConsistencyError);
  const normalizedShots = normalizeDailyPlanShotDrafts(input.shots);
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(input.projectId)}/daily-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dailyPlanId: input.dailyPlanId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        plan: input.plan,
        shots: normalizedShots,
        allowDuplicate: input.allowDuplicate
      })
    });
    const payload = (await response.json().catch(() => ({}))) as SaveDailyPlanApiPayload;
    const planRow = payload.dailyPlan ?? payload.plan;
    if ((response.ok || response.status === 409) && planRow && payload.shots) {
      return {
        plan: dailyPlanFromRow(planRow),
        shots: payload.shots.map(dailyPlanShotFromRow),
        saveStatus: payload.status === "duplicate" ? "duplicate" : "saved",
        message: payload.message ?? (payload.status === "duplicate" ? "이미 저장된 일촬표입니다." : "일촬표가 저장되었습니다."),
        progressSyncStatus: payload.shotsSync ? (payload.shotsSync.ok ? "synced" : "failed") : payload.progressSync?.status,
        progressShotCount: payload.shotsSync?.targetShotCount ?? payload.progressSync?.shotCount,
        progressSyncError: payload.shotsSync?.errorMessage ?? payload.progressSync?.error,
        progressSyncStep: payload.shotsSync?.step,
        progressSyncErrorCode: payload.shotsSync?.errorCode
      };
    }
    if (response.status === 409 && payload.status === "conflict") {
      throw new AutosaveConflictError(
        "daily-plan",
        payload.error || "일촬표가 다른 화면에서 변경되었습니다. 현재 입력은 유지됩니다.",
        payload.latestUpdatedAt ? { updatedAt: payload.latestUpdatedAt } : null
      );
    }
    if (response.status === 409 || payload.status === "duplicate") {
      throw new DailyPlanDuplicateError(payload.message);
    }
    if (response.status === 403) throw new Error("Key staff 권한이 필요합니다.");
    if (response.status !== 401 && response.status !== 503) {
      throw new Error(payload.error || payload.message || "일촬표를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  const supabase = await loadFallbackSupabaseClient();

  if (supabase) {
    if (input.dailyPlanId) {
      const expectedUpdatedAt = String(input.expectedUpdatedAt ?? "").trim();
      if (!expectedUpdatedAt) throw new Error("최신 일촬표 저장 시각이 필요합니다.");
      const { data: oldShots, error: oldShotsError } = await supabase
        .from("daily_plan_shots")
        .select("*")
        .eq("project_id", input.projectId)
        .eq("daily_plan_id", input.dailyPlanId);
      if (oldShotsError) throw oldShotsError;

      const newRows = normalizedShots.map((shot, index) => dailyPlanShotDraftToRow(input.projectId, input.dailyPlanId!, shot, index + 1));
      let insertedRows: Record<string, unknown>[] = [];
      try {
        const { data: planRow, error: planError } = await supabase
          .from("daily_plans")
          .update(dailyPlanDraftToRow(input.projectId, input.plan))
          .eq("id", input.dailyPlanId)
          .eq("project_id", input.projectId)
          .eq("updated_at", expectedUpdatedAt)
          .select("*")
          .maybeSingle();
        if (planError) throw planError;
        if (!planRow) {
          const { data: latest, error: latestError } = await supabase
            .from("daily_plans")
            .select("updated_at")
            .eq("id", input.dailyPlanId)
            .eq("project_id", input.projectId)
            .maybeSingle();
          if (latestError) throw latestError;
          throw new AutosaveConflictError(
            "daily-plan",
            "일촬표가 다른 화면에서 변경되었습니다. 현재 입력은 유지됩니다.",
            latest?.updated_at ? { updatedAt: String(latest.updated_at) } : null
          );
        }
        if (newRows.length) {
          const { data, error } = await supabase.from("daily_plan_shots").insert(newRows).select("*").order("order_index", { ascending: true });
          if (error) throw error;
          insertedRows = data;
        }
        if (oldShots.length) {
          const { error } = await supabase.from("daily_plan_shots").delete().in("id", oldShots.map((row) => row.id));
          if (error) throw error;
        }
        return {
          plan: dailyPlanFromRow(planRow),
          shots: insertedRows.map(dailyPlanShotFromRow),
          saveStatus: "saved",
          message: "일촬표가 저장되었습니다."
        };
      } catch (error) {
        if (insertedRows.length) await supabase.from("daily_plan_shots").delete().in("id", insertedRows.map((row) => row.id));
        if (oldShots.length) {
          const { data: remaining } = await supabase.from("daily_plan_shots").select("id").in("id", oldShots.map((row) => row.id));
          if ((remaining?.length ?? 0) < oldShots.length) await supabase.from("daily_plan_shots").insert(oldShots);
        }
        throw error;
      }
    }

    if (!input.allowDuplicate) {
      const duplicate = await findSupabaseDuplicateDailyPlan(input.projectId, input.plan);
      if (duplicate) return { ...duplicate, saveStatus: "duplicate", message: "이미 저장된 일촬표입니다." };
    }

    const { data: planRow, error: planError } = await supabase
      .from("daily_plans")
      .insert(dailyPlanDraftToRow(input.projectId, input.plan))
      .select("*")
      .single();

    if (planError) throw planError;

    const plan = dailyPlanFromRow(planRow);
    try {
      const insertedShots = await insertDailyPlanShots(input.projectId, plan.id, normalizedShots);
      return { plan, shots: insertedShots, saveStatus: "saved", message: "일촬표가 저장되었습니다." };
    } catch (error) {
      await supabase.from("daily_plans").delete().eq("id", plan.id).eq("project_id", input.projectId);
      throw error;
    }
  }

  const buckets = readLocalBuckets();
  if (!input.dailyPlanId && !input.allowDuplicate) {
    const duplicatePlan = buckets.dailyPlans.find((plan) => plan.projectId === input.projectId && isSameDailyPlanIdentity(plan, input.plan));
    if (duplicatePlan) {
      return {
        plan: duplicatePlan,
        shots: buckets.dailyPlanShots.filter((shot) => shot.dailyPlanId === duplicatePlan.id).sort((left, right) => left.orderIndex - right.orderIndex),
        saveStatus: "duplicate",
        message: "이미 저장된 일촬표입니다."
      };
    }
  }
  const now = new Date().toISOString();
  const planId = input.dailyPlanId ?? createLocalId("daily_plan");
  const existingPlan = buckets.dailyPlans.find((plan) => plan.id === planId);
  if (input.dailyPlanId) {
    const expectedUpdatedAt = String(input.expectedUpdatedAt ?? "").trim();
    if (!existingPlan) throw new Error("수정할 일촬표를 찾을 수 없습니다.");
    if (!expectedUpdatedAt || existingPlan.updatedAt !== expectedUpdatedAt) {
      throw new AutosaveConflictError(
        "daily-plan",
        "일촬표가 다른 화면에서 변경되었습니다. 현재 입력은 유지됩니다.",
        { updatedAt: existingPlan.updatedAt }
      );
    }
  }
  const plan: DailyPlan = {
    id: planId,
    projectId: input.projectId,
    ...input.plan,
    createdAt: existingPlan?.createdAt ?? now,
    updatedAt: now
  };
  const shots: DailyPlanShot[] = normalizedShots.map((shot, index) => ({
    id: createLocalId("daily_plan_shot"),
    dailyPlanId: plan.id,
    projectId: input.projectId,
    ...shot,
    orderIndex: index + 1,
    createdAt: now,
    updatedAt: now
  }));

  writeLocalBuckets(
    {
      dailyPlans: [plan, ...buckets.dailyPlans.filter((item) => item.id !== plan.id)],
      dailyPlanShots: [...buckets.dailyPlanShots.filter((shot) => shot.dailyPlanId !== plan.id), ...shots]
    },
    input.projectId
  );

  return { plan, shots, saveStatus: "saved", message: "일촬표가 저장되었습니다." };
}

async function findSupabaseDuplicateDailyPlan(projectId: string, draft: DailyPlanDraft): Promise<DailyPlanWithShots | null> {
  const supabase = await loadFallbackSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.from("daily_plans").select("*").eq("project_id", projectId);
  if (error) throw error;
  const duplicateRow = data.find((row) => isSameDailyPlanIdentity(dailyPlanFromRow(row), draft));
  if (!duplicateRow) return null;

  const duplicatePlan = dailyPlanFromRow(duplicateRow);
  const { data: shotRows, error: shotError } = await supabase
    .from("daily_plan_shots")
    .select("*")
    .eq("project_id", projectId)
    .eq("daily_plan_id", duplicatePlan.id)
    .order("order_index", { ascending: true });
  if (shotError) throw shotError;
  return { plan: duplicatePlan, shots: shotRows.map(dailyPlanShotFromRow) };
}

async function insertDailyPlanShots(projectId: string, dailyPlanId: string, shots: DailyPlanShotDraft[]) {
  const supabase = await loadFallbackSupabaseClient();
  if (!supabase || shots.length === 0) return [];

  const rows = shots.map((shot, index) => dailyPlanShotDraftToRow(projectId, dailyPlanId, shot, index + 1));
  const { data, error } = await supabase.from("daily_plan_shots").insert(rows).select("*").order("order_index", { ascending: true });
  if (error) throw error;
  return data.map(dailyPlanShotFromRow);
}

/** 저장된 일촬표를 복사해 새 일촬표로 만듭니다. */
export async function duplicateDailyPlan(projectId: string, dailyPlanId: string): Promise<DailyPlanWithShots> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/daily-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duplicateSourceDailyPlanId: dailyPlanId })
    });
    const payload = (await response.json().catch(() => ({}))) as SaveDailyPlanApiPayload;
    const planRow = payload.dailyPlan ?? payload.plan;
    if (response.ok && planRow && payload.shots) {
      return {
        plan: dailyPlanFromRow(planRow),
        shots: payload.shots.map(dailyPlanShotFromRow)
      };
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || payload.message || "일촬표를 복사하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  const existing = await getDailyPlanWithShots(projectId, dailyPlanId);
  if (!existing) throw new Error("복사할 일촬표를 찾을 수 없습니다.");
  const localBuckets = readLocalBuckets();
  const localPlans = localBuckets.dailyPlans.filter((plan) => plan.projectId === projectId);
  const canonicalProjectTitle = localBuckets.projects.find((project) => project.id === projectId)?.name;
  const duplicate = buildDailyPlanDuplicateDraft({
    plan: existing.plan,
    shots: existing.shots,
    existingEpisodes: localPlans.map((plan) => plan.episode),
    canonicalProjectTitle
  });
  return saveDailyPlanWithShots({
    projectId,
    plan: duplicate.plan,
    shots: duplicate.shots,
    allowDuplicate: true
  });
}

/** 저장된 일촬표와 cascade child를 삭제하고 복원 영수증을 돌려줍니다. */
export async function deleteDailyPlan(projectId: string, dailyPlanId: string): Promise<DeletedDailyPlanMutation> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; receipt?: unknown };
    if (response.ok && typeof payload.receipt === "string") {
      return { receipt: payload.receipt, fallback: null, progressShotIds: [] };
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || (response.status === 403 ? "Key staff 권한이 필요합니다." : "일촬표를 삭제하지 못했습니다."));
    }
  } catch (error) {
    // 실제 DB 프로젝트의 API 실패는 브라우저 fallback으로 성공처럼 처리하지 않습니다.
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }
  const supabase = await loadFallbackSupabaseClient();

  if (supabase) {
    const [{ data: planRow, error: planError }, { data: shotRows, error: shotError }, { data: progressRows, error: progressError }] = await Promise.all([
      supabase.from("daily_plans").select("*").eq("id", dailyPlanId).eq("project_id", projectId).maybeSingle(),
      supabase.from("daily_plan_shots").select("*").eq("daily_plan_id", dailyPlanId).eq("project_id", projectId).order("order_index"),
      supabase.from("shots").select("id").eq("daily_plan_id", dailyPlanId).eq("project_id", projectId)
    ]);
    if (planError) throw planError;
    if (shotError) throw shotError;
    if (progressError) throw progressError;
    if (!planRow) throw new Error("삭제할 일촬표를 찾을 수 없습니다.");
    const fallback = {
      plan: dailyPlanFromRow(planRow),
      shots: (shotRows ?? []).map(dailyPlanShotFromRow)
    };
    const { error } = await supabase.from("daily_plans").delete().eq("id", dailyPlanId).eq("project_id", projectId);
    if (error) throw error;
    return {
      receipt: null,
      fallback,
      progressShotIds: (progressRows ?? []).map((row) => String(row.id))
    };
  }

  const buckets = readLocalBuckets();
  const plan = buckets.dailyPlans.find((item) => item.id === dailyPlanId && item.projectId === projectId);
  if (!plan) throw new Error("삭제할 일촬표를 찾을 수 없습니다.");
  const fallback = {
    plan,
    shots: buckets.dailyPlanShots
      .filter((shot) => shot.dailyPlanId === dailyPlanId && shot.projectId === projectId)
      .sort((left, right) => left.orderIndex - right.orderIndex)
  };
  writeLocalBuckets(
    {
      dailyPlans: buckets.dailyPlans.filter((plan) => plan.id !== dailyPlanId),
      dailyPlanShots: buckets.dailyPlanShots.filter((shot) => shot.dailyPlanId !== dailyPlanId)
    },
    projectId
  );
  return { receipt: null, fallback, progressShotIds: [] };
}

/** 삭제 영수증 또는 legacy local snapshot으로 stable-ID 회차를 복원합니다. */
export async function restoreDeletedDailyPlan(
  projectId: string,
  dailyPlanId: string,
  mutation: DeletedDailyPlanMutation | null
): Promise<void> {
  if (!mutation) throw new Error("일촬표 복원 정보가 없습니다.");
  if (mutation.receipt) {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "restore_deleted", receipt: mutation.receipt })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || "일촬표를 복원하지 못했습니다.");
    }
    return;
  }
  if (!mutation.fallback) throw new Error("일촬표 복원 정보가 없습니다.");
  const supabase = await loadFallbackSupabaseClient();
  if (supabase) {
    const { plan, shots } = mutation.fallback;
    const { error: planError } = await supabase.from("daily_plans").upsert([{
      id: plan.id,
      ...dailyPlanDraftToRow(projectId, plan),
      created_at: plan.createdAt,
      updated_at: plan.updatedAt
    }], { onConflict: "id", ignoreDuplicates: true });
    if (planError) throw planError;
    if (shots.length > 0) {
      const rows = shots.map((shot) => ({
        id: shot.id,
        ...dailyPlanShotDraftToRow(projectId, dailyPlanId, shot, shot.orderIndex),
        created_at: shot.createdAt,
        updated_at: shot.updatedAt
      }));
      const { error: shotError } = await supabase
        .from("daily_plan_shots")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (shotError) throw shotError;
    }
    if (mutation.progressShotIds.length > 0) {
      const { error: relationError } = await supabase
        .from("shots")
        .update({ daily_plan_id: dailyPlanId })
        .eq("project_id", projectId)
        .in("id", mutation.progressShotIds)
        .is("daily_plan_id", null);
      if (relationError) throw relationError;
    }
    return;
  }
  const buckets = readLocalBuckets();
  const restoredShotIds = new Set(mutation.fallback.shots.map((shot) => shot.id));
  writeLocalBuckets({
    dailyPlans: [
      ...buckets.dailyPlans.filter((plan) => plan.id !== dailyPlanId),
      mutation.fallback.plan
    ],
    dailyPlanShots: [
      ...buckets.dailyPlanShots.filter((shot) => !restoredShotIds.has(shot.id)),
      ...mutation.fallback.shots
    ]
  }, projectId);
}

/** DB-only 회차 삭제 finalize는 receipt scope 검증 후 idempotent하게 끝납니다. */
export async function finalizeDeletedDailyPlan(
  projectId: string,
  dailyPlanId: string,
  mutation: DeletedDailyPlanMutation | null
): Promise<void> {
  if (!mutation?.receipt) return;
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}`, {
    method: "POST",
    keepalive: mutation.receipt.length <= 48_000,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "finalize_deleted", receipt: mutation.receipt })
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "일촬표 삭제를 확정하지 못했습니다.");
  }
}

/** 일촬표 컷 행을 기존 shots 진행표에 넣을 수 있는 초안으로 바꿉니다. */
export function dailyPlanShotsToShotDrafts(plan: DailyPlanDraft | DailyPlan, shots: Array<DailyPlanShotDraft | DailyPlanShot>): ShotDraft[] {
  return buildProgressShotDrafts(plan, shots);
}

export function dailyPlanShotToDraft(shot: DailyPlanShot | DailyPlanShotDraft): DailyPlanShotDraft {
  return {
    orderIndex: shot.orderIndex,
    startTime: shot.startTime,
    endTime: shot.endTime,
    sceneNumber: shot.sceneNumber,
    sceneTitle: shot.sceneTitle ?? "",
    locationId: shot.locationId ?? "",
    locationName: shot.locationName ?? shot.subLocation ?? "",
    cutNumber: shot.cutNumber,
    subject: shot.subject,
    subLocation: shot.subLocation,
    dayNight: shot.dayNight,
    liveSync: shot.liveSync,
    cutType: shot.cutType,
    storyDay: shot.storyDay,
    description: shot.description,
    props: shot.props,
    costumeMakeup: shot.costumeMakeup,
    sceneMemo: shot.sceneMemo ?? "",
    memo: shot.memo,
    status: normalizeDailyPlanShotStatus(shot.status)
  };
}

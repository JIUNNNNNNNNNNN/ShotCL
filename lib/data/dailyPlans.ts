import {
  dailyPlanDraftToRow,
  dailyPlanFromRow,
  dailyPlanShotDraftToRow,
  dailyPlanShotFromRow,
  normalizeDailyPlanShotStatus
} from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import { buildProgressShotDrafts } from "@/lib/dailyPlan/progressShots";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSameDailyPlanIdentity } from "@/lib/dailyPlan/identity";
import type {
  DailyPlan,
  DailyPlanDraft,
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
  plan: DailyPlanDraft;
  shots: DailyPlanShotDraft[];
  allowDuplicate?: boolean;
};

export type DailyPlanListItem = DailyPlan & {
  shotCount: number;
  progressTotal: number;
  progressCompleted: number;
};

const dailyPlanListRequests = new Map<string, Promise<DailyPlanListItem[]>>();
const dailyPlanListColumns = "id,project_id,title,source_type,source_file_name,shooting_date,episode,created_at,updated_at";

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
  status?: "saved" | "saved_shots_failed" | "duplicate";
  message?: string;
  dailyPlan?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  shots?: Record<string, unknown>[];
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

async function loadDailyPlans(projectId: string): Promise<DailyPlanListItem[]> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/daily-plans`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as {
        plans: Record<string, unknown>[];
        shotPlanIds: string[];
        progressShots?: Array<{ daily_plan_id?: unknown; status?: unknown }>;
      };
      const counts = new Map<string, number>();
      payload.shotPlanIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
      const progress = summarizeProgressRows(payload.progressShots ?? []);
      return payload.plans.map(dailyPlanFromRow).map((plan) => ({
        ...plan,
        shotCount: counts.get(plan.id) ?? 0,
        progressTotal: progress.get(plan.id)?.total ?? 0,
        progressCompleted: progress.get(plan.id)?.completed ?? 0
      }));
    }
    if (response.status === 403) throw new Error("관리자 권한이 필요합니다.");
  } catch (error) {
    if (error instanceof Error && error.message === "관리자 권한이 필요합니다.") throw error;
  }
  const supabase = getSupabaseBrowserClient();

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
      supabase.from("daily_plan_shots").select("daily_plan_id").eq("project_id", projectId),
      supabase.from("shots").select("daily_plan_id,status").eq("project_id", projectId)
    ]);
    if (shotError) throw shotError;
    if (progressError) throw progressError;

    const counts = new Map<string, number>();
    shotRows.forEach((row) => counts.set(row.daily_plan_id, (counts.get(row.daily_plan_id) ?? 0) + 1));
    const progress = summarizeProgressRows(progressRows ?? []);
    return plans.map((plan) => ({
      ...plan,
      shotCount: counts.get(plan.id) ?? 0,
      progressTotal: progress.get(plan.id)?.total ?? 0,
      progressCompleted: progress.get(plan.id)?.completed ?? 0
    }));
  }

  const { dailyPlans, dailyPlanShots, shots } = readLocalBuckets();
  const progress = summarizeProgressRows(
    shots
      .filter((shot) => shot.projectId === projectId)
      .map((shot) => ({
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
      progressCompleted: progress.get(plan.id)?.completed ?? 0
    }));
}

function summarizeProgressRows(rows: Array<{ daily_plan_id?: unknown; status?: unknown }>) {
  const summaries = new Map<string, { total: number; completed: number }>();
  rows.forEach((row) => {
    const dailyPlanId = String(row.daily_plan_id ?? "");
    if (!dailyPlanId) return;
    const current = summaries.get(dailyPlanId) ?? { total: 0, completed: 0 };
    current.total += 1;
    if (row.status === "ok" || row.status === "omit") current.completed += 1;
    summaries.set(dailyPlanId, current);
  });
  return summaries;
}

/** 일촬표와 컷 행을 함께 가져옵니다. */
export async function getDailyPlanWithShots(projectId: string, dailyPlanId: string): Promise<DailyPlanWithShots | null> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { plan: Record<string, unknown>; shots: Record<string, unknown>[] };
      return { plan: dailyPlanFromRow(payload.plan), shots: payload.shots.map(dailyPlanShotFromRow) };
    }
    if (response.status === 403) throw new Error("관리자 권한이 필요합니다.");
  } catch (error) {
    if (error instanceof Error && error.message === "관리자 권한이 필요합니다.") throw error;
  }
  const supabase = getSupabaseBrowserClient();

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

/** 새 일촬표를 만들거나 기존 일촬표를 저장합니다. */
export async function saveDailyPlanWithShots(input: SaveDailyPlanInput): Promise<SaveDailyPlanResult> {
  const normalizedShots = normalizeDailyPlanShotDrafts(input.shots);
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(input.projectId)}/daily-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyPlanId: input.dailyPlanId, plan: input.plan, shots: normalizedShots, allowDuplicate: input.allowDuplicate })
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
    if (response.status === 409 || payload.status === "duplicate") {
      throw new DailyPlanDuplicateError(payload.message);
    }
    if (response.status === 403) throw new Error("관리자 권한이 필요합니다.");
    if (response.status !== 401 && response.status !== 503) {
      throw new Error(payload.error || payload.message || "일촬표를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    if (input.dailyPlanId) {
      const { data: oldShots, error: oldShotsError } = await supabase
        .from("daily_plan_shots")
        .select("*")
        .eq("project_id", input.projectId)
        .eq("daily_plan_id", input.dailyPlanId);
      if (oldShotsError) throw oldShotsError;

      const newRows = normalizedShots.map((shot, index) => dailyPlanShotDraftToRow(input.projectId, input.dailyPlanId!, shot, index + 1));
      let insertedRows: Record<string, unknown>[] = [];
      try {
        if (newRows.length) {
          const { data, error } = await supabase.from("daily_plan_shots").insert(newRows).select("*").order("order_index", { ascending: true });
          if (error) throw error;
          insertedRows = data;
        }
        if (oldShots.length) {
          const { error } = await supabase.from("daily_plan_shots").delete().in("id", oldShots.map((row) => row.id));
          if (error) throw error;
        }
        const { data: planRow, error: planError } = await supabase
          .from("daily_plans")
          .update(dailyPlanDraftToRow(input.projectId, input.plan))
          .eq("id", input.dailyPlanId)
          .eq("project_id", input.projectId)
          .select("*")
          .single();
        if (planError) throw planError;
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
  const supabase = getSupabaseBrowserClient();
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
  const supabase = getSupabaseBrowserClient();
  if (!supabase || shots.length === 0) return [];

  const rows = shots.map((shot, index) => dailyPlanShotDraftToRow(projectId, dailyPlanId, shot, index + 1));
  const { data, error } = await supabase.from("daily_plan_shots").insert(rows).select("*").order("order_index", { ascending: true });
  if (error) throw error;
  return data.map(dailyPlanShotFromRow);
}

/** 저장된 일촬표를 복사해 새 일촬표로 만듭니다. */
export async function duplicateDailyPlan(projectId: string, dailyPlanId: string): Promise<DailyPlanWithShots> {
  const existing = await getDailyPlanWithShots(projectId, dailyPlanId);
  if (!existing) throw new Error("복사할 일촬표를 찾을 수 없습니다.");

  const draft: DailyPlanDraft = {
    title: `${existing.plan.title || "일촬표"} 복사본`,
    sourceType: "web_editor",
    sourceFileName: existing.plan.sourceFileName,
    shootingDate: existing.plan.shootingDate,
    episode: existing.plan.episode,
    director: existing.plan.director,
    dop: existing.plan.dop,
    assistantDirector: existing.plan.assistantDirector,
    production: existing.plan.production,
    callTime: existing.plan.callTime,
    shootStartTime: existing.plan.shootStartTime,
    shootEndTime: existing.plan.shootEndTime,
    meetingLocation: existing.plan.meetingLocation,
    shootingLocation: existing.plan.shootingLocation,
    shootingLocations: existing.plan.shootingLocations ?? [],
    mealTime: existing.plan.mealTime,
    mealTimes: existing.plan.mealTimes ?? [],
    safetyNotice: existing.plan.safetyNotice,
    memo: existing.plan.memo
  };
  const shotDrafts = existing.shots.map(dailyPlanShotToDraft);
  return saveDailyPlanWithShots({ projectId, plan: draft, shots: shotDrafts, allowDuplicate: true });
}

/** 저장된 일촬표와 연결 컷 행을 삭제합니다. */
export async function deleteDailyPlan(projectId: string, dailyPlanId: string): Promise<void> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}`, { method: "DELETE" });
    if (response.ok) return;
    if (response.status === 403) throw new Error("관리자 권한이 필요합니다.");
  } catch (error) {
    if (error instanceof Error && error.message === "관리자 권한이 필요합니다.") throw error;
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const { error } = await supabase.from("daily_plans").delete().eq("id", dailyPlanId).eq("project_id", projectId);
    if (error) throw error;
    return;
  }

  const buckets = readLocalBuckets();
  writeLocalBuckets(
    {
      dailyPlans: buckets.dailyPlans.filter((plan) => plan.id !== dailyPlanId),
      dailyPlanShots: buckets.dailyPlanShots.filter((shot) => shot.dailyPlanId !== dailyPlanId)
    },
    projectId
  );
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

import {
  dailyPlanDraftToRow,
  dailyPlanFromRow,
  dailyPlanShotDraftToRow,
  dailyPlanShotFromRow,
  normalizeDailyPlanShotStatus,
  normalizeShotStatus
} from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
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
export async function listDailyPlans(projectId: string): Promise<Array<DailyPlan & { shotCount: number }>> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("daily_plans")
      .select("*")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const plans = data.map(dailyPlanFromRow);
    const { data: shotRows, error: shotError } = await supabase
      .from("daily_plan_shots")
      .select("daily_plan_id")
      .eq("project_id", projectId);

    if (shotError) throw shotError;

    const counts = new Map<string, number>();
    shotRows.forEach((row) => counts.set(row.daily_plan_id, (counts.get(row.daily_plan_id) ?? 0) + 1));
    return plans.map((plan) => ({ ...plan, shotCount: counts.get(plan.id) ?? 0 }));
  }

  const { dailyPlans, dailyPlanShots } = readLocalBuckets();
  return dailyPlans
    .filter((plan) => plan.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((plan) => ({
      ...plan,
      shotCount: dailyPlanShots.filter((shot) => shot.dailyPlanId === plan.id).length
    }));
}

/** 일촬표와 컷 행을 함께 가져옵니다. */
export async function getDailyPlanWithShots(projectId: string, dailyPlanId: string): Promise<DailyPlanWithShots | null> {
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
export async function saveDailyPlanWithShots(input: SaveDailyPlanInput): Promise<DailyPlanWithShots> {
  const normalizedShots = normalizeDailyPlanShotDrafts(input.shots);
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    if (input.dailyPlanId) {
      const { data: planRow, error: planError } = await supabase
        .from("daily_plans")
        .update(dailyPlanDraftToRow(input.projectId, input.plan))
        .eq("id", input.dailyPlanId)
        .eq("project_id", input.projectId)
        .select("*")
        .single();

      if (planError) throw planError;

      const { error: deleteError } = await supabase.from("daily_plan_shots").delete().eq("daily_plan_id", input.dailyPlanId);
      if (deleteError) throw deleteError;

      const insertedShots = await insertDailyPlanShots(input.projectId, input.dailyPlanId, normalizedShots);
      return { plan: dailyPlanFromRow(planRow), shots: insertedShots };
    }

    const { data: planRow, error: planError } = await supabase
      .from("daily_plans")
      .insert(dailyPlanDraftToRow(input.projectId, input.plan))
      .select("*")
      .single();

    if (planError) throw planError;

    const plan = dailyPlanFromRow(planRow);
    const insertedShots = await insertDailyPlanShots(input.projectId, plan.id, normalizedShots);
    return { plan, shots: insertedShots };
  }

  const buckets = readLocalBuckets();
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

  return { plan, shots };
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
  return saveDailyPlanWithShots({ projectId, plan: draft, shots: shotDrafts });
}

/** 저장된 일촬표와 연결 컷 행을 삭제합니다. */
export async function deleteDailyPlan(projectId: string, dailyPlanId: string): Promise<void> {
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
  const locations = plan.shootingLocations ?? [];
  let orderIndex = 0;

  return normalizeDailyPlanShotDrafts(shots.map((shot) => dailyPlanShotToDraft(shot))).flatMap((shot) => {
    const timeMemo = [shot.startTime, shot.endTime].filter(Boolean).join("~");
    const location = findDailyPlanLocation(locations, shot);
    const locationAddress = formatDailyPlanLocationAddress(location);
    const locationMapUrl = location?.naverMapUrl ?? "";
    const cutNumbers = expandDailyPlanShootingOrder(shot.cutNumber);
    const extraMemo = [
      timeMemo ? `시간: ${timeMemo}` : "",
      shot.dayNight ? `D/N: ${shot.dayNight}` : "",
      locationAddress ? `주소: ${locationAddress}` : "",
      locationMapUrl ? `지도: ${locationMapUrl}` : "",
      shot.props ? `소품: ${shot.props}` : "",
      shot.costumeMakeup ? `의상/분장: ${shot.costumeMakeup}` : "",
      shot.sceneMemo ? `씬 메모: ${shot.sceneMemo}` : "",
      shot.memo
    ]
      .filter(Boolean)
      .join("\n");

    return cutNumbers.map((cutNumber) => {
      orderIndex += 1;
      return {
        sceneNumber: shot.sceneNumber,
        cutNumber,
        title: shot.description.trim().slice(0, 40) || `씬 ${shot.sceneNumber || "-"} 컷 ${cutNumber || "-"}`,
        description: shot.description,
        location: shot.locationName || shot.subLocation || plan.shootingLocation,
        characters: splitPeople(shot.subject),
        memo: extraMemo,
        orderIndex,
        status: normalizeShotStatus("pending")
      };
    });
  });
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

function splitPeople(value: string) {
  return value
    .split(/[,/·]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function expandDailyPlanShootingOrder(value: string) {
  const tokens = String(value ?? "")
    .split(/[-,/\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return tokens.length > 0 ? tokens : ["1"];
}

function findDailyPlanLocation(locations: DailyPlan["shootingLocations"], shot: DailyPlanShotDraft) {
  return locations.find((location) => location.id === shot.locationId) ?? locations.find((location) => location.name === shot.locationName);
}

function formatDailyPlanLocationAddress(location: DailyPlan["shootingLocations"][number] | undefined) {
  if (!location) return "";
  return [location.roadAddress, location.address].find((value) => value?.trim()) ?? location.detail ?? "";
}

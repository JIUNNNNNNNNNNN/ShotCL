import type {
  DailyPlan,
  DailyPlanDraft,
  DailyPlanLocation,
  DailyPlanMealTime,
  DailyPlanShot,
  DailyPlanShotDraft,
  DailyPlanShotStatus,
  DailyPlanSourceType,
  Project,
  Shot,
  ShotDraft,
  ShotStatus
} from "@/lib/types";

type AnyRow = Record<string, any>;

/** 예전 MVP 상태값을 새 현장용 상태값으로 안전하게 변환합니다. */
export function normalizeShotStatus(status: unknown): ShotStatus {
  if (status === "ok" || status === "done") return "ok";
  if (status === "omit" || status === "skipped") return "omit";
  return "pending";
}

/** 일촬표 편집기 상태값을 한국어 표시값으로 정리합니다. */
export function normalizeDailyPlanShotStatus(status: unknown): DailyPlanShotStatus {
  if (status === "촬영중") return "촬영중";
  if (status === "OK") return "OK";
  if (status === "보류") return "보류";
  if (status === "Omit" || status === "omit") return "Omit";
  return "촬영 전";
}

function normalizeDailyPlanSourceType(value: unknown): DailyPlanSourceType {
  if (value === "excel_import") return value;
  return "web_editor";
}

function normalizeLocations(value: unknown): DailyPlanLocation[] {
  if (!Array.isArray(value)) return [];

  return value.map((item, index) => {
    const source = item as Partial<DailyPlanLocation>;
    return {
      id: source.id || `loc_${index + 1}`,
      name: source.name || "",
      detail: source.detail || "",
      searchQuery: source.searchQuery || "",
      address: source.address || "",
      roadAddress: source.roadAddress || "",
      mapx: source.mapx || "",
      mapy: source.mapy || "",
      lat: typeof source.lat === "number" ? source.lat : null,
      lng: typeof source.lng === "number" ? source.lng : null,
      category: source.category || "",
      naverMapUrl: source.naverMapUrl || ""
    };
  });
}

function normalizeMealTimes(value: unknown): DailyPlanMealTime[] {
  if (!Array.isArray(value)) return [];

  return value.map((item, index) => {
    const source = item as Partial<DailyPlanMealTime> & { type?: string; time?: string };
    return {
      id: source.id || `meal_${index + 1}`,
      startTime: source.startTime || source.time || "",
      endTime: source.endTime || "",
      memo: source.memo || source.type || ""
    };
  });
}

/** Supabase의 snake_case 프로젝트 row를 화면에서 쓰는 camelCase 타입으로 바꿉니다. */
export function projectFromRow(row: AnyRow): Project {
  return {
    id: row.id,
    name: row.name,
    shootDate: row.shoot_date ?? "",
    description: row.description ?? "",
    createdAt: row.created_at,
    shareConfigured: Boolean(row.share_enabled),
    accessRole: row.access_role === "admin" || row.access_role === "progress" ? row.access_role : undefined
  };
}

/** 화면 타입의 프로젝트 입력값을 Supabase insert/update row로 바꿉니다. */
export function projectInputToRow(input: { name: string; shootDate: string; description: string }) {
  return {
    name: input.name,
    shoot_date: input.shootDate || null,
    description: input.description
  };
}

/** Supabase의 daily_plans row를 화면 타입으로 바꿉니다. */
export function dailyPlanFromRow(row: AnyRow): DailyPlan {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title ?? "",
    sourceType: normalizeDailyPlanSourceType(row.source_type),
    sourceFileName: row.source_file_name ?? "",
    shootingDate: row.shooting_date ?? "",
    episode: row.episode ?? "",
    director: row.director ?? "",
    dop: row.dop ?? "",
    assistantDirector: row.assistant_director ?? "",
    production: row.production ?? "",
    callTime: row.call_time ?? "",
    shootStartTime: row.shoot_start_time ?? "",
    shootEndTime: row.shoot_end_time ?? "",
    meetingLocation: row.meeting_location ?? "",
    shootingLocation: row.shooting_location ?? "",
    shootingLocations: normalizeLocations(row.shooting_locations),
    mealTime: row.meal_time ?? "",
    mealTimes: normalizeMealTimes(row.meal_times),
    safetyNotice: row.safety_notice ?? "",
    memo: row.memo ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** 화면의 daily plan 입력값을 Supabase row로 바꿉니다. */
export function dailyPlanDraftToRow(projectId: string, draft: DailyPlanDraft) {
  return {
    project_id: projectId,
    title: draft.title,
    source_type: draft.sourceType,
    source_file_name: draft.sourceFileName,
    shooting_date: draft.shootingDate || null,
    episode: draft.episode,
    director: draft.director,
    dop: draft.dop,
    assistant_director: draft.assistantDirector,
    production: draft.production,
    call_time: draft.callTime,
    shoot_start_time: draft.shootStartTime,
    shoot_end_time: draft.shootEndTime,
    meeting_location: draft.meetingLocation,
    shooting_location: draft.shootingLocation,
    shooting_locations: draft.shootingLocations,
    meal_time: draft.mealTime,
    meal_times: draft.mealTimes,
    safety_notice: draft.safetyNotice,
    memo: draft.memo
  };
}

/** Supabase의 daily_plan_shots row를 화면 타입으로 바꿉니다. */
export function dailyPlanShotFromRow(row: AnyRow): DailyPlanShot {
  return {
    id: row.id,
    dailyPlanId: row.daily_plan_id,
    projectId: row.project_id,
    orderIndex: row.order_index ?? 1,
    startTime: row.start_time ?? "",
    endTime: row.end_time ?? "",
    sceneNumber: row.scene_number ?? "",
    sceneTitle: row.scene_title ?? "",
    locationId: row.location_id ?? "",
    locationName: row.location_name ?? row.sub_location ?? "",
    cutNumber: row.cut_number ?? "",
    subject: row.subject ?? "",
    subLocation: row.sub_location ?? "",
    dayNight: row.day_night ?? "",
    liveSync: row.live_sync ?? "",
    cutType: row.cut_type ?? "",
    storyDay: row.story_day ?? "",
    description: row.description ?? "",
    props: row.props ?? "",
    costumeMakeup: row.costume_makeup ?? "",
    sceneMemo: row.scene_memo ?? "",
    memo: row.memo ?? "",
    status: normalizeDailyPlanShotStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** 화면의 daily plan shot 입력값을 Supabase row로 바꿉니다. */
export function dailyPlanShotDraftToRow(projectId: string, dailyPlanId: string, draft: DailyPlanShotDraft, orderIndex?: number) {
  return {
    daily_plan_id: dailyPlanId,
    project_id: projectId,
    order_index: orderIndex ?? draft.orderIndex,
    start_time: draft.startTime,
    end_time: draft.endTime,
    scene_number: draft.sceneNumber,
    scene_title: draft.sceneTitle,
    location_id: draft.locationId,
    location_name: draft.locationName,
    cut_number: draft.cutNumber,
    subject: draft.subject,
    sub_location: draft.subLocation,
    day_night: draft.dayNight,
    live_sync: draft.liveSync,
    cut_type: draft.cutType,
    story_day: draft.storyDay,
    description: draft.description,
    props: draft.props,
    costume_makeup: draft.costumeMakeup,
    scene_memo: draft.sceneMemo,
    memo: draft.memo,
    status: normalizeDailyPlanShotStatus(draft.status)
  };
}

/** Supabase의 shots row를 화면 타입으로 바꿉니다. */
export function shotFromRow(row: AnyRow): Shot {
  return {
    id: row.id,
    projectId: row.project_id,
    dailyPlanId: row.daily_plan_id ?? null,
    analysisRunId: row.analysis_run_id ?? null,
    sceneNumber: row.scene_number ?? "",
    cutNumber: row.cut_number ?? row.shot_number ?? "",
    title: row.title,
    description: row.description ?? "",
    location: row.location ?? "",
    characters: Array.isArray(row.characters) ? row.characters : [],
    memo: row.memo ?? row.notes ?? "",
    orderIndex: row.order_index,
    status: normalizeShotStatus(row.status),
    storyboardImageUrl: row.storyboard_image_url ?? null,
    sourceFileId: row.source_file_id ?? null,
    sourcePage: row.source_page ?? null,
    sourceRow: row.source_row ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** 화면 타입의 컷 초안을 Supabase insert row로 바꿉니다. */
export function shotDraftToInsertRow(projectId: string, draft: ShotDraft, orderIndex?: number, dailyPlanId?: string | null) {
  return {
    project_id: projectId,
    daily_plan_id: dailyPlanId ?? null,
    scene_number: draft.sceneNumber,
    cut_number: draft.cutNumber,
    shot_number: draft.cutNumber,
    title: draft.title,
    description: draft.description,
    location: draft.location,
    characters: draft.characters,
    memo: draft.memo,
    notes: draft.memo,
    order_index: orderIndex ?? draft.orderIndex,
    status: normalizeShotStatus(draft.status),
    analysis_run_id: draft.analysisRunId ?? null,
    storyboard_image_url: draft.storyboardImageUrl ?? null,
    source_file_id: draft.sourceFileId ?? null,
    source_page: draft.sourcePage ?? null,
    source_row: draft.sourceRow ?? null
  };
}

/** 화면에서 수정한 컷 일부를 Supabase update row로 바꿉니다. */
export function shotPatchToRow(patch: Partial<Shot>) {
  const row: AnyRow = {};

  if (patch.sceneNumber !== undefined) row.scene_number = patch.sceneNumber;
  if (patch.cutNumber !== undefined) {
    row.cut_number = patch.cutNumber;
    row.shot_number = patch.cutNumber;
  }
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.location !== undefined) row.location = patch.location;
  if (patch.characters !== undefined) row.characters = patch.characters;
  if (patch.memo !== undefined) {
    row.memo = patch.memo;
    row.notes = patch.memo;
  }
  if (patch.orderIndex !== undefined) row.order_index = patch.orderIndex;
  if (patch.status !== undefined) row.status = normalizeShotStatus(patch.status);
  if (patch.analysisRunId !== undefined) row.analysis_run_id = patch.analysisRunId;
  if (patch.storyboardImageUrl !== undefined) row.storyboard_image_url = patch.storyboardImageUrl;
  if (patch.sourceFileId !== undefined) row.source_file_id = patch.sourceFileId;
  if (patch.sourcePage !== undefined) row.source_page = patch.sourcePage;
  if (patch.sourceRow !== undefined) row.source_row = patch.sourceRow;

  return row;
}

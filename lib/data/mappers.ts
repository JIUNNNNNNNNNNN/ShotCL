import type {
  AnalysisRun,
  AnalysisRunItem,
  AnalysisRunStatus,
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
  ShotStatus,
  StoryboardFile
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
  if (value === "excel_import" || value === "pdf_ai_import") return value;
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

/** Supabase의 storyboard_files row를 화면 타입으로 바꿉니다. */
export function storyboardFileFromRow(row: AnyRow): StoryboardFile {
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    fileType: row.file_type ?? "",
    fileSize: row.file_size ?? 0,
    storagePath: row.storage_path,
    createdAt: row.created_at
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

function normalizeAnalysisRunStatus(status: unknown): AnalysisRunStatus {
  if (status === "confirmed" || status === "discarded" || status === "failed") return status;
  return "preview";
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function normalizeShotDraftArray(value: unknown): ShotDraft[] {
  return Array.isArray(value) ? (value as ShotDraft[]) : [];
}

/** Supabase의 analysis_runs row를 화면에서 쓰는 camelCase 타입으로 바꿉니다. */
export function analysisRunFromRow(row: AnyRow): AnalysisRun {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceFileName: row.source_file_name ?? "",
    sourceFileType: row.source_file_type ?? "",
    sourceFileUrl: row.source_file_url ?? null,
    analyzerType: row.analyzer_type ?? "mock",
    status: normalizeAnalysisRunStatus(row.status),
    detectedRowCount: row.detected_row_count ?? 0,
    detectedShotCandidateCount: row.detected_shot_candidate_count ?? 0,
    generatedShotCount: row.generated_shot_count ?? 0,
    finalShotCount: row.final_shot_count ?? 0,
    aiRawResult: row.ai_raw_result ?? null,
    aiNormalizedShots: normalizeShotDraftArray(row.ai_normalized_shots),
    finalConfirmedShots: normalizeShotDraftArray(row.final_confirmed_shots),
    warnings: normalizeStringArray(row.warnings),
    debugPayload: row.debug_payload ?? null,
    textQuality: row.text_quality ?? null,
    isTextCorrupted: Boolean(row.is_text_corrupted),
    failureReason: row.failure_reason ?? "",
    userFeedback: row.user_feedback ?? "",
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? null
  };
}

/** analysis_runs insert/update 입력값을 Supabase row로 바꿉니다. */
export function analysisRunToRow(input: Partial<AnalysisRun> & { projectId?: string }) {
  const row: AnyRow = {};

  if (input.projectId !== undefined) row.project_id = input.projectId;
  if (input.sourceFileName !== undefined) row.source_file_name = input.sourceFileName;
  if (input.sourceFileType !== undefined) row.source_file_type = input.sourceFileType;
  if (input.sourceFileUrl !== undefined) row.source_file_url = input.sourceFileUrl;
  if (input.analyzerType !== undefined) row.analyzer_type = input.analyzerType;
  if (input.status !== undefined) row.status = input.status;
  if (input.detectedRowCount !== undefined) row.detected_row_count = input.detectedRowCount;
  if (input.detectedShotCandidateCount !== undefined) row.detected_shot_candidate_count = input.detectedShotCandidateCount;
  if (input.generatedShotCount !== undefined) row.generated_shot_count = input.generatedShotCount;
  if (input.finalShotCount !== undefined) row.final_shot_count = input.finalShotCount;
  if (input.aiRawResult !== undefined) row.ai_raw_result = input.aiRawResult;
  if (input.aiNormalizedShots !== undefined) row.ai_normalized_shots = input.aiNormalizedShots;
  if (input.finalConfirmedShots !== undefined) row.final_confirmed_shots = input.finalConfirmedShots;
  if (input.warnings !== undefined) row.warnings = input.warnings;
  if (input.debugPayload !== undefined) row.debug_payload = input.debugPayload;
  if (input.textQuality !== undefined) row.text_quality = input.textQuality;
  if (input.isTextCorrupted !== undefined) row.is_text_corrupted = input.isTextCorrupted;
  if (input.failureReason !== undefined) row.failure_reason = input.failureReason;
  if (input.userFeedback !== undefined) row.user_feedback = input.userFeedback;
  if (input.confirmedAt !== undefined) row.confirmed_at = input.confirmedAt;

  return row;
}

/** Supabase의 analysis_run_items row를 화면 타입으로 바꿉니다. */
export function analysisRunItemFromRow(row: AnyRow): AnalysisRunItem {
  return {
    id: row.id,
    analysisRunId: row.analysis_run_id,
    projectId: row.project_id,
    originalOrderIndex: row.original_order_index ?? null,
    finalOrderIndex: row.final_order_index ?? null,
    aiSceneNumber: row.ai_scene_number ?? "",
    aiCutNumber: row.ai_cut_number ?? "",
    aiTitle: row.ai_title ?? "",
    aiDescription: row.ai_description ?? "",
    aiLocation: row.ai_location ?? "",
    aiCharacters: normalizeStringArray(row.ai_characters),
    aiMemo: row.ai_memo ?? "",
    finalSceneNumber: row.final_scene_number ?? "",
    finalCutNumber: row.final_cut_number ?? "",
    finalTitle: row.final_title ?? "",
    finalDescription: row.final_description ?? "",
    finalLocation: row.final_location ?? "",
    finalCharacters: normalizeStringArray(row.final_characters),
    finalMemo: row.final_memo ?? "",
    action: row.action ?? "unchanged",
    sourceSheet: row.source_sheet ?? null,
    sourcePage: row.source_page ?? null,
    sourceRow: row.source_row ?? null,
    createdAt: row.created_at
  };
}

/** 분석 컷 단위 비교 결과를 Supabase insert row로 바꿉니다. */
export function analysisRunItemToRow(item: Omit<AnalysisRunItem, "id" | "createdAt">) {
  return {
    analysis_run_id: item.analysisRunId,
    project_id: item.projectId,
    original_order_index: item.originalOrderIndex,
    final_order_index: item.finalOrderIndex,
    ai_scene_number: item.aiSceneNumber,
    ai_cut_number: item.aiCutNumber,
    ai_title: item.aiTitle,
    ai_description: item.aiDescription,
    ai_location: item.aiLocation,
    ai_characters: item.aiCharacters,
    ai_memo: item.aiMemo,
    final_scene_number: item.finalSceneNumber,
    final_cut_number: item.finalCutNumber,
    final_title: item.finalTitle,
    final_description: item.finalDescription,
    final_location: item.finalLocation,
    final_characters: item.finalCharacters,
    final_memo: item.finalMemo,
    action: item.action,
    source_sheet: item.sourceSheet,
    source_page: item.sourcePage,
    source_row: item.sourceRow
  };
}

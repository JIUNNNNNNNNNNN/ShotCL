import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  getProjectRequestRole,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import {
  createProjectDeleteReceipt,
  ProjectDeleteReceiptError,
  verifyProjectDeleteReceipt
} from "@/lib/projectDeleteReceipt.server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { normalizeSceneCutMetadata } from "@/lib/archiveAssetMetadata";
import { normalizeSceneNumber } from "@/lib/sceneNumber";
import { SCENARIO_MARKER_NOT_FOUND_MESSAGE } from "@/lib/scenarioSceneMarker";
import {
  hasStoredScenarioSceneText,
  normalizeStoredProjectScenarioScenes,
  reconcileRecoveredScenarioSceneText
} from "@/lib/server/scenarioSceneTextRecovery";
import { progressMediaSummaryDisplayUrl } from "@/lib/progress/mediaGallery";
import {
  createProgressMediaPlanScope,
  isProgressMediaAssetInPlanScope,
  progressMediaCandidateDatabaseFilter
} from "@/lib/progress/mediaScope";
import type {
  ArchiveMediaAssetType,
  ArchiveSceneCutMetadata,
  ProjectScenarioScene
} from "@/lib/types";

type RouteContext = { params: Promise<{ projectId: string }> };
type AssetType = "scenario" | "storyboard" | "overhead";
type BulkStoryboardCropManifestItem = {
  clientResultId: string;
  assetId: string;
  metadata: Record<string, unknown>;
};
type BulkStoryboardCropPreparedItem = BulkStoryboardCropManifestItem & {
  file: File;
  thumbnail: File;
  rawCropData: Record<string, unknown>;
  archiveMetadata: ArchiveSceneCutMetadata;
  uploadedPath: string;
  thumbnailPath: string;
};
type BulkStoryboardCropResult = {
  clientResultId: string;
  assetId: string;
  status: "saved" | "existing" | "failed";
  asset?: ReturnType<typeof mapAssetRow>;
  error?: string;
};
type ReferenceMediaLinkTypeUpdate = {
  id: string;
  previousShotRef: string;
  previousData: Record<string, unknown>;
  nextShotRef: string;
  nextData: Record<string, unknown>;
};
type ReferenceAssetPatchBody = {
  id?: unknown;
  ids?: unknown;
  orderedAssetIds?: unknown;
  operation?: unknown;
  folderId?: unknown;
  groupId?: unknown;
  crop?: unknown;
  title?: unknown;
  memo?: unknown;
  sceneNo?: unknown;
  cutNo?: unknown;
  displayName?: unknown;
  episodeNumber?: unknown;
  sceneId?: unknown;
  sceneNumber?: unknown;
  cutNumber?: unknown;
  cropIndex?: unknown;
  assetType?: unknown;
  sortOrder?: unknown;
  scenarioScenes?: unknown;
  scenarioParseError?: unknown;
  reanalyzeScenario?: unknown;
  receipt?: unknown;
  expectedUpdatedAt?: unknown;
  expectedUpdatedAtById?: unknown;
};

const STORAGE_BUCKET = "storyboards";
const SELECT_COLUMNS = "id,project_id,asset_type,filename,storage_path,public_url,mime_type,size_bytes,daily_plan_id,scene_no,cut_no,shot_ref,group_id,crop_data,scenario_scenes,scenario_parse_error,sort_order,created_at,updated_at";
const PROGRESS_MEDIA_SELECT_COLUMNS = "id,asset_type,filename,public_url,mime_type,daily_plan_id,scene_no,cut_no,group_id,crop_data,sort_order,created_at";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BULK_STORYBOARD_MAX_ITEMS = 8;
const BULK_STORYBOARD_MAX_BYTES = 3 * 1024 * 1024;
const BULK_STORYBOARD_UPLOAD_CONCURRENCY = 4;
const REFERENCE_ASSET_DELETE_RECEIPT_KIND = "reference-assets";
const SCENARIO_SCENE_DELETE_RECEIPT_KIND = "scenario-scene";

type ReferenceAssetDeleteReceipt = {
  assets: Record<string, unknown>[];
  mediaLinks: Record<string, unknown>[];
  sourceDependents: Array<{ id: string; sourceAssetId: string }>;
};

type ScenarioSceneDeleteReceipt = {
  assetId: string;
  scene: ProjectScenarioScene;
  index: number;
  previousSceneId: string | null;
  nextSceneId: string | null;
  scenarioParseError: string | null;
};

class ReferenceAssetDeleteConflictError extends Error {
  constructor(message = "자료가 다른 곳에서 변경되어 삭제하지 않았습니다.") {
    super(message);
    this.name = "ReferenceAssetDeleteConflictError";
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if (!(await getMaterialRole(request, projectId))) {
      return NextResponse.json({ error: "프로젝트 자료를 볼 권한이 없습니다." }, { status: 403 });
    }

    const progressMedia = request.nextUrl.searchParams.get("media") === "1";
    const progressMediaMode = request.nextUrl.searchParams.get("mode") === "gallery"
      ? "gallery"
      : "summary";
    const assetType = normalizeAssetType(request.nextUrl.searchParams.get("type"));
    const assetTypes = normalizeAssetTypes(request.nextUrl.searchParams.get("types"));
    if (!progressMedia && !assetType && assetTypes.length === 0) {
      return NextResponse.json({ error: "자료 종류가 올바르지 않습니다." }, { status: 400 });
    }

    const dailyPlanId = cleanText(request.nextUrl.searchParams.get("dailyPlanId"), 500);
    const supabase = requireProjectAccessDb();
    if (progressMedia) {
      if (!UUID_PATTERN.test(dailyPlanId)) {
        return NextResponse.json({ error: "진행도 회차 ID가 올바르지 않습니다." }, { status: 400 });
      }
      const { data: plan, error: planError } = await supabase
        .from("daily_plans")
        .select("id,episode,memo")
        .eq("project_id", projectId)
        .eq("id", dailyPlanId)
        .maybeSingle();
      if (planError) throw planError;
      if (!plan) {
        return NextResponse.json({ error: "진행도 회차를 찾을 수 없습니다." }, { status: 404 });
      }
      const progressPlanScope = createProgressMediaPlanScope({
        id: String(plan.id ?? ""),
        episode: String(plan.episode ?? ""),
        memo: String(plan.memo ?? "")
      });
      if (!progressPlanScope.isWithinCandidateLimit) {
        return NextResponse.json(
          { error: "진행도 미디어를 조회할 씬 범위가 너무 큽니다." },
          { status: 422 }
        );
      }
      const { data, error } = await supabase
        .from("project_reference_assets")
        .select(PROGRESS_MEDIA_SELECT_COLUMNS)
        .eq("project_id", projectId)
        .in("asset_type", ["storyboard", "overhead"])
        .or(progressMediaCandidateDatabaseFilter(progressPlanScope))
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      const progressAssets = (data ?? [])
        .map(mapProgressMediaRow)
        .filter(isProgressArchiveMediaAsset)
        .filter((asset) => isProgressMediaAssetInPlanScope({
          dailyPlanId: asset.dailyPlanId,
          sceneId: asset.crop.sceneId ?? null,
          sceneNumber: asset.crop.sceneNumber ?? asset.sceneNo ?? "",
          cutNumber: nullablePositiveInteger(asset.crop.cutNumber ?? asset.cutNo),
          episodeNumber: nullablePositiveInteger(asset.crop.episodeNumber)
        }, progressPlanScope));
      const assets = progressMediaMode === "gallery"
        ? progressAssets
        : selectProgressMediaRepresentatives(progressAssets).map(toProgressMediaSummary);
      return NextResponse.json({ ok: true, assets });
    }

    let query = supabase
      .from("project_reference_assets")
      .select(SELECT_COLUMNS)
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    query = assetTypes.length > 0
      ? query.in("asset_type", assetTypes)
      : query.eq("asset_type", assetType as AssetType);
    if (dailyPlanId) query = query.eq("daily_plan_id", dailyPlanId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true, assets: (data ?? []).map(mapAssetRow) });
  } catch (error) {
    return materialError(error, "프로젝트 자료를 불러오지 못했습니다.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const uploadedPaths: string[] = [];
  let cleanupClient: ReturnType<typeof requireProjectAccessDb> | null = null;
  let rowPersisted = false;
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const role = await getMaterialRole(request, projectId);
    if (!role) {
      return NextResponse.json({ error: "프로젝트 자료에 접근할 권한이 없습니다." }, { status: 403 });
    }

    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = (await request.json()) as { operation?: unknown; ids?: unknown };
      if (body.operation !== "inspect_many") {
        return NextResponse.json({ error: "자료 확인 작업이 올바르지 않습니다." }, { status: 400 });
      }
      const ids = normalizeIds(body.ids);
      if (ids.length === 0) {
        return NextResponse.json({ error: "확인할 자료를 선택해주세요." }, { status: 400 });
      }
      const inspection = await inspectReferenceAssets(requireProjectAccessDb(), projectId, ids);
      if (!inspection) {
        return NextResponse.json({ error: "선택한 자료 중 일부를 찾을 수 없습니다." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, inspection });
    }

    if (role !== "admin") {
      return NextResponse.json({ error: "자료 업로드는 Key staff만 할 수 있습니다." }, { status: 403 });
    }

    const formData = await request.formData();
    if (formData.get("operation") === "bulk_storyboard_crop") {
      return handleBulkStoryboardCropUpload(projectId, formData);
    }
    const assetType = normalizeAssetType(formData.get("assetType"));
    const file = formData.get("file");
    const thumbnail = formData.get("thumbnail");
    if (!assetType || !(file instanceof File)) {
      return NextResponse.json({ error: "업로드할 자료가 없습니다." }, { status: 400 });
    }
    const validationError = validateFile(assetType, file);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 415 });
    const requestedAssetId = cleanText(formData.get("assetId"), 100).toLowerCase();
    if (requestedAssetId && !UUID_PATTERN.test(requestedAssetId)) {
      return NextResponse.json({ error: "자료 ID가 올바른 UUID 형식이 아닙니다." }, { status: 400 });
    }

    const dailyPlanId = cleanText(formData.get("dailyPlanId"), 500);
    const sceneNo = cleanText(formData.get("sceneNo"), 100);
    const cutNo = cleanText(formData.get("cutNo"), 100);
    const shotRef = cleanText(formData.get("shotRef"), 500);

    const supabase = requireProjectAccessDb();
    cleanupClient = supabase;
    if (requestedAssetId) {
      const { data: existingById, error: existingByIdError } = await supabase
        .from("project_reference_assets")
        .select(SELECT_COLUMNS)
        .eq("id", requestedAssetId)
        .eq("project_id", projectId)
        .maybeSingle();
      if (existingByIdError) throw existingByIdError;
      if (existingById) {
        if (String(existingById.asset_type ?? "") !== assetType) {
          return NextResponse.json(
            { error: "같은 자료 ID가 다른 프로젝트 또는 자료 종류에서 사용 중입니다." },
            { status: 409 }
          );
        }
        return NextResponse.json({
          ok: true,
          asset: mapAssetRow(existingById),
          idempotent: true
        });
      }
    }
    const rawCropData = parseCropFormData(formData, normalizeSourceType(formData.get("sourceType"), file));
    const rawMetadataError = validateRawArchiveMetadata(rawCropData);
    if (rawMetadataError) {
      return NextResponse.json({ error: rawMetadataError }, { status: 400 });
    }
    const sceneId = cleanText(rawCropData.sceneId, 100);
    const resolvedScene = await resolveProjectScene(supabase, projectId, sceneId);
    if (sceneId && !resolvedScene) {
      return NextResponse.json({ error: "선택한 씬을 찾을 수 없습니다." }, { status: 400 });
    }
    const sourceAssetId = cleanText(rawCropData.sourceAssetId, 100);
    if (sourceAssetId && !await hasProjectReferenceAsset(supabase, projectId, sourceAssetId)) {
      return NextResponse.json({ error: "crop 원본 자료를 찾을 수 없습니다." }, { status: 400 });
    }
    const archiveMetadata = normalizeSceneCutMetadata({
      ...rawCropData,
      sceneId: sceneId || null,
      sceneNumber: resolvedScene?.sceneNo || rawCropData.sceneNumber || sceneNo,
      cutNumber: rawCropData.cutNumber || cutNo
    }, { assetType });
    const archiveMetadataError = validateSceneCutMetadata(archiveMetadata);
    if (archiveMetadataError) {
      return NextResponse.json({ error: archiveMetadataError }, { status: 400 });
    }
    if (resolvedScene && archiveMetadata.cutNumber && !resolvedScene.cutCount) {
      return NextResponse.json(
        { error: "선택한 씬의 총 컷수를 먼저 입력해주세요." },
        { status: 400 }
      );
    }
    if (
      resolvedScene?.cutCount
      && archiveMetadata.cutNumber
      && archiveMetadata.cutNumber > resolvedScene.cutCount
    ) {
      return NextResponse.json(
        { error: `선택한 씬의 총 컷수 ${resolvedScene.cutCount}를 초과했습니다.` },
        { status: 400 }
      );
    }
    const safeFilename = safeName(file.name);
    const sourceType = normalizeSourceType(formData.get("sourceType"), file);
    const storageFolder = sourceType === "upload_pdf"
      ? "pdf"
      : sourceType === "image_crop" || sourceType === "pdf_crop"
        ? "crops"
        : "images";
    const uploadedPath = `projects/${projectId}/archive/${assetType}/${storageFolder}/${Date.now()}-${randomUUID()}-${safeFilename}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const scenarioExtraction = assetType === "scenario"
      ? await (await import("@/lib/server/scenarioPdf")).extractScenarioScenesFromPdf(fileBuffer)
      : null;
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(uploadedPath, fileBuffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false
      });
    if (uploadError) throw uploadError;
    uploadedPaths.push(uploadedPath);
    const { data: publicData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(uploadedPath);
    let thumbnailPath = "";
    let thumbnailUrl = "";
    if (thumbnail instanceof File && thumbnail.size > 0 && thumbnail.type.startsWith("image/")) {
      thumbnailPath = `projects/${projectId}/archive/${assetType}/thumbnails/${Date.now()}-${randomUUID()}-${safeName(thumbnail.name)}`;
      const { error: thumbnailError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(thumbnailPath, Buffer.from(await thumbnail.arrayBuffer()), {
          contentType: thumbnail.type || "image/jpeg",
          upsert: false
        });
      if (thumbnailError) throw thumbnailError;
      uploadedPaths.push(thumbnailPath);
      thumbnailUrl = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(thumbnailPath).data.publicUrl;
    }
    const originalFilename = cleanText(rawCropData.originalFilename, 500)
      || file.name.slice(0, 500);
    const displayName = cleanText(rawCropData.displayName, 240)
      || cleanText(rawCropData.title, 240)
      || stripFileExtension(originalFilename).slice(0, 240);
    const cropData = {
      ...rawCropData,
      sourceType,
      title: cleanText(rawCropData.title, 240) || displayName,
      displayName,
      originalFilename,
      ...archiveMetadata,
      sourceAssetId: sourceAssetId || null
    };
    const payload = {
      project_id: projectId,
      asset_type: assetType,
      filename: file.name.slice(0, 500),
      storage_path: uploadedPath,
      public_url: publicData.publicUrl,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      daily_plan_id: dailyPlanId || null,
      scene_no: archiveMetadata.sceneNumber || null,
      cut_no: archiveMetadata.cutNumber ? String(archiveMetadata.cutNumber) : null,
      shot_ref: shotRef || null,
      group_id: cleanText(formData.get("groupId"), 200) || null,
      crop_data: normalizeCrop({
        ...cropData,
        ...(thumbnailPath ? { thumbnailPath, thumbnailUrl } : {})
      }),
      scenario_scenes: scenarioExtraction?.scenes ?? [],
      scenario_parse_error: scenarioExtraction?.error ?? null,
      sort_order: toInteger(formData.get("sortOrder"))
    };

    let savedRow: Record<string, unknown> | null = null;
    if (assetType === "overhead" && dailyPlanId && shotRef) {
      const { data: existing, error: existingError } = await supabase
        .from("project_reference_assets")
        .select(SELECT_COLUMNS)
        .eq("project_id", projectId)
        .eq("asset_type", "overhead")
        .eq("daily_plan_id", dailyPlanId)
        .eq("shot_ref", shotRef)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        const { data, error } = await supabase
          .from("project_reference_assets")
          .update(payload)
          .eq("id", existing.id)
          .eq("project_id", projectId)
          .select(SELECT_COLUMNS)
          .single();
        if (error) throw error;
        savedRow = data;
        rowPersisted = true;
        const previousPaths = [
          String(existing.storage_path ?? ""),
          cleanText(normalizeCrop(existing.crop_data).thumbnailPath, 1_000)
        ].filter((path) => path && !uploadedPaths.includes(path));
        if (previousPaths.length > 0) {
          await supabase.storage.from(STORAGE_BUCKET).remove(previousPaths);
        }
      }
    }

    if (!savedRow) {
      // 이 프로젝트의 Supabase client는 Database generic이 없어 payload에서 Insert shape를 추론합니다.
      // 실제 테이블의 UUID PK를 포함하되 기존 payload shape로 좁혀 나머지 필드 검사는 유지합니다.
      const insertPayload = requestedAssetId
        ? { id: requestedAssetId, ...payload } as typeof payload
        : payload;
      const { data, error } = await supabase
        .from("project_reference_assets")
        .insert(insertPayload)
        .select(SELECT_COLUMNS)
        .single();
      if (error) {
        if (requestedAssetId && safeError(error).code === "23505") {
          const { data: existingById, error: existingByIdError } = await supabase
            .from("project_reference_assets")
            .select(SELECT_COLUMNS)
            .eq("id", requestedAssetId)
            .eq("project_id", projectId)
            .maybeSingle();
          if (existingByIdError) throw existingByIdError;
          if (existingById && isMatchingStableAsset(existingById, projectId, assetType)) {
            const storageCleanupWarning = await cleanupUploadedPaths(
              supabase,
              uploadedPaths,
              "idempotent-race"
            );
            return NextResponse.json({
              ok: true,
              asset: mapAssetRow(existingById),
              idempotent: true,
              ...(storageCleanupWarning ? { storageCleanupWarning } : {})
            });
          }
        }
        throw error;
      }
      savedRow = data;
      rowPersisted = true;
    }
    return NextResponse.json({ ok: true, asset: mapAssetRow(savedRow) }, { status: 201 });
  } catch (error) {
    if (!rowPersisted && cleanupClient && uploadedPaths.length > 0) {
      await cleanupUploadedPaths(cleanupClient, uploadedPaths, "upload-failure");
    }
    return materialError(error, "자료를 업로드하지 못했습니다.");
  }
}

async function handleBulkStoryboardCropUpload(projectId: string, formData: FormData) {
  const startedAt = performance.now();
  let cleanupClient: ReturnType<typeof requireProjectAccessDb> | null = null;
  let cleanupItems: BulkStoryboardCropPreparedItem[] = [];
  const timings = {
    validationMs: 0,
    uploadMs: 0,
    databaseMs: 0,
    cleanupMs: 0,
    totalMs: 0
  };
  try {
  const validationStartedAt = performance.now();
  const manifest = parseBulkStoryboardManifest(formData.get("manifest"));
  if (!manifest) {
    return NextResponse.json({ error: "콘티 crop 묶음 정보가 올바르지 않습니다." }, { status: 400 });
  }
  if (manifest.length === 0 || manifest.length > BULK_STORYBOARD_MAX_ITEMS) {
    return NextResponse.json(
      { error: `콘티 crop은 한 번에 1~${BULK_STORYBOARD_MAX_ITEMS}개까지 저장할 수 있습니다.` },
      { status: 400 }
    );
  }
  const expectedFileKeys = new Set(
    manifest.flatMap((item) => [`file:${item.assetId}`, `thumbnail:${item.assetId}`])
  );
  const unexpectedFileKey = [...formData.entries()].find(
    ([key, value]) => value instanceof File && !expectedFileKeys.has(key)
  )?.[0];
  if (unexpectedFileKey) {
    return NextResponse.json({ error: "manifest에 없는 crop 파일이 포함되어 있습니다." }, { status: 400 });
  }

  const duplicateAssetId = firstDuplicate(manifest.map((item) => item.assetId));
  const duplicateResultId = firstDuplicate(manifest.map((item) => item.clientResultId));
  if (duplicateAssetId || duplicateResultId) {
    return NextResponse.json(
      { error: "같은 crop 식별값이 묶음 안에 중복되어 있습니다." },
      { status: 409 }
    );
  }

  const candidates: Array<{
    manifestItem: BulkStoryboardCropManifestItem;
    file: File;
    thumbnail: File;
    rawCropData: Record<string, unknown>;
  }> = [];
  const failures = new Map<string, BulkStoryboardCropResult>();
  const totalBytes = [...formData.values()].reduce(
    (sum, value) => sum + (value instanceof File ? value.size : 0),
    0
  );
  for (const item of manifest) {
    const file = formData.get(`file:${item.assetId}`);
    const thumbnail = formData.get(`thumbnail:${item.assetId}`);
    const error = validateBulkStoryboardManifestItem(item, file, thumbnail);
    if (error || !(file instanceof File) || !(thumbnail instanceof File)) {
      failures.set(item.clientResultId, bulkFailure(item, error || "crop 이미지 파일이 없습니다."));
      continue;
    }
    const rawCropData = {
      ...parseBulkCropMetadata(item.metadata, file),
      clientResultId: item.clientResultId
    };
    const metadataError = validateRawArchiveMetadata(rawCropData);
    if (metadataError) {
      failures.set(item.clientResultId, bulkFailure(item, metadataError));
      continue;
    }
    if (rawCropData.sourceType !== "image_crop" && rawCropData.sourceType !== "pdf_crop") {
      failures.set(item.clientResultId, bulkFailure(item, "콘티 crop 원본 종류가 올바르지 않습니다."));
      continue;
    }
    const folderId = cleanText(rawCropData.folderId, 100);
    const sourceAssetId = cleanText(rawCropData.sourceAssetId, 100);
    const sceneId = cleanText(rawCropData.sceneId, 100);
    if (folderId && !UUID_PATTERN.test(folderId)) {
      failures.set(item.clientResultId, bulkFailure(item, "선택한 폴더 ID가 올바르지 않습니다."));
      continue;
    }
    if (sourceAssetId && !UUID_PATTERN.test(sourceAssetId)) {
      failures.set(item.clientResultId, bulkFailure(item, "crop 원본 자료 ID가 올바르지 않습니다."));
      continue;
    }
    if (sceneId && !UUID_PATTERN.test(sceneId)) {
      failures.set(item.clientResultId, bulkFailure(item, "선택한 씬 ID가 올바르지 않습니다."));
      continue;
    }
    candidates.push({ manifestItem: item, file, thumbnail, rawCropData });
  }
  if (totalBytes > BULK_STORYBOARD_MAX_BYTES) {
    return NextResponse.json(
      { error: "콘티 crop 묶음은 약 3MB 이하로 나누어 업로드해주세요." },
      { status: 413 }
    );
  }

  const supabase = requireProjectAccessDb();
  cleanupClient = supabase;
  const assetIds = candidates.map(({ manifestItem }) => manifestItem.assetId);
  const folderIds = uniqueNonEmpty(candidates.map(({ rawCropData }) => cleanText(rawCropData.folderId, 100)));
  const sourceAssetIds = uniqueNonEmpty(candidates.map(({ rawCropData }) => cleanText(rawCropData.sourceAssetId, 100)));
  const sceneIds = uniqueNonEmpty(candidates.map(({ rawCropData }) => cleanText(rawCropData.sceneId, 100)));
  const [
    existingRowsResult,
    folderRowsResult,
    sourceRowsResult,
    sceneRowsResult
  ] = await Promise.all([
    assetIds.length > 0
      ? supabase.from("project_reference_assets").select(SELECT_COLUMNS).in("id", assetIds)
      : Promise.resolve({ data: [], error: null }),
    folderIds.length > 0
      ? supabase.from("project_archive_folders").select("id").eq("project_id", projectId).in("id", folderIds)
      : Promise.resolve({ data: [], error: null }),
    sourceAssetIds.length > 0
      ? supabase.from("project_reference_assets").select("id").eq("project_id", projectId).in("id", sourceAssetIds)
      : Promise.resolve({ data: [], error: null }),
    sceneIds.length > 0
      ? supabase.from("project_scene_items").select("id,scene_no,cut_count").eq("project_id", projectId).in("id", sceneIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (existingRowsResult.error) throw existingRowsResult.error;
  if (folderRowsResult.error) throw folderRowsResult.error;
  if (sourceRowsResult.error) throw sourceRowsResult.error;
  if (sceneRowsResult.error) throw sceneRowsResult.error;

  const existingById = new Map(
    (existingRowsResult.data ?? []).map((row) => [String(row.id), row as Record<string, unknown>])
  );
  const validFolderIds = new Set((folderRowsResult.data ?? []).map((row) => String(row.id)));
  const validSourceAssetIds = new Set((sourceRowsResult.data ?? []).map((row) => String(row.id)));
  const sceneById = new Map(
    (sceneRowsResult.data ?? []).map((row) => [String(row.id), {
      id: String(row.id),
      sceneNo: normalizeSceneNumber(String(row.scene_no ?? "")) || cleanText(row.scene_no, 100),
      cutCount: nullablePositiveInteger(row.cut_count)
    }])
  );
  const results = new Map<string, BulkStoryboardCropResult>(failures);
  const prepared: BulkStoryboardCropPreparedItem[] = [];
  const uploadAttemptId = randomUUID();

  for (const candidate of candidates) {
    const item = candidate.manifestItem;
    const existing = existingById.get(item.assetId);
    if (existing) {
      if (!isMatchingStableAsset(existing, projectId, "storyboard")) {
        results.set(item.clientResultId, bulkFailure(
          item,
          "같은 자료 ID가 다른 프로젝트 또는 자료 종류에서 사용 중입니다."
        ));
      } else {
        results.set(item.clientResultId, {
          clientResultId: item.clientResultId,
          assetId: item.assetId,
          status: "existing",
          asset: mapAssetRow(existing)
        });
      }
      continue;
    }

    const folderId = cleanText(candidate.rawCropData.folderId, 100);
    if (folderId && !validFolderIds.has(folderId)) {
      results.set(item.clientResultId, bulkFailure(item, "선택한 폴더를 찾을 수 없습니다."));
      continue;
    }
    const sourceAssetId = cleanText(candidate.rawCropData.sourceAssetId, 100);
    if (sourceAssetId && !validSourceAssetIds.has(sourceAssetId)) {
      results.set(item.clientResultId, bulkFailure(item, "crop 원본 자료를 찾을 수 없습니다."));
      continue;
    }
    const sceneId = cleanText(candidate.rawCropData.sceneId, 100);
    const resolvedScene = sceneId ? sceneById.get(sceneId) ?? null : null;
    if (sceneId && !resolvedScene) {
      results.set(item.clientResultId, bulkFailure(item, "선택한 씬을 찾을 수 없습니다."));
      continue;
    }
    const archiveMetadata = normalizeSceneCutMetadata({
      ...candidate.rawCropData,
      sceneId: sceneId || null,
      sceneNumber: resolvedScene?.sceneNo || candidate.rawCropData.sceneNumber,
      cutNumber: candidate.rawCropData.cutNumber
    }, { assetType: "storyboard" });
    const archiveMetadataError = validateSceneCutMetadata(archiveMetadata);
    if (archiveMetadataError) {
      results.set(item.clientResultId, bulkFailure(item, archiveMetadataError));
      continue;
    }
    if (resolvedScene && archiveMetadata.cutNumber && !resolvedScene.cutCount) {
      results.set(item.clientResultId, bulkFailure(item, "선택한 씬의 총 컷수를 먼저 입력해주세요."));
      continue;
    }
    if (
      resolvedScene?.cutCount
      && archiveMetadata.cutNumber
      && archiveMetadata.cutNumber > resolvedScene.cutCount
    ) {
      results.set(item.clientResultId, bulkFailure(
        item,
        `선택한 씬의 총 컷수 ${resolvedScene.cutCount}를 초과했습니다.`
      ));
      continue;
    }

    prepared.push({
      ...item,
      file: candidate.file,
      thumbnail: candidate.thumbnail,
      rawCropData: candidate.rawCropData,
      archiveMetadata,
      uploadedPath: bulkStoryboardStoragePath(projectId, item.assetId, uploadAttemptId, "crop"),
      thumbnailPath: bulkStoryboardStoragePath(projectId, item.assetId, uploadAttemptId, "thumbnail")
    });
  }
  cleanupItems = prepared;
  timings.validationMs = performance.now() - validationStartedAt;

  const uploadStartedAt = performance.now();
  const uploadTasks = prepared.flatMap((item) => [
    { item, file: item.file, path: item.uploadedPath },
    { item, file: item.thumbnail, path: item.thumbnailPath }
  ]);
  const uploadResults = await mapSettledWithConcurrency(
    uploadTasks,
    BULK_STORYBOARD_UPLOAD_CONCURRENCY,
    async ({ file, path }) => {
      const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(
        path,
        Buffer.from(await file.arrayBuffer()),
        {
          contentType: file.type || "image/jpeg",
          upsert: false
        }
      );
      if (error) throw error;
      return path;
    }
  );
  timings.uploadMs = performance.now() - uploadStartedAt;
  const uploadErrorByAssetId = new Map<string, string>();
  uploadResults.forEach((result, index) => {
    const task = uploadTasks[index];
    if (result.status === "rejected" && !uploadErrorByAssetId.has(task.item.assetId)) {
      uploadErrorByAssetId.set(task.item.assetId, safeError(result.reason).message);
    }
  });

  const readyForInsert = prepared.filter((item) => {
    const uploadError = uploadErrorByAssetId.get(item.assetId);
    if (!uploadError) return true;
    results.set(item.clientResultId, bulkFailure(item, `Storage 업로드 실패: ${uploadError}`));
    return false;
  });
  const cleanupWarnings = new Set<string>();
  const uploadFailedItems = prepared.filter((item) => uploadErrorByAssetId.has(item.assetId));
  if (uploadFailedItems.length > 0) {
    const cleanupStartedAt = performance.now();
    const warning = await cleanupUnpersistedBulkStoryboardFiles(
      supabase,
      projectId,
      uploadFailedItems
    );
    if (warning) cleanupWarnings.add(warning);
    timings.cleanupMs += performance.now() - cleanupStartedAt;
  }

  const payloadByAssetId = new Map(
    readyForInsert.map((item) => [item.assetId, buildBulkStoryboardPayload(projectId, item, supabase)])
  );
  const databaseStartedAt = performance.now();
  if (payloadByAssetId.size > 0) {
    const payloads = [...payloadByAssetId.values()];
    const { data, error } = await supabase
      .from("project_reference_assets")
      .insert(payloads)
      .select(SELECT_COLUMNS);

    if (!error) {
      for (const row of data ?? []) {
        const item = readyForInsert.find((entry) => entry.assetId === String(row.id));
        if (!item) continue;
        results.set(item.clientResultId, {
          clientResultId: item.clientResultId,
          assetId: item.assetId,
          status: "saved",
          asset: mapAssetRow(row as Record<string, unknown>)
        });
      }
      for (const item of readyForInsert) {
        if (results.has(item.clientResultId)) continue;
        results.set(
          item.clientResultId,
          bulkFailure(item, "DB 저장 결과에서 생성된 콘티 crop을 확인하지 못했습니다.")
        );
      }
    } else {
      // 묶음 전체가 원자적으로 실패하면 최대 8개에 한해 개별 저장으로 원인을 격리합니다.
      const fallbacks = await mapSettledWithConcurrency(
        readyForInsert,
        2,
        async (item) => saveBulkStoryboardPayloadWithRaceRecovery(
          supabase,
          projectId,
          item,
          payloadByAssetId.get(item.assetId)!
        )
      );
      fallbacks.forEach((fallback, index) => {
        const item = readyForInsert[index];
        if (fallback.status === "fulfilled") {
          results.set(item.clientResultId, fallback.value);
        } else {
          results.set(item.clientResultId, bulkFailure(
            item,
            `DB 저장 실패: ${safeError(fallback.reason).message}`
          ));
        }
      });
    }
  }
  timings.databaseMs = performance.now() - databaseStartedAt;

  const unownedPersistItems = readyForInsert.filter(
    (item) => results.get(item.clientResultId)?.status !== "saved"
  );
  if (unownedPersistItems.length > 0) {
    const cleanupStartedAt = performance.now();
    const warning = await cleanupUnpersistedBulkStoryboardFiles(
      supabase,
      projectId,
      unownedPersistItems
    );
    if (warning) cleanupWarnings.add(warning);
    timings.cleanupMs += performance.now() - cleanupStartedAt;
  }

  const orderedResults = manifest.map((item) => (
    results.get(item.clientResultId)
    ?? bulkFailure(item, "콘티 crop 저장 결과를 확인하지 못했습니다.")
  ));
  timings.totalMs = performance.now() - startedAt;
  const failedCount = orderedResults.filter((result) => result.status === "failed").length;
  return NextResponse.json({
    ok: failedCount === 0,
    results: orderedResults,
    assets: orderedResults.flatMap((result) => result.asset ? [result.asset] : []),
    storageCleanupWarning: [...cleanupWarnings].join(" · "),
    timings: roundedTimings(timings)
  }, { status: failedCount > 0 ? 207 : 201 });
  } catch (error) {
    if (cleanupClient && cleanupItems.length > 0) {
      const warning = await cleanupUnpersistedBulkStoryboardFiles(
        cleanupClient,
        projectId,
        cleanupItems
      );
      if (warning) {
        console.error("[reference-assets:bulk-exception-cleanup]", warning);
      }
    }
    return materialError(error, "콘티 crop 묶음을 저장하지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "자료 수정은 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const body = (await request.json()) as ReferenceAssetPatchBody;
    const supabase = requireProjectAccessDb();
    if (body.operation === "restore_deleted") {
      const snapshot = readReferenceAssetDeleteReceipt(projectId, body.receipt);
      return restoreDeletedReferenceAssets(supabase, projectId, snapshot);
    }
    if (body.operation === "finalize_deleted") {
      const snapshot = readReferenceAssetDeleteReceipt(projectId, body.receipt);
      return finalizeDeletedReferenceAssets(supabase, projectId, snapshot);
    }
    if (body.operation === "delete_scenario_scene") {
      return deleteProjectScenarioScene(supabase, projectId, body);
    }
    if (body.operation === "restore_deleted_scenario_scene") {
      const snapshot = readScenarioSceneDeleteReceipt(projectId, body.receipt);
      return restoreDeletedProjectScenarioScene(supabase, projectId, snapshot);
    }
    if (body.operation === "finalize_deleted_scenario_scene") {
      readScenarioSceneDeleteReceipt(projectId, body.receipt);
      return NextResponse.json({ ok: true });
    }
    if (body.operation === "move_many") {
      const ids = normalizeIds(body.ids);
      if (ids.length === 0) return NextResponse.json({ error: "이동할 자료를 선택해주세요." }, { status: 400 });
      const folderId = cleanText(body.folderId, 100) || null;
      if (folderId && !await hasProjectArchiveFolder(supabase, projectId, folderId)) {
        return NextResponse.json({ error: "이동할 폴더를 찾을 수 없습니다." }, { status: 404 });
      }
      const { data: assets, error: readError } = await supabase
        .from("project_reference_assets")
        .select("id,crop_data,updated_at")
        .eq("project_id", projectId)
        .in("id", ids);
      if (readError) throw readError;
      if ((assets ?? []).length !== ids.length) {
        return NextResponse.json({ error: "이동할 자료 중 일부를 찾을 수 없습니다." }, { status: 404 });
      }

      const applied: Array<{
        asset: NonNullable<typeof assets>[number];
        updatedAt: string;
      }> = [];
      try {
        for (const asset of assets ?? []) {
          const { data: updated, error } = await supabase
            .from("project_reference_assets")
            .update({ crop_data: { ...objectValue(asset.crop_data), folderId } })
            .eq("id", asset.id)
            .eq("project_id", projectId)
            .eq("updated_at", asset.updated_at)
            .select("id,updated_at")
            .maybeSingle();
          if (error) throw error;
          if (!updated) throw new Error("이동 중 자료가 다른 요청에서 변경되었습니다.");
          applied.push({ asset, updatedAt: String(updated.updated_at ?? "") });
        }
      } catch (moveError) {
        const rollbackErrors: string[] = [];
        for (const appliedEntry of applied.reverse()) {
          const { data: rolledBack, error: rollbackError } = await supabase
            .from("project_reference_assets")
            .update({ crop_data: appliedEntry.asset.crop_data })
            .eq("id", appliedEntry.asset.id)
            .eq("project_id", projectId)
            .eq("updated_at", appliedEntry.updatedAt)
            .select("id");
          if (rollbackError || (rolledBack ?? []).length !== 1) {
            rollbackErrors.push(
              rollbackError
                ? safeError(rollbackError).message
                : `${String(appliedEntry.asset.id)} rollback skipped after concurrent change`
            );
          }
        }
        throw new Error([
          safeError(moveError).message,
          rollbackErrors.length > 0 ? `asset rollback: ${rollbackErrors.join(" / ")}` : ""
        ].filter(Boolean).join(" · "));
      }
      return NextResponse.json({ ok: true, moved: ids.length, folderId });
    }

    if (body.operation === "update_scene_cut") {
      return await updateReferenceAssetSceneCut(supabase, projectId, body);
    }

    if (body.operation === "reorder_cut_assets") {
      return await reorderReferenceAssetsInCut(supabase, projectId, body);
    }

    if (body.operation === "update_scenario_scenes") {
      return await updateReferenceAssetScenarioScenes(supabase, projectId, body);
    }

    const id = cleanText(body.id, 100);
    if (!id) return NextResponse.json({ error: "자료 ID가 필요합니다." }, { status: 400 });
    const { data: existing, error: existingError } = await supabase
      .from("project_reference_assets")
      .select(SELECT_COLUMNS)
      .eq("id", id)
      .eq("project_id", projectId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) {
      return NextResponse.json({ error: "자료를 찾을 수 없습니다." }, { status: 404 });
    }

    const scenarioMutationRequested = "scenarioScenes" in body || body.reanalyzeScenario === true;
    const expectedScenarioUpdatedAt = scenarioMutationRequested
      && body.expectedUpdatedAt !== undefined
      ? cleanText(body.expectedUpdatedAt, 80)
      : "";
    if (
      scenarioMutationRequested
      && (!expectedScenarioUpdatedAt || Number.isNaN(Date.parse(expectedScenarioUpdatedAt)))
    ) {
      return NextResponse.json({ error: "시나리오 버전 정보가 올바르지 않습니다." }, { status: 400 });
    }
    if (
      expectedScenarioUpdatedAt
      && String(existing.updated_at ?? "") !== expectedScenarioUpdatedAt
    ) {
      return NextResponse.json(
        {
          error: "시나리오가 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요.",
          asset: mapAssetRow(existing)
        },
        { status: 409 }
      );
    }

    const updatePayload: Record<string, unknown> = {};
    let mediaLinkTypeUpdates: ReferenceMediaLinkTypeUpdate[] = [];
    if ("groupId" in body) updatePayload.group_id = cleanText(body.groupId, 200) || null;
    const cropMutationRequested = [
      "crop",
      "title",
      "memo",
      "displayName",
      "episodeNumber",
      "sceneId",
      "sceneNumber",
      "sceneNo",
      "cutNumber",
      "cutNo",
      "cropIndex",
      "assetType",
      "folderId"
    ].some((key) => key in body);
    if (cropMutationRequested) {
      const currentCrop = normalizeCrop(existing.crop_data);
      const cropPatch = objectValue(body.crop);
      const folderMutationRequested = "folderId" in body || "folderId" in cropPatch;
      const cutMutationRequested = "cutNumber" in body
        || "cutNo" in body
        || "cutNumber" in cropPatch
        || "cutNo" in cropPatch;
      const rawMetadataError = validateRawArchiveMetadata({
        ...cropPatch,
        ...("episodeNumber" in body ? { episodeNumber: body.episodeNumber } : {}),
        ...("cutNumber" in body ? { cutNumber: body.cutNumber } : {}),
        ...("cutNo" in body && !("cutNumber" in body) ? { cutNo: body.cutNo } : {}),
        ...("cropIndex" in body ? { cropIndex: body.cropIndex } : {})
      });
      if (rawMetadataError) {
        return NextResponse.json({ error: rawMetadataError }, { status: 400 });
      }
      const mergedCrop: Record<string, unknown> = {
        ...currentCrop,
        ...cropPatch,
        originalFilename: cleanText(currentCrop.originalFilename, 500)
          || cleanText(existing.filename, 500),
        assetType: normalizeArchiveMediaType(existing.asset_type)
      };

      if ("title" in body || "displayName" in body) {
        const displayName = cleanText(
          "displayName" in body ? body.displayName : body.title,
          240
        );
        if (!displayName) {
          return NextResponse.json({ error: "자료 이름을 입력해주세요." }, { status: 400 });
        }
        mergedCrop.displayName = displayName;
        // 기존 화면이 title을 읽더라도 같은 표시 이름을 보도록 mirror합니다.
        mergedCrop.title = displayName;
      }
      if ("memo" in body) mergedCrop.memo = cleanText(body.memo, 1_000);
      if ("episodeNumber" in body) mergedCrop.episodeNumber = nullablePositiveInteger(body.episodeNumber);
      if ("sceneId" in body) mergedCrop.sceneId = cleanText(body.sceneId, 100) || null;
      if ("sceneNumber" in body || "sceneNo" in body) {
        const rawSceneNumber = "sceneNumber" in body ? body.sceneNumber : body.sceneNo;
        mergedCrop.sceneNumber = cleanText(rawSceneNumber, 100);
      }
      if (cutMutationRequested) {
        const rawCutNumber = "cutNumber" in body
          ? body.cutNumber
          : "cutNo" in body
            ? body.cutNo
            : "cutNumber" in cropPatch
              ? cropPatch.cutNumber
              : cropPatch.cutNo;
        mergedCrop.cutNumber = nullablePositiveInteger(rawCutNumber);
        delete mergedCrop.cutNo;
      }
      if ("cropIndex" in body) mergedCrop.cropIndex = nullableNonNegativeInteger(body.cropIndex);
      if (folderMutationRequested) {
        const rawFolderId = "folderId" in body ? body.folderId : cropPatch.folderId;
        const requestedFolderId = cleanText(rawFolderId, 100) || null;
        if (
          requestedFolderId
          && !await hasProjectArchiveFolder(supabase, projectId, requestedFolderId)
        ) {
          return NextResponse.json({ error: "선택한 폴더를 찾을 수 없습니다." }, { status: 404 });
        }
        mergedCrop.folderId = requestedFolderId;
      }

      const requestedAssetType = "assetType" in body
        ? normalizeArchiveMediaType(body.assetType)
        : normalizeArchiveMediaType(existing.asset_type);
      if (!requestedAssetType) {
        return NextResponse.json({ error: "자료 유형이 올바르지 않습니다." }, { status: 400 });
      }
      const previousAssetType = normalizeArchiveMediaType(existing.asset_type);
      if ("assetType" in body && requestedAssetType !== previousAssetType) {
        mediaLinkTypeUpdates = await prepareReferenceMediaTypeUpdates(
          supabase,
          projectId,
          id,
          requestedAssetType
        );
        updatePayload.asset_type = requestedAssetType;
      }
      mergedCrop.assetType = requestedAssetType;

      const requestedSceneId = cleanText(mergedCrop.sceneId, 100);
      const resolvedScene = await resolveProjectScene(supabase, projectId, requestedSceneId);
      if (requestedSceneId && !resolvedScene) {
        return NextResponse.json({ error: "선택한 씬을 찾을 수 없습니다." }, { status: 400 });
      }
      if (resolvedScene) mergedCrop.sceneNumber = resolvedScene.sceneNo;

      const sourceAssetId = cleanText(mergedCrop.sourceAssetId, 100);
      if (
        sourceAssetId
        && sourceAssetId !== id
        && !await hasProjectReferenceAsset(supabase, projectId, sourceAssetId)
      ) {
        return NextResponse.json({ error: "crop 원본 자료를 찾을 수 없습니다." }, { status: 400 });
      }

      const archiveMetadata = normalizeSceneCutMetadata(mergedCrop, {
        assetType: requestedAssetType,
        sceneNumber: existing.scene_no,
        ...(!cutMutationRequested ? { cutNumber: existing.cut_no } : {})
      });
      const archiveMetadataError = validateSceneCutMetadata(archiveMetadata);
      if (archiveMetadataError) {
        return NextResponse.json({ error: archiveMetadataError }, { status: 400 });
      }
      if (resolvedScene && archiveMetadata.cutNumber && !resolvedScene.cutCount) {
        return NextResponse.json(
          { error: "선택한 씬의 총 컷수를 먼저 입력해주세요." },
          { status: 400 }
        );
      }
      if (
        resolvedScene?.cutCount
        && archiveMetadata.cutNumber
        && archiveMetadata.cutNumber > resolvedScene.cutCount
      ) {
        return NextResponse.json(
          { error: `선택한 씬의 총 컷수 ${resolvedScene.cutCount}를 초과했습니다.` },
          { status: 400 }
        );
      }

      updatePayload.crop_data = normalizeCrop({
        ...mergedCrop,
        ...archiveMetadata,
        sourceAssetId: sourceAssetId || null
      });
      updatePayload.scene_no = archiveMetadata.sceneNumber || null;
      updatePayload.cut_no = archiveMetadata.cutNumber ? String(archiveMetadata.cutNumber) : null;
    }
    if ("sortOrder" in body) updatePayload.sort_order = toInteger(body.sortOrder);

    if ("scenarioScenes" in body || body.reanalyzeScenario === true) {
      if (existing.asset_type !== "scenario") {
        return NextResponse.json({ error: "시나리오 PDF를 찾을 수 없습니다." }, { status: 404 });
      }

      if (body.reanalyzeScenario === true) {
        const { data: storedFile, error: downloadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .download(String(existing.storage_path ?? ""));
        if (downloadError || !storedFile) throw downloadError ?? new Error("PDF 파일을 내려받지 못했습니다.");
        const extraction = await (await import("@/lib/server/scenarioPdf"))
          .extractScenarioScenesFromPdf(Buffer.from(await storedFile.arrayBuffer()));
        if (extraction.error || extraction.scenes.length === 0) {
          return NextResponse.json(
            { error: extraction.error || SCENARIO_MARKER_NOT_FOUND_MESSAGE },
            { status: 422 }
          );
        }
        const recovery = reconcileRecoveredScenarioSceneText(
          existing.scenario_scenes,
          extraction.scenes
        );
        if (!hasStoredScenarioSceneText(recovery.scenes)) {
          return NextResponse.json(
            { error: "시나리오 Scene 본문을 복구하지 못했습니다. PDF 원문을 확인해주세요." },
            { status: 422 }
          );
        }
        updatePayload.scenario_scenes = recovery.scenes;
        updatePayload.scenario_parse_error = null;
      } else {
        const scenes = normalizeScenarioScenes(body.scenarioScenes);
        updatePayload.scenario_scenes = scenes;
        updatePayload.scenario_parse_error = scenes.length > 0 ? null : SCENARIO_MARKER_NOT_FOUND_MESSAGE;
      }
    }
    if ("scenarioParseError" in body) {
      updatePayload.scenario_parse_error = cleanText(body.scenarioParseError, 1_000) || null;
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: "수정할 자료 설정이 없습니다." }, { status: 400 });
    }
    let updateQuery = supabase
      .from("project_reference_assets")
      .update(updatePayload)
      .eq("id", id)
      .eq("project_id", projectId);
    if (expectedScenarioUpdatedAt) {
      updateQuery = updateQuery.eq("updated_at", expectedScenarioUpdatedAt);
    }
    const { data, error } = await updateQuery
      .select(SELECT_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: latest, error: latestError } = await supabase
        .from("project_reference_assets")
        .select(SELECT_COLUMNS)
        .eq("id", id)
        .eq("project_id", projectId)
        .maybeSingle();
      if (latestError) throw latestError;
      if (expectedScenarioUpdatedAt) {
        return NextResponse.json(
          {
            error: "시나리오가 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요.",
            asset: latest ? mapAssetRow(latest) : null
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "자료를 찾을 수 없습니다." }, { status: 404 });
    }
    if (mediaLinkTypeUpdates.length > 0) {
      try {
        await applyReferenceMediaTypeUpdates(supabase, mediaLinkTypeUpdates);
      } catch (linkError) {
        const existingRecord = existing as Record<string, unknown>;
        const rollbackPayload = Object.fromEntries(
          Object.keys(updatePayload).map((key) => [key, existingRecord[key] ?? null])
        );
        const { error: rollbackError } = await supabase
          .from("project_reference_assets")
          .update(rollbackPayload)
          .eq("id", id)
          .eq("project_id", projectId);
        const detail = [
          safeError(linkError).message,
          rollbackError ? `asset rollback: ${safeError(rollbackError).message}` : ""
        ].filter(Boolean).join(" · ");
        throw new Error(`자료 유형과 기존 진행도 연결을 함께 변경하지 못했습니다. ${detail}`);
      }
    }
    return NextResponse.json({ ok: true, asset: mapAssetRow(data) });
  } catch (error) {
    return materialError(error, "자료 설정을 저장하지 못했습니다.");
  }
}

async function updateReferenceAssetScenarioScenes(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  body: ReferenceAssetPatchBody
) {
  const id = cleanText(body.id, 100);
  if (!id) {
    return NextResponse.json({ error: "자료 ID가 필요합니다." }, { status: 400 });
  }

  const expectedUpdatedAt = cleanText(body.expectedUpdatedAt, 80);
  if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
    return NextResponse.json({ error: "시나리오 버전 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const scenes = normalizeScenarioScenes(body.scenarioScenes);
  const scenarioParseError = "scenarioParseError" in body
    ? cleanText(body.scenarioParseError, 1_000) || null
    : scenes.length > 0
      ? null
      : SCENARIO_MARKER_NOT_FOUND_MESSAGE;
  const { data, error } = await supabase
    .from("project_reference_assets")
    .update({
      scenario_scenes: scenes,
      scenario_parse_error: scenarioParseError
    })
    .eq("id", id)
    .eq("project_id", projectId)
    .eq("asset_type", "scenario")
    .eq("updated_at", expectedUpdatedAt)
    .select("id,scenario_scenes,scenario_parse_error,updated_at")
    .maybeSingle();
  if (error) throw error;

  if (!data) {
    const { data: latest, error: latestError } = await supabase
      .from("project_reference_assets")
      .select(SELECT_COLUMNS)
      .eq("id", id)
      .eq("project_id", projectId)
      .maybeSingle();
    if (latestError) throw latestError;
    if (!latest) {
      return NextResponse.json({ error: "시나리오 PDF를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json(
      {
        error: "시나리오가 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요.",
        asset: mapAssetRow(latest)
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    asset: {
      id: String(data.id ?? ""),
      scenarioScenes: normalizeScenarioScenes(data.scenario_scenes),
      scenarioParseError: cleanText(data.scenario_parse_error, 1_000) || null,
      updatedAt: String(data.updated_at ?? "")
    }
  });
}

async function deleteProjectScenarioScene(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  body: ReferenceAssetPatchBody
) {
  const assetId = cleanText(body.id, 100);
  const sceneId = cleanText(body.sceneId, 100);
  const expectedUpdatedAt = cleanText(body.expectedUpdatedAt, 80);
  if (!UUID_PATTERN.test(assetId) || !sceneId) {
    return NextResponse.json({ error: "삭제할 시나리오 씬 정보가 올바르지 않습니다." }, { status: 400 });
  }
  if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
    return NextResponse.json({ error: "시나리오 버전 정보가 올바르지 않습니다." }, { status: 400 });
  }
  const { data: current, error: currentError } = await supabase
    .from("project_reference_assets")
    .select("id,asset_type,scenario_scenes,scenario_parse_error,updated_at")
    .eq("id", assetId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current || current.asset_type !== "scenario") {
    return NextResponse.json({ error: "시나리오 PDF를 찾을 수 없습니다." }, { status: 404 });
  }
  if (String(current.updated_at ?? "") !== expectedUpdatedAt) {
    return scenarioSceneConflictResponse(current);
  }
  const scenes = normalizeScenarioScenes(current.scenario_scenes);
  const matchingIndices = scenes.flatMap((scene, index) => scene.id === sceneId ? [index] : []);
  if (matchingIndices.length !== 1) {
    return NextResponse.json(
      { error: matchingIndices.length === 0 ? "삭제할 씬을 찾을 수 없습니다." : "씬 식별값이 중복되어 삭제할 수 없습니다." },
      { status: matchingIndices.length === 0 ? 404 : 409 }
    );
  }
  const index = matchingIndices[0];
  const snapshot: ScenarioSceneDeleteReceipt = {
    assetId,
    scene: scenes[index],
    index,
    previousSceneId: scenes[index - 1]?.id ?? null,
    nextSceneId: scenes[index + 1]?.id ?? null,
    scenarioParseError: cleanText(current.scenario_parse_error, 1_000) || null
  };
  const receipt = createProjectDeleteReceipt({
    projectId,
    kind: SCENARIO_SCENE_DELETE_RECEIPT_KIND,
    payload: snapshot
  });
  const remainingScenes = scenes.filter((_, sceneIndex) => sceneIndex !== index);
  const { data: updated, error: updateError } = await supabase
    .from("project_reference_assets")
    .update({
      scenario_scenes: remainingScenes,
      scenario_parse_error: remainingScenes.length > 0
        ? cleanText(current.scenario_parse_error, 1_000) || null
        : SCENARIO_MARKER_NOT_FOUND_MESSAGE
    })
    .eq("id", assetId)
    .eq("project_id", projectId)
    .eq("asset_type", "scenario")
    .eq("updated_at", expectedUpdatedAt)
    .select("id,scenario_scenes,scenario_parse_error,updated_at")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) {
    const { data: latest, error: latestError } = await supabase
      .from("project_reference_assets")
      .select("id,scenario_scenes,scenario_parse_error,updated_at")
      .eq("id", assetId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (latestError) throw latestError;
    return latest
      ? scenarioSceneConflictResponse(latest)
      : NextResponse.json({ error: "시나리오 PDF를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    deletedSceneId: sceneId,
    receipt,
    asset: scenarioScenesUpdatePayload(updated)
  });
}

function readScenarioSceneDeleteReceipt(
  projectId: string,
  receipt: unknown
): ScenarioSceneDeleteReceipt {
  const value = verifyProjectDeleteReceipt<unknown>(receipt, {
    projectId,
    kind: SCENARIO_SCENE_DELETE_RECEIPT_KIND
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectDeleteReceiptError();
  }
  const payload = value as Partial<ScenarioSceneDeleteReceipt>;
  const normalizedScene = normalizeScenarioScenes([payload.scene])[0];
  const previousSceneId = payload.previousSceneId === null
    ? null
    : cleanText(payload.previousSceneId, 100);
  const nextSceneId = payload.nextSceneId === null
    ? null
    : cleanText(payload.nextSceneId, 100);
  if (
    !UUID_PATTERN.test(cleanText(payload.assetId, 100))
    || !normalizedScene
    || normalizedScene.id !== cleanText(payload.scene?.id, 100)
    || !Number.isInteger(payload.index)
    || Number(payload.index) < 0
    || Number(payload.index) > 1_999
    || (payload.previousSceneId !== null && !previousSceneId)
    || (payload.nextSceneId !== null && !nextSceneId)
    || previousSceneId === normalizedScene.id
    || nextSceneId === normalizedScene.id
  ) {
    throw new ProjectDeleteReceiptError();
  }
  return {
    assetId: cleanText(payload.assetId, 100),
    scene: normalizedScene,
    index: Number(payload.index),
    previousSceneId,
    nextSceneId,
    scenarioParseError: cleanText(payload.scenarioParseError, 1_000) || null
  };
}

async function restoreDeletedProjectScenarioScene(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  snapshot: ScenarioSceneDeleteReceipt
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: current, error: currentError } = await supabase
      .from("project_reference_assets")
      .select("id,asset_type,scenario_scenes,scenario_parse_error,updated_at")
      .eq("id", snapshot.assetId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current || current.asset_type !== "scenario") {
      return NextResponse.json({ error: "시나리오 PDF를 찾을 수 없습니다." }, { status: 404 });
    }
    const scenes = normalizeScenarioScenes(current.scenario_scenes);
    const sameIdScenes = scenes.filter((scene) => scene.id === snapshot.scene.id);
    if (sameIdScenes.length > 0) {
      if (sameIdScenes.length !== 1 || JSON.stringify(sameIdScenes[0]) !== JSON.stringify(snapshot.scene)) {
        return NextResponse.json({ error: "같은 ID의 다른 시나리오 씬이 이미 존재합니다." }, { status: 409 });
      }
      return NextResponse.json({ ok: true, restored: false, asset: scenarioScenesUpdatePayload(current) });
    }

    let insertIndex = Math.min(snapshot.index, scenes.length);
    const previousIndex = snapshot.previousSceneId
      ? scenes.findIndex((scene) => scene.id === snapshot.previousSceneId)
      : -1;
    const nextIndex = snapshot.nextSceneId
      ? scenes.findIndex((scene) => scene.id === snapshot.nextSceneId)
      : -1;
    if (previousIndex >= 0) insertIndex = previousIndex + 1;
    else if (nextIndex >= 0) insertIndex = nextIndex;
    const mergedScenes = [...scenes];
    mergedScenes.splice(insertIndex, 0, snapshot.scene);
    const { data: restored, error: restoreError } = await supabase
      .from("project_reference_assets")
      .update({
        scenario_scenes: mergedScenes,
        scenario_parse_error: scenes.length === 0
          ? snapshot.scenarioParseError
          : cleanText(current.scenario_parse_error, 1_000) || null
      })
      .eq("id", snapshot.assetId)
      .eq("project_id", projectId)
      .eq("asset_type", "scenario")
      .eq("updated_at", current.updated_at)
      .select("id,scenario_scenes,scenario_parse_error,updated_at")
      .maybeSingle();
    if (restoreError) throw restoreError;
    if (restored) {
      return NextResponse.json({ ok: true, restored: true, asset: scenarioScenesUpdatePayload(restored) });
    }
  }
  return NextResponse.json(
    { error: "시나리오가 계속 변경되어 씬 삭제를 되돌리지 못했습니다." },
    { status: 409 }
  );
}

function scenarioScenesUpdatePayload(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    scenarioScenes: normalizeScenarioScenes(row.scenario_scenes),
    scenarioParseError: cleanText(row.scenario_parse_error, 1_000) || null,
    updatedAt: String(row.updated_at ?? "")
  };
}

function scenarioSceneConflictResponse(row: Record<string, unknown>) {
  return NextResponse.json(
    {
      error: "시나리오가 다른 곳에서 변경되었습니다. 최신 내용을 확인해주세요.",
      asset: scenarioScenesUpdatePayload(row)
    },
    { status: 409 }
  );
}

async function updateReferenceAssetSceneCut(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  body: ReferenceAssetPatchBody
) {
  const id = cleanText(body.id, 100);
  if (!id) return NextResponse.json({ error: "자료 ID가 필요합니다." }, { status: 400 });

  const sceneId = cleanText(body.sceneId, 100) || null;
  const parsedCut = parseArchiveCutNumber(body.cutNumber);
  if (parsedCut.error) return NextResponse.json({ error: parsedCut.error }, { status: 400 });
  if (parsedCut.value !== null && !sceneId) {
    return NextResponse.json({ error: "컷을 설정하려면 씬을 먼저 선택해주세요." }, { status: 400 });
  }
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "자료 ID가 올바르지 않습니다." }, { status: 400 });
  }
  if (sceneId && !UUID_PATTERN.test(sceneId)) {
    return NextResponse.json({ error: "씬 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const expectedUpdatedAt = cleanText(body.expectedUpdatedAt, 100);
  if (!expectedUpdatedAt) {
    return NextResponse.json({ error: "자료의 저장 버전이 필요합니다." }, { status: 400 });
  }
  let atomicResponse = await supabase.rpc(
    "archive_move_reference_asset_scene_cut",
    {
      p_project_id: projectId,
      p_asset_id: id,
      p_scene_id: sceneId,
      p_cut_number: parsedCut.value,
      p_expected_updated_at: expectedUpdatedAt
    }
  );
  if (isRetryableArchiveOrderRpc(atomicResponse.error)) {
    await waitForArchiveOrderRetry();
    atomicResponse = await supabase.rpc(
      "archive_move_reference_asset_scene_cut",
      {
        p_project_id: projectId,
        p_asset_id: id,
        p_scene_id: sceneId,
        p_cut_number: parsedCut.value,
        p_expected_updated_at: expectedUpdatedAt
      }
    );
  }
  const { data: atomicResult, error: atomicError } = atomicResponse;
  if (!atomicError) {
    const normalizedResult = normalizeArchiveSceneCutRpcResult(atomicResult);
    if (!normalizedResult) throw new Error("씬·컷 저장 결과를 확인하지 못했습니다.");
    if (objectValue(atomicResult).ok === false) {
      return NextResponse.json({
        error: "다른 작업의 변경을 확인했습니다. 최신 상태에서 다시 저장합니다.",
        ...normalizedResult
      }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...normalizedResult });
  }
  if (!isMissingArchiveOrderRpc(atomicError)) {
    return archiveOrderRpcErrorResponse(atomicError, "자료의 씬·컷을 저장하지 못했습니다.");
  }

  // RPC가 아직 적용되지 않은 배포에서만 기존 guarded fallback을 사용합니다.
  const resolvedScene = await resolveProjectScene(supabase, projectId, sceneId ?? "");
  if (sceneId && !resolvedScene) {
    return NextResponse.json({ error: "선택한 씬을 찾을 수 없습니다." }, { status: 400 });
  }
  if (resolvedScene && parsedCut.value !== null && !resolvedScene.cutCount) {
    return NextResponse.json({ error: "선택한 씬의 총 컷수를 먼저 입력해주세요." }, { status: 400 });
  }
  if (
    resolvedScene?.cutCount
    && parsedCut.value !== null
    && parsedCut.value > resolvedScene.cutCount
  ) {
    return NextResponse.json(
      { error: `선택한 씬의 총 컷수 ${resolvedScene.cutCount}를 초과했습니다.` },
      { status: 400 }
    );
  }

  const rows = await listOrderableArchiveRows(supabase, projectId);
  const existing = rows.find((row) => String(row.id ?? "") === id);
  if (!existing) {
    return NextResponse.json({ error: "수정할 이미지 자료를 찾을 수 없습니다." }, { status: 404 });
  }
  const previousGroup = archiveOrderGroupFromRow(existing);
  const nextGroup: ArchiveOrderGroup = { sceneId, cutNumber: parsedCut.value };
  const sceneCutStateFromRows = (currentRows: Array<Record<string, unknown>>) => {
    const currentAsset = currentRows.find((row) => String(row.id ?? "") === id) ?? null;
    const affectedRows = currentRows.filter((row) => (
      rowMatchesArchiveOrderGroup(row, previousGroup)
      || rowMatchesArchiveOrderGroup(row, nextGroup)
    ));
    const currentCrop = currentAsset ? normalizeCrop(currentAsset.crop_data) : null;
    return {
      asset: currentAsset && currentCrop ? {
        id,
        sceneId: cleanText(currentCrop.sceneId, 100) || null,
        sceneNumber: cleanText(currentCrop.sceneNumber, 100),
        cutNumber: nullablePositiveInteger(currentCrop.cutNumber),
        sortOrder: Number(currentAsset.sort_order ?? 0),
        updatedAt: String(currentAsset.updated_at ?? "")
      } : null,
      orders: affectedRows.map((row) => ({
        id: String(row.id ?? ""),
        sortOrder: Number(row.sort_order ?? 0),
        updatedAt: String(row.updated_at ?? "")
      }))
    };
  };
  if (expectedUpdatedAt && expectedUpdatedAt !== String(existing.updated_at ?? "")) {
    return NextResponse.json(
      {
        error: "다른 화면에서 자료가 먼저 수정되었습니다. 다시 열어 확인해주세요.",
        ...sceneCutStateFromRows(rows)
      },
      { status: 409 }
    );
  }

  const sameGroup = sameArchiveOrderGroup(previousGroup, nextGroup);
  const previousRows = rows
    .filter((row) => String(row.id ?? "") !== id && rowMatchesArchiveOrderGroup(row, previousGroup))
    .sort(compareArchiveOrderRows);
  const nextRows = rows
    .filter((row) => String(row.id ?? "") !== id && rowMatchesArchiveOrderGroup(row, nextGroup))
    .sort(compareArchiveOrderRows);
  const nextCrop = normalizeCrop({
    ...normalizeCrop(existing.crop_data),
    sceneId,
    sceneNumber: resolvedScene?.sceneNo || "",
    cutNumber: parsedCut.value
  });
  const storedOrder = Number(existing.sort_order ?? 0);
  const originalOrder = Number.isSafeInteger(storedOrder) ? storedOrder : 0;

  if (sameGroup) {
    const { data: moved, error } = await supabase
      .from("project_reference_assets")
      .update({
        crop_data: nextCrop,
        scene_no: resolvedScene?.sceneNo || null,
        cut_no: parsedCut.value === null ? null : String(parsedCut.value)
      })
      .eq("id", id)
      .eq("project_id", projectId)
      .eq("updated_at", String(existing.updated_at ?? ""))
      .select("id,crop_data,scene_no,cut_no,sort_order,updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!moved) {
      const currentRows = await listOrderableArchiveRows(supabase, projectId);
      return NextResponse.json(
        {
          error: "다른 화면에서 자료가 먼저 수정되었습니다. 다시 열어 확인해주세요.",
          ...sceneCutStateFromRows(currentRows)
        },
        { status: 409 }
      );
    }
    const movedRow = moved as Record<string, unknown>;
    const movedCrop = normalizeCrop(movedRow.crop_data);
    return NextResponse.json({
      ok: true,
      asset: {
        id,
        sceneId: cleanText(movedCrop.sceneId, 100) || null,
        sceneNumber: cleanText(movedCrop.sceneNumber, 100),
        cutNumber: nullablePositiveInteger(movedCrop.cutNumber),
        sortOrder: Number(movedRow.sort_order ?? originalOrder),
        updatedAt: String(movedRow.updated_at ?? "")
      },
      orders: [{
        id,
        sortOrder: Number(movedRow.sort_order ?? originalOrder),
        updatedAt: String(movedRow.updated_at ?? "")
      }]
    });
  }

  type SceneCutWrite = {
    id: string;
    expectedUpdatedAt: string;
    patch: Record<string, unknown>;
    rollback: Record<string, unknown>;
  };
  const normalizeRowOrder = (
    row: Record<string, unknown>,
    nextOrder: number
  ): SceneCutWrite | null => {
    const previousOrder = Number.isSafeInteger(Number(row.sort_order)) ? Number(row.sort_order) : 0;
    if (previousOrder === nextOrder) return null;
    return {
      id: String(row.id ?? ""),
      expectedUpdatedAt: String(row.updated_at ?? ""),
      patch: { sort_order: nextOrder },
      rollback: { sort_order: previousOrder }
    };
  };
  const orderWrites = [
    ...previousRows.map((row, index) => normalizeRowOrder(row, index + 1)),
    ...nextRows.map((row, index) => normalizeRowOrder(row, index + 1))
  ].filter((write): write is SceneCutWrite => write !== null);
  const writes: SceneCutWrite[] = [
    ...orderWrites,
    {
      id,
      expectedUpdatedAt: String(existing.updated_at ?? ""),
      patch: {
        crop_data: nextCrop,
        scene_no: resolvedScene?.sceneNo || null,
        cut_no: parsedCut.value === null ? null : String(parsedCut.value),
        sort_order: nextRows.length + 1
      },
      rollback: {
        crop_data: existing.crop_data,
        scene_no: existing.scene_no,
        cut_no: existing.cut_no,
        sort_order: originalOrder
      }
    }
  ];
  const attempts = await mapSettledWithConcurrency(writes, 6, async (write) => {
    const { data, error } = await supabase
      .from("project_reference_assets")
      .update(write.patch)
      .eq("id", write.id)
      .eq("project_id", projectId)
      .eq("updated_at", write.expectedUpdatedAt)
      .select("id,updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("자료가 다른 요청에서 먼저 변경되었습니다.");
    return { ...write, savedUpdatedAt: String(data.updated_at ?? "") };
  });
  const applied = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
  const failed = attempts.filter((attempt) => attempt.status === "rejected");
  const rollbackApplied = async () => {
    const rollbacks = await mapSettledWithConcurrency(applied, 6, async (write) => {
      const { data, error } = await supabase
        .from("project_reference_assets")
        .update(write.rollback)
        .eq("id", write.id)
        .eq("project_id", projectId)
        .eq("updated_at", write.savedUpdatedAt)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("동시 변경으로 씬·컷 변경을 복구하지 못했습니다.");
      return data;
    });
    return rollbacks.some((rollback) => rollback.status === "rejected");
  };
  const readCurrentState = async () => {
    const currentRows = await listOrderableArchiveRows(supabase, projectId);
    return {
      rows: currentRows,
      state: sceneCutStateFromRows(currentRows)
    };
  };

  if (failed.length > 0) {
    const rollbackFailed = await rollbackApplied();
    const current = await readCurrentState();
    console.error("[reference-assets/scene-cut] guarded update failed", {
      projectId,
      id,
      failedCount: failed.length,
      rollbackFailed
    });
    return NextResponse.json({
      error: rollbackFailed
        ? "다른 화면의 변경과 충돌해 씬·컷 변경을 안전하게 확정하지 못했습니다. 다시 확인해주세요."
        : "다른 화면에서 자료가 먼저 변경되었습니다. 변경 전 상태로 복구했습니다.",
      ...current.state
    }, { status: 409 });
  }

  const current = await readCurrentState();
  const normalizedPreviousRows = current.rows
    .filter((row) => rowMatchesArchiveOrderGroup(row, previousGroup))
    .sort(compareArchiveOrderRows);
  const normalizedNextRows = current.rows
    .filter((row) => rowMatchesArchiveOrderGroup(row, nextGroup))
    .sort(compareArchiveOrderRows);
  const normalized = current.state.asset?.sceneId === sceneId
    && current.state.asset.cutNumber === parsedCut.value
    && normalizedPreviousRows.every((row, index) => positiveArchiveOrder(row.sort_order) === index + 1)
    && normalizedNextRows.every((row, index) => positiveArchiveOrder(row.sort_order) === index + 1);
  if (!normalized) {
    const rollbackFailed = await rollbackApplied();
    const restored = await readCurrentState();
    console.error("[reference-assets/scene-cut] post-write verification failed", {
      projectId,
      id,
      rollbackFailed
    });
    return NextResponse.json({
      error: "동시 변경으로 씬·컷과 순서를 확정하지 못했습니다. 다시 시도해주세요.",
      ...restored.state
    }, { status: 409 });
  }
  if (!current.state.asset) throw new Error("수정한 자료의 저장 결과를 확인하지 못했습니다.");
  return NextResponse.json({ ok: true, ...current.state });
}

async function reorderReferenceAssetsInCut(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  body: ReferenceAssetPatchBody
) {
  const sceneId = cleanText(body.sceneId, 100) || null;
  const parsedCut = parseArchiveCutNumber(body.cutNumber);
  if (parsedCut.error) return NextResponse.json({ error: parsedCut.error }, { status: 400 });
  if (parsedCut.value !== null && !sceneId) {
    return NextResponse.json({ error: "컷 순서 범위가 올바르지 않습니다." }, { status: 400 });
  }
  const orderedAssetIds = normalizeOrderedAssetIds(body.orderedAssetIds);
  if (orderedAssetIds.error) {
    return NextResponse.json({ error: orderedAssetIds.error }, { status: 400 });
  }
  if (sceneId && !UUID_PATTERN.test(sceneId)) {
    return NextResponse.json({ error: "씬 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const expectedUpdatedAtById = objectValue(body.expectedUpdatedAtById);
  const expectedUpdatedAts = orderedAssetIds.value.map((id) => cleanText(expectedUpdatedAtById[id], 100));
  if (expectedUpdatedAts.some((value) => !value)) {
    return NextResponse.json({ error: "각 이미지의 저장 버전이 필요합니다." }, { status: 400 });
  }

  let atomicResponse = await supabase.rpc(
    "archive_reorder_reference_assets",
    {
      p_project_id: projectId,
      p_scene_id: sceneId,
      p_cut_number: parsedCut.value,
      p_ordered_asset_ids: orderedAssetIds.value,
      p_expected_updated_ats: expectedUpdatedAts
    }
  );
  if (isRetryableArchiveOrderRpc(atomicResponse.error)) {
    await waitForArchiveOrderRetry();
    atomicResponse = await supabase.rpc(
      "archive_reorder_reference_assets",
      {
        p_project_id: projectId,
        p_scene_id: sceneId,
        p_cut_number: parsedCut.value,
        p_ordered_asset_ids: orderedAssetIds.value,
        p_expected_updated_ats: expectedUpdatedAts
      }
    );
  }
  const { data: atomicResult, error: atomicError } = atomicResponse;
  if (!atomicError) {
    const orders = normalizeArchiveOrderRpcResult(atomicResult);
    if (!orders) throw new Error("자료 순서 저장 결과를 확인하지 못했습니다.");
    const rpcStatus = cleanText(objectValue(atomicResult).code, 100);
    if (objectValue(atomicResult).ok === false) {
      if (rpcStatus === "GROUP_CHANGED") {
        const ids = [...new Set([
          ...orders.map((order) => order.id),
          ...orderedAssetIds.value
        ])];
        const { data: currentAssets, error: currentAssetsError } = ids.length > 0
          ? await supabase
              .from("project_reference_assets")
              .select(SELECT_COLUMNS)
              .eq("project_id", projectId)
              .in("id", ids)
          : { data: [], error: null };
        if (currentAssetsError) throw currentAssetsError;
        const normalizedAssets = ((currentAssets ?? []) as Array<Record<string, unknown>>).map(mapAssetRow);
        return NextResponse.json({
          error: "같은 씬·컷의 이미지 구성이 변경되었습니다. 서버의 현재 상태로 맞춥니다.",
          orders: normalizedAssets.map((asset) => ({
            id: asset.id,
            sortOrder: asset.sortOrder,
            updatedAt: asset.updatedAt
          })),
          assets: normalizedAssets,
          groupSnapshot: true
        }, { status: 409 });
      }
      return NextResponse.json({
        error: "다른 작업의 순서 변경을 확인했습니다. 최신 상태에서 다시 저장합니다.",
        orders
      }, { status: 409 });
    }
    return NextResponse.json({ ok: true, orders });
  }
  if (!isMissingArchiveOrderRpc(atomicError)) {
    return archiveOrderRpcErrorResponse(atomicError, "자료 순서를 저장하지 못했습니다.");
  }

  // RPC가 아직 적용되지 않은 배포에서만 기존 guarded fallback을 사용합니다.
  const resolvedScene = await resolveProjectScene(supabase, projectId, sceneId ?? "");
  if (sceneId && !resolvedScene) {
    return NextResponse.json({ error: "순서를 바꿀 씬을 찾을 수 없습니다." }, { status: 400 });
  }
  if (
    resolvedScene?.cutCount
    && parsedCut.value !== null
    && parsedCut.value > resolvedScene.cutCount
  ) {
    return NextResponse.json({ error: "순서를 바꿀 컷 범위가 올바르지 않습니다." }, { status: 400 });
  }

  const rows = await listOrderableArchiveRows(supabase, projectId);
  const group: ArchiveOrderGroup = { sceneId, cutNumber: parsedCut.value };
  const scopedRows = rows.filter((row) => rowMatchesArchiveOrderGroup(row, group));
  const scopedIds = scopedRows.map((row) => String(row.id ?? ""));
  const requestedIdSet = new Set(orderedAssetIds.value);
  const snapshotRows = rows.filter((row) => (
    rowMatchesArchiveOrderGroup(row, group)
    || requestedIdSet.has(String(row.id ?? ""))
  ));
  const currentOrders = snapshotRows.map((row) => ({
    id: String(row.id ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
    updatedAt: String(row.updated_at ?? "")
  }));
  const currentAssets = snapshotRows.map(mapAssetRow);
  if (!sameStringSet(scopedIds, orderedAssetIds.value)) {
    return NextResponse.json(
      {
        error: "같은 씬·컷의 전체 이미지 순서가 일치하지 않습니다. 화면을 다시 확인해주세요.",
        orders: currentOrders,
        assets: currentAssets,
        groupSnapshot: true
      },
      { status: 409 }
    );
  }
  if (Object.keys(expectedUpdatedAtById).length > 0) {
    const expectedIds = Object.keys(expectedUpdatedAtById);
    const stale = !sameStringSet(scopedIds, expectedIds) || scopedRows.some((row) => (
      String(expectedUpdatedAtById[String(row.id ?? "")] ?? "") !== String(row.updated_at ?? "")
    ));
    if (stale) {
      return NextResponse.json(
        {
          error: "다른 화면에서 이 씬·컷 순서가 먼저 변경되었습니다. 다시 시도해주세요.",
          orders: currentOrders,
          assets: currentAssets,
          groupSnapshot: true
        },
        { status: 409 }
      );
    }
  }

  const rowById = new Map(scopedRows.map((row) => [String(row.id ?? ""), row]));
  const updates = orderedAssetIds.value.map((id, index) => {
    const row = rowById.get(id)!;
    return {
      id,
      nextOrder: index + 1,
      previousOrder: Number.isSafeInteger(Number(row.sort_order)) ? Number(row.sort_order) : 0,
      expectedUpdatedAt: String(row.updated_at ?? "")
    };
  }).filter((update) => update.previousOrder !== update.nextOrder);
  // PostgREST cannot atomically assign a different order to every row without a
  // database RPC. Keep the public request batched, but use update-only CAS writes
  // so a concurrent delete cannot be resurrected and metadata is never overwritten.
  const attempts = await mapSettledWithConcurrency(updates, 6, async (update) => {
    const { data, error } = await supabase
      .from("project_reference_assets")
      .update({ sort_order: update.nextOrder })
      .eq("id", update.id)
      .eq("project_id", projectId)
      .eq("updated_at", update.expectedUpdatedAt)
      .select("id,sort_order,updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("자료 순서가 다른 요청에서 먼저 변경되었습니다.");
    return {
      ...update,
      savedUpdatedAt: String(data.updated_at ?? ""),
      savedOrder: positiveArchiveOrder(data.sort_order) ?? update.nextOrder
    };
  });
  const applied = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
  const failed = attempts.filter((attempt) => attempt.status === "rejected");

  const rollbackApplied = async () => {
    const rollbacks = await mapSettledWithConcurrency(applied, 6, async (update) => {
      const { data, error } = await supabase
        .from("project_reference_assets")
        .update({ sort_order: update.previousOrder })
        .eq("id", update.id)
        .eq("project_id", projectId)
        .eq("updated_at", update.savedUpdatedAt)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("동시 변경으로 순서 복구를 완료하지 못했습니다.");
      return data;
    });
    return rollbacks.some((rollback) => rollback.status === "rejected");
  };

  const readCurrentGroupState = async () => {
    const currentRows = await listOrderableArchiveRows(supabase, projectId);
    const currentGroupRows = currentRows.filter((row) => (
      rowMatchesArchiveOrderGroup(row, group)
      || requestedIdSet.has(String(row.id ?? ""))
    ));
    return {
      orders: currentGroupRows.map((row) => ({
        id: String(row.id ?? ""),
        sortOrder: Number(row.sort_order ?? 0),
        updatedAt: String(row.updated_at ?? "")
      })),
      assets: currentGroupRows.map(mapAssetRow)
    };
  };

  if (failed.length > 0) {
    const rollbackFailed = await rollbackApplied();
    const currentGroup = await readCurrentGroupState();
    console.error("[reference-assets/reorder] guarded update failed", {
      projectId,
      group,
      failedCount: failed.length,
      rollbackFailed
    });
    return NextResponse.json(
      {
        error: rollbackFailed
          ? "다른 화면의 변경과 충돌해 순서를 안전하게 확정하지 못했습니다. 자료를 다시 열어 확인해주세요."
          : "다른 화면에서 이 씬·컷 자료가 먼저 변경되었습니다. 이전 순서로 복구했습니다.",
        ...currentGroup,
        groupSnapshot: true
      },
      { status: 409 }
    );
  }

  const savedRows = await listOrderableArchiveRows(supabase, projectId);
  const savedGroupRows = savedRows.filter((row) => rowMatchesArchiveOrderGroup(row, group));
  const savedById = new Map(savedGroupRows.map((row) => [String(row.id ?? ""), row]));
  const verified = sameStringSet(
    savedGroupRows.map((row) => String(row.id ?? "")),
    orderedAssetIds.value
  ) && orderedAssetIds.value.every((id, index) => (
    positiveArchiveOrder(savedById.get(id)?.sort_order) === index + 1
  ));
  if (!verified) {
    const rollbackFailed = await rollbackApplied();
    const currentGroup = await readCurrentGroupState();
    console.error("[reference-assets/reorder] post-write verification failed", {
      projectId,
      group,
      rollbackFailed
    });
    return NextResponse.json(
      {
        error: "동시 변경으로 자료 순서를 확정하지 못했습니다. 다시 시도해주세요.",
        ...currentGroup,
        groupSnapshot: true
      },
      { status: 409 }
    );
  }
  const savedOrder = new Map(
    savedGroupRows.map((row) => [
      String(row.id ?? ""),
      {
        sortOrder: positiveArchiveOrder(row.sort_order) ?? 1,
        updatedAt: String(row.updated_at ?? "")
      }
    ])
  );
  return NextResponse.json({
    ok: true,
    orders: orderedAssetIds.value.map((id, index) => ({
      id,
      sortOrder: savedOrder.get(id)?.sortOrder ?? index + 1,
      updatedAt: savedOrder.get(id)?.updatedAt ?? ""
    }))
  });
}

type ArchiveOrderGroup = {
  sceneId: string | null;
  cutNumber: number | null;
};

async function listOrderableArchiveRows(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string
) {
  const { data, error } = await supabase
    .from("project_reference_assets")
    .select(SELECT_COLUMNS)
    .eq("project_id", projectId)
    .in("asset_type", ["overhead", "storyboard"]);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).filter(isOrderableArchiveRow);
}

function isOrderableArchiveRow(row: Record<string, unknown>) {
  const assetType = String(row.asset_type ?? "");
  const mimeType = String(row.mime_type ?? "").trim().toLowerCase();
  const filename = String(row.filename ?? "").trim().toLowerCase();
  // Keep this predicate aligned with detectArchiveCropSourceKind on the client.
  // Otherwise a legacy GIF/HEIC row hidden from the grid makes exact-set reorder validation fail.
  const isImage = /^(?:image\/jpeg|image\/png|image\/webp)$/i.test(mimeType)
    || /\.(?:jpe?g|png|webp)$/i.test(filename);
  return (assetType === "overhead" || assetType === "storyboard")
    && isImage
    && !String(row.group_id ?? "").startsWith("source:");
}

function archiveOrderGroupFromRow(row: Record<string, unknown>): ArchiveOrderGroup {
  const crop = normalizeCrop(row.crop_data);
  return {
    sceneId: cleanText(crop.sceneId, 100) || null,
    cutNumber: nullablePositiveInteger(crop.cutNumber ?? row.cut_no)
  };
}

function rowMatchesArchiveOrderGroup(row: Record<string, unknown>, group: ArchiveOrderGroup) {
  return sameArchiveOrderGroup(archiveOrderGroupFromRow(row), group);
}

function sameArchiveOrderGroup(left: ArchiveOrderGroup, right: ArchiveOrderGroup) {
  return left.sceneId === right.sceneId && left.cutNumber === right.cutNumber;
}

function compareArchiveOrderRows(left: Record<string, unknown>, right: Record<string, unknown>) {
  // Match the archive grid: legacy/non-positive orders sort first, then created_at/id.
  const leftOrder = positiveArchiveOrder(left.sort_order) ?? 0;
  const rightOrder = positiveArchiveOrder(right.sort_order) ?? 0;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const createdOrder = Date.parse(String(left.created_at ?? "")) - Date.parse(String(right.created_at ?? ""));
  if (Number.isFinite(createdOrder) && createdOrder !== 0) return createdOrder;
  return String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function positiveArchiveOrder(value: unknown) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function parseArchiveCutNumber(value: unknown): { value: number | null; error: string } {
  if (value === null || value === undefined || value === "") return { value: null, error: "" };
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 2_147_483_647) {
    return { value: null, error: "컷은 1 이상의 정수로 입력해주세요." };
  }
  return { value: numeric, error: "" };
}

function normalizeOrderedAssetIds(value: unknown): { value: string[]; error: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    return { value: [], error: "순서를 저장할 이미지 목록이 올바르지 않습니다." };
  }
  const ids = value.map((entry) => cleanText(entry, 100));
  if (ids.some((id) => !UUID_PATTERN.test(id))) {
    return { value: [], error: "순서를 저장할 이미지 ID가 올바르지 않습니다." };
  }
  if (new Set(ids).size !== ids.length) {
    return { value: [], error: "같은 이미지 ID가 순서 목록에 중복되어 있습니다." };
  }
  return { value: ids, error: "" };
}

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every((value) => expected.has(value));
}

async function normalizeReferenceAssetOrdersAfterDelete(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  affectedGroups: ArchiveOrderGroup[]
) {
  const groups = affectedGroups.filter((group, index) => (
    affectedGroups.findIndex((candidate) => sameArchiveOrderGroup(candidate, group)) === index
  ));
  if (groups.length === 0) {
    return { orders: [] as Array<{ id: string; sortOrder: number; updatedAt: string }>, warning: "" };
  }

  const currentRows = await listOrderableArchiveRows(supabase, projectId);
  const updates = groups.flatMap((group) => currentRows
    .filter((row) => rowMatchesArchiveOrderGroup(row, group))
    .sort(compareArchiveOrderRows)
    .map((row, index) => ({
      id: String(row.id ?? ""),
      nextOrder: index + 1,
      currentOrder: positiveArchiveOrder(row.sort_order),
      expectedUpdatedAt: String(row.updated_at ?? "")
    })))
    .filter((update) => update.id && update.currentOrder !== update.nextOrder);

  const attempts = await mapSettledWithConcurrency(updates, 6, async (update) => {
    const { data, error } = await supabase
      .from("project_reference_assets")
      .update({ sort_order: update.nextOrder })
      .eq("id", update.id)
      .eq("project_id", projectId)
      .eq("updated_at", update.expectedUpdatedAt)
      .select("id,sort_order,updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("삭제 후 순서 정리 중 다른 요청에서 자료가 변경되었습니다.");
    return data;
  });
  const failedCount = attempts.filter((attempt) => attempt.status === "rejected").length;
  if (failedCount > 0) {
    console.error("[reference-assets:delete-order-normalization]", {
      projectId,
      affectedGroupCount: groups.length,
      failedCount
    });
  }

  const savedRows = await listOrderableArchiveRows(supabase, projectId);
  const savedScopedRows = savedRows
    .filter((row) => groups.some((group) => rowMatchesArchiveOrderGroup(row, group)));
  const fullyNormalized = groups.every((group) => savedScopedRows
    .filter((row) => rowMatchesArchiveOrderGroup(row, group))
    .sort(compareArchiveOrderRows)
    .every((row, index) => positiveArchiveOrder(row.sort_order) === index + 1));
  if (!fullyNormalized) {
    console.error("[reference-assets:delete-order-verification]", {
      projectId,
      affectedGroupCount: groups.length
    });
  }
  return {
    orders: savedScopedRows.map((row) => ({
        id: String(row.id ?? ""),
        sortOrder: Number.isSafeInteger(Number(row.sort_order)) ? Number(row.sort_order) : 0,
        updatedAt: String(row.updated_at ?? "")
      })),
    warning: failedCount > 0 || !fullyNormalized
      ? "이미지는 삭제됐지만 일부 순서 번호를 정리하지 못했습니다."
      : ""
  };
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "자료 삭제는 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as { ids?: unknown };
    const queryId = cleanText(request.nextUrl.searchParams.get("id"), 100);
    const ids = normalizeIds(body.ids);
    if (queryId) ids.unshift(queryId);
    const uniqueIds = [...new Set(ids)].slice(0, 500);
    if (uniqueIds.length === 0) return NextResponse.json({ error: "자료 ID가 필요합니다." }, { status: 400 });
    if (uniqueIds.some((id) => !UUID_PATTERN.test(id))) {
      return NextResponse.json({ error: "자료 ID가 올바르지 않습니다." }, { status: 400 });
    }
    const supabase = requireProjectAccessDb();
    const { data: existing, error: readError } = await supabase
      .from("project_reference_assets")
      .select(SELECT_COLUMNS)
      .eq("project_id", projectId)
      .in("id", uniqueIds);
    if (readError) throw readError;
    if ((existing ?? []).length !== uniqueIds.length) {
      return NextResponse.json({ error: "삭제할 자료 중 일부를 찾을 수 없습니다." }, { status: 404 });
    }
    const affectedOrderGroups = ((existing ?? []) as Array<Record<string, unknown>>)
      .filter(isOrderableArchiveRow)
      .map(archiveOrderGroupFromRow);
    const assetIdSet = new Set((existing ?? []).map((asset) => String(asset.id)));
    const { data: linkRows, error: linkReadError } = await supabase
      .from("shot_diagrams")
      .select("*")
      .eq("project_id", projectId)
      .eq("diagram_type", "overhead")
      .like("shot_ref", "media-link:%");
    if (linkReadError && linkReadError.code !== "42P01") throw linkReadError;
    const affectedLinks = (linkRows ?? []).filter((row) => {
      const data = objectValue(row.data);
      return data.kind === "media_link"
        && data.source === "reference"
        && assetIdSet.has(cleanText(data.assetId, 100));
    });
    const { data: possibleSourceDependents, error: sourceDependentReadError } = await supabase
      .from("project_reference_assets")
      .select("id,project_id,crop_data,updated_at")
      .eq("project_id", projectId);
    if (sourceDependentReadError) throw sourceDependentReadError;
    const sourceDependents = (possibleSourceDependents ?? []).flatMap((row) => {
      const sourceAssetId = cleanText(normalizeCrop(row.crop_data).sourceAssetId, 100);
      return sourceAssetId
        && assetIdSet.has(sourceAssetId)
        && !assetIdSet.has(String(row.id))
        ? [{
            row: row as Record<string, unknown>,
            relation: { id: String(row.id), sourceAssetId }
          }]
        : [];
    });
    // Sign the exact rows and relations before any mutation. Storage bytes are
    // deliberately excluded from this critical path and remain available
    // until the shared project Undo stack evicts/finalizes this operation.
    const receipt = createProjectDeleteReceipt({
      projectId,
      kind: REFERENCE_ASSET_DELETE_RECEIPT_KIND,
      payload: {
        assets: (existing ?? []) as Record<string, unknown>[],
        mediaLinks: (affectedLinks ?? []) as Record<string, unknown>[],
        sourceDependents: sourceDependents.map(({ relation }) => relation)
      } satisfies ReferenceAssetDeleteReceipt
    });

    const deletedLinks: Record<string, unknown>[] = [];
    const deletedAssets: Record<string, unknown>[] = [];
    const detachedSourceDependents: Array<{
      row: Record<string, unknown>;
      detachedUpdatedAt: string;
    }> = [];
    try {
      for (const link of affectedLinks) {
        let query = supabase
          .from("shot_diagrams")
          .delete()
          .eq("project_id", projectId)
          .eq("id", link.id);
        const linkUpdatedAt = cleanText(link.updated_at, 80);
        if (linkUpdatedAt) query = query.eq("updated_at", linkUpdatedAt);
        const { data: deletedRow, error: linkDeleteError } = await query
          .select("id")
          .maybeSingle();
        if (linkDeleteError) throw linkDeleteError;
        if (!deletedRow) {
          throw new ReferenceAssetDeleteConflictError("자료 연결이 다른 곳에서 변경되어 삭제하지 않았습니다.");
        }
        deletedLinks.push(link as Record<string, unknown>);
      }
      for (const { row } of sourceDependents) {
        const cropData = objectValue(row.crop_data);
        const { data: detached, error: detachError } = await supabase
          .from("project_reference_assets")
          .update({ crop_data: { ...cropData, sourceAssetId: null } })
          .eq("project_id", projectId)
          .eq("id", row.id)
          .eq("updated_at", row.updated_at)
          .select("id,updated_at")
          .maybeSingle();
        if (detachError) throw detachError;
        if (!detached) {
          throw new ReferenceAssetDeleteConflictError("원본을 사용하는 자료가 다른 곳에서 변경되어 삭제하지 않았습니다.");
        }
        detachedSourceDependents.push({
          row,
          detachedUpdatedAt: String(detached.updated_at ?? "")
        });
      }
      for (const asset of (existing ?? []) as Record<string, unknown>[]) {
        const { data: deletedRow, error: deleteError } = await supabase
          .from("project_reference_assets")
          .delete()
          .eq("project_id", projectId)
          .eq("id", asset.id)
          .eq("updated_at", asset.updated_at)
          .select("id")
          .maybeSingle();
        if (deleteError) throw deleteError;
        if (!deletedRow) throw new ReferenceAssetDeleteConflictError();
        deletedAssets.push(asset);
      }
    } catch (deleteError) {
      const assetRollbackErrors = await restoreReferenceAssetRows(supabase, deletedAssets);
      const sourceDependentRollbackErrors = await restoreReferenceAssetSourceRelations(
        supabase,
        detachedSourceDependents
      );
      const linkRollbackErrors = await restoreReferenceMediaLinks(supabase, deletedLinks);
      const rollbackDetail = [
        assetRollbackErrors.length > 0 ? `asset rollback: ${assetRollbackErrors.join(" / ")}` : "",
        sourceDependentRollbackErrors.length > 0
          ? `source relation rollback: ${sourceDependentRollbackErrors.join(" / ")}`
          : "",
        linkRollbackErrors.length > 0 ? `link rollback: ${linkRollbackErrors.join(" / ")}` : ""
      ].filter(Boolean).join(" · ");
      if (deleteError instanceof ReferenceAssetDeleteConflictError) {
        throw new ReferenceAssetDeleteConflictError([
          deleteError.message,
          rollbackDetail
        ].filter(Boolean).join(" · "));
      }
      throw new Error([safeError(deleteError).message, rollbackDetail].filter(Boolean).join(" · "));
    }

    let normalizedOrders: Array<{ id: string; sortOrder: number; updatedAt: string }> = [];
    let orderNormalizationWarning = "";
    try {
      const normalized = await normalizeReferenceAssetOrdersAfterDelete(
        supabase,
        projectId,
        affectedOrderGroups
      );
      normalizedOrders = normalized.orders;
      orderNormalizationWarning = normalized.warning;
    } catch (normalizationError) {
      orderNormalizationWarning = "이미지는 삭제됐지만 순서 번호를 정리하지 못했습니다.";
      console.error("[reference-assets:delete-order-normalization]", safeError(normalizationError));
    }

    return NextResponse.json({
      ok: true,
      deleted: uniqueIds.length,
      receipt,
      storageCleanupWarning: "",
      orderNormalizationWarning,
      orders: normalizedOrders
    });
  } catch (error) {
    return materialError(error, "자료를 삭제하지 못했습니다.");
  }
}

function readReferenceAssetDeleteReceipt(
  projectId: string,
  receipt: unknown
): ReferenceAssetDeleteReceipt {
  const value = verifyProjectDeleteReceipt<unknown>(receipt, {
    projectId,
    kind: REFERENCE_ASSET_DELETE_RECEIPT_KIND
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectDeleteReceiptError();
  }
  const payload = value as Partial<ReferenceAssetDeleteReceipt>;
  if (
    !Array.isArray(payload.assets)
    || payload.assets.length === 0
    || payload.assets.length > 500
    || !Array.isArray(payload.mediaLinks)
    || !Array.isArray(payload.sourceDependents)
  ) {
    throw new ProjectDeleteReceiptError();
  }
  const assetIds = new Set<string>();
  for (const row of payload.assets) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new ProjectDeleteReceiptError();
    }
    const id = cleanText(row.id, 100);
    const assetType = normalizeAssetType(row.asset_type);
    const storagePath = cleanText(row.storage_path, 1_000);
    const thumbnailPath = cleanText(normalizeCrop(row.crop_data).thumbnailPath, 1_000);
    const storagePrefix = `projects/${projectId}/archive/${assetType ?? "invalid"}/`;
    if (
      !UUID_PATTERN.test(id)
      || assetIds.has(id)
      || row.project_id !== projectId
      || !assetType
      || !storagePath.startsWith(storagePrefix)
      || storagePath.includes("..")
      || (thumbnailPath && (!thumbnailPath.startsWith(storagePrefix) || thumbnailPath.includes("..")))
    ) {
      throw new ProjectDeleteReceiptError();
    }
    assetIds.add(id);
  }
  const linkIds = new Set<string>();
  for (const row of payload.mediaLinks) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new ProjectDeleteReceiptError();
    }
    const id = cleanText(row.id, 100);
    const data = objectValue(row.data);
    if (
      !UUID_PATTERN.test(id)
      || linkIds.has(id)
      || row.project_id !== projectId
      || row.diagram_type !== "overhead"
      || data.kind !== "media_link"
      || data.source !== "reference"
      || !assetIds.has(cleanText(data.assetId, 100))
    ) {
      throw new ProjectDeleteReceiptError();
    }
    linkIds.add(id);
  }
  const sourceDependentIds = new Set<string>();
  for (const relation of payload.sourceDependents) {
    const id = cleanText(relation?.id, 100);
    const sourceAssetId = cleanText(relation?.sourceAssetId, 100);
    if (
      !UUID_PATTERN.test(id)
      || sourceDependentIds.has(id)
      || assetIds.has(id)
      || !assetIds.has(sourceAssetId)
    ) {
      throw new ProjectDeleteReceiptError();
    }
    sourceDependentIds.add(id);
  }
  return {
    assets: payload.assets,
    mediaLinks: payload.mediaLinks,
    sourceDependents: payload.sourceDependents.map((relation) => ({
      id: cleanText(relation.id, 100),
      sourceAssetId: cleanText(relation.sourceAssetId, 100)
    }))
  };
}

async function restoreDeletedReferenceAssets(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  snapshot: ReferenceAssetDeleteReceipt
) {
  const assetIds = snapshot.assets.map((row) => String(row.id));
  const { data: currentAssets, error: currentAssetsError } = await supabase
    .from("project_reference_assets")
    .select(SELECT_COLUMNS)
    .eq("project_id", projectId)
    .in("id", assetIds);
  if (currentAssetsError) throw currentAssetsError;
  const currentById = new Map((currentAssets ?? []).map((row) => [String(row.id), row]));
  for (const snapshotRow of snapshot.assets) {
    const current = currentById.get(String(snapshotRow.id));
    if (
      current
      && (
        current.storage_path !== snapshotRow.storage_path
        || current.asset_type !== snapshotRow.asset_type
      )
    ) {
      return NextResponse.json({ error: "같은 ID의 다른 자료가 이미 존재합니다." }, { status: 409 });
    }
  }

  const missingAssets = snapshot.assets.filter((row) => !currentById.has(String(row.id)));
  const linkIds = snapshot.mediaLinks.map((row) => String(row.id));
  const { data: currentLinks, error: currentLinksError } = linkIds.length > 0
    ? await supabase.from("shot_diagrams").select("*").eq("project_id", projectId).in("id", linkIds)
    : { data: [] as Record<string, unknown>[], error: null };
  if (currentLinksError && currentLinksError.code !== "42P01") throw currentLinksError;
  const currentLinksById = new Map((currentLinks ?? []).map((row) => [String(row.id), row]));
  for (const snapshotLink of snapshot.mediaLinks) {
    const current = currentLinksById.get(String(snapshotLink.id));
    const currentData = objectValue(current?.data);
    const snapshotData = objectValue(snapshotLink.data);
    if (current && (
      current.shot_ref !== snapshotLink.shot_ref
      || currentData.kind !== snapshotData.kind
      || currentData.source !== snapshotData.source
      || currentData.assetId !== snapshotData.assetId
    )) {
      return NextResponse.json({ error: "같은 ID의 다른 자료 연결이 이미 존재합니다." }, { status: 409 });
    }
  }

  const sourceDependentIds = snapshot.sourceDependents.map(({ id }) => id);
  const { data: currentSourceDependents, error: currentSourceDependentsError } = sourceDependentIds.length > 0
    ? await supabase
        .from("project_reference_assets")
        .select("id,crop_data,updated_at")
        .eq("project_id", projectId)
        .in("id", sourceDependentIds)
    : { data: [] as Record<string, unknown>[], error: null };
  if (currentSourceDependentsError) throw currentSourceDependentsError;
  const sourceRelationByDependentId = new Map(
    snapshot.sourceDependents.map((relation) => [relation.id, relation])
  );
  const sourceDependentsToRestore: Record<string, unknown>[] = [];
  for (const current of currentSourceDependents ?? []) {
    const relation = sourceRelationByDependentId.get(String(current.id));
    if (!relation) continue;
    const currentSourceAssetId = cleanText(normalizeCrop(current.crop_data).sourceAssetId, 100);
    if (currentSourceAssetId && currentSourceAssetId !== relation.sourceAssetId) {
      return NextResponse.json(
        { error: "원본 연결이 다른 자료로 변경되어 삭제를 되돌릴 수 없습니다." },
        { status: 409 }
      );
    }
    if (!currentSourceAssetId) sourceDependentsToRestore.push(current as Record<string, unknown>);
  }

  const insertedAssetIds: string[] = [];
  const insertedLinkIds: string[] = [];
  const restoredSourceDependents: Array<{ id: string; updatedAt: string }> = [];
  try {
    for (const assetBatch of chunk(missingAssets, 100)) {
      const { data, error } = await supabase
        .from("project_reference_assets")
        .insert(assetBatch)
        .select("id");
      if (error) throw error;
      insertedAssetIds.push(...(data ?? []).map((row) => String(row.id)));
    }
    const missingLinks = snapshot.mediaLinks.filter((row) => !currentLinksById.has(String(row.id)));
    for (const linkBatch of chunk(missingLinks, 100)) {
      const { data, error } = await supabase
        .from("shot_diagrams")
        .insert(linkBatch)
        .select("id");
      if (error && error.code !== "42P01") throw error;
      insertedLinkIds.push(...(data ?? []).map((row) => String(row.id)));
    }
    for (const current of sourceDependentsToRestore) {
      const relation = sourceRelationByDependentId.get(String(current.id));
      if (!relation) continue;
      const { data, error } = await supabase
        .from("project_reference_assets")
        .update({
          crop_data: {
            ...objectValue(current.crop_data),
            sourceAssetId: relation.sourceAssetId
          }
        })
        .eq("project_id", projectId)
        .eq("id", current.id)
        .eq("updated_at", current.updated_at)
        .select("id,updated_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ReferenceAssetDeleteConflictError("원본을 사용하는 자료가 다른 곳에서 변경되었습니다.");
      restoredSourceDependents.push({ id: String(data.id), updatedAt: String(data.updated_at ?? "") });
    }
  } catch (restoreError) {
    for (const restored of restoredSourceDependents.reverse()) {
      await supabase
        .from("project_reference_assets")
        .update({
          crop_data: {
            ...objectValue(sourceDependentsToRestore.find((row) => String(row.id) === restored.id)?.crop_data),
            sourceAssetId: null
          }
        })
        .eq("project_id", projectId)
        .eq("id", restored.id)
        .eq("updated_at", restored.updatedAt);
    }
    if (insertedLinkIds.length > 0) {
      await supabase.from("shot_diagrams").delete().eq("project_id", projectId).in("id", insertedLinkIds);
    }
    if (insertedAssetIds.length > 0) {
      await supabase.from("project_reference_assets").delete().eq("project_id", projectId).in("id", insertedAssetIds);
    }
    throw restoreError;
  }

  const affectedGroups = snapshot.assets
    .filter(isOrderableArchiveRow)
    .map(archiveOrderGroupFromRow);
  let normalizedOrders: Array<{ id: string; sortOrder: number; updatedAt: string }> = [];
  let orderNormalizationWarning = "";
  try {
    const normalized = await normalizeReferenceAssetOrdersAfterDelete(
      supabase,
      projectId,
      affectedGroups
    );
    normalizedOrders = normalized.orders;
    orderNormalizationWarning = normalized.warning;
  } catch (error) {
    orderNormalizationWarning = "자료는 복원했지만 일부 순서 번호를 정리하지 못했습니다.";
    console.error("[reference-assets:restore-order-normalization]", safeError(error));
  }
  const { data: restoredAssets, error: restoredAssetsError } = await supabase
    .from("project_reference_assets")
    .select(SELECT_COLUMNS)
    .eq("project_id", projectId)
    .in("id", assetIds);
  if (restoredAssetsError) throw restoredAssetsError;
  return NextResponse.json({
    ok: true,
    restored: (restoredAssets ?? []).length,
    assets: (restoredAssets ?? []).map(mapAssetRow),
    orders: normalizedOrders,
    orderNormalizationWarning
  });
}

async function finalizeDeletedReferenceAssets(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  snapshot: ReferenceAssetDeleteReceipt
) {
  const { data: currentAssets, error } = await supabase
    .from("project_reference_assets")
    .select("id,storage_path,crop_data")
    .eq("project_id", projectId);
  if (error) throw error;
  const referencedPaths = new Set((currentAssets ?? []).flatMap((row) => [
    cleanText(row.storage_path, 1_000),
    cleanText(normalizeCrop(row.crop_data).thumbnailPath, 1_000)
  ]).filter(Boolean));
  const paths = [...new Set(snapshot.assets.flatMap((row) => [
    cleanText(row.storage_path, 1_000),
    cleanText(normalizeCrop(row.crop_data).thumbnailPath, 1_000)
  ]).filter((path) => path && !referencedPaths.has(path)))];
  for (const pathBatch of chunk(paths, 100)) {
    const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(pathBatch);
    if (storageError) throw storageError;
  }
  return NextResponse.json({
    ok: true,
    finalized: paths.length,
    restored: snapshot.assets.filter((row) => (
      (currentAssets ?? []).some((current) => current.id === row.id)
    )).length
  });
}

async function getProjectId(context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  return isValidDatabaseProjectId(projectId) ? projectId : "";
}

async function getMaterialRole(request: NextRequest, projectId: string) {
  return getProjectRequestRole(request, projectId);
}

function normalizeAssetType(value: unknown): AssetType | null {
  return value === "scenario" || value === "storyboard" || value === "overhead" ? value : null;
}

function normalizeAssetTypes(value: unknown): AssetType[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(",").map((item) => normalizeAssetType(item.trim())).filter((item): item is AssetType => Boolean(item)))];
}

function isProgressArchiveMediaAsset(asset: ReturnType<typeof mapAssetRow>) {
  if (asset.assetType !== "storyboard" && asset.assetType !== "overhead") return false;
  if (asset.groupId?.startsWith("source:")) return false;
  return asset.mimeType.startsWith("image/") || /\.(?:jpe?g|png|webp)$/i.test(asset.filename);
}

/** Initial Progress cards need at most one thumbnail for each cut and media kind. */
function selectProgressMediaRepresentatives(
  assets: Array<ReturnType<typeof mapAssetRow>>
) {
  const seen = new Set<string>();
  return [...assets].sort((left, right) => {
    const sortOrder = Math.max(0, left.sortOrder) - Math.max(0, right.sortOrder);
    if (sortOrder !== 0) return sortOrder;
    const createdOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (Number.isFinite(createdOrder) && createdOrder !== 0) return createdOrder;
    return left.id.localeCompare(right.id);
  }).filter((asset) => {
    const crop = asset.crop;
    const sceneKey = cleanText(crop.sceneId, 100)
      || normalizeSceneNumber(crop.sceneNumber ?? asset.sceneNo)
      || "unassigned";
    const cutNumber = nullablePositiveInteger(crop.cutNumber ?? asset.cutNo) ?? 0;
    const key = `${asset.assetType}\u0000${sceneKey}\u0000${cutNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Summary responses carry one display URL; original galleries stay click-lazy. */
function toProgressMediaSummary(asset: ReturnType<typeof mapAssetRow>) {
  const originalUrl = asset.publicUrl.trim();
  const thumbnailUrl = cleanText(asset.crop.thumbnailUrl, 2_000);
  const displayUrl = progressMediaSummaryDisplayUrl(originalUrl, thumbnailUrl);
  return {
    ...asset,
    // Keep the canonical identity URL so explicit shot links and Archive
    // representatives dedupe without loading the whole gallery.
    publicUrl: originalUrl,
    crop: {
      ...asset.crop,
      thumbnailUrl: displayUrl
    }
  };
}

function validateFile(assetType: AssetType, file: File) {
  if (assetType === "scenario") {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return "PDF 파일만 업로드할 수 있습니다.";
    if (file.size > 50 * 1024 * 1024) return "PDF는 50MB 이하만 업로드할 수 있습니다.";
    return "";
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return file.size > 50 * 1024 * 1024 ? "PDF는 50MB 이하만 업로드할 수 있습니다." : "";
  }
  if (!file.type.startsWith("image/") && !/\.(?:jpe?g|png|gif|webp|heic|heif)$/i.test(file.name)) {
    return "PDF 또는 이미지 파일만 업로드할 수 있습니다.";
  }
  return file.size > 20 * 1024 * 1024 ? "이미지는 장당 20MB 이하만 업로드할 수 있습니다." : "";
}

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "file";
}

function stripFileExtension(value: string) {
  return value.replace(/\.[^.]+$/, "").trim() || "자료";
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanMultilineText(value: unknown, max: number) {
  return typeof value === "string"
    ? value.replace(/\r\n?/g, "\n").trim().slice(0, max)
    : "";
}

function toInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeCrop(value: unknown) {
  const source = value && typeof value === "object"
    ? value as Record<string, unknown>
    : { ratio: value };
  const number = (key: string, fallback: number) => {
    const parsed = Number(source[key]);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const ratio = number("ratio", 0);
  const sourceType = normalizeStoredSourceType(source.sourceType);
  const sourceKind = normalizeSourceKind(source.sourceKind);
  const assetType = normalizeArchiveMediaType(source.assetType);
  const hasPageIndex = source.pageIndex !== null && source.pageIndex !== undefined && source.pageIndex !== "";
  const pageIndexValue = Number(source.pageIndex);
  const sourcePageNumber = nullablePositiveInteger(source.sourcePageNumber);
  const episodeNumber = nullablePositiveInteger(source.episodeNumber);
  const sceneId = cleanText(source.sceneId, 100) || null;
  const rawSceneNumber = cleanText(source.sceneNumber ?? source.sceneNo, 100);
  const sceneNumber = normalizeSceneNumber(rawSceneNumber) || rawSceneNumber;
  const cutNumber = nullablePositiveInteger(source.cutNumber ?? source.cutNo);
  const cropIndex = nullableNonNegativeInteger(source.cropIndex);
  const normalizedLinkKey = cleanText(source.normalizedLinkKey, 1_000);
  const manuallyPositioned = nullableBoolean(source.manuallyPositioned);
  const customSize = nullableBoolean(source.customSize);
  return {
    x: Math.min(1, Math.max(0, number("x", 0))),
    y: Math.min(1, Math.max(0, number("y", 0))),
    width: Math.min(1, Math.max(0.01, number("width", 1))),
    height: Math.min(1, Math.max(0.01, number("height", 1))),
    ratio: ratio > 0 ? ratio : null,
    ...(sourceType ? { sourceType } : {}),
    ...("sourceAssetId" in source
      ? { sourceAssetId: cleanText(source.sourceAssetId, 100) || null }
      : {}),
    ...(hasPageIndex && Number.isInteger(pageIndexValue) && pageIndexValue >= 0 ? { pageIndex: pageIndexValue } : {}),
    ...(cleanText(source.sourceFilename, 500)
      ? { sourceFilename: cleanText(source.sourceFilename, 500) }
      : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(sourcePageNumber !== null ? { sourcePageNumber } : {}),
    ...(cleanText(source.importBatchId, 200)
      ? { importBatchId: cleanText(source.importBatchId, 200) }
      : {}),
    ...(cleanText(source.clientResultId, 200)
      ? { clientResultId: cleanText(source.clientResultId, 200) }
      : {}),
    ...(cleanText(source.templateId, 200) ? { templateId: cleanText(source.templateId, 200) } : {}),
    ...(manuallyPositioned !== null ? { manuallyPositioned } : {}),
    ...(customSize !== null ? { customSize } : {}),
    ...(cleanText(source.title, 240) ? { title: cleanText(source.title, 240) } : {}),
    ...(cleanText(source.displayName, 240) ? { displayName: cleanText(source.displayName, 240) } : {}),
    ...(cleanText(source.originalFilename, 500)
      ? { originalFilename: cleanText(source.originalFilename, 500) }
      : {}),
    ...(cleanText(source.memo, 1_000) ? { memo: cleanText(source.memo, 1_000) } : {}),
    ...("episodeNumber" in source ? { episodeNumber } : {}),
    ...("sceneId" in source ? { sceneId } : {}),
    ...(sceneNumber ? { sceneNumber } : {}),
    ...("cutNumber" in source || "cutNo" in source ? { cutNumber } : {}),
    ...(assetType ? { assetType } : {}),
    ...("cropIndex" in source ? { cropIndex } : {}),
    ...(normalizedLinkKey ? { normalizedLinkKey } : {}),
    ...(positiveNumber(source.basePageWidth) ? { basePageWidth: positiveNumber(source.basePageWidth) } : {}),
    ...(positiveNumber(source.basePageHeight) ? { basePageHeight: positiveNumber(source.basePageHeight) } : {}),
    ...(positiveNumber(source.cropWidth) ? { cropWidth: Math.min(1, positiveNumber(source.cropWidth)) } : {}),
    ...(positiveNumber(source.cropHeight) ? { cropHeight: Math.min(1, positiveNumber(source.cropHeight)) } : {}),
    ...(positiveNumber(source.aspectRatio) ? { aspectRatio: positiveNumber(source.aspectRatio) } : {}),
    ...(source.clickPlacementMode === "center" ? { clickPlacementMode: "center" as const } : {}),
    ...(unitNumber(source.centerX) !== null ? { centerX: unitNumber(source.centerX) as number } : {}),
    ...(unitNumber(source.centerY) !== null ? { centerY: unitNumber(source.centerY) as number } : {}),
    ...(nonNegativeInteger(source.orderIndex) !== null ? { orderIndex: nonNegativeInteger(source.orderIndex) as number } : {}),
    ...(positiveNumber(source.rowStep) ? { rowStep: Math.min(1, positiveNumber(source.rowStep)) } : {}),
    ...(positiveInteger(source.rowsPerPage) ? { rowsPerPage: positiveInteger(source.rowsPerPage) } : {}),
    ...(source.targetColumn === "storyboard" ? { targetColumn: "storyboard" as const } : {}),
    ...(source.includeContext === false || source.includeContext === "false" ? { includeContext: false as const } : {}),
    ...(cleanText(source.thumbnailUrl, 2_000) ? { thumbnailUrl: cleanText(source.thumbnailUrl, 2_000) } : {}),
    ...(cleanText(source.thumbnailPath, 1_000) ? { thumbnailPath: cleanText(source.thumbnailPath, 1_000) } : {}),
    ...("folderId" in source ? { folderId: cleanText(source.folderId, 100) || null } : {}),
    ...(cleanText(source.originalFolderName, 240)
      ? { originalFolderName: cleanText(source.originalFolderName, 240) }
      : {}),
    ...(cleanText(source.relativePath, 1_000)
      ? { relativePath: cleanText(source.relativePath, 1_000) }
      : {})
  };
}

function parseCropFormData(formData: FormData, sourceType: ReturnType<typeof normalizeSourceType>) {
  return {
    x: formData.get("cropX"),
    y: formData.get("cropY"),
    width: formData.get("cropWidth"),
    height: formData.get("cropHeight"),
    ratio: formData.get("cropRatio"),
    sourceType,
    sourceAssetId: formData.get("sourceAssetId"),
    pageIndex: formData.get("pageIndex"),
    sourceFilename: formData.get("sourceFilename"),
    sourceKind: formData.get("sourceKind"),
    sourcePageNumber: formData.get("sourcePageNumber"),
    importBatchId: formData.get("importBatchId"),
    templateId: formData.get("templateId"),
    manuallyPositioned: formData.get("manuallyPositioned"),
    customSize: formData.get("customSize"),
    title: formData.get("title"),
    memo: formData.get("memo"),
    basePageWidth: formData.get("basePageWidth"),
    basePageHeight: formData.get("basePageHeight"),
    cropWidth: formData.get("templateCropWidth"),
    cropHeight: formData.get("templateCropHeight"),
    aspectRatio: formData.get("aspectRatio"),
    clickPlacementMode: formData.get("clickPlacementMode"),
    centerX: formData.get("centerX"),
    centerY: formData.get("centerY"),
    orderIndex: formData.get("cropOrderIndex"),
    rowStep: formData.get("rowStep"),
    rowsPerPage: formData.get("rowsPerPage"),
    targetColumn: formData.get("targetColumn"),
    includeContext: formData.get("includeContext"),
    folderId: formData.get("folderId"),
    originalFolderName: formData.get("originalFolderName"),
    relativePath: formData.get("relativePath"),
    displayName: formData.get("displayName"),
    originalFilename: formData.get("originalFilename"),
    episodeNumber: formData.get("episodeNumber"),
    sceneId: formData.get("sceneId"),
    sceneNumber: formData.get("sceneNumber"),
    cutNumber: formData.get("cutNumber"),
    cropIndex: formData.get("cropIndex")
  };
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function unitNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : null;
}

function nonNegativeInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function nullableNonNegativeInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nullableBoolean(value: unknown) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function normalizeSourceType(value: FormDataEntryValue | null, file: File) {
  const normalized = normalizeStoredSourceType(value);
  if (normalized) return normalized;
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? "upload_pdf" : "upload_image";
}

function normalizeStoredSourceType(value: unknown) {
  return value === "upload_image"
    || value === "upload_pdf"
    || value === "pdf_page"
    || value === "image_crop"
    || value === "pdf_crop"
    ? value
      : null;
}

function normalizeSourceKind(value: unknown) {
  return value === "pdf" || value === "image" ? value : null;
}

function mapAssetRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    projectId: String(row.project_id ?? ""),
    assetType: String(row.asset_type ?? ""),
    filename: String(row.filename ?? ""),
    storagePath: String(row.storage_path ?? ""),
    publicUrl: String(row.public_url ?? ""),
    mimeType: String(row.mime_type ?? ""),
    sizeBytes: Number(row.size_bytes ?? 0),
    dailyPlanId: row.daily_plan_id ? String(row.daily_plan_id) : null,
    sceneNo: row.scene_no ? String(row.scene_no) : null,
    cutNo: row.cut_no ? String(row.cut_no) : null,
    shotRef: row.shot_ref ? String(row.shot_ref) : null,
    groupId: row.group_id ? String(row.group_id) : null,
    crop: normalizeCrop(row.crop_data),
    scenarioScenes: normalizeScenarioScenes(row.scenario_scenes),
    scenarioParseError: row.scenario_parse_error ? String(row.scenario_parse_error) : null,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

/** Progress 목록에 필요한 연결·대표 thumbnail metadata만 직렬화합니다. */
function mapProgressMediaRow(row: Record<string, unknown>): ReturnType<typeof mapAssetRow> {
  const crop = normalizeCrop(row.crop_data);
  return {
    id: String(row.id ?? ""),
    projectId: "",
    assetType: String(row.asset_type ?? ""),
    filename: String(row.filename ?? ""),
    storagePath: "",
    publicUrl: String(row.public_url ?? ""),
    mimeType: String(row.mime_type ?? ""),
    sizeBytes: 0,
    dailyPlanId: row.daily_plan_id ? String(row.daily_plan_id) : null,
    sceneNo: row.scene_no ? String(row.scene_no) : null,
    cutNo: row.cut_no ? String(row.cut_no) : null,
    shotRef: null,
    groupId: row.group_id ? String(row.group_id) : null,
    crop: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      ratio: null,
      ...(cleanText(crop.displayName, 240) ? { displayName: cleanText(crop.displayName, 240) } : {}),
      ...(cleanText(crop.title, 240) ? { title: cleanText(crop.title, 240) } : {}),
      ...(cleanText(crop.thumbnailUrl, 2_000) ? { thumbnailUrl: cleanText(crop.thumbnailUrl, 2_000) } : {}),
      ...(crop.episodeNumber ? { episodeNumber: crop.episodeNumber } : {}),
      ...(crop.sceneId ? { sceneId: crop.sceneId } : {}),
      ...(crop.sceneNumber ? { sceneNumber: crop.sceneNumber } : {}),
      ...(crop.cutNumber ? { cutNumber: crop.cutNumber } : {})
    },
    scenarioScenes: [],
    scenarioParseError: null,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: ""
  };
}

const normalizeScenarioScenes = normalizeStoredProjectScenarioScenes;

function nullablePositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function validateRawArchiveMetadata(value: unknown) {
  const source = objectValue(value);
  const episodeValue = source.episodeNumber;
  const cutValue = source.cutNumber ?? source.cutNo;
  const cropIndexValue = source.cropIndex;
  const sourcePageNumberValue = source.sourcePageNumber;
  if (hasValue(episodeValue) && nullablePositiveInteger(episodeValue) === null) {
    return "회차는 1 이상의 정수로 입력해주세요.";
  }
  if (hasValue(cutValue) && nullablePositiveInteger(cutValue) === null) {
    return "컷은 1 이상의 정수로 입력해주세요.";
  }
  if (hasValue(cropIndexValue) && nullableNonNegativeInteger(cropIndexValue) === null) {
    return "crop 순서는 0 이상의 정수로 입력해주세요.";
  }
  if (hasValue(sourcePageNumberValue) && nullablePositiveInteger(sourcePageNumberValue) === null) {
    return "원본 페이지 번호는 1 이상의 정수로 입력해주세요.";
  }
  if (hasValue(source.sourceKind) && !normalizeSourceKind(source.sourceKind)) {
    return "crop 원본 종류가 올바르지 않습니다.";
  }
  if (hasValue(source.manuallyPositioned) && nullableBoolean(source.manuallyPositioned) === null) {
    return "crop 수동 이동 여부가 올바르지 않습니다.";
  }
  if (hasValue(source.customSize) && nullableBoolean(source.customSize) === null) {
    return "crop 사용자 크기 여부가 올바르지 않습니다.";
  }
  return "";
}

function validateSceneCutMetadata(value: ArchiveSceneCutMetadata) {
  if (value.cutNumber !== null && !value.sceneId && !value.sceneNumber) {
    return "컷을 설정하려면 씬을 먼저 선택해주세요.";
  }
  return "";
}

async function resolveProjectScene(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  sceneId: string
) {
  if (!sceneId) return null;
  const { data, error } = await supabase
    .from("project_scene_items")
    .select("id,scene_no,cut_count")
    .eq("id", sceneId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        id: String(data.id ?? ""),
        sceneNo: normalizeSceneNumber(String(data.scene_no ?? ""))
          || cleanText(data.scene_no, 100),
        cutCount: nullablePositiveInteger(data.cut_count)
      }
    : null;
}

async function hasProjectReferenceAsset(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  assetId: string
) {
  const { data, error } = await supabase
    .from("project_reference_assets")
    .select("id")
    .eq("id", assetId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function hasProjectArchiveFolder(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  folderId: string
) {
  const { data, error } = await supabase
    .from("project_archive_folders")
    .select("id")
    .eq("id", folderId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function inspectReferenceAssets(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  ids: string[]
) {
  const { data: assets, error: assetError } = await supabase
    .from("project_reference_assets")
    .select("id")
    .eq("project_id", projectId)
    .in("id", ids);
  if (assetError) throw assetError;
  const assetIds = (assets ?? []).map((asset) => String(asset.id));
  if (assetIds.length !== ids.length) return null;
  const linkedAssetIds = await readLinkedReferenceAssetIds(supabase, projectId);
  return {
    assetIds,
    assetCount: assetIds.length,
    linkedAssetCount: assetIds.filter((id) => linkedAssetIds.has(id)).length
  };
}

async function prepareReferenceMediaTypeUpdates(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  assetId: string,
  nextType: ArchiveMediaAssetType
): Promise<ReferenceMediaLinkTypeUpdate[]> {
  const { data, error } = await supabase
    .from("shot_diagrams")
    .select("id,daily_plan_id,shot_ref,data")
    .eq("project_id", projectId)
    .eq("diagram_type", "overhead")
    .contains("data", { kind: "media_link", assetId, source: "reference" });
  if (error) {
    if (error.code === "42P01") return [];
    throw error;
  }

  const updates: ReferenceMediaLinkTypeUpdate[] = [];
  for (const row of data ?? []) {
    const previousData = objectValue(row.data);
    const linkedShotRef = cleanText(previousData.shotRef, 500);
    if (!linkedShotRef) {
      throw new Error("기존 진행도 연결의 컷 식별값을 확인할 수 없습니다.");
    }
    const nextShotRef = `media-link:${nextType}:${linkedShotRef}`.slice(0, 500);
    const { data: collision, error: collisionError } = await supabase
      .from("shot_diagrams")
      .select("id")
      .eq("project_id", projectId)
      .eq("daily_plan_id", cleanText(row.daily_plan_id, 500))
      .eq("diagram_type", "overhead")
      .eq("shot_ref", nextShotRef)
      .maybeSingle();
    if (collisionError) throw collisionError;
    if (collision && String(collision.id) !== String(row.id)) {
      throw new Error("같은 컷에 변경하려는 유형의 자료가 이미 연결되어 있습니다.");
    }
    updates.push({
      id: String(row.id),
      previousShotRef: cleanText(row.shot_ref, 500),
      previousData,
      nextShotRef,
      nextData: { ...previousData, mediaType: nextType }
    });
  }
  return updates;
}

async function readLinkedReferenceAssetIds(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string
) {
  const { data, error } = await supabase
    .from("shot_diagrams")
    .select("data")
    .eq("project_id", projectId)
    .eq("diagram_type", "overhead")
    .like("shot_ref", "media-link:%");
  if (error) {
    if (error.code === "42P01") return new Set<string>();
    throw error;
  }
  return new Set((data ?? []).flatMap((row) => {
    const source = objectValue(row.data);
    return source.kind === "media_link" && source.source === "reference"
      ? [cleanText(source.assetId, 100)].filter(Boolean)
      : [];
  }));
}

async function applyReferenceMediaTypeUpdates(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  updates: ReferenceMediaLinkTypeUpdate[]
) {
  const applied: ReferenceMediaLinkTypeUpdate[] = [];
  try {
    for (const update of updates) {
      const { error } = await supabase
        .from("shot_diagrams")
        .update({ shot_ref: update.nextShotRef, data: update.nextData })
        .eq("id", update.id);
      if (error) throw error;
      applied.push(update);
    }
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const update of applied.reverse()) {
      const { error: rollbackError } = await supabase
        .from("shot_diagrams")
        .update({ shot_ref: update.previousShotRef, data: update.previousData })
        .eq("id", update.id);
      if (rollbackError) rollbackErrors.push(safeError(rollbackError).message);
    }
    throw new Error([
      safeError(error).message,
      rollbackErrors.length > 0 ? `link rollback: ${rollbackErrors.join(" / ")}` : ""
    ].filter(Boolean).join(" · "));
  }
}

async function restoreReferenceMediaLinks(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  rows: Record<string, unknown>[]
) {
  const errors: string[] = [];
  for (const rowBatch of chunk(rows, 100)) {
    const { error } = await supabase
      .from("shot_diagrams")
      .insert(rowBatch);
    if (error) errors.push(safeError(error).message);
  }
  return errors;
}

async function restoreReferenceAssetRows(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  rows: Record<string, unknown>[]
) {
  const errors: string[] = [];
  for (const rowBatch of chunk(rows, 100)) {
    const { error } = await supabase
      .from("project_reference_assets")
      .insert(rowBatch);
    if (error) errors.push(safeError(error).message);
  }
  return errors;
}

async function restoreReferenceAssetSourceRelations(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  rows: Array<{ row: Record<string, unknown>; detachedUpdatedAt: string }>
) {
  const errors: string[] = [];
  for (const { row, detachedUpdatedAt } of rows) {
    const { data, error } = await supabase
      .from("project_reference_assets")
      .update({ crop_data: row.crop_data })
      .eq("project_id", row.project_id)
      .eq("id", row.id)
      .eq("updated_at", detachedUpdatedAt)
      .select("id")
      .maybeSingle();
    if (error) errors.push(safeError(error).message);
    else if (!data) errors.push(`${String(row.id)} rollback skipped after concurrent change`);
  }
  return errors;
}

function parseBulkStoryboardManifest(value: FormDataEntryValue | null): BulkStoryboardCropManifestItem[] | null {
  if (typeof value !== "string" || value.length > 128 * 1024) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.map((entry) => {
      const source = objectValue(entry);
      const metadata = objectValue(source.metadata);
      const assetId = cleanText(source.assetId ?? metadata.assetId, 100).toLowerCase();
      return {
        clientResultId: cleanText(source.clientResultId, 200),
        assetId,
        metadata
      };
    });
  } catch {
    return null;
  }
}

function validateBulkStoryboardManifestItem(
  item: BulkStoryboardCropManifestItem,
  file: FormDataEntryValue | null,
  thumbnail: FormDataEntryValue | null
) {
  if (!item.clientResultId) return "crop 결과 식별값이 없습니다.";
  if (!UUID_PATTERN.test(item.assetId)) return "자료 ID가 올바른 UUID 형식이 아닙니다.";
  if (
    cleanText(item.metadata.assetId, 100)
    && cleanText(item.metadata.assetId, 100).toLowerCase() !== item.assetId
  ) {
    return "manifest와 metadata의 자료 ID가 일치하지 않습니다.";
  }
  if (!(file instanceof File) || file.size <= 0) return "crop 이미지 파일이 없습니다.";
  if (!(thumbnail instanceof File) || thumbnail.size <= 0) return "crop 썸네일 파일이 없습니다.";
  if (!isArchiveImage(file)) return "콘티 crop 결과는 이미지 파일이어야 합니다.";
  if (!isArchiveImage(thumbnail)) return "콘티 crop 썸네일은 이미지 파일이어야 합니다.";
  if (!cleanText(item.metadata.importBatchId, 200)) return "crop import batch 식별값이 없습니다.";
  if (!hasValue(item.metadata.cropIndex) || nullableNonNegativeInteger(item.metadata.cropIndex) === null) {
    return "crop 순서는 0 이상의 정수로 입력해주세요.";
  }
  return "";
}

function parseBulkCropMetadata(metadata: Record<string, unknown>, file: File) {
  const sourceType = normalizeStoredSourceType(metadata.sourceType)
    ?? normalizeSourceType(null, file);
  return {
    x: metadata.cropX,
    y: metadata.cropY,
    width: metadata.cropWidth,
    height: metadata.cropHeight,
    ratio: metadata.cropRatio,
    sourceType,
    sourceAssetId: metadata.sourceAssetId,
    pageIndex: metadata.pageIndex,
    sourceFilename: metadata.sourceFilename,
    sourceKind: metadata.sourceKind,
    sourcePageNumber: metadata.sourcePageNumber,
    importBatchId: metadata.importBatchId,
    templateId: metadata.templateId,
    manuallyPositioned: metadata.manuallyPositioned,
    customSize: metadata.customSize,
    title: metadata.title,
    memo: metadata.memo,
    basePageWidth: metadata.basePageWidth,
    basePageHeight: metadata.basePageHeight,
    cropWidth: metadata.templateCropWidth,
    cropHeight: metadata.templateCropHeight,
    aspectRatio: metadata.aspectRatio,
    clickPlacementMode: metadata.clickPlacementMode,
    centerX: metadata.centerX,
    centerY: metadata.centerY,
    orderIndex: metadata.cropOrderIndex,
    rowStep: metadata.rowStep,
    rowsPerPage: metadata.rowsPerPage,
    targetColumn: metadata.targetColumn,
    includeContext: metadata.includeContext,
    folderId: metadata.folderId,
    originalFolderName: metadata.originalFolderName,
    relativePath: metadata.relativePath,
    displayName: metadata.displayName,
    originalFilename: metadata.originalFilename,
    episodeNumber: metadata.episodeNumber,
    sceneId: metadata.sceneId,
    sceneNumber: metadata.sceneNumber ?? metadata.sceneNo,
    cutNumber: metadata.cutNumber ?? metadata.cutNo,
    cropIndex: metadata.cropIndex
  };
}

function buildBulkStoryboardPayload(
  projectId: string,
  item: BulkStoryboardCropPreparedItem,
  supabase: ReturnType<typeof requireProjectAccessDb>
) {
  const originalFilename = cleanText(item.rawCropData.originalFilename, 500)
    || item.file.name.slice(0, 500);
  const displayName = cleanText(item.rawCropData.displayName, 240)
    || cleanText(item.rawCropData.title, 240)
    || stripFileExtension(originalFilename).slice(0, 240);
  const sourceAssetId = cleanText(item.rawCropData.sourceAssetId, 100);
  const thumbnailUrl = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(item.thumbnailPath).data.publicUrl;
  const publicUrl = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(item.uploadedPath).data.publicUrl;
  return {
    id: item.assetId,
    project_id: projectId,
    asset_type: "storyboard",
    filename: item.file.name.slice(0, 500),
    storage_path: item.uploadedPath,
    public_url: publicUrl,
    mime_type: item.file.type || "image/jpeg",
    size_bytes: item.file.size,
    daily_plan_id: cleanText(item.metadata.dailyPlanId, 500) || null,
    scene_no: item.archiveMetadata.sceneNumber || null,
    cut_no: item.archiveMetadata.cutNumber ? String(item.archiveMetadata.cutNumber) : null,
    shot_ref: cleanText(item.metadata.shotRef, 500) || null,
    group_id: cleanText(item.metadata.groupId ?? item.metadata.importBatchId, 200) || null,
    crop_data: normalizeCrop({
      ...item.rawCropData,
      sourceType: item.rawCropData.sourceType,
      title: cleanText(item.rawCropData.title, 240) || displayName,
      displayName,
      originalFilename,
      ...item.archiveMetadata,
      sourceAssetId: sourceAssetId || null,
      thumbnailPath: item.thumbnailPath,
      thumbnailUrl
    }),
    scenario_scenes: [],
    scenario_parse_error: null,
    sort_order: toInteger(item.metadata.sortOrder)
  };
}

async function saveBulkStoryboardPayloadWithRaceRecovery(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  item: BulkStoryboardCropPreparedItem,
  payload: ReturnType<typeof buildBulkStoryboardPayload>
): Promise<BulkStoryboardCropResult> {
  const { data: existing, error: existingError } = await supabase
    .from("project_reference_assets")
    .select(SELECT_COLUMNS)
    .eq("id", item.assetId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    if (!isMatchingStableAsset(existing as Record<string, unknown>, projectId, "storyboard")) {
      throw new Error("같은 자료 ID가 다른 프로젝트 또는 자료 종류에서 사용 중입니다.");
    }
    return {
      clientResultId: item.clientResultId,
      assetId: item.assetId,
      status: "existing",
      asset: mapAssetRow(existing as Record<string, unknown>)
    };
  }

  const { data, error } = await supabase
    .from("project_reference_assets")
    .insert(payload)
    .select(SELECT_COLUMNS)
    .single();
  if (error) {
    if (safeError(error).code === "23505") {
      const { data: raced, error: racedError } = await supabase
        .from("project_reference_assets")
        .select(SELECT_COLUMNS)
        .eq("id", item.assetId)
        .maybeSingle();
      if (racedError) throw racedError;
      if (raced && isMatchingStableAsset(raced as Record<string, unknown>, projectId, "storyboard")) {
        return {
          clientResultId: item.clientResultId,
          assetId: item.assetId,
          status: "existing",
          asset: mapAssetRow(raced as Record<string, unknown>)
        };
      }
    }
    throw error;
  }
  return {
    clientResultId: item.clientResultId,
    assetId: item.assetId,
    status: "saved",
    asset: mapAssetRow(data as Record<string, unknown>)
  };
}

async function cleanupUnpersistedBulkStoryboardFiles(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  items: BulkStoryboardCropPreparedItem[]
) {
  const ids = items.map((item) => item.assetId);
  const { data, error } = await supabase
    .from("project_reference_assets")
    .select("id,storage_path,crop_data")
    .eq("project_id", projectId)
    .in("id", ids);
  if (error) {
    console.error("[reference-assets:bulk-cleanup-read]", safeError(error));
    return "DB 저장 실패 후 Storage 정리 대상을 확인하지 못했습니다.";
  }
  const persistedById = new Map(
    (data ?? []).map((row) => [String(row.id), row as Record<string, unknown>])
  );
  const paths = items.flatMap((item) => {
    const persisted = persistedById.get(item.assetId);
    if (!persisted) return [item.uploadedPath, item.thumbnailPath];
    const persistedCrop = normalizeCrop(persisted.crop_data);
    return [
      cleanText(persisted.storage_path, 1_000) === item.uploadedPath ? "" : item.uploadedPath,
      cleanText(persistedCrop.thumbnailPath, 1_000) === item.thumbnailPath ? "" : item.thumbnailPath
    ].filter(Boolean);
  });
  return cleanupUploadedPaths(supabase, paths, "bulk-db-failure");
}

function bulkStoryboardStoragePath(
  projectId: string,
  assetId: string,
  uploadAttemptId: string,
  kind: "crop" | "thumbnail"
) {
  return kind === "crop"
    ? `projects/${projectId}/archive/storyboard/crops/${assetId}-${uploadAttemptId}.jpg`
    : `projects/${projectId}/archive/storyboard/thumbnails/${assetId}-${uploadAttemptId}.jpg`;
}

function bulkFailure(
  item: Pick<BulkStoryboardCropManifestItem, "clientResultId" | "assetId">,
  error: string
): BulkStoryboardCropResult {
  return {
    clientResultId: item.clientResultId,
    assetId: item.assetId,
    status: "failed",
    error
  };
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function firstDuplicate(values: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return "";
}

function isArchiveImage(file: File) {
  return file.type.startsWith("image/")
    || /\.(?:jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
}

function normalizeArchiveSceneCutRpcResult(value: unknown) {
  const result = objectValue(value);
  const assetValue = objectValue(result.asset);
  const id = cleanText(assetValue.id, 100);
  const numericSortOrder = Number(assetValue.sortOrder);
  const sortOrder = Number.isSafeInteger(numericSortOrder) && numericSortOrder >= 0
    ? numericSortOrder
    : null;
  const cutNumber = nullablePositiveInteger(assetValue.cutNumber);
  const updatedAt = cleanText(assetValue.updatedAt, 100);
  if (!UUID_PATTERN.test(id) || sortOrder === null || !updatedAt) return null;
  const orders = normalizeArchiveOrderRpcResult({ orders: result.orders });
  if (!orders) return null;
  return {
    asset: {
      id,
      sceneId: cleanText(assetValue.sceneId, 100) || null,
      sceneNumber: cleanText(assetValue.sceneNumber, 100),
      cutNumber,
      sortOrder,
      updatedAt
    },
    orders
  };
}

function normalizeArchiveOrderRpcResult(value: unknown) {
  const result = objectValue(value);
  if (!Array.isArray(result.orders)) return null;
  const orders = result.orders.map((entry) => {
    const order = objectValue(entry);
    const numericSortOrder = Number(order.sortOrder);
    return {
      id: cleanText(order.id, 100),
      sortOrder: Number.isSafeInteger(numericSortOrder) && numericSortOrder >= 0
        ? numericSortOrder
        : null,
      updatedAt: cleanText(order.updatedAt, 100)
    };
  });
  if (orders.some((order) => (
    !UUID_PATTERN.test(order.id)
    || order.sortOrder === null
    || !order.updatedAt
  ))) return null;
  return orders.map((order) => ({
    id: order.id,
    sortOrder: order.sortOrder!,
    updatedAt: order.updatedAt
  }));
}

function isMissingArchiveOrderRpc(error: unknown) {
  const source = safeError(error);
  return source.code === "PGRST202"
    || source.code === "42883"
    || /archive_(?:move|reorder)_reference_asset/i.test(source.message)
      && /schema cache|could not find|does not exist/i.test(source.message);
}

function isRetryableArchiveOrderRpc(error: unknown) {
  const code = safeError(error).code;
  return code === "40001" || code === "40P01";
}

function waitForArchiveOrderRetry() {
  return new Promise<void>((resolve) => setTimeout(resolve, 20));
}

function archiveOrderRpcErrorResponse(error: unknown, fallbackMessage: string) {
  const source = safeError(error);
  const status = source.code === "P0002"
    ? 404
    : source.code === "22023" || source.code === "22007" || source.code === "22003" || source.code === "22P02"
      ? 400
      : source.code === "40001" || source.code === "40P01"
        ? 409
        : 500;
  if (status >= 500) console.error("[reference-assets/archive-order-rpc]", source);
  return NextResponse.json({
    error: source.message && source.message !== "Unknown error" ? source.message : fallbackMessage,
    code: status === 409 ? "PROJECT_REFERENCE_CONFLICT" : "PROJECT_REFERENCE_ERROR"
  }, { status });
}

async function mapSettledWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
) {
  const output = new Array<
    { status: "fulfilled"; value: R } | { status: "rejected"; reason: unknown }
  >(values.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        output[index] = { status: "fulfilled", value: await worker(values[index], index) };
      } catch (reason) {
        output[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, run)
  );
  return output;
}

function roundedTimings(values: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Math.max(0, Math.round(value))])
  );
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function normalizeArchiveMediaType(value: unknown): ArchiveMediaAssetType | null {
  return value === "storyboard" || value === "overhead" ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isMatchingStableAsset(
  row: Record<string, unknown>,
  projectId: string,
  assetType: AssetType
) {
  return String(row.project_id ?? "") === projectId
    && String(row.asset_type ?? "") === assetType;
}

async function cleanupUploadedPaths(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  uploadedPaths: string[],
  reason: string
) {
  const paths = [...new Set(uploadedPaths.filter(Boolean))];
  if (paths.length === 0) return "";
  try {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    if (error) throw error;
    uploadedPaths.splice(0, uploadedPaths.length);
    return "";
  } catch (error) {
    console.error(`[reference-assets:${reason}:storage-cleanup]`, safeError(error));
    return "일부 Storage 파일을 정리하지 못했습니다.";
  }
}

function materialError(error: unknown, message: string) {
  if (error instanceof ProjectDeleteReceiptError) {
    return NextResponse.json({ error: error.message, code: "PROJECT_REFERENCE_DELETE_RECEIPT_INVALID" }, { status: 400 });
  }
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: message, code: "PROJECT_REFERENCE_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
  if (error instanceof ReferenceAssetDeleteConflictError) {
    return NextResponse.json(
      { error: error.message, code: "PROJECT_REFERENCE_DELETE_CONFLICT" },
      { status: 409 }
    );
  }
  console.error("[reference-assets]", safeError(error));
  const source = safeError(error);
  const missingTable = source.code === "42P01"
    || source.code === "42703"
    || /project_reference_assets|scenario_scenes|scenario_parse_error/i.test(source.message)
      && /does not exist|schema cache|column/i.test(source.message);
  return NextResponse.json({
    error: missingTable ? "프로젝트 자료 migration을 먼저 적용해주세요." : message,
    code: missingTable ? "PROJECT_REFERENCE_MIGRATION_REQUIRED" : "PROJECT_REFERENCE_ERROR",
    detail: source.message
  }, { status: missingTable ? 503 : 500 });
}

function safeError(error: unknown) {
  if (!error || typeof error !== "object") return { code: "", message: String(error) };
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : "",
    message: typeof value.message === "string" ? value.message : "Unknown error"
  };
}

function normalizeIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((entry) => cleanText(entry, 100))
      .filter(Boolean)
  )].slice(0, 500);
}

function chunk<T>(values: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

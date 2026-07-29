import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  getProjectRequestRole,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { normalizeSceneCutMetadata } from "@/lib/archiveAssetMetadata";
import { normalizeSceneNumber } from "@/lib/sceneNumber";
import { SCENARIO_MARKER_NOT_FOUND_MESSAGE } from "@/lib/scenarioSceneMarker";
import { extractScenarioScenesFromPdf } from "@/lib/server/scenarioPdf";
import type {
  ArchiveMediaAssetType,
  ArchiveSceneCutMetadata,
  ProjectScenarioScene
} from "@/lib/types";

type RouteContext = { params: Promise<{ projectId: string }> };
type AssetType = "scenario" | "storyboard" | "overhead";
type ReferenceMediaLinkTypeUpdate = {
  id: string;
  previousShotRef: string;
  previousData: Record<string, unknown>;
  nextShotRef: string;
  nextData: Record<string, unknown>;
};

const STORAGE_BUCKET = "storyboards";
const SELECT_COLUMNS = "id,project_id,asset_type,filename,storage_path,public_url,mime_type,size_bytes,daily_plan_id,scene_no,cut_no,shot_ref,group_id,crop_data,scenario_scenes,scenario_parse_error,sort_order,created_at,updated_at";

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if (!(await getMaterialRole(request, projectId))) {
      return NextResponse.json({ error: "프로젝트 자료를 볼 권한이 없습니다." }, { status: 403 });
    }

    const assetType = normalizeAssetType(request.nextUrl.searchParams.get("type"));
    if (!assetType) return NextResponse.json({ error: "자료 종류가 올바르지 않습니다." }, { status: 400 });

    const supabase = requireProjectAccessDb();
    let query = supabase
      .from("project_reference_assets")
      .select(SELECT_COLUMNS)
      .eq("project_id", projectId)
      .eq("asset_type", assetType)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    const dailyPlanId = cleanText(request.nextUrl.searchParams.get("dailyPlanId"), 500);
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
    const assetType = normalizeAssetType(formData.get("assetType"));
    const file = formData.get("file");
    const thumbnail = formData.get("thumbnail");
    if (!assetType || !(file instanceof File)) {
      return NextResponse.json({ error: "업로드할 자료가 없습니다." }, { status: 400 });
    }
    const validationError = validateFile(assetType, file);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 415 });

    const dailyPlanId = cleanText(formData.get("dailyPlanId"), 500);
    const sceneNo = cleanText(formData.get("sceneNo"), 100);
    const cutNo = cleanText(formData.get("cutNo"), 100);
    const shotRef = cleanText(formData.get("shotRef"), 500);

    const supabase = requireProjectAccessDb();
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
      ? extractScenarioScenesFromPdf(fileBuffer)
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
      const { data, error } = await supabase
        .from("project_reference_assets")
        .insert(payload)
        .select(SELECT_COLUMNS)
        .single();
      if (error) throw error;
      savedRow = data;
    }
    return NextResponse.json({ ok: true, asset: mapAssetRow(savedRow) }, { status: 201 });
  } catch (error) {
    if (uploadedPaths.length > 0) {
      try {
        await requireProjectAccessDb().storage.from(STORAGE_BUCKET).remove(uploadedPaths);
      } catch {
        // 메타데이터 저장 실패 응답을 우선합니다.
      }
    }
    return materialError(error, "자료를 업로드하지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const projectId = await getProjectId(context);
    if (!projectId) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    if ((await getMaterialRole(request, projectId)) !== "admin") {
      return NextResponse.json({ error: "자료 수정은 Key staff만 할 수 있습니다." }, { status: 403 });
    }
    const body = (await request.json()) as {
      id?: unknown;
      ids?: unknown;
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
    };
    const supabase = requireProjectAccessDb();
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
        const extraction = extractScenarioScenesFromPdf(Buffer.from(await storedFile.arrayBuffer()));
        updatePayload.scenario_scenes = extraction.scenes;
        updatePayload.scenario_parse_error = extraction.error;
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
    const { data, error } = await supabase
      .from("project_reference_assets")
      .update(updatePayload)
      .eq("id", id)
      .eq("project_id", projectId)
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw error;
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
    const supabase = requireProjectAccessDb();
    const { data: existing, error: readError } = await supabase
      .from("project_reference_assets")
      .select("id,storage_path,crop_data")
      .eq("project_id", projectId)
      .in("id", uniqueIds);
    if (readError) throw readError;
    if ((existing ?? []).length !== uniqueIds.length) {
      return NextResponse.json({ error: "삭제할 자료 중 일부를 찾을 수 없습니다." }, { status: 404 });
    }
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

    const deletedLinks: Record<string, unknown>[] = [];
    try {
      for (const linkBatch of chunk(affectedLinks, 100)) {
        const byId = new Map(linkBatch.map((row) => [String(row.id), row]));
        const { data: deletedRows, error: linkDeleteError } = await supabase
          .from("shot_diagrams")
          .delete()
          .eq("project_id", projectId)
          .in("id", [...byId.keys()])
          .select("id");
        if (linkDeleteError) throw linkDeleteError;
        for (const deletedRow of deletedRows ?? []) {
          const snapshot = byId.get(String(deletedRow.id));
          if (snapshot) deletedLinks.push(snapshot);
        }
      }
    } catch (linkDeleteError) {
      const rollbackErrors = await restoreReferenceMediaLinks(supabase, deletedLinks);
      throw new Error([
        safeError(linkDeleteError).message,
        rollbackErrors.length > 0 ? `link rollback: ${rollbackErrors.join(" / ")}` : ""
      ].filter(Boolean).join(" · "));
    }

    try {
      const { error: deleteError } = await supabase
        .from("project_reference_assets")
        .delete()
        .eq("project_id", projectId)
        .in("id", (existing ?? []).map((asset) => asset.id));
      if (deleteError) throw deleteError;
    } catch (deleteError) {
      const rollbackErrors = await restoreReferenceMediaLinks(supabase, deletedLinks);
      throw new Error([
        safeError(deleteError).message,
        rollbackErrors.length > 0 ? `link rollback: ${rollbackErrors.join(" / ")}` : ""
      ].filter(Boolean).join(" · "));
    }

    const storagePaths = [...new Set((existing ?? []).flatMap((asset) => [
      cleanText(asset.storage_path, 1_000),
      cleanText(normalizeCrop(asset.crop_data).thumbnailPath, 1_000)
    ]).filter(Boolean))];
    let storageCleanupWarning = "";
    for (const pathBatch of chunk(storagePaths, 100)) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(pathBatch);
      if (storageError) {
        storageCleanupWarning = "DB 삭제는 완료됐지만 일부 Storage 파일을 정리하지 못했습니다.";
        console.error("[reference-assets:storage-delete]", safeError(storageError));
      }
    }
    return NextResponse.json({
      ok: true,
      deleted: uniqueIds.length,
      storageCleanupWarning
    });
  } catch (error) {
    return materialError(error, "자료를 삭제하지 못했습니다.");
  }
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
  const assetType = normalizeArchiveMediaType(source.assetType);
  const hasPageIndex = source.pageIndex !== null && source.pageIndex !== undefined && source.pageIndex !== "";
  const pageIndexValue = Number(source.pageIndex);
  const episodeNumber = nullablePositiveInteger(source.episodeNumber);
  const sceneId = cleanText(source.sceneId, 100) || null;
  const rawSceneNumber = cleanText(source.sceneNumber ?? source.sceneNo, 100);
  const sceneNumber = normalizeSceneNumber(rawSceneNumber) || rawSceneNumber;
  const cutNumber = nullablePositiveInteger(source.cutNumber ?? source.cutNo);
  const cropIndex = nullableNonNegativeInteger(source.cropIndex);
  const normalizedLinkKey = cleanText(source.normalizedLinkKey, 1_000);
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

function normalizeScenarioScenes(value: unknown): ProjectScenarioScene[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2_000).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const source = entry as Record<string, unknown>;
    const pageStart = nullablePositiveInteger(source.pageStart);
    const pageEnd = nullablePositiveInteger(source.pageEnd);
    const rawSceneNo = cleanText(source.sceneNo, 100);
    const imageSegments = normalizeScenarioImageSegments(source.imageSegments);
    return [{
      id: cleanText(source.id, 100) || randomUUID(),
      sceneNo: normalizeSceneNumber(rawSceneNo) || rawSceneNo || String(index + 1),
      title: cleanText(source.title, 240) || `Scene ${index + 1}`,
      pageStart,
      pageEnd: pageEnd ?? pageStart,
      text: "",
      imageSegments
    }];
  });
}

function normalizeScenarioImageSegments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5_000).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const source = entry as Record<string, unknown>;
    const pageIndex = Number(source.pageIndex);
    const startYRatio = Number(source.startYRatio);
    const endYRatio = Number(source.endYRatio);
    if (
      !Number.isInteger(pageIndex)
      || pageIndex < 0
      || !Number.isFinite(startYRatio)
      || !Number.isFinite(endYRatio)
    ) {
      return [];
    }
    const start = Math.min(1, Math.max(0, startYRatio));
    const end = Math.min(1, Math.max(0, endYRatio));
    return end > start ? [{ pageIndex, startYRatio: start, endYRatio: end }] : [];
  });
}

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
  if (hasValue(episodeValue) && nullablePositiveInteger(episodeValue) === null) {
    return "회차는 1 이상의 정수로 입력해주세요.";
  }
  if (hasValue(cutValue) && nullablePositiveInteger(cutValue) === null) {
    return "컷은 1 이상의 정수로 입력해주세요.";
  }
  if (hasValue(cropIndexValue) && nullableNonNegativeInteger(cropIndexValue) === null) {
    return "crop 순서는 0 이상의 정수로 입력해주세요.";
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
      .upsert(rowBatch, { onConflict: "id" });
    if (error) errors.push(safeError(error).message);
  }
  return errors;
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

function materialError(error: unknown, message: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: message, code: "PROJECT_REFERENCE_STORAGE_UNAVAILABLE" }, { status: 503 });
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

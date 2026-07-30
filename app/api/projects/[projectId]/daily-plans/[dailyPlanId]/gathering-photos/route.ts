import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { dailyPlanFromRow } from "@/lib/data/mappers";
import {
  appendGatheringPhoto,
  reconcileDailyPlanGatheringPoints,
  removeGatheringPhoto,
  reorderGatheringPhotos
} from "@/lib/dailyPlan/gatheringPoints";
import {
  decodeDailyPlanMemo,
  encodeDailyPlanMemo,
  type DailyPlanGatheringPhoto
} from "@/lib/dailyPlan/printMeta";
import {
  getProjectRequestRole,
  ProjectAccessUnavailableError,
  requireProjectAccessDb
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type RouteContext = {
  params: Promise<{ projectId: string; dailyPlanId: string }>;
};

const STORAGE_BUCKET = "storyboards";
const MAX_DISPLAY_BYTES = 8 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const SAFE_ID = /^[a-zA-Z0-9_-]{8,180}$/;

type PendingPhotoDescriptor = {
  photoId: string;
  originalFilename: string;
};

/** 사진 편집창의 명시적 저장을 metadata 한 번의 갱신으로 확정합니다. */
export async function PUT(request: NextRequest, context: RouteContext) {
  const uploadedPaths: string[] = [];
  try {
    const params = await getRouteParams(context);
    if (!params) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const role = await getProjectRequestRole(request, params.projectId);
    if (role !== "admin") {
      return NextResponse.json({ error: "집합장소 사진은 Key staff만 저장할 수 있습니다." }, { status: role ? 403 : 401 });
    }

    const formData = await request.formData();
    const requestedPointId = cleanId(formData.get("gatheringPointId"));
    const departmentIds = parseDepartmentIds(formData.get("departmentIds"));
    const deletedPhotoIds = parseIdArray(formData.get("deletedPhotoIds"));
    const orderedPhotoIds = parseIdArray(formData.get("orderedPhotoIds"));
    const pendingPhotos = parsePendingPhotos(formData.get("pendingPhotos"));
    const expectedUpdatedAt = cleanText(formData.get("expectedUpdatedAt"), 100);
    if (pendingPhotos.length > 12) {
      return NextResponse.json({ error: "한 번에 추가할 수 있는 위치 사진은 12장입니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const planRow = await loadOwnedPlan(supabase, params.projectId, params.dailyPlanId);
    if (!planRow) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });
    const plan = dailyPlanFromRow(planRow);
    let meta = reconcileDailyPlanGatheringPoints(
      decodeDailyPlanMemo(plan.memo),
      plan.shootingLocations
    );
    const point = resolveGatheringPoint(meta.gatheringPoints, requestedPointId, departmentIds);
    if (!point || !SAFE_ID.test(point.id)) {
      return NextResponse.json({ error: "사진을 연결할 집합장소를 찾을 수 없습니다." }, { status: 404 });
    }

    const currentIds = point.photos.map((photo) => photo.id);
    const alreadyApplied = pendingPhotos.every((photo) => currentIds.includes(photo.photoId))
      && deletedPhotoIds.every((photoId) => !currentIds.includes(photoId))
      && arraysEqual(currentIds, orderedPhotoIds);
    if (alreadyApplied) {
      return NextResponse.json({
        ok: true,
        gatheringPointId: point.id,
        memo: plan.memo,
        updatedAt: String(planRow.updated_at ?? ""),
        idempotent: true
      });
    }
    if (expectedUpdatedAt && String(planRow.updated_at ?? "") !== expectedUpdatedAt) {
      return NextResponse.json(
        { error: "일촬표가 다른 화면에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요." },
        { status: 409 }
      );
    }

    const currentIdSet = new Set(currentIds);
    if (deletedPhotoIds.some((photoId) => !currentIdSet.has(photoId))) {
      return NextResponse.json({ error: "삭제할 사진 정보가 현재 저장본과 다릅니다." }, { status: 409 });
    }
    const pendingIds = new Set(pendingPhotos.map((photo) => photo.photoId));
    const expectedFinalIds = new Set([
      ...currentIds.filter((photoId) => !deletedPhotoIds.includes(photoId)),
      ...pendingIds
    ]);
    if (
      orderedPhotoIds.length !== expectedFinalIds.size
      || orderedPhotoIds.some((photoId) => !expectedFinalIds.has(photoId))
    ) {
      return NextResponse.json({ error: "사진 순서 정보가 현재 편집 내용과 다릅니다." }, { status: 409 });
    }

    const pendingUploads = pendingPhotos
      .filter((descriptor) => !currentIdSet.has(descriptor.photoId))
      .map((descriptor) => ({
        descriptor,
        file: formData.get(`display:${descriptor.photoId}`),
        thumbnail: formData.get(`thumbnail:${descriptor.photoId}`)
      }));
    for (const entry of pendingUploads) {
      if (!(entry.file instanceof File) || !(entry.thumbnail instanceof File)) {
        return NextResponse.json({ error: "저장할 사진과 썸네일이 없습니다." }, { status: 400 });
      }
      if (!isOptimizedImage(entry.file) || !isOptimizedImage(entry.thumbnail)) {
        return NextResponse.json({ error: "JPG, PNG 또는 WebP 이미지로 저장해주세요." }, { status: 415 });
      }
      if (entry.file.size > MAX_DISPLAY_BYTES || entry.thumbnail.size > MAX_THUMBNAIL_BYTES) {
        return NextResponse.json({ error: "최적화된 이미지 용량이 너무 큽니다." }, { status: 413 });
      }
    }

    const addedPhotos: DailyPlanGatheringPhoto[] = [];
    for (const entry of pendingUploads) {
      const { descriptor, file, thumbnail } = entry as {
        descriptor: PendingPhotoDescriptor;
        file: File;
        thumbnail: File;
      };

      const basePath = storageBasePath(
        params.projectId,
        params.dailyPlanId,
        point.id,
        descriptor.photoId
      );
      const displayPath = `${basePath}/display.jpg`;
      const thumbnailPath = `${basePath}/thumbnail.jpg`;
      await uploadFile(supabase, displayPath, file, true);
      uploadedPaths.push(displayPath);
      await uploadFile(supabase, thumbnailPath, thumbnail, true);
      uploadedPaths.push(thumbnailPath);
      addedPhotos.push({
        id: descriptor.photoId,
        url: supabase.storage.from(STORAGE_BUCKET).getPublicUrl(displayPath).data.publicUrl,
        thumbnailUrl: supabase.storage.from(STORAGE_BUCKET).getPublicUrl(thumbnailPath).data.publicUrl,
        storagePath: displayPath,
        thumbnailPath,
        sortOrder: point.photos.length + addedPhotos.length,
        originalFilename: descriptor.originalFilename || file.name
      });
    }

    const photosToDelete = point.photos.filter((photo) => deletedPhotoIds.includes(photo.id));
    deletedPhotoIds.forEach((photoId) => {
      meta = removeGatheringPhoto(meta, point.id, photoId);
    });
    addedPhotos.forEach((photo) => {
      meta = appendGatheringPhoto(meta, point.id, photo);
    });
    meta = reorderGatheringPhotos(meta, point.id, orderedPhotoIds);
    const saved = await saveMemo(
      supabase,
      params.projectId,
      params.dailyPlanId,
      encodeDailyPlanMemo(meta),
      String(planRow.updated_at ?? "")
    );
    uploadedPaths.length = 0;

    const deletedPaths = photosToDelete.flatMap((photo) => {
      const prefix = `${storageBasePath(params.projectId, params.dailyPlanId, point.id, photo.id)}/`;
      return [photo.storagePath, photo.thumbnailPath].filter((path) => path && path.startsWith(prefix));
    });
    let cleanupWarning = "";
    if (deletedPaths.length > 0) {
      const { error: removeError } = await supabase.storage.from(STORAGE_BUCKET).remove(deletedPaths);
      if (removeError) {
        cleanupWarning = "사진 정보는 저장했지만 삭제한 Storage 파일 일부를 정리하지 못했습니다.";
        console.error("[gathering-photos:batch-cleanup]", safeError(removeError));
      }
    }
    return NextResponse.json({
      ok: true,
      gatheringPointId: point.id,
      memo: String(saved.memo ?? ""),
      updatedAt: String(saved.updated_at ?? ""),
      cleanupWarning
    });
  } catch (error) {
    if (uploadedPaths.length > 0) {
      try {
        const supabase = requireProjectAccessDb();
        await supabase.storage.from(STORAGE_BUCKET).remove(uploadedPaths);
      } catch (cleanupError) {
        console.error("[gathering-photos:batch-rollback]", safeError(cleanupError));
      }
    }
    return gatheringPhotoError(error, "집합장소 사진 변경사항을 저장하지 못했습니다.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const uploadedPaths: string[] = [];
  try {
    const params = await getRouteParams(context);
    if (!params) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const role = await getProjectRequestRole(request, params.projectId);
    if (role !== "admin") {
      return NextResponse.json({ error: "집합장소 사진은 Key staff만 저장할 수 있습니다." }, { status: role ? 403 : 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const thumbnail = formData.get("thumbnail");
    const requestedPointId = cleanId(formData.get("gatheringPointId"));
    const requestedPhotoId = cleanId(formData.get("photoId"));
    const departmentIds = parseDepartmentIds(formData.get("departmentIds"));
    const expectedUpdatedAt = cleanText(formData.get("expectedUpdatedAt"), 100);
    const originalFilename = cleanText(formData.get("originalFilename"), 500);
    if (!(file instanceof File) || !(thumbnail instanceof File)) {
      return NextResponse.json({ error: "저장할 사진과 썸네일이 없습니다." }, { status: 400 });
    }
    if (!isOptimizedImage(file) || !isOptimizedImage(thumbnail)) {
      return NextResponse.json({ error: "JPG, PNG 또는 WebP 이미지로 저장해주세요." }, { status: 415 });
    }
    if (file.size > MAX_DISPLAY_BYTES || thumbnail.size > MAX_THUMBNAIL_BYTES) {
      return NextResponse.json({ error: "최적화된 이미지 용량이 너무 큽니다." }, { status: 413 });
    }

    const supabase = requireProjectAccessDb();
    const planRow = await loadOwnedPlan(supabase, params.projectId, params.dailyPlanId);
    if (!planRow) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });

    const plan = dailyPlanFromRow(planRow);
    let meta = reconcileDailyPlanGatheringPoints(
      decodeDailyPlanMemo(plan.memo),
      plan.shootingLocations
    );
    const point = resolveGatheringPoint(meta.gatheringPoints, requestedPointId, departmentIds);
    if (!point) {
      return NextResponse.json({ error: "사진을 연결할 집합장소를 찾을 수 없습니다." }, { status: 404 });
    }
    if (!SAFE_ID.test(point.id)) {
      return NextResponse.json({ error: "집합장소 사진 연결 ID가 올바르지 않습니다." }, { status: 409 });
    }

    const photoId = requestedPhotoId || randomUUID();
    const existingPhoto = point.photos.find((photo) => photo.id === photoId);
    if (existingPhoto) {
      return NextResponse.json({
        ok: true,
        gatheringPointId: point.id,
        photo: existingPhoto,
        memo: plan.memo,
        updatedAt: String(planRow.updated_at ?? ""),
        idempotent: true
      });
    }
    if (expectedUpdatedAt && String(planRow.updated_at ?? "") !== expectedUpdatedAt) {
      return NextResponse.json(
        { error: "일촬표가 다른 화면에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요." },
        { status: 409 }
      );
    }
    const basePath = storageBasePath(params.projectId, params.dailyPlanId, point.id, photoId);
    const displayPath = `${basePath}/display.jpg`;
    const thumbnailPath = `${basePath}/thumbnail.jpg`;
    await uploadFile(supabase, displayPath, file);
    uploadedPaths.push(displayPath);
    await uploadFile(supabase, thumbnailPath, thumbnail);
    uploadedPaths.push(thumbnailPath);
    const displayUrl = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(displayPath).data.publicUrl;
    const thumbnailUrl = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(thumbnailPath).data.publicUrl;
    const photo: DailyPlanGatheringPhoto = {
      id: photoId,
      url: displayUrl,
      thumbnailUrl,
      storagePath: displayPath,
      thumbnailPath,
      sortOrder: point.photos.length,
      originalFilename: originalFilename || file.name
    };
    meta = appendGatheringPhoto(meta, point.id, photo);
    const saved = await saveMemo(
      supabase,
      params.projectId,
      params.dailyPlanId,
      encodeDailyPlanMemo(meta),
      String(planRow.updated_at ?? "")
    );
    uploadedPaths.length = 0;
    return NextResponse.json({
      ok: true,
      gatheringPointId: point.id,
      photo,
      memo: String(saved.memo ?? ""),
      updatedAt: String(saved.updated_at ?? "")
    }, { status: 201 });
  } catch (error) {
    if (uploadedPaths.length > 0) {
      try {
        const supabase = requireProjectAccessDb();
        await supabase.storage.from(STORAGE_BUCKET).remove(uploadedPaths);
      } catch (cleanupError) {
        console.error("[gathering-photos:upload-cleanup]", safeError(cleanupError));
      }
    }
    return gatheringPhotoError(error, "집합장소 사진을 저장하지 못했습니다.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const params = await getRouteParams(context);
    if (!params) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const role = await getProjectRequestRole(request, params.projectId);
    if (role !== "admin") {
      return NextResponse.json({ error: "집합장소 사진은 Key staff만 삭제할 수 있습니다." }, { status: role ? 403 : 401 });
    }
    const body = (await request.json()) as {
      gatheringPointId?: unknown;
      photoId?: unknown;
      expectedUpdatedAt?: unknown;
    };
    const gatheringPointId = cleanId(body.gatheringPointId);
    const photoId = cleanId(body.photoId);
    if (!gatheringPointId || !photoId) {
      return NextResponse.json({ error: "삭제할 사진 정보가 없습니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const planRow = await loadOwnedPlan(supabase, params.projectId, params.dailyPlanId);
    if (!planRow) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });
    const expectedUpdatedAt = cleanText(body.expectedUpdatedAt, 100);
    if (expectedUpdatedAt && String(planRow.updated_at ?? "") !== expectedUpdatedAt) {
      return NextResponse.json(
        { error: "일촬표가 다른 화면에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요." },
        { status: 409 }
      );
    }
    const plan = dailyPlanFromRow(planRow);
    const meta = reconcileDailyPlanGatheringPoints(
      decodeDailyPlanMemo(plan.memo),
      plan.shootingLocations
    );
    const point = meta.gatheringPoints.find((item) => item.id === gatheringPointId);
    const photo = point?.photos.find((item) => item.id === photoId);
    if (!point || !photo) return NextResponse.json({ error: "삭제할 사진을 찾을 수 없습니다." }, { status: 404 });
    const expectedPrefix = `${storageBasePath(params.projectId, params.dailyPlanId, gatheringPointId, photoId)}/`;
    const paths = [photo.storagePath, photo.thumbnailPath]
      .filter((path) => path && path.startsWith(expectedPrefix));
    const nextMeta = removeGatheringPhoto(meta, gatheringPointId, photoId);
    const saved = await saveMemo(
      supabase,
      params.projectId,
      params.dailyPlanId,
      encodeDailyPlanMemo(nextMeta),
      String(planRow.updated_at ?? "")
    );
    let cleanupWarning = "";
    if (paths.length > 0) {
      const { error: removeError } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
      if (removeError) {
        cleanupWarning = "사진 정보는 삭제했지만 Storage 파일 일부를 정리하지 못했습니다.";
        console.error("[gathering-photos:delete-cleanup]", safeError(removeError));
      }
    }
    return NextResponse.json({
      ok: true,
      memo: String(saved.memo ?? ""),
      updatedAt: String(saved.updated_at ?? ""),
      cleanupWarning
    });
  } catch (error) {
    return gatheringPhotoError(error, "집합장소 사진을 삭제하지 못했습니다.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const params = await getRouteParams(context);
    if (!params) return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다." }, { status: 400 });
    const role = await getProjectRequestRole(request, params.projectId);
    if (role !== "admin") {
      return NextResponse.json({ error: "집합장소 사진 순서는 Key staff만 저장할 수 있습니다." }, { status: role ? 403 : 401 });
    }
    const body = (await request.json()) as {
      gatheringPointId?: unknown;
      orderedPhotoIds?: unknown;
      expectedUpdatedAt?: unknown;
    };
    const gatheringPointId = cleanId(body.gatheringPointId);
    const orderedPhotoIds = Array.isArray(body.orderedPhotoIds)
      ? body.orderedPhotoIds.map(cleanId).filter(Boolean)
      : [];
    if (!gatheringPointId) {
      return NextResponse.json({ error: "순서를 저장할 집합장소가 없습니다." }, { status: 400 });
    }

    const supabase = requireProjectAccessDb();
    const planRow = await loadOwnedPlan(supabase, params.projectId, params.dailyPlanId);
    if (!planRow) return NextResponse.json({ error: "일촬표를 찾을 수 없습니다." }, { status: 404 });
    const expectedUpdatedAt = cleanText(body.expectedUpdatedAt, 100);
    if (expectedUpdatedAt && String(planRow.updated_at ?? "") !== expectedUpdatedAt) {
      return NextResponse.json(
        { error: "일촬표가 다른 화면에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요." },
        { status: 409 }
      );
    }
    const plan = dailyPlanFromRow(planRow);
    const meta = reconcileDailyPlanGatheringPoints(
      decodeDailyPlanMemo(plan.memo),
      plan.shootingLocations
    );
    const point = meta.gatheringPoints.find((item) => item.id === gatheringPointId);
    if (!point) return NextResponse.json({ error: "집합장소를 찾을 수 없습니다." }, { status: 404 });
    const storedIds = new Set(point.photos.map((photo) => photo.id));
    if (orderedPhotoIds.length !== storedIds.size || orderedPhotoIds.some((id) => !storedIds.has(id))) {
      return NextResponse.json({ error: "사진 순서 정보가 현재 저장본과 다릅니다." }, { status: 409 });
    }
    const nextMeta = reorderGatheringPhotos(meta, gatheringPointId, orderedPhotoIds);
    const saved = await saveMemo(
      supabase,
      params.projectId,
      params.dailyPlanId,
      encodeDailyPlanMemo(nextMeta),
      String(planRow.updated_at ?? "")
    );
    return NextResponse.json({
      ok: true,
      memo: String(saved.memo ?? ""),
      updatedAt: String(saved.updated_at ?? "")
    });
  } catch (error) {
    return gatheringPhotoError(error, "집합장소 사진 순서를 저장하지 못했습니다.");
  }
}

async function getRouteParams(context: RouteContext) {
  const { projectId: routeProjectId, dailyPlanId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  if (!isValidDatabaseProjectId(projectId) || !dailyPlanId.trim()) return null;
  return { projectId, dailyPlanId: dailyPlanId.trim() };
}

async function loadOwnedPlan(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  dailyPlanId: string
) {
  const { data, error } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", dailyPlanId)
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

async function saveMemo(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  projectId: string,
  dailyPlanId: string,
  memo: string,
  expectedUpdatedAt: string
) {
  let query = supabase
    .from("daily_plans")
    .update({ memo })
    .eq("project_id", projectId)
    .eq("id", dailyPlanId);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await query.select("memo,updated_at").maybeSingle();
  if (error) throw error;
  if (!data) {
    const conflict = new Error("일촬표가 다른 화면에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.");
    Object.assign(conflict, { status: 409 });
    throw conflict;
  }
  return data;
}

async function uploadFile(
  supabase: ReturnType<typeof requireProjectAccessDb>,
  path: string,
  file: File,
  upsert = false
) {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "image/jpeg",
      upsert
    });
  if (error) throw error;
}

function resolveGatheringPoint(
  points: ReturnType<typeof decodeDailyPlanMemo>["gatheringPoints"],
  requestedPointId: string,
  departmentIds: string[]
) {
  const exact = requestedPointId ? points.find((point) => point.id === requestedPointId) : null;
  if (exact) return exact;
  if (departmentIds.length === 0) return null;
  return points.find((point) => departmentIds.some((id) => point.departmentIds.includes(id))) ?? null;
}

function storageBasePath(projectId: string, dailyPlanId: string, pointId: string, photoId: string) {
  return `projects/${projectId}/daily-plans/${dailyPlanId}/gathering-points/${pointId}/${photoId}`;
}

function parseDepartmentIds(value: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(cleanReferenceId).filter(Boolean))].slice(0, 200);
  } catch {
    return [];
  }
}

function parseIdArray(value: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(cleanId).filter(Boolean))].slice(0, 200);
  } catch {
    return [];
  }
}

function parsePendingPhotos(value: FormDataEntryValue | null): PendingPhotoDescriptor[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.slice(0, 20).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as { photoId?: unknown; originalFilename?: unknown };
      const photoId = cleanId(value.photoId);
      if (!photoId || seen.has(photoId)) return [];
      seen.add(photoId);
      return [{
        photoId,
        originalFilename: cleanText(value.originalFilename, 500)
      }];
    });
  } catch {
    return [];
  }
}

function isOptimizedImage(file: File) {
  return /^(?:image\/jpeg|image\/png|image\/webp)$/i.test(file.type)
    || /\.(?:jpe?g|png|webp)$/i.test(file.name);
}

function cleanId(value: unknown) {
  const id = String(value ?? "").trim();
  return SAFE_ID.test(id) ? id : "";
}

function cleanReferenceId(value: unknown) {
  const id = String(value ?? "").trim();
  return id && id.length <= 180 && !/[\u0000-\u001f\u007f]/.test(id) ? id : "";
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function gatheringPhotoError(error: unknown, fallbackMessage: string) {
  if (error instanceof ProjectAccessUnavailableError) {
    return NextResponse.json({ error: fallbackMessage }, { status: 503 });
  }
  const source = safeError(error);
  console.error("[gathering-photos]", source);
  const safeDetail = source.message && source.message !== "Unknown error"
    ? source.message.slice(0, 500)
    : "";
  return NextResponse.json(
    {
      error: source.status === 409
        ? source.message
        : safeDetail
          ? `${fallbackMessage} (${safeDetail})`
          : fallbackMessage,
      detail: safeDetail
    },
    { status: source.status === 409 ? 409 : 500 }
  );
}

function safeError(error: unknown) {
  if (!error || typeof error !== "object") {
    return { code: "", message: String(error), status: 0 };
  }
  const value = error as { code?: unknown; message?: unknown; status?: unknown };
  return {
    code: typeof value.code === "string" ? value.code : "",
    message: typeof value.message === "string" ? value.message : "Unknown error",
    status: typeof value.status === "number" ? value.status : 0
  };
}

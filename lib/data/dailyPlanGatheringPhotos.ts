import { readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import {
  appendGatheringPhoto,
  reconcileDailyPlanGatheringPoints,
  removeGatheringPhoto,
  reorderGatheringPhotos
} from "@/lib/dailyPlan/gatheringPoints";
import { decodeDailyPlanMemo, encodeDailyPlanMemo } from "@/lib/dailyPlan/printMeta";
import { isValidDatabaseProjectId } from "@/lib/projectId";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type GatheringPhotoMutationResult = {
  memo: string;
  updatedAt: string;
  gatheringPointId?: string;
  cleanupWarning?: string;
};

type UploadGatheringPhotoInput = {
  projectId: string;
  dailyPlanId: string;
  gatheringPointId: string | null;
  departmentIds: string[];
  photoId: string;
  displayFile: File;
  thumbnailFile: File;
  originalFilename: string;
  expectedUpdatedAt: string;
};

type DeleteGatheringPhotoInput = {
  projectId: string;
  dailyPlanId: string;
  gatheringPointId: string;
  photoId: string;
  expectedUpdatedAt: string;
};

type ReorderGatheringPhotosInput = {
  projectId: string;
  dailyPlanId: string;
  gatheringPointId: string;
  orderedPhotoIds: string[];
  expectedUpdatedAt: string;
};

export type SaveGatheringPhotoDraftInput = {
  projectId: string;
  dailyPlanId: string;
  gatheringPointId: string | null;
  departmentIds: string[];
  deletedPhotoIds: string[];
  orderedPhotoIds: string[];
  pendingPhotos: Array<{
    photoId: string;
    displayFile: File;
    thumbnailFile: File;
    originalFilename: string;
  }>;
  expectedUpdatedAt: string;
};

export async function saveDailyPlanGatheringPhotoDraft(
  input: SaveGatheringPhotoDraftInput
): Promise<GatheringPhotoMutationResult> {
  if (!isValidDatabaseProjectId(input.projectId)) return saveLocalPhotoDraft(input);
  const formData = new FormData();
  formData.set("departmentIds", JSON.stringify(input.departmentIds));
  formData.set("deletedPhotoIds", JSON.stringify(input.deletedPhotoIds));
  formData.set("orderedPhotoIds", JSON.stringify(input.orderedPhotoIds));
  formData.set("pendingPhotos", JSON.stringify(input.pendingPhotos.map((photo) => ({
    photoId: photo.photoId,
    originalFilename: photo.originalFilename
  }))));
  formData.set("expectedUpdatedAt", input.expectedUpdatedAt);
  if (input.gatheringPointId) formData.set("gatheringPointId", input.gatheringPointId);
  input.pendingPhotos.forEach((photo) => {
    formData.set(`display:${photo.photoId}`, photo.displayFile);
    formData.set(`thumbnail:${photo.photoId}`, photo.thumbnailFile);
  });
  const response = await fetchGatheringApi(input.projectId, input.dailyPlanId, {
    method: "PUT",
    body: formData
  });
  return readMutationResponse(response, "집합장소 사진 변경사항을 저장하지 못했습니다.");
}

export async function uploadDailyPlanGatheringPhoto(
  input: UploadGatheringPhotoInput
): Promise<GatheringPhotoMutationResult> {
  if (!isValidDatabaseProjectId(input.projectId)) return uploadLocalPhoto(input);
  const formData = new FormData();
  formData.set("file", input.displayFile);
  formData.set("thumbnail", input.thumbnailFile);
  formData.set("photoId", input.photoId);
  formData.set("departmentIds", JSON.stringify(input.departmentIds));
  formData.set("originalFilename", input.originalFilename);
  formData.set("expectedUpdatedAt", input.expectedUpdatedAt);
  if (input.gatheringPointId) formData.set("gatheringPointId", input.gatheringPointId);
  const response = await fetchGatheringApi(input.projectId, input.dailyPlanId, {
    method: "POST",
    body: formData
  });
  return readMutationResponse(response, "집합장소 사진을 저장하지 못했습니다.");
}

export async function deleteDailyPlanGatheringPhoto(
  input: DeleteGatheringPhotoInput
): Promise<GatheringPhotoMutationResult> {
  if (!isValidDatabaseProjectId(input.projectId)) return deleteLocalPhoto(input);
  const response = await fetchGatheringApi(input.projectId, input.dailyPlanId, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gatheringPointId: input.gatheringPointId,
      photoId: input.photoId,
      expectedUpdatedAt: input.expectedUpdatedAt
    })
  });
  return readMutationResponse(response, "집합장소 사진을 삭제하지 못했습니다.");
}

export async function saveDailyPlanGatheringPhotoOrder(
  input: ReorderGatheringPhotosInput
): Promise<GatheringPhotoMutationResult> {
  if (!isValidDatabaseProjectId(input.projectId)) return reorderLocalPhotos(input);
  const response = await fetchGatheringApi(input.projectId, input.dailyPlanId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gatheringPointId: input.gatheringPointId,
      orderedPhotoIds: input.orderedPhotoIds,
      expectedUpdatedAt: input.expectedUpdatedAt
    })
  });
  return readMutationResponse(response, "집합장소 사진 순서를 저장하지 못했습니다.");
}

async function fetchGatheringApi(projectId: string, dailyPlanId: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(
    `/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}/gathering-photos`,
    { ...init, headers }
  );
}

async function readMutationResponse(response: Response, fallbackMessage: string) {
  const payload = (await response.json().catch(() => ({}))) as {
    memo?: string;
    updatedAt?: string;
    gatheringPointId?: string;
    cleanupWarning?: string;
    error?: string;
    detail?: string;
  };
  if (!response.ok || !payload.memo || !payload.updatedAt) {
    throw new Error(payload.error || payload.detail || fallbackMessage);
  }
  return {
    memo: payload.memo,
    updatedAt: payload.updatedAt,
    gatheringPointId: payload.gatheringPointId,
    cleanupWarning: payload.cleanupWarning
  };
}

async function uploadLocalPhoto(input: UploadGatheringPhotoInput): Promise<GatheringPhotoMutationResult> {
  const buckets = readLocalBuckets();
  const index = buckets.dailyPlans.findIndex((plan) => (
    plan.projectId === input.projectId && plan.id === input.dailyPlanId
  ));
  if (index < 0) throw new Error("일촬표를 찾을 수 없습니다.");
  const plan = buckets.dailyPlans[index];
  let meta = reconcileDailyPlanGatheringPoints(decodeDailyPlanMemo(plan.memo), plan.shootingLocations);
  const point = meta.gatheringPoints.find((item) => item.id === input.gatheringPointId)
    ?? meta.gatheringPoints.find((item) => input.departmentIds.some((id) => item.departmentIds.includes(id)));
  if (!point) throw new Error("사진을 연결할 집합장소를 찾을 수 없습니다.");
  const [url, thumbnailUrl] = await Promise.all([
    readFileAsDataUrl(input.displayFile),
    readFileAsDataUrl(input.thumbnailFile)
  ]);
  meta = appendGatheringPhoto(meta, point.id, {
    id: input.photoId,
    url,
    thumbnailUrl,
    storagePath: "",
    thumbnailPath: "",
    sortOrder: point.photos.length,
    originalFilename: input.originalFilename
  });
  return saveLocalMeta(input.projectId, index, buckets, meta, point.id);
}

async function deleteLocalPhoto(input: DeleteGatheringPhotoInput): Promise<GatheringPhotoMutationResult> {
  const buckets = readLocalBuckets();
  const index = buckets.dailyPlans.findIndex((plan) => (
    plan.projectId === input.projectId && plan.id === input.dailyPlanId
  ));
  if (index < 0) throw new Error("일촬표를 찾을 수 없습니다.");
  const plan = buckets.dailyPlans[index];
  const meta = reconcileDailyPlanGatheringPoints(decodeDailyPlanMemo(plan.memo), plan.shootingLocations);
  if (!meta.gatheringPoints.some((point) => point.id === input.gatheringPointId)) {
    throw new Error("집합장소를 찾을 수 없습니다.");
  }
  return saveLocalMeta(
    input.projectId,
    index,
    buckets,
    removeGatheringPhoto(meta, input.gatheringPointId, input.photoId)
  );
}

async function reorderLocalPhotos(input: ReorderGatheringPhotosInput): Promise<GatheringPhotoMutationResult> {
  const buckets = readLocalBuckets();
  const index = buckets.dailyPlans.findIndex((plan) => (
    plan.projectId === input.projectId && plan.id === input.dailyPlanId
  ));
  if (index < 0) throw new Error("일촬표를 찾을 수 없습니다.");
  const plan = buckets.dailyPlans[index];
  const meta = reconcileDailyPlanGatheringPoints(decodeDailyPlanMemo(plan.memo), plan.shootingLocations);
  return saveLocalMeta(
    input.projectId,
    index,
    buckets,
    reorderGatheringPhotos(meta, input.gatheringPointId, input.orderedPhotoIds)
  );
}

function saveLocalMeta(
  projectId: string,
  planIndex: number,
  buckets: ReturnType<typeof readLocalBuckets>,
  meta: ReturnType<typeof decodeDailyPlanMemo>,
  gatheringPointId?: string
) {
  const now = new Date().toISOString();
  const memo = encodeDailyPlanMemo(meta);
  const dailyPlans = buckets.dailyPlans.map((plan, index) => (
    index === planIndex ? { ...plan, memo, updatedAt: now } : plan
  ));
  writeLocalBuckets({ dailyPlans }, projectId);
  return Promise.resolve({ memo, updatedAt: now, gatheringPointId });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("선택한 사진을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

async function saveLocalPhotoDraft(
  input: SaveGatheringPhotoDraftInput
): Promise<GatheringPhotoMutationResult> {
  const buckets = readLocalBuckets();
  const index = buckets.dailyPlans.findIndex((plan) => (
    plan.projectId === input.projectId && plan.id === input.dailyPlanId
  ));
  if (index < 0) throw new Error("일촬표를 찾을 수 없습니다.");
  const plan = buckets.dailyPlans[index];
  if (input.expectedUpdatedAt && plan.updatedAt !== input.expectedUpdatedAt) {
    throw new Error("일촬표가 다른 화면에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.");
  }
  let meta = reconcileDailyPlanGatheringPoints(decodeDailyPlanMemo(plan.memo), plan.shootingLocations);
  const point = meta.gatheringPoints.find((item) => item.id === input.gatheringPointId)
    ?? meta.gatheringPoints.find((item) => input.departmentIds.some((id) => item.departmentIds.includes(id)));
  if (!point) throw new Error("사진을 연결할 집합장소를 찾을 수 없습니다.");

  const localPhotos = await Promise.all(input.pendingPhotos.map(async (photo, photoIndex) => {
    // localStorage fallback은 용량을 제한하기 위해 420px thumbnail 하나만 원본/썸네일로 함께 사용합니다.
    const url = await readFileAsDataUrl(photo.thumbnailFile);
    return {
      id: photo.photoId,
      url,
      thumbnailUrl: url,
      storagePath: "",
      thumbnailPath: "",
      sortOrder: point.photos.length + photoIndex,
      originalFilename: photo.originalFilename
    };
  }));
  input.deletedPhotoIds.forEach((photoId) => {
    meta = removeGatheringPhoto(meta, point.id, photoId);
  });
  localPhotos.forEach((photo) => {
    meta = appendGatheringPhoto(meta, point.id, photo);
  });
  meta = reorderGatheringPhotos(meta, point.id, input.orderedPhotoIds);
  return saveLocalMeta(input.projectId, index, buckets, meta, point.id);
}

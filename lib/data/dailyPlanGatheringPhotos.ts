import { isValidDatabaseProjectId } from "@/lib/projectId";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type GatheringPhotoFailure = {
  photoId: string;
  error: string;
};

export class GatheringPhotoMutationError extends Error {
  readonly status: number;
  readonly latestMemo: string;
  readonly latestUpdatedAt: string;

  constructor(message: string, options: { status: number; latestMemo?: string; latestUpdatedAt?: string }) {
    super(message);
    this.name = "GatheringPhotoMutationError";
    this.status = options.status;
    this.latestMemo = options.latestMemo ?? "";
    this.latestUpdatedAt = options.latestUpdatedAt ?? "";
  }
}

export type GatheringPhotoMutationResult = {
  memo: string;
  updatedAt: string;
  gatheringPointId?: string;
  cleanupWarning?: string;
  appliedPhotoIds: string[];
  failedPhotos: GatheringPhotoFailure[];
};

type UploadGatheringPhotoInput = {
  projectId: string;
  dailyPlanId: string;
  gatheringPointId: string | null;
  locationId?: string | null;
  locationName?: string;
  address?: string;
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
  locationId?: string | null;
  locationName?: string;
  address?: string;
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
  requireDatabaseProject(input.projectId);
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
  if (input.locationId) formData.set("locationId", input.locationId);
  if (input.locationName) formData.set("locationName", input.locationName);
  if (input.address) formData.set("address", input.address);
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
  requireDatabaseProject(input.projectId);
  const formData = new FormData();
  formData.set("file", input.displayFile);
  formData.set("thumbnail", input.thumbnailFile);
  formData.set("photoId", input.photoId);
  formData.set("departmentIds", JSON.stringify(input.departmentIds));
  formData.set("originalFilename", input.originalFilename);
  formData.set("expectedUpdatedAt", input.expectedUpdatedAt);
  if (input.gatheringPointId) formData.set("gatheringPointId", input.gatheringPointId);
  if (input.locationId) formData.set("locationId", input.locationId);
  if (input.locationName) formData.set("locationName", input.locationName);
  if (input.address) formData.set("address", input.address);
  const response = await fetchGatheringApi(input.projectId, input.dailyPlanId, {
    method: "POST",
    body: formData
  });
  return readMutationResponse(response, "집합장소 사진을 저장하지 못했습니다.");
}

export async function deleteDailyPlanGatheringPhoto(
  input: DeleteGatheringPhotoInput
): Promise<GatheringPhotoMutationResult> {
  requireDatabaseProject(input.projectId);
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
  requireDatabaseProject(input.projectId);
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
    appliedPhotoIds?: unknown;
    failedPhotos?: unknown;
    error?: string;
    detail?: string;
  };
  if (!response.ok || !payload.memo || !payload.updatedAt) {
    throw new GatheringPhotoMutationError(
      payload.error || payload.detail || fallbackMessage,
      {
        status: response.status,
        latestMemo: payload.memo,
        latestUpdatedAt: payload.updatedAt
      }
    );
  }
  return {
    memo: payload.memo,
    updatedAt: payload.updatedAt,
    gatheringPointId: payload.gatheringPointId,
    cleanupWarning: payload.cleanupWarning,
    appliedPhotoIds: normalizeAppliedPhotoIds(payload.appliedPhotoIds),
    failedPhotos: normalizePhotoFailures(payload.failedPhotos)
  };
}

function requireDatabaseProject(projectId: string) {
  if (!isValidDatabaseProjectId(projectId)) {
    throw new Error("집합장소 사진은 Supabase에 연결된 프로젝트에서만 저장할 수 있습니다.");
  }
}

function normalizeAppliedPhotoIds(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function normalizePhotoFailures(value: unknown): GatheringPhotoFailure[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as { photoId?: unknown; error?: unknown };
    const photoId = String(source.photoId ?? "").trim();
    const error = String(source.error ?? "").trim();
    return photoId && error ? [{ photoId, error }] : [];
  });
}

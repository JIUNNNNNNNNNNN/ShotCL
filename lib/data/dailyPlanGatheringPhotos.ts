import { isValidDatabaseProjectId } from "@/lib/projectId";

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
  receipt?: string;
  appliedPhotoIds: string[];
  failedPhotos: GatheringPhotoFailure[];
};

export type GatheringPhotoDeleteResult = GatheringPhotoMutationResult & {
  receipt: string;
};

export type UploadGatheringPhotoInput = {
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

export type ReplaceGatheringPhotoInput = UploadGatheringPhotoInput & {
  replacedPhotoId: string;
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
  const formData = createGatheringPhotoUploadFormData(input, { ensureMissingParent: true });
  const response = await fetchGatheringApi(input.projectId, input.dailyPlanId, {
    method: "POST",
    body: formData
  });
  return readMutationResponse(response, "집합장소 사진을 저장하지 못했습니다.");
}

/**
 * 새 파일을 먼저 저장한 뒤 metadata를 교체하고, 성공한 뒤에만 이전
 * Storage 파일을 정리하는 서버의 단일 사진 교체 계약을 사용합니다.
 */
export async function replaceDailyPlanGatheringPhoto(
  input: ReplaceGatheringPhotoInput
): Promise<GatheringPhotoMutationResult> {
  requireDatabaseProject(input.projectId);
  const formData = createGatheringPhotoUploadFormData(input);
  formData.set("replacedPhotoId", input.replacedPhotoId);
  const response = await fetchGatheringApi(input.projectId, input.dailyPlanId, {
    method: "POST",
    body: formData
  });
  return readMutationResponse(response, "집합장소 사진을 변경하지 못했습니다.");
}

export async function deleteDailyPlanGatheringPhoto(
  input: DeleteGatheringPhotoInput
): Promise<GatheringPhotoDeleteResult> {
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
  const result = await readMutationResponse(response, "집합장소 사진을 삭제하지 못했습니다.");
  if (!result.receipt) throw new Error("집합장소 사진 복원 정보를 받지 못했습니다.");
  return { ...result, receipt: result.receipt };
}

export async function restoreDailyPlanGatheringPhoto(
  projectId: string,
  dailyPlanId: string,
  receipt: string
): Promise<GatheringPhotoMutationResult> {
  requireDatabaseProject(projectId);
  const response = await fetchGatheringApi(projectId, dailyPlanId, {
    method: "PATCH",
    keepalive: receipt.length <= 48_000,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restore-delete", receipt })
  });
  return readMutationResponse(response, "집합장소 사진 삭제를 되돌리지 못했습니다.");
}

export async function finalizeDailyPlanGatheringPhotoDelete(
  projectId: string,
  dailyPlanId: string,
  receipt: string
): Promise<void> {
  requireDatabaseProject(projectId);
  const response = await fetchGatheringApi(projectId, dailyPlanId, {
    method: "PATCH",
    keepalive: receipt.length <= 48_000,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "finalize-delete", receipt })
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "집합장소 사진 파일을 정리하지 못했습니다.");
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
  return fetch(
    `/api/projects/${encodeURIComponent(projectId)}/daily-plans/${encodeURIComponent(dailyPlanId)}/gathering-photos`,
    { ...init, credentials: "same-origin" }
  );
}

function createGatheringPhotoUploadFormData(
  input: UploadGatheringPhotoInput,
  options: { ensureMissingParent?: boolean } = {}
) {
  const formData = new FormData();
  formData.set("file", input.displayFile);
  formData.set("thumbnail", input.thumbnailFile);
  formData.set("photoId", input.photoId);
  formData.set("departmentIds", JSON.stringify(input.departmentIds));
  formData.set("originalFilename", input.originalFilename);
  formData.set("expectedUpdatedAt", input.expectedUpdatedAt);
  if (input.gatheringPointId) formData.set("gatheringPointId", input.gatheringPointId);
  if (options.ensureMissingParent && !input.gatheringPointId) {
    formData.set("ensureGatheringPoint", "true");
  }
  if (input.locationId) formData.set("locationId", input.locationId);
  if (input.locationName) formData.set("locationName", input.locationName);
  if (input.address) formData.set("address", input.address);
  return formData;
}

async function readMutationResponse(response: Response, fallbackMessage: string) {
  const payload = (await response.json().catch(() => ({}))) as {
    memo?: string;
    updatedAt?: string;
    gatheringPointId?: string;
    cleanupWarning?: string;
    receipt?: unknown;
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
    receipt: typeof payload.receipt === "string" ? payload.receipt : undefined,
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

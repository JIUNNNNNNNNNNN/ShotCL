import type {
  ProjectCostume,
  ProjectCostumeScene,
  ProjectArchiveFolder,
  ProjectArchiveFolderInspection,
  ProjectReferenceAsset,
  ProjectReferenceAssetType,
  ProjectReferenceCrop,
  ProjectScenarioScene,
} from "@/lib/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type ApiError = { error?: string; detail?: string };

export type ProjectReferenceAssetUploadMetadata = {
  assetId?: string;
  dailyPlanId?: string;
  sceneNo?: string;
  cutNo?: string;
  shotRef?: string;
  groupId?: string;
  cropRatio?: number | null;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  sourceType?: ProjectReferenceCrop["sourceType"];
  sourceAssetId?: string;
  pageIndex?: number;
  sourceFilename?: string;
  sourceKind?: ProjectReferenceCrop["sourceKind"];
  sourcePageNumber?: number;
  importBatchId?: string;
  templateId?: string;
  manuallyPositioned?: boolean;
  customSize?: boolean;
  title?: string;
  memo?: string;
  sortOrder?: number;
  basePageWidth?: number;
  basePageHeight?: number;
  templateCropWidth?: number;
  templateCropHeight?: number;
  aspectRatio?: number;
  clickPlacementMode?: "center";
  centerX?: number;
  centerY?: number;
  cropOrderIndex?: number;
  rowStep?: number;
  rowsPerPage?: number;
  targetColumn?: "storyboard";
  includeContext?: false;
  folderId?: string | null;
  originalFolderName?: string;
  relativePath?: string;
  displayName?: string;
  originalFilename?: string;
  episodeNumber?: number;
  sceneId?: string;
  sceneNumber?: string;
  cutNumber?: number;
  cropIndex?: number;
  thumbnailFile?: File;
};

export type StoryboardCropBulkUploadItem = {
  clientResultId: string;
  file: File;
  thumbnailFile: File;
  metadata: ProjectReferenceAssetUploadMetadata & {
    assetId: string;
    importBatchId: string;
    cropIndex: number;
    sourceType: "image_crop" | "pdf_crop";
  };
};

export type StoryboardCropBulkUploadItemResult = {
  clientResultId: string;
  assetId: string;
  status: "saved" | "existing" | "failed";
  asset?: ProjectReferenceAsset;
  error?: string;
};

export type StoryboardCropBulkUploadResult = {
  results: StoryboardCropBulkUploadItemResult[];
  assets: ProjectReferenceAsset[];
  storageCleanupWarning: string;
  timings: {
    requestMs: number;
    uploadMs: number;
    databaseMs: number;
    totalMs: number;
    requestCount: number;
  };
};

const STORYBOARD_BULK_MAX_COUNT = 8;
const STORYBOARD_BULK_MAX_BYTES = 3 * 1024 * 1024;

async function fetchArchiveApi(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(input, { ...init, headers });
}

export type ProjectCostumeBulkSaveInput = {
  scenes: Array<{
    id: string;
    sceneNo: string;
    sceneTitle: string;
    episodeNumbers: number[];
    sortOrder: number;
    items: Array<{
      id: string;
      actorRole: string;
      actorName: string;
      costumeContent: string;
      provider: string;
      hair: string;
      sortOrder: number;
      keepCostumeImagePaths: string[];
      keepHairImagePaths: string[];
    }>;
  }>;
  deletedSceneIds: string[];
  deletedItemIds: string[];
};

export type ProjectCostumeBulkSaveResult = {
  scenes: ProjectCostumeScene[];
  sceneIdMap: Record<string, string>;
  itemIdMap: Record<string, string>;
  verification: {
    expectedSceneCount: number;
    actualSceneCount: number;
    expectedItemCount: number;
    actualItemCount: number;
    missingScenes: string[];
    itemCountMismatches: string[];
  };
  timings: Record<string, number>;
};

export class ProjectCostumeBulkSaveError extends Error {
  readonly partialResult: ProjectCostumeBulkSaveResult | null;

  constructor(message: string, partialResult: ProjectCostumeBulkSaveResult | null = null) {
    super(message);
    this.name = "ProjectCostumeBulkSaveError";
    this.partialResult = partialResult;
  }
}

export async function listProjectReferenceAssets(
  projectId: string,
  assetType: ProjectReferenceAssetType,
  dailyPlanId?: string
): Promise<ProjectReferenceAsset[]> {
  const query = new URLSearchParams({ type: assetType });
  if (dailyPlanId) query.set("dailyPlanId", dailyPlanId);
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/reference-assets?${query}`, {
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { assets?: ProjectReferenceAsset[] };
  if (!response.ok) throw new Error(payload.error || "프로젝트 자료를 불러오지 못했습니다.");
  return payload.assets ?? [];
}

export async function uploadProjectReferenceAsset(
  projectId: string,
  assetType: ProjectReferenceAssetType,
  file: File,
  metadata: ProjectReferenceAssetUploadMetadata = {}
): Promise<ProjectReferenceAsset> {
  const formData = new FormData();
  formData.set("assetType", assetType);
  formData.set("file", file);
  if (metadata.thumbnailFile) formData.set("thumbnail", metadata.thumbnailFile);
  Object.entries(metadata).forEach(([key, value]) => {
    if (key === "thumbnailFile") return;
    if (key === "folderId" && value === null) {
      formData.set(key, "");
      return;
    }
    if (value !== undefined && value !== null && value !== "") formData.set(key, String(value));
  });
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/reference-assets`, {
    method: "POST",
    body: formData
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { asset?: ProjectReferenceAsset };
  if (!response.ok || !payload.asset) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "자료를 업로드하지 못했습니다.");
  }
  return payload.asset;
}

/**
 * 콘티 crop 결과를 작은 multipart 묶음으로 저장합니다.
 * 한 요청이 서버리스 body 제한을 넘지 않도록 8개·약 3MB 중 먼저 도달하는 기준으로 나눕니다.
 */
export async function uploadStoryboardCropAssetsBulk(
  projectId: string,
  items: StoryboardCropBulkUploadItem[],
  options: {
    signal?: AbortSignal;
    onChunkComplete?: (completedCount: number, totalCount: number) => void;
  } = {}
): Promise<StoryboardCropBulkUploadResult> {
  const startedAt = nowMs();
  const normalizedItems = items.map((item) => ({
    ...item,
    clientResultId: item.clientResultId.trim(),
    metadata: {
      ...item.metadata,
      assetId: item.metadata.assetId.trim().toLowerCase()
    }
  }));
  const duplicateAssetId = firstDuplicateValue(
    normalizedItems.map((item) => item.metadata.assetId)
  );
  const duplicateResultId = firstDuplicateValue(
    normalizedItems.map((item) => item.clientResultId)
  );
  if (duplicateAssetId || duplicateResultId) {
    throw new Error("같은 crop 식별값이 전체 추출 목록에 중복되어 있습니다.");
  }
  const chunks = chunkStoryboardCropUploads(normalizedItems);
  const results: StoryboardCropBulkUploadItemResult[] = [];
  const timings = {
    requestMs: 0,
    uploadMs: 0,
    databaseMs: 0,
    totalMs: 0,
    requestCount: 0
  };
  const cleanupWarnings = new Set<string>();
  let completedCount = 0;

  for (const chunk of chunks) {
    if (options.signal?.aborted) throw new DOMException("작업이 취소되었습니다.", "AbortError");

    if (chunk.length === 1 && storyboardCropUploadBytes(chunk[0]) > STORYBOARD_BULK_MAX_BYTES) {
      const item = chunk[0];
      results.push({
        clientResultId: item.clientResultId,
        assetId: item.metadata.assetId,
        status: "failed",
        error: "crop 이미지와 썸네일 합계가 3MB를 초과했습니다."
      });
      completedCount += 1;
      options.onChunkComplete?.(completedCount, normalizedItems.length);
      continue;
    }

    const formData = new FormData();
    formData.set("operation", "bulk_storyboard_crop");
    formData.set("manifest", JSON.stringify(chunk.map((item) => {
      const { thumbnailFile: _thumbnailFile, ...metadata } = item.metadata;
      return {
        clientResultId: item.clientResultId,
        assetId: item.metadata.assetId,
        metadata
      };
    })));
    for (const item of chunk) {
      formData.set(`file:${item.metadata.assetId}`, item.file);
      formData.set(`thumbnail:${item.metadata.assetId}`, item.thumbnailFile);
    }

    const requestStartedAt = nowMs();
    timings.requestCount += 1;
    const response = await fetchArchiveApi(
      `/api/projects/${encodeURIComponent(projectId)}/reference-assets`,
      { method: "POST", body: formData, signal: options.signal }
    );
    const payload = (await response.json().catch(() => ({}))) as ApiError & {
      results?: StoryboardCropBulkUploadItemResult[];
      storageCleanupWarning?: string;
      timings?: Partial<typeof timings>;
    };
    timings.requestMs += nowMs() - requestStartedAt;
    timings.uploadMs += Number(payload.timings?.uploadMs ?? 0);
    timings.databaseMs += Number(payload.timings?.databaseMs ?? 0);
    if (payload.storageCleanupWarning) cleanupWarnings.add(payload.storageCleanupWarning);

    if (payload.results) {
      results.push(...payload.results);
    } else {
      const message = [payload.error, payload.detail].filter(Boolean).join(" · ")
        || "콘티 crop 묶음을 업로드하지 못했습니다.";
      results.push(...chunk.map((item) => ({
        clientResultId: item.clientResultId,
        assetId: item.metadata.assetId,
        status: "failed" as const,
        error: message
      })));
    }
    completedCount += chunk.length;
    options.onChunkComplete?.(completedCount, normalizedItems.length);
  }

  const byClientResultId = new Map(results.map((result) => [result.clientResultId, result]));
  const orderedResults = normalizedItems.map((item) => (
    byClientResultId.get(item.clientResultId) ?? {
      clientResultId: item.clientResultId,
      assetId: item.metadata.assetId,
      status: "failed" as const,
      error: "콘티 crop 저장 결과를 확인하지 못했습니다."
    }
  ));
  timings.totalMs = nowMs() - startedAt;
  return {
    results: orderedResults,
    assets: orderedResults.flatMap((result) => result.asset ? [result.asset] : []),
    storageCleanupWarning: [...cleanupWarnings].join(" · "),
    timings
  };
}

function chunkStoryboardCropUploads(items: StoryboardCropBulkUploadItem[]) {
  const chunks: StoryboardCropBulkUploadItem[][] = [];
  let current: StoryboardCropBulkUploadItem[] = [];
  let currentBytes = 0;
  for (const item of items) {
    const itemBytes = storyboardCropUploadBytes(item);
    if (
      current.length > 0
      && (current.length >= STORYBOARD_BULK_MAX_COUNT || currentBytes + itemBytes > STORYBOARD_BULK_MAX_BYTES)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += itemBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function storyboardCropUploadBytes(item: StoryboardCropBulkUploadItem) {
  return item.file.size + item.thumbnailFile.size;
}

function firstDuplicateValue(values: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return "";
}

function nowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export async function updateProjectReferenceAsset(
  projectId: string,
  id: string,
  patch: {
    groupId?: string;
    crop?: Partial<ProjectReferenceCrop>;
    title?: string;
    memo?: string;
    sceneNo?: string;
    cutNo?: string;
    displayName?: string;
    episodeNumber?: number | null;
    sceneId?: string | null;
    sceneNumber?: string;
    cutNumber?: number | null;
    cropIndex?: number | null;
    assetType?: ProjectReferenceCrop["assetType"];
    folderId?: string | null;
    sortOrder?: number;
    scenarioScenes?: ProjectScenarioScene[];
    scenarioParseError?: string | null;
    reanalyzeScenario?: boolean;
  }
): Promise<ProjectReferenceAsset> {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/reference-assets`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...patch })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { asset?: ProjectReferenceAsset };
  if (!response.ok || !payload.asset) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "자료 설정을 저장하지 못했습니다.");
  }
  return payload.asset;
}

export type ProjectReferenceAssetOrderUpdate = {
  id: string;
  sortOrder: number;
  updatedAt?: string;
};

export class ProjectReferenceAssetReorderError extends Error {
  readonly orders: ProjectReferenceAssetOrderUpdate[];
  readonly assets: ProjectReferenceAsset[];
  readonly hasGroupSnapshot: boolean;

  constructor(
    message: string,
    orders: ProjectReferenceAssetOrderUpdate[] = [],
    assets: ProjectReferenceAsset[] = [],
    hasGroupSnapshot = false
  ) {
    super(message);
    this.name = "ProjectReferenceAssetReorderError";
    this.orders = orders;
    this.assets = assets;
    this.hasGroupSnapshot = hasGroupSnapshot;
  }
}

export type ProjectReferenceAssetSceneCutUpdateResult = {
  asset: {
    id: string;
    sceneId: string | null;
    sceneNumber: string;
    cutNumber: number | null;
    sortOrder: number;
    updatedAt: string;
  };
  orders: ProjectReferenceAssetOrderUpdate[];
};

export class ProjectReferenceAssetSceneCutError extends Error {
  readonly asset: ProjectReferenceAssetSceneCutUpdateResult["asset"] | null;
  readonly orders: ProjectReferenceAssetOrderUpdate[];

  constructor(
    message: string,
    asset: ProjectReferenceAssetSceneCutUpdateResult["asset"] | null,
    orders: ProjectReferenceAssetOrderUpdate[] = []
  ) {
    super(message);
    this.name = "ProjectReferenceAssetSceneCutError";
    this.asset = asset;
    this.orders = orders;
  }
}

/**
 * 아카이브 우클릭 정보창 전용 경량 mutation입니다.
 * 이미지나 Storage 메타데이터는 보내지 않고 scene/cut 식별값만 변경합니다.
 */
export async function updateProjectReferenceAssetSceneCut(
  projectId: string,
  id: string,
  input: {
    sceneId: string | null;
    cutNumber: number | null;
    expectedUpdatedAt?: string;
  }
): Promise<ProjectReferenceAssetSceneCutUpdateResult> {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/reference-assets`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "update_scene_cut",
      id,
      sceneId: input.sceneId,
      cutNumber: input.cutNumber,
      expectedUpdatedAt: input.expectedUpdatedAt
    })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    asset?: ProjectReferenceAssetSceneCutUpdateResult["asset"];
    orders?: ProjectReferenceAssetOrderUpdate[];
  };
  if (!response.ok || !payload.asset) {
    throw new ProjectReferenceAssetSceneCutError(
      [payload.error, payload.detail].filter(Boolean).join(" · ") || "자료의 씬·컷을 저장하지 못했습니다.",
      payload.asset ?? null,
      payload.orders ?? []
    );
  }
  return { asset: payload.asset, orders: payload.orders ?? [] };
}

/** 같은 씬·컷에 속한 모든 이미지의 순서를 한 요청으로 저장합니다. */
export async function reorderProjectReferenceAssets(
  projectId: string,
  input: {
    sceneId: string | null;
    cutNumber: number | null;
    orderedAssetIds: string[];
    expectedUpdatedAtById?: Record<string, string>;
  }
): Promise<ProjectReferenceAssetOrderUpdate[]> {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/reference-assets`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "reorder_cut_assets", ...input })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    orders?: ProjectReferenceAssetOrderUpdate[];
    assets?: ProjectReferenceAsset[];
    groupSnapshot?: boolean;
  };
  if (!response.ok || !payload.orders) {
    throw new ProjectReferenceAssetReorderError(
      [payload.error, payload.detail].filter(Boolean).join(" · ") || "자료 순서를 저장하지 못했습니다.",
      payload.orders ?? [],
      payload.assets ?? [],
      payload.groupSnapshot === true
    );
  }
  return payload.orders;
}

export async function deleteProjectReferenceAsset(projectId: string, id: string) {
  const response = await fetchArchiveApi(
    `/api/projects/${encodeURIComponent(projectId)}/reference-assets?id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    deleted?: number;
    storageCleanupWarning?: string;
  };
  if (!response.ok) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "자료를 삭제하지 못했습니다.");
  }
  return {
    deleted: payload.deleted ?? 0,
    storageCleanupWarning: payload.storageCleanupWarning ?? ""
  };
}

export async function moveProjectReferenceAssets(
  projectId: string,
  ids: string[],
  folderId: string | null
) {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/reference-assets`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "move_many", ids, folderId })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { moved?: number };
  if (!response.ok) throw new Error(payload.error || "선택한 자료를 이동하지 못했습니다.");
  return payload.moved ?? 0;
}

export async function deleteProjectReferenceAssets(projectId: string, ids: string[]) {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/reference-assets`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    deleted?: number;
    storageCleanupWarning?: string;
  };
  if (!response.ok) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "선택한 자료를 삭제하지 못했습니다.");
  }
  return {
    deleted: payload.deleted ?? 0,
    storageCleanupWarning: payload.storageCleanupWarning ?? ""
  };
}

export async function inspectProjectReferenceAssets(
  projectId: string,
  ids: string[]
): Promise<{ assetIds: string[]; assetCount: number; linkedAssetCount: number }> {
  const response = await fetchArchiveApi(
    `/api/projects/${encodeURIComponent(projectId)}/reference-assets`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "inspect_many", ids: [...new Set(ids)] })
    }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    inspection?: { assetIds?: string[]; assetCount?: number; linkedAssetCount?: number };
  };
  if (!response.ok || !payload.inspection) {
    throw new Error(
      [payload.error, payload.detail].filter(Boolean).join(" · ")
      || "선택한 자료의 연결 상태를 확인하지 못했습니다."
    );
  }
  return {
    assetIds: payload.inspection.assetIds ?? [],
    assetCount: payload.inspection.assetCount ?? 0,
    linkedAssetCount: payload.inspection.linkedAssetCount ?? 0
  };
}

export async function listProjectArchiveFolders(projectId: string): Promise<ProjectArchiveFolder[]> {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/archive-folders`, {
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { folders?: ProjectArchiveFolder[] };
  if (!response.ok) throw new Error(payload.error || "아카이브 폴더를 불러오지 못했습니다.");
  return payload.folders ?? [];
}

export async function createProjectArchiveFolder(
  projectId: string,
  name: string,
  sortOrder = 0
): Promise<ProjectArchiveFolder> {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/archive-folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, sortOrder })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { folder?: ProjectArchiveFolder };
  if (!response.ok || !payload.folder) throw new Error(payload.error || "폴더를 만들지 못했습니다.");
  return payload.folder;
}

export async function renameProjectArchiveFolder(
  projectId: string,
  id: string,
  name: string
): Promise<ProjectArchiveFolder> {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/archive-folders`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { folder?: ProjectArchiveFolder };
  if (!response.ok || !payload.folder) throw new Error(payload.error || "폴더 이름을 바꾸지 못했습니다.");
  return payload.folder;
}

export async function renameProjectArchiveFolderTree(
  projectId: string,
  id: string | null,
  rootPath: string,
  name: string
): Promise<ProjectArchiveFolder[]> {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/archive-folders`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "rename_tree", id, rootPath, name })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    folders?: ProjectArchiveFolder[];
  };
  if (!response.ok || !payload.folders) {
    throw new Error(
      [payload.error, payload.detail].filter(Boolean).join(" · ")
      || "폴더 이름을 바꾸지 못했습니다."
    );
  }
  return payload.folders;
}

export async function deleteProjectArchiveFolder(projectId: string, id: string) {
  const response = await fetchArchiveApi(
    `/api/projects/${encodeURIComponent(projectId)}/archive-folders?id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) throw new Error(payload.error || "폴더를 삭제하지 못했습니다.");
}

/**
 * 선택된 폴더와 모든 하위 폴더의 full path를 변경합니다.
 * 부모와 자식이 함께 전달돼도 서버가 최상위 선택 폴더만 이동 대상으로 정리합니다.
 */
export async function moveProjectArchiveFolders(
  projectId: string,
  ids: string[],
  destinationFolderId: string | null
): Promise<{ movedRootIds: string[]; folders: ProjectArchiveFolder[] }> {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/archive-folders`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "move_many",
      ids,
      destinationFolderId
    })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    movedRootIds?: string[];
    folders?: ProjectArchiveFolder[];
  };
  if (!response.ok) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "폴더를 이동하지 못했습니다.");
  }
  return {
    movedRootIds: payload.movedRootIds ?? [],
    folders: payload.folders ?? []
  };
}

/**
 * asset·folder 혼합 선택을 하나의 서버 작업으로 이동합니다.
 * 서버는 폴더 이동 뒤 asset 이동이 실패하면 두 상태를 이전 값으로 되돌립니다.
 */
export async function moveProjectArchiveSelection(
  projectId: string,
  assetIds: string[],
  folderIds: string[],
  destinationFolderId: string | null
): Promise<{
  movedAssetIds: string[];
  movedRootIds: string[];
  folders: ProjectArchiveFolder[];
}> {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/archive-folders`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "move_selection",
      assetIds,
      ids: folderIds,
      destinationFolderId
    })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    movedAssetIds?: string[];
    movedRootIds?: string[];
    folders?: ProjectArchiveFolder[];
  };
  if (!response.ok) {
    throw new Error(
      [payload.error, payload.detail].filter(Boolean).join(" · ")
      || "자료와 폴더를 이동하지 못했습니다."
    );
  }
  return {
    movedAssetIds: payload.movedAssetIds ?? [],
    movedRootIds: payload.movedRootIds ?? [],
    folders: payload.folders ?? []
  };
}

/** 삭제 확인 화면에 필요한 하위 폴더·파일·진행도 연결 개수를 서버 기준으로 조회합니다. */
export async function inspectProjectArchiveFolders(
  projectId: string,
  ids: string[],
  assetIds: string[] = []
): Promise<ProjectArchiveFolderInspection> {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/archive-folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "inspect_delete", ids, assetIds })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    inspection?: ProjectArchiveFolderInspection;
  };
  if (!response.ok || !payload.inspection) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "폴더 내용을 확인하지 못했습니다.");
  }
  return payload.inspection;
}

/**
 * inspect 결과를 사용자에게 보여준 뒤에만 호출해야 합니다.
 * 연결된 진행도 media_link도 명시적으로 정리하며 Storage 정리 경고를 함께 반환합니다.
 */
export async function deleteProjectArchiveFolders(
  projectId: string,
  ids: string[],
  confirmed: boolean,
  assetIds: string[] = []
): Promise<{
  inspection: ProjectArchiveFolderInspection;
  deletedFolderCount: number;
  deletedAssetCount: number;
  storageCleanupWarning: string;
}> {
  const response = await fetchArchiveApi(`/api/projects/${encodeURIComponent(projectId)}/archive-folders`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, confirmed, assetIds })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    inspection?: ProjectArchiveFolderInspection;
    deletedFolderCount?: number;
    deletedAssetCount?: number;
    storageCleanupWarning?: string;
  };
  if (!response.ok || !payload.inspection) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "폴더를 삭제하지 못했습니다.");
  }
  return {
    inspection: payload.inspection,
    deletedFolderCount: payload.deletedFolderCount ?? 0,
    deletedAssetCount: payload.deletedAssetCount ?? 0,
    storageCleanupWarning: payload.storageCleanupWarning ?? ""
  };
}

export async function listProjectCostumes(projectId: string): Promise<ProjectCostume[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/costumes`, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { costumes?: ProjectCostume[] };
  if (!response.ok) throw new Error(payload.error || "의상 리스트를 불러오지 못했습니다.");
  return payload.costumes ?? [];
}

export async function listProjectCostumeScenes(projectId: string): Promise<ProjectCostumeScene[]> {
  return (await getProjectCostumeSceneOverview(projectId)).scenes;
}

export async function getProjectCostumeSceneOverview(
  projectId: string
): Promise<{ scenes: ProjectCostumeScene[]; totalEpisodes: number }> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/costume-scenes`, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    scenes?: ProjectCostumeScene[];
    totalEpisodes?: number;
  };
  if (!response.ok) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "씬별 의상 자료를 불러오지 못했습니다.");
  }
  return {
    scenes: payload.scenes ?? [],
    totalEpisodes: Math.max(0, Number(payload.totalEpisodes ?? 0))
  };
}

/** 현재 의상 local state 전체를 한 요청으로 저장하고 서버 재조회 검증 결과를 돌려받습니다. */
export async function saveProjectCostumeSnapshot(
  projectId: string,
  value: ProjectCostumeBulkSaveInput
): Promise<ProjectCostumeBulkSaveResult> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/costume-scenes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError
    & Partial<ProjectCostumeBulkSaveResult>
    & { step?: string };
  const partialResult = (
    !payload.scenes
    || !payload.sceneIdMap
    || !payload.itemIdMap
    || !payload.verification
    || !payload.timings
  )
    ? null
    : {
        scenes: payload.scenes,
        sceneIdMap: payload.sceneIdMap,
        itemIdMap: payload.itemIdMap,
        verification: payload.verification,
        timings: payload.timings
      };
  if (!response.ok || !partialResult) {
    const context = [payload.step ? `단계: ${payload.step}` : "", payload.detail].filter(Boolean).join(" · ");
    throw new ProjectCostumeBulkSaveError(
      [payload.error || "의상 전체 저장을 완료하지 못했습니다.", context].filter(Boolean).join(" · "),
      partialResult
    );
  }
  return partialResult;
}

export async function createProjectCostumeScene(
  projectId: string,
  value: {
    sceneNo: string;
    sceneTitle: string;
    episodeNumbers: number[];
    actors: Array<{ role: string; name: string }>;
  }
): Promise<ProjectCostumeScene> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/costume-scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { scene?: ProjectCostumeScene };
  if (!response.ok || !payload.scene) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "의상 씬을 추가하지 못했습니다.");
  }
  return payload.scene;
}

export async function updateProjectCostumeScene(
  projectId: string,
  value: { id: string; sceneNo: string; sceneTitle: string; episodeNumbers: number[] }
): Promise<ProjectCostumeScene> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/costume-scenes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { scene?: ProjectCostumeScene };
  if (!response.ok || !payload.scene) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "의상 씬을 수정하지 못했습니다.");
  }
  return payload.scene;
}

export async function deleteProjectCostumeScene(projectId: string, id: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/costume-scenes?id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) throw new Error(payload.error || "의상 씬을 삭제하지 못했습니다.");
}

export async function saveProjectCostume(
  projectId: string,
  value: {
    id?: string;
    costumeSceneId: string;
    actorRole: string;
    actorName: string;
    costumeContent: string;
    provider: string;
    hair: string;
    sortOrder: number;
    clientItemId?: string;
    keepCostumeImagePaths: string[];
    keepHairImagePaths: string[];
    costumeFiles: File[];
    hairFiles: File[];
  }
): Promise<ProjectCostume> {
  const formData = new FormData();
  if (value.id) formData.set("id", value.id);
  if (value.clientItemId) formData.set("clientItemId", value.clientItemId);
  formData.set("costumeSceneId", value.costumeSceneId);
  formData.set("actorRole", value.actorRole);
  formData.set("actorName", value.actorName);
  formData.set("costumeContent", value.costumeContent);
  formData.set("provider", value.provider);
  formData.set("hair", value.hair);
  formData.set("sortOrder", String(value.sortOrder));
  formData.set("keepCostumeImagePaths", JSON.stringify(value.keepCostumeImagePaths));
  formData.set("keepHairImagePaths", JSON.stringify(value.keepHairImagePaths));
  value.costumeFiles.forEach((file) => formData.append("costumeFiles", file));
  value.hairFiles.forEach((file) => formData.append("hairFiles", file));
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/costumes`, {
    method: "POST",
    body: formData
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { costume?: ProjectCostume };
  if (!response.ok || !payload.costume) throw new Error(payload.error || "의상 항목을 저장하지 못했습니다.");
  return payload.costume;
}

export async function deleteProjectCostume(projectId: string, id: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/costumes?id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) throw new Error(payload.error || "의상 항목을 삭제하지 못했습니다.");
}

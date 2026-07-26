import type {
  ProjectCostume,
  ProjectCostumeScene,
  ProjectArchiveFolder,
  ProjectReferenceAsset,
  ProjectReferenceAssetType,
  ProjectReferenceCrop,
  ProjectScenarioScene,
} from "@/lib/types";

type ApiError = { error?: string; detail?: string };

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
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reference-assets?${query}`, {
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
  metadata: {
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
    thumbnailFile?: File;
  } = {}
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
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reference-assets`, {
    method: "POST",
    body: formData
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { asset?: ProjectReferenceAsset };
  if (!response.ok || !payload.asset) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "자료를 업로드하지 못했습니다.");
  }
  return payload.asset;
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
    sortOrder?: number;
    scenarioScenes?: ProjectScenarioScene[];
    scenarioParseError?: string | null;
    reanalyzeScenario?: boolean;
  }
): Promise<ProjectReferenceAsset> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reference-assets`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...patch })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { asset?: ProjectReferenceAsset };
  if (!response.ok || !payload.asset) throw new Error(payload.error || "자료 설정을 저장하지 못했습니다.");
  return payload.asset;
}

export async function deleteProjectReferenceAsset(projectId: string, id: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/reference-assets?id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) throw new Error(payload.error || "자료를 삭제하지 못했습니다.");
}

export async function moveProjectReferenceAssets(
  projectId: string,
  ids: string[],
  folderId: string | null
) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reference-assets`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "move_many", ids, folderId })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { moved?: number };
  if (!response.ok) throw new Error(payload.error || "선택한 자료를 이동하지 못했습니다.");
  return payload.moved ?? 0;
}

export async function deleteProjectReferenceAssets(projectId: string, ids: string[]) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reference-assets`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { deleted?: number };
  if (!response.ok) throw new Error(payload.error || "선택한 자료를 삭제하지 못했습니다.");
  return payload.deleted ?? 0;
}

export async function listProjectArchiveFolders(projectId: string): Promise<ProjectArchiveFolder[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/archive-folders`, {
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
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/archive-folders`, {
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
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/archive-folders`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { folder?: ProjectArchiveFolder };
  if (!response.ok || !payload.folder) throw new Error(payload.error || "폴더 이름을 바꾸지 못했습니다.");
  return payload.folder;
}

export async function deleteProjectArchiveFolder(projectId: string, id: string) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/archive-folders?id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) throw new Error(payload.error || "폴더를 삭제하지 못했습니다.");
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

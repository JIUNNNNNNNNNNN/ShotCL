import { getShotDiagramKey } from "@/lib/data/shotDiagrams";
import type {
  ProjectCostume,
  ProjectReferenceAsset,
  ProjectReferenceAssetType,
  ProjectReferenceCrop,
  Shot
} from "@/lib/types";

type ApiError = { error?: string; detail?: string };

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
    sortOrder?: number;
  } = {}
): Promise<ProjectReferenceAsset> {
  const formData = new FormData();
  formData.set("assetType", assetType);
  formData.set("file", file);
  Object.entries(metadata).forEach(([key, value]) => {
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
  patch: { groupId?: string; crop?: Partial<ProjectReferenceCrop>; sortOrder?: number }
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

/** 업로드형 부감도를 기존 JSON 부감도보다 우선 표시하도록 컷 ID별 URL을 만듭니다. */
export async function loadShotOverheadImageUrls(shots: Shot[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const firstShot = shots[0];
  if (!firstShot?.dailyPlanId) return result;
  const assets = await listProjectReferenceAssets(firstShot.projectId, "overhead", firstShot.dailyPlanId);
  const byRef = new Map(
    assets
      .filter((asset) => asset.shotRef && asset.publicUrl)
      .map((asset) => [asset.shotRef as string, asset.publicUrl])
  );
  shots.forEach((shot) => {
    const url = byRef.get(getShotDiagramKey(shot).shotRef);
    if (url) result.set(shot.id, url);
  });
  return result;
}

export async function listProjectCostumes(projectId: string): Promise<ProjectCostume[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/costumes`, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as ApiError & { costumes?: ProjectCostume[] };
  if (!response.ok) throw new Error(payload.error || "의상 리스트를 불러오지 못했습니다.");
  return payload.costumes ?? [];
}

export async function saveProjectCostume(
  projectId: string,
  value: {
    id?: string;
    characterName: string;
    costumeName: string;
    description: string;
    memo: string;
    sortOrder: number;
    keepImagePaths: string[];
    files: File[];
  }
): Promise<ProjectCostume> {
  const formData = new FormData();
  if (value.id) formData.set("id", value.id);
  formData.set("characterName", value.characterName);
  formData.set("costumeName", value.costumeName);
  formData.set("description", value.description);
  formData.set("memo", value.memo);
  formData.set("sortOrder", String(value.sortOrder));
  formData.set("keepImagePaths", JSON.stringify(value.keepImagePaths));
  value.files.forEach((file) => formData.append("files", file));
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

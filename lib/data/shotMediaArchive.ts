import { getShotDiagramKey } from "@/lib/data/shotDiagrams";
import type { DailyPlanTimetableSceneMeta } from "@/lib/dailyPlan/printMeta";
import { normalizeSceneNumber } from "@/lib/sceneNumber";
import { normalizeShotOverheadDiagram } from "@/lib/shotOverhead";
import {
  normalizeShotOverheadSpacePreset,
  type ShotOverheadSpacePreset
} from "@/lib/shotOverheadSpacePresets";
import {
  mergeProgressMediaWithLinkedFallbacks,
  progressMediaIdentityKey,
  safeProgressThumbnailUrl
} from "@/lib/progress/mediaGallery";
import type {
  ArchiveMediaAssetType,
  OverheadDiagramArchiveItem,
  ProjectReferenceAsset,
  Shot,
  ShotMediaLink,
  ShotMediaType,
  ShotOverheadDiagram
} from "@/lib/types";

type ApiError = { error?: string; detail?: string };

export type OverheadArchiveWorkspace = {
  archives: OverheadDiagramArchiveItem[];
  spacePresets: ShotOverheadSpacePreset[];
};

export type SaveShotOverheadSpacePresetInput = {
  sceneId: string;
  diagram: ShotOverheadDiagram;
  /** null creates; the loaded revision string performs a CAS replacement. */
  expectedUpdatedAt: string | null;
};

export type DeleteShotOverheadSpacePresetInput = {
  presetId: string;
  expectedUpdatedAt: string | null;
};

/** 진행표가 자동으로 연결해 보여주는 아카이브 이미지 한 건입니다. */
export type ProgressArchiveMediaAsset = {
  id: string;
  mediaType: ArchiveMediaAssetType;
  title: string;
  publicUrl: string;
  thumbnailUrl: string;
  dailyPlanId: string | null;
  episodeNumber: number | null;
  sceneId: string | null;
  sceneNumber: string;
  cutNumber: number;
  sortOrder: number;
  createdAt: string;
};

export type BuildProgressArchiveMediaMapInput = {
  shots: Shot[];
  assets: ProgressArchiveMediaAsset[];
  timetableScenes: DailyPlanTimetableSceneMeta[];
  dailyPlanId: string;
  episodeNumber?: number | null;
};

/** 콘티·부감도 아카이브 이미지를 한 요청으로 불러옵니다. */
export async function loadProgressArchiveMediaAssets(
  projectId: string,
  dailyPlanId?: string
): Promise<ProgressArchiveMediaAsset[]> {
  const query = new URLSearchParams({ media: "1" });
  if (dailyPlanId?.trim()) query.set("dailyPlanId", dailyPlanId.trim());
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/reference-assets?${query}`,
    { cache: "no-store" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    assets?: ProjectReferenceAsset[];
  };
  if (!response.ok) throw new Error(payload.error || "진행표용 콘티·부감도를 불러오지 못했습니다.");
  return (payload.assets ?? []).flatMap(normalizeProgressArchiveMediaAsset);
}

/**
 * 일촬표의 stable scene id를 최우선으로 사용해 컷별 아카이브 이미지를 연결합니다.
 * 예전 자료의 scene number 연결은 같은 회차 또는 같은 일촬표임이 확인될 때만 허용합니다.
 */
export function buildProgressArchiveMediaByShotId({
  shots,
  assets,
  timetableScenes,
  dailyPlanId,
  episodeNumber = null
}: BuildProgressArchiveMediaMapInput): Map<string, ProgressArchiveMediaAsset[]> {
  const sceneIdByNumber = buildUniqueSceneIdByNumber(timetableScenes);
  const stableAssets = new Map<string, ProgressArchiveMediaAsset[]>();
  const legacyAssets = new Map<string, ProgressArchiveMediaAsset[]>();
  const assetsByCategoryAndUrl = new Map<string, ProgressArchiveMediaAsset[]>();

  assets.forEach((asset) => {
    appendMedia(
      assetsByCategoryAndUrl,
      progressMediaIdentityKey(asset.mediaType, asset.publicUrl),
      asset
    );
    if (asset.sceneId && asset.cutNumber > 0) {
      appendMedia(stableAssets, mediaLookupKey(asset.sceneId, asset.cutNumber), asset);
    }

    const hasDailyPlanScope = Boolean(asset.dailyPlanId && asset.dailyPlanId === dailyPlanId);
    const hasEpisodeScope = Boolean(
      asset.episodeNumber !== null
      && episodeNumber !== null
      && asset.episodeNumber === episodeNumber
    );
    if (
      asset.cutNumber > 0
      && !asset.sceneId
      && asset.sceneNumber
      && (hasDailyPlanScope || hasEpisodeScope)
    ) {
      appendMedia(legacyAssets, mediaLookupKey(asset.sceneNumber, asset.cutNumber), asset);
    }
  });

  const result = new Map<string, ProgressArchiveMediaAsset[]>();
  shots.forEach((shot) => {
    const cutNumber = positiveInteger(shot.cutNumber);
    const sceneNumber = normalizeSceneNumber(shot.sceneNumber);
    let matchedByScene: ProgressArchiveMediaAsset[] = [];
    if (cutNumber !== null && sceneNumber) {
      const sourceSceneId = sceneIdByNumber.get(sceneNumber) ?? null;
      const stableMatch = sourceSceneId
        ? stableAssets.get(mediaLookupKey(sourceSceneId, cutNumber))
        : undefined;
      const legacyMatch = legacyAssets.get(mediaLookupKey(sceneNumber, cutNumber));
      matchedByScene = stableMatch?.length && legacyMatch?.length
        ? [...stableMatch, ...legacyMatch]
        : stableMatch?.length
          ? stableMatch
          : legacyMatch ?? [];
    }
    const explicitlyLinked = [
      ...(shot.storyboardImageUrl
        ? assetsByCategoryAndUrl.get(
            progressMediaIdentityKey("storyboard", shot.storyboardImageUrl)
          ) ?? []
        : []),
      ...(shot.overheadImageUrl
        ? assetsByCategoryAndUrl.get(
            progressMediaIdentityKey("overhead", shot.overheadImageUrl)
          ) ?? []
        : [])
    ];
    const matched = mergeProgressMediaWithLinkedFallbacks(
      matchedByScene,
      explicitlyLinked
    );
    if (matched.length) result.set(shot.id, matched);
  });
  return result;
}

/** One archive request returns both diagrams and project-level space presets. */
export async function loadOverheadArchiveWorkspace(
  projectId: string
): Promise<OverheadArchiveWorkspace> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/shot-diagrams?archive=1`,
    { cache: "no-store" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    archives?: OverheadDiagramArchiveItem[];
    spacePresets?: unknown[];
  };
  if (!response.ok) throw new Error(payload.error || "직접 만든 부감도를 불러오지 못했습니다.");
  const archives = (payload.archives ?? []).flatMap((item) => {
    const diagram = normalizeShotOverheadDiagram(item.diagram);
    return diagram ? [{
      ...item,
      sceneId: normalizeArchiveSceneId(item.sceneId),
      diagram
    }] : [];
  });
  const spacePresets = (payload.spacePresets ?? []).flatMap((item) => {
    const preset = normalizeShotOverheadSpacePreset(item);
    return preset ? [preset] : [];
  });
  return { archives, spacePresets };
}

/** Backwards-compatible archive-only wrapper. */
export async function listOverheadDiagramArchive(
  projectId: string
): Promise<OverheadDiagramArchiveItem[]> {
  return (await loadOverheadArchiveWorkspace(projectId)).archives;
}

export async function saveOverheadDiagramArchive(
  projectId: string,
  diagram: ShotOverheadDiagram,
  metadata: {
    id?: string;
    title?: string;
    memo?: string;
    sceneId?: string | null;
    sceneNo?: string;
    cutNo?: string;
  } = {}
): Promise<OverheadDiagramArchiveItem> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shot-diagrams`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "save_archive",
      archiveId: metadata.id,
      title: metadata.title,
      memo: metadata.memo,
      sceneId: metadata.sceneId,
      sceneNo: metadata.sceneNo,
      cutNo: metadata.cutNo,
      data: diagram
    })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    archive?: OverheadDiagramArchiveItem;
  };
  if (!response.ok || !payload.archive) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "부감도를 아카이브에 저장하지 못했습니다.");
  }
  return {
    ...payload.archive,
    sceneId: normalizeArchiveSceneId(payload.archive.sceneId)
  };
}

export async function saveShotOverheadSpacePreset(
  projectId: string,
  input: SaveShotOverheadSpacePresetInput
): Promise<ShotOverheadSpacePreset> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shot-diagrams`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "save_space_preset",
      sceneId: input.sceneId,
      data: input.diagram,
      expectedUpdatedAt: input.expectedUpdatedAt
    })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    spacePreset?: unknown;
  };
  const preset = normalizeShotOverheadSpacePreset(payload.spacePreset);
  if (!response.ok || !preset) {
    throw new Error(
      [payload.error, payload.detail].filter(Boolean).join(" · ")
      || "공간 프리셋을 저장하지 못했습니다."
    );
  }
  return preset;
}

export async function deleteShotOverheadSpacePreset(
  projectId: string,
  input: DeleteShotOverheadSpacePresetInput
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/shot-diagrams`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "delete_space_preset",
        presetId: input.presetId,
        expectedUpdatedAt: input.expectedUpdatedAt
      })
    }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) {
    throw new Error(payload.error || "공간 프리셋을 삭제하지 못했습니다.");
  }
}

export async function deleteOverheadDiagramArchive(projectId: string, archiveId: string) {
  return deleteOverheadDiagramArchives(projectId, [archiveId]);
}

/** 선택한 직접 제작 부감도를 한 요청으로 삭제합니다. */
export async function deleteOverheadDiagramArchives(projectId: string, archiveIds: string[]) {
  const ids = [...new Set(archiveIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return;
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/shot-diagrams`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archiveIds: ids })
    }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) throw new Error(payload.error || "부감도 자료를 삭제하지 못했습니다.");
}

export async function loadShotMediaLinks(shots: Shot[]): Promise<Map<string, ShotMediaLink[]>> {
  const result = new Map<string, ShotMediaLink[]>();
  const firstShot = shots[0];
  if (!firstShot?.dailyPlanId) return result;
  const firstKey = getShotDiagramKey(firstShot);
  const query = new URLSearchParams({
    links: "1",
    dailyPlanId: firstKey.dailyPlanId
  });
  const response = await fetch(
    `/api/projects/${encodeURIComponent(firstKey.projectId)}/shot-diagrams?${query}`,
    { cache: "no-store" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    links?: ShotMediaLink[];
  };
  if (!response.ok) throw new Error(payload.error || "컷별 자료 연결을 불러오지 못했습니다.");
  (payload.links ?? []).forEach((link) => {
    result.set(link.shotRef, [...(result.get(link.shotRef) ?? []), {
      ...link,
      diagram: normalizeShotOverheadDiagram(link.diagram)
    }]);
  });
  return result;
}

export async function saveShotMediaLink(
  shot: Shot,
  mediaType: ShotMediaType,
  selection: { assetId: string; source: "reference" | "diagram" } | null
) {
  const key = getShotDiagramKey(shot);
  const response = await fetch(`/api/projects/${encodeURIComponent(key.projectId)}/shot-diagrams`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "save_link",
      dailyPlanId: key.dailyPlanId,
      shotRef: key.shotRef,
      mediaType,
      assetId: selection?.assetId ?? "",
      source: selection?.source ?? "reference"
    })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "컷 자료 연결을 저장하지 못했습니다.");
  }
}

export function applyShotMediaLinks(
  shots: Shot[],
  linksByRef: Map<string, ShotMediaLink[]>,
  legacyDiagrams: Map<string, ShotOverheadDiagram>
) {
  return shots.map((shot) => {
    const shotLinks = linksByRef.get(getShotDiagramKey(shot).shotRef) ?? [];
    const storyboard = shotLinks.find((link) => link.mediaType === "storyboard");
    const overhead = shotLinks.find((link) => link.mediaType === "overhead");
    return {
      ...shot,
      storyboardImageUrl: storyboard?.publicUrl || shot.storyboardImageUrl || null,
      overheadImageUrl: overhead?.publicUrl || null,
      overheadDiagram: overhead?.diagram || legacyDiagrams.get(shot.id) || null
    };
  });
}

function normalizeProgressArchiveMediaAsset(
  asset: ProjectReferenceAsset
): ProgressArchiveMediaAsset[] {
  if (asset.assetType !== "storyboard" && asset.assetType !== "overhead") return [];
  if (asset.groupId?.startsWith("source:")) return [];
  const publicUrl = asset.publicUrl.trim();
  const cutNumber = positiveInteger(asset.crop.cutNumber ?? asset.cutNo);
  const sceneId = cleanText(asset.crop.sceneId);
  const sceneNumber = normalizeSceneNumber(asset.crop.sceneNumber ?? asset.sceneNo);
  if (!publicUrl) return [];

  return [{
    id: asset.id,
    mediaType: asset.assetType,
    title: cleanText(asset.crop.displayName) || cleanText(asset.crop.title) || asset.filename,
    publicUrl,
    thumbnailUrl: safeProgressThumbnailUrl(publicUrl, cleanText(asset.crop.thumbnailUrl)),
    dailyPlanId: cleanText(asset.dailyPlanId) || null,
    episodeNumber: positiveInteger(asset.crop.episodeNumber),
    sceneId,
    sceneNumber,
    cutNumber: cutNumber ?? 0,
    sortOrder: Number.isFinite(asset.sortOrder) ? asset.sortOrder : 0,
    createdAt: asset.createdAt
  }];
}

function buildUniqueSceneIdByNumber(
  timetableScenes: DailyPlanTimetableSceneMeta[]
): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  timetableScenes.forEach((scene) => {
    const sceneNumber = normalizeSceneNumber(
      scene.rowSnapshot.sceneNumber || scene.sourceSnapshot?.sceneNumber
    );
    const sourceSceneId = cleanText(scene.sourceSceneId);
    if (!sceneNumber || !sourceSceneId) return;
    const ids = candidates.get(sceneNumber) ?? new Set<string>();
    ids.add(sourceSceneId);
    candidates.set(sceneNumber, ids);
  });

  const result = new Map<string, string>();
  candidates.forEach((ids, sceneNumber) => {
    if (ids.size === 1) result.set(sceneNumber, Array.from(ids)[0]);
  });
  return result;
}

function appendMedia(
  target: Map<string, ProgressArchiveMediaAsset[]>,
  key: string,
  asset: ProgressArchiveMediaAsset
) {
  const current = target.get(key);
  if (current) current.push(asset);
  else target.set(key, [asset]);
}

function mediaLookupKey(sceneKey: string, cutNumber: number) {
  return `${sceneKey}\u0000${cutNumber}`;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArchiveSceneId(value: unknown) {
  const normalized = cleanText(value).toLocaleLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized)
    ? normalized
    : null;
}

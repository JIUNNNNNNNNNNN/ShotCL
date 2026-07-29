import { normalizeSceneNumber } from "@/lib/sceneNumber";
import type {
  ArchiveAssetLinkCandidate,
  ArchiveFilenameSuggestion,
  ArchiveMediaAssetType,
  ArchiveSceneCutMetadata,
  ProjectReferenceAsset
} from "@/lib/types";

type MetadataDefaults = {
  assetType?: unknown;
  episodeNumber?: unknown;
  sceneId?: unknown;
  sceneNumber?: unknown;
  cutNumber?: unknown;
};

export type ArchiveAssetLinkQuery = {
  episodeNumber?: number | null;
  sceneId?: string | null;
  sceneNumber?: string;
  cutNumber?: number | null;
  assetType?: ArchiveMediaAssetType | null;
};

/**
 * 파일명이 명확한 씬/컷 패턴 전체와 일치할 때만 후보를 반환합니다.
 * 반환값은 제안일 뿐이며 저장 metadata를 자동으로 변경하지 않습니다.
 */
export function parseArchiveFilenameSuggestion(value: string): ArchiveFilenameSuggestion | null {
  const filename = value.trim().replace(/\.[^.]+$/, "").trim();
  if (!filename) return null;
  const patterns = [
    /^sc(?:ene)?\s*#?\s*([0-9]+[a-z]?)\s*[-_]\s*cut\s*#?\s*([0-9]+)$/i,
    /^s(?:cene)?\s*#?\s*([0-9]+[a-z]?)\s*[-_]\s*c(?:ut)?\s*#?\s*([0-9]+)$/i,
    /^([0-9]+[a-z]?)\s*[-_]\s*([0-9]+)$/i
  ];
  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (!match) continue;
    const sceneNumber = normalizeSceneNumber(match[1]) || cleanText(match[1], 100);
    const cutNumber = positiveInteger(match[2]);
    if (sceneNumber && cutNumber) return { sceneNumber, cutNumber };
  }
  return null;
}

/** JSON metadata를 일관된 씬/컷 구조와 derived link key로 정규화합니다. */
export function normalizeSceneCutMetadata(
  value: unknown,
  defaults: MetadataDefaults = {}
): ArchiveSceneCutMetadata {
  const source = objectValue(value);
  const episodeNumber = nullablePositiveInteger(
    ownValue(source, ["episodeNumber"], defaults.episodeNumber)
  );
  const sceneId = cleanText(ownValue(source, ["sceneId"], defaults.sceneId), 100) || null;
  const rawSceneNumber = ownValue(
    source,
    ["sceneNumber", "sceneNo"],
    defaults.sceneNumber
  );
  const sceneNumber = normalizeSceneNumber(
    rawSceneNumber
  ) || cleanText(rawSceneNumber, 100);
  const cutNumber = nullablePositiveInteger(
    ownValue(source, ["cutNumber", "cutNo"], defaults.cutNumber)
  );
  const assetType = normalizeArchiveAssetType(
    ownValue(source, ["assetType"], defaults.assetType)
  );
  return {
    episodeNumber,
    sceneId,
    sceneNumber,
    cutNumber,
    assetType,
    normalizedLinkKey: createArchiveNormalizedLinkKey({
      episodeNumber,
      sceneId,
      sceneNumber,
      cutNumber,
      assetType
    })
  };
}

/**
 * 명시 metadata를 우선하고 파일명 분석은 마지막 fallback 후보로만 반환합니다.
 * asset id는 언제나 DB의 stable UUID를 사용합니다.
 */
export function getArchiveAssetLinkCandidate(
  asset: ProjectReferenceAsset
): ArchiveAssetLinkCandidate | null {
  const explicit = normalizeSceneCutMetadata(asset.crop, {
    assetType: asset.assetType,
    sceneNumber: asset.sceneNo,
    cutNumber: asset.cutNo
  });
  if (explicit.sceneId) {
    return { assetId: asset.id, source: "explicit_scene_id", ...explicit };
  }
  if (explicit.sceneNumber) {
    return { assetId: asset.id, source: "explicit_scene_number", ...explicit };
  }
  const suggestion = [
    asset.crop.displayName,
    asset.crop.title,
    asset.crop.originalFilename,
    asset.filename
  ].flatMap((value) => {
    const parsed = value ? parseArchiveFilenameSuggestion(value) : null;
    return parsed ? [parsed] : [];
  })[0] ?? null;
  if (!suggestion) return null;
  const suggested = normalizeSceneCutMetadata({
    ...explicit,
    sceneNumber: suggestion.sceneNumber,
    cutNumber: suggestion.cutNumber
  }, { assetType: asset.assetType });
  return { assetId: asset.id, source: "filename_suggestion", ...suggested };
}

/**
 * 한 씬·컷에 여러 자료가 있을 수 있으므로 모든 후보를 우선순위 순으로 반환합니다.
 * filename 후보는 explicit metadata가 없는 asset에만 사용됩니다.
 */
export function findAssetsForSceneCut(
  assets: ProjectReferenceAsset[],
  query: ArchiveAssetLinkQuery
): ArchiveAssetLinkCandidate[] {
  const normalizedQuery = normalizeSceneCutMetadata(query);
  const priorities: Record<ArchiveAssetLinkCandidate["source"], number> = {
    explicit_scene_id: 0,
    explicit_scene_number: 1,
    filename_suggestion: 2
  };
  return assets
    .flatMap((asset) => {
      const candidate = getArchiveAssetLinkCandidate(asset);
      return candidate && matchesLinkQuery(candidate, normalizedQuery) ? [candidate] : [];
    })
    .sort((left, right) => priorities[left.source] - priorities[right.source]);
}

export function createArchiveNormalizedLinkKey(
  value: Omit<ArchiveSceneCutMetadata, "normalizedLinkKey">
) {
  const scenePart = value.sceneId
    ? `scene-id:${encodeURIComponent(value.sceneId)}`
    : `scene:${encodeURIComponent(value.sceneNumber || "unassigned")}`;
  return [
    `episode:${value.episodeNumber ?? "unassigned"}`,
    scenePart,
    `cut:${value.cutNumber ?? "unassigned"}`,
    `type:${value.assetType ?? "unassigned"}`
  ].join(":");
}

function matchesLinkQuery(
  candidate: ArchiveAssetLinkCandidate,
  query: ArchiveSceneCutMetadata
) {
  if (query.assetType && candidate.assetType !== query.assetType) return false;
  if (query.episodeNumber && candidate.episodeNumber !== query.episodeNumber) return false;
  if (query.cutNumber && candidate.cutNumber !== query.cutNumber) return false;
  if (query.sceneId) return candidate.sceneId === query.sceneId;
  if (query.sceneNumber) return candidate.sceneNumber === query.sceneNumber;
  return false;
}

function normalizeArchiveAssetType(value: unknown): ArchiveMediaAssetType | null {
  return value === "overhead" || value === "storyboard" ? value : null;
}

function nullablePositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return positiveInteger(value) || null;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function ownValue(
  source: Record<string, unknown>,
  keys: string[],
  fallback: unknown
) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  return fallback;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

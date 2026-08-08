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

type FilenamePattern = {
  pattern: ArchiveFilenameSuggestion["pattern"];
  expression: RegExp;
};

const BASENAME_SCENE_CUT_PATTERNS: FilenamePattern[] = [
  {
    pattern: "scene_cut",
    expression: /(?:^|[^a-z0-9])scene[\s._-]*#?[\s._-]*([0-9]+[a-z]?)[\s._-]*cut[\s._-]*#?[\s._-]*([0-9]+)/i
  },
  {
    pattern: "korean_scene_cut",
    expression: /씬[\s._-]*#?[\s._-]*([0-9]+[a-z]?)[\s._-]*컷[\s._-]*#?[\s._-]*([0-9]+)/i
  },
  {
    pattern: "s_c",
    expression: /(?:^|[^a-z0-9])s[\s._-]*#?[\s._-]*([0-9]+[a-z]?)[\s._-]*c(?:ut)?[\s._-]*#?[\s._-]*([0-9]+)/i
  }
];

const PARENTHESIZED_SCENE_CUT_PATTERN: FilenamePattern = {
  pattern: "s_parenthesized_cut",
  expression: /(?:^|[^a-z0-9])s[\s._-]*#?[\s._-]*([0-9]+[a-z]?)[\s._-]*\(\s*([0-9]+)\s*\)/i
};

/**
 * 파일 basename을 먼저, 폴더 업로드의 인접 relative-path segment를 그다음 분석합니다.
 * Scene/Cut token이 모두 명확한 경우만 반환하며 DB mutation은 수행하지 않습니다.
 */
export function parseSceneCutFromAssetName(
  value: string,
  relativePath = ""
): ArchiveFilenameSuggestion | null {
  const normalizedValue = normalizeFilenameText(value);
  const valueSegments = splitArchivePath(normalizedValue);
  const basename = stripArchiveExtension(valueSegments.at(-1) ?? normalizedValue);
  const basenameMatch = matchSceneCutBasename(basename);
  if (basenameMatch) return basenameMatch;

  const normalizedRelativePath = normalizeFilenameText(relativePath || normalizedValue);
  const pathSegments = splitArchivePath(normalizedRelativePath);
  if (pathSegments.length > 0) {
    pathSegments[pathSegments.length - 1] = stripArchiveExtension(pathSegments.at(-1) ?? "");
  }
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const sceneNumber = matchScenePathSegment(pathSegments[index]);
    const cutNumber = matchCutPathSegment(pathSegments[index + 1]);
    if (!sceneNumber || !cutNumber) continue;
    return {
      sceneNumber,
      cutNumber,
      matched: true,
      pattern: "relative_path",
      source: "relative_path"
    };
  }
  return matchSceneCutBasename(basename, [PARENTHESIZED_SCENE_CUT_PATTERN]);
}

/** 기존 filename suggestion 호출부를 위한 호환 wrapper입니다. */
export function parseArchiveFilenameSuggestion(value: string): ArchiveFilenameSuggestion | null {
  return parseSceneCutFromAssetName(value);
}

function matchSceneCutBasename(
  value: string,
  patterns: FilenamePattern[] = BASENAME_SCENE_CUT_PATTERNS
): ArchiveFilenameSuggestion | null {
  if (!value) return null;
  for (const candidate of patterns) {
    const match = value.match(candidate.expression);
    if (!match) continue;
    const sceneNumber = canonicalFilenameSceneNumber(match[1]);
    const cutNumber = positiveInteger(match[2]);
    if (!sceneNumber || !cutNumber) continue;
    return {
      sceneNumber,
      cutNumber,
      matched: true,
      pattern: candidate.pattern,
      source: "basename"
    };
  }
  return null;
}

function matchScenePathSegment(value: string) {
  const match = value.match(/^(?:s(?:cene)?|scene|씬)[\s._-]*#?[\s._-]*([0-9]+[a-z]?)$/i);
  if (!match) return "";
  return canonicalFilenameSceneNumber(match[1]);
}

function matchCutPathSegment(value: string) {
  const match = value.match(/^(?:c(?:ut)?|cut|컷)[\s._-]*#?[\s._-]*([0-9]+)$/i);
  return match ? positiveInteger(match[1]) : 0;
}

function normalizeFilenameText(value: string) {
  return String(value ?? "").normalize("NFKC").trim();
}

function splitArchivePath(value: string) {
  return value.split(/[\\/]+/).map((segment) => segment.trim()).filter(Boolean);
}

function stripArchiveExtension(value: string) {
  return value.replace(/\.(?:pdf|jpe?g|png|webp)$/i, "").trim();
}

function canonicalFilenameSceneNumber(value: unknown) {
  const normalized = normalizeSceneNumber(value);
  if (normalized) return normalized;
  const token = cleanText(value, 100);
  const match = token.match(/^0*([0-9]+)([a-z]?)$/i);
  if (!match) return token;
  const digits = match[1].replace(/^0+(?=\d)/, "");
  return `${digits}${match[2].toUpperCase()}`;
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
  const relativePathSuggestion = suggestion ?? parseSceneCutFromAssetName(
    asset.crop.originalFilename || asset.filename,
    asset.crop.relativePath || ""
  );
  if (!relativePathSuggestion) return null;
  const suggested = normalizeSceneCutMetadata({
    ...explicit,
    sceneNumber: relativePathSuggestion.sceneNumber,
    cutNumber: relativePathSuggestion.cutNumber
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

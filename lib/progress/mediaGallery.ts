export type ProgressMediaCategory = "storyboard" | "overhead";

export type ProgressMediaGallerySource = {
  id: string;
  mediaType: ProgressMediaCategory;
  title: string;
  publicUrl: string;
  thumbnailUrl: string;
  sortOrder?: number;
  createdAt?: string;
};

export type ProgressMediaGalleryItem = {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
};

export function progressMediaIdentityKey(
  mediaType: ProgressMediaCategory,
  publicUrl: string
) {
  return `${mediaType}\u0000${publicUrl}`;
}

/** 목록에서는 원본 URL을 thumbnail 대용으로 사용하지 않습니다. */
export function safeProgressThumbnailUrl(publicUrl: string, thumbnailUrl: string) {
  const normalizedPublicUrl = publicUrl.trim();
  const normalizedThumbnailUrl = thumbnailUrl.trim();
  return normalizedThumbnailUrl && normalizedThumbnailUrl !== normalizedPublicUrl
    ? normalizedThumbnailUrl
    : "";
}

/** 서버가 반환한 아카이브 순서를 바꾸지 않고 한 종류의 자료만 고릅니다. */
export function buildProgressMediaGalleryItems(
  assets: readonly ProgressMediaGallerySource[],
  category: ProgressMediaCategory,
  fallback?: ProgressMediaGalleryItem | null
): ProgressMediaGalleryItem[] {
  const canonicalItems = assets
    .filter((asset) => asset.mediaType === category)
    .map((asset) => ({
      id: asset.id,
      title: asset.title,
      url: asset.publicUrl,
      thumbnailUrl: asset.thumbnailUrl
    }));

  if (!fallback || canonicalItems.some((item) => item.url === fallback.url)) {
    return canonicalItems;
  }
  return [...canonicalItems, fallback];
}

/** 아카이브 grid와 같은 sortOrder → 생성시각 → id 순서를 사용합니다. */
export function orderProgressMediaAsArchive<T extends {
  id: string;
  sortOrder: number;
  createdAt: string;
}>(assets: readonly T[]): T[] {
  return [...assets].sort((left, right) => {
    const sortOrder = positiveSortOrder(left.sortOrder) - positiveSortOrder(right.sortOrder);
    if (sortOrder !== 0) return sortOrder;
    const createdOrder = safeTimestamp(left.createdAt) - safeTimestamp(right.createdAt);
    if (createdOrder !== 0) return createdOrder;
    return left.id.localeCompare(right.id);
  });
}

/** 현재 컷의 canonical 순서를 유지하고 명시 연결 fallback만 종류·URL 기준으로 뒤에 보탭니다. */
export function mergeProgressMediaWithLinkedFallbacks<T extends {
  id: string;
  mediaType: ProgressMediaCategory;
  publicUrl: string;
  thumbnailUrl: string;
  sortOrder: number;
  createdAt: string;
}>(canonical: readonly T[], linked: readonly T[]): T[] {
  const orderedLinked = orderProgressMediaAsArchive(linked);
  const preferredThumbnails = new Map<string, string>();
  [...orderProgressMediaAsArchive(canonical), ...orderedLinked].forEach((asset) => {
    const key = progressMediaIdentityKey(asset.mediaType, asset.publicUrl);
    const thumbnailUrl = safeProgressThumbnailUrl(asset.publicUrl, asset.thumbnailUrl);
    if (thumbnailUrl && !preferredThumbnails.has(key)) {
      preferredThumbnails.set(key, thumbnailUrl);
    }
  });
  const seen = new Set<string>();
  const orderedCanonical = orderProgressMediaAsArchive(canonical).filter((asset) => {
    const key = progressMediaIdentityKey(asset.mediaType, asset.publicUrl);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((asset) => withPreferredThumbnail(asset, preferredThumbnails));
  const linkedFallbacks = orderedLinked.filter((asset) => {
    const key = progressMediaIdentityKey(asset.mediaType, asset.publicUrl);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((asset) => withPreferredThumbnail(asset, preferredThumbnails));
  return [...orderedCanonical, ...linkedFallbacks];
}

export function clampGalleryIndex(index: number, length: number) {
  if (length <= 0) return 0;
  const safeIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(Math.max(safeIndex, 0), length - 1);
}

export function moveGalleryIndex(
  index: number,
  step: -1 | 1,
  length: number,
  loop = false
) {
  if (length <= 1) return 0;
  const safeIndex = clampGalleryIndex(index, length);
  if (loop) return (safeIndex + step + length) % length;
  return clampGalleryIndex(safeIndex + step, length);
}

/** 현재 원본 외에는 인접한 앞·뒤 원본만 선택적으로 미리 불러옵니다. */
export function getGalleryNeighborIndexes(index: number, length: number, loop = false) {
  if (length <= 1) return [];
  const safeIndex = clampGalleryIndex(index, length);
  return [...new Set([
    moveGalleryIndex(safeIndex, -1, length, loop),
    moveGalleryIndex(safeIndex, 1, length, loop)
  ])].filter((neighborIndex) => neighborIndex !== safeIndex);
}

function positiveSortOrder(value: unknown) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function safeTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function withPreferredThumbnail<T extends {
  mediaType: ProgressMediaCategory;
  publicUrl: string;
  thumbnailUrl: string;
}>(asset: T, preferredThumbnails: ReadonlyMap<string, string>): T {
  const key = progressMediaIdentityKey(asset.mediaType, asset.publicUrl);
  const thumbnailUrl = safeProgressThumbnailUrl(asset.publicUrl, asset.thumbnailUrl)
    || preferredThumbnails.get(key)
    || "";
  return thumbnailUrl === asset.thumbnailUrl ? asset : { ...asset, thumbnailUrl };
}

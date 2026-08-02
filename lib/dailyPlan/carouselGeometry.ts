export type DailyPlanCarouselMetrics = {
  viewportWidth: number;
  cardWidth: number;
  cardGap: number;
  cardStep: number;
  safePadding: number;
  sideScale: number;
  maxVisibleSlot: number;
};

export type DailyPlanCarouselVisualTransform = {
  translateX: number;
  translateZ: number;
  rotationY: number;
  scale: number;
  opacity: number;
  zIndex: number;
  visible: boolean;
  interactive: boolean;
};

export type DailyPlanCarouselSnap = {
  index: number;
  target: number;
};

/**
 * 중앙의 0번 슬롯은 실제 item이 아닌 고정 선택 기준점입니다.
 * logical item은 stable 순서대로 -1, +1, -2, +2 ... 에 배치합니다.
 */
export function getBalancedCarouselSlot(logicalIndex: number) {
  const safeIndex = Math.max(0, Math.trunc(logicalIndex));
  const magnitude = Math.floor(safeIndex / 2) + 1;
  return safeIndex % 2 === 0 ? -magnitude : magnitude;
}

/** 실제 item 수보다 한 칸 큰 순환 공간을 사용해 중앙 0번 슬롯을 비워 둡니다. */
export function getCarouselCycleSize(itemCount: number) {
  return Math.max(1, Math.trunc(itemCount) + 1);
}

export function getCarouselItemDistance(logicalIndex: number, position: number, itemCount: number) {
  if (itemCount <= 0 || !Number.isFinite(position)) return 0;
  const slot = getBalancedCarouselSlot(logicalIndex);
  return wrapCarouselDistance(slot - position, getCarouselCycleSize(itemCount));
}

export function getNearestCarouselItemTarget(logicalIndex: number, position: number, itemCount: number) {
  if (itemCount <= 0 || !Number.isFinite(position)) return null;
  return position + getCarouselItemDistance(logicalIndex, position, itemCount);
}

/** 현재 연속 위치에서 가장 가까운 실제 item 슬롯을 찾습니다. 빈 중앙 슬롯은 반환하지 않습니다. */
export function getNearestCarouselSnap(position: number, itemCount: number): DailyPlanCarouselSnap | null {
  if (itemCount <= 0 || !Number.isFinite(position)) return null;
  let nearest: DailyPlanCarouselSnap | null = null;
  let nearestDelta = Number.POSITIVE_INFINITY;

  for (let index = 0; index < itemCount; index += 1) {
    const target = getNearestCarouselItemTarget(index, position, itemCount);
    if (target === null) continue;
    const delta = Math.abs(target - position);
    if (delta < nearestDelta - 0.0001) {
      nearest = { index, target };
      nearestDelta = delta;
    }
  }

  return nearest;
}

/** 방향키 이동도 빈 중앙 슬롯을 건너뛰고 다음 실제 item으로 향합니다. */
export function getDirectionalCarouselTarget(
  position: number,
  itemCount: number,
  direction: -1 | 1
) {
  if (itemCount <= 0 || !Number.isFinite(position)) return null;
  const cycleSize = getCarouselCycleSize(itemCount);
  let bestTarget: number | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let index = 0; index < itemCount; index += 1) {
    const nearestTarget = getNearestCarouselItemTarget(index, position, itemCount);
    if (nearestTarget === null) continue;
    let delta = nearestTarget - position;
    if (direction > 0 && delta <= 0.0001) delta += cycleSize;
    if (direction < 0 && delta >= -0.0001) delta -= cycleSize;
    const magnitude = Math.abs(delta);
    if (magnitude < bestDelta - 0.0001) {
      bestDelta = magnitude;
      bestTarget = position + delta;
    }
  }

  return bestTarget;
}

/** 큰 관성 회전 뒤에도 같은 visual cycle 안으로 위치값만 정리합니다. */
export function normalizeCarouselPosition(position: number, itemCount: number) {
  if (itemCount <= 0 || !Number.isFinite(position)) return 0;
  return wrapCarouselDistance(position, getCarouselCycleSize(itemCount));
}

/**
 * 실제 캐러셀 viewport 폭과 scale을 함께 사용합니다.
 * 좁은 화면은 ±1만 완전히 노출하고, 충분한 데스크탑 폭에서 ±2까지 노출합니다.
 */
export function getDailyPlanCarouselMetrics(rawViewportWidth: number): DailyPlanCarouselMetrics {
  const viewportWidth = Number.isFinite(rawViewportWidth) && rawViewportWidth > 0
    ? rawViewportWidth
    : 1;
  const cardWidth = clamp(viewportWidth * 0.34, 124, 168);
  const safePadding = clamp(viewportWidth * 0.04, 12, 40);
  const selectionWidth = cardWidth + 8;
  const centerGap = clamp(viewportWidth * 0.02, 6, 18);
  const desiredSideScale = clamp(viewportWidth / 520, 0.46, 0.91);
  const maxSideScaleWithoutOverlap = (
    viewportWidth / 2 - safePadding - selectionWidth / 2 - centerGap
  ) / cardWidth;
  const sideScale = clamp(Math.min(desiredSideScale, maxSideScaleWithoutOverlap), 0.42, 0.91);
  const sideVisualWidth = cardWidth * sideScale;
  const naturalGap = clamp(viewportWidth * 0.055, 16, 52);
  const minimumClearStep = selectionWidth / 2 + sideVisualWidth / 2 + centerGap;
  const idealStep = Math.max(sideVisualWidth + naturalGap, minimumClearStep);
  const maxSideOffset = Math.max(
    1,
    viewportWidth / 2 - safePadding - sideVisualWidth / 2
  );
  const slotsThatFit = Math.max(1, Math.floor(maxSideOffset / minimumClearStep));
  const maxVisibleSlot = Math.min(2, slotsThatFit);
  const cardStep = Math.max(1, Math.min(idealStep, maxSideOffset / maxVisibleSlot));

  return {
    viewportWidth,
    cardWidth,
    cardGap: Math.max(0, cardStep - sideVisualWidth),
    cardStep,
    safePadding,
    sideScale,
    maxVisibleSlot
  };
}

/** initial/copy/delete/drag/snap/resize가 모두 공유하는 유일한 slot-to-transform 공식입니다. */
export function getDailyPlanCarouselVisualTransform(
  distance: number,
  metrics: DailyPlanCarouselMetrics,
  reduceMotion: boolean
): DailyPlanCarouselVisualTransform {
  const safeDistance = Number.isFinite(distance) ? distance : 0;
  const absoluteDistance = Math.abs(safeDistance);
  const interactive = absoluteDistance <= metrics.maxVisibleSlot + 0.001;
  const previewRange = 0.6;
  const previewOpacity = interactive
    ? 1
    : clamp((metrics.maxVisibleSlot + previewRange - absoluteDistance) / previewRange, 0, 1);
  const visible = previewOpacity > 0.01;
  const minimumOuterScale = Math.max(0.36, metrics.sideScale - 0.22);
  const scale = absoluteDistance <= 1
    ? 1 - (1 - metrics.sideScale) * absoluteDistance
    : Math.max(minimumOuterScale, metrics.sideScale - (absoluteDistance - 1) * 0.1);

  return {
    translateX: safeDistance * metrics.cardStep,
    translateZ: -Math.min(260, absoluteDistance * 82),
    rotationY: reduceMotion ? 0 : -Math.sign(safeDistance) * Math.min(22, absoluteDistance * 14),
    scale,
    opacity: visible ? Math.max(0.22, 1 - absoluteDistance * 0.14) * previewOpacity : 0,
    zIndex: Math.max(1, 100 - Math.round(absoluteDistance * 20)),
    visible,
    interactive
  };
}

function wrapCarouselDistance(value: number, cycleSize: number) {
  if (cycleSize <= 0 || !Number.isFinite(value)) return 0;
  let result = value;
  const half = cycleSize / 2;
  while (result > half) result -= cycleSize;
  while (result < -half) result += cycleSize;
  return result;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

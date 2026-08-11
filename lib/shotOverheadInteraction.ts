import type {
  ShotOverheadDiagram,
  ShotOverheadMovementPath,
  ShotOverheadPoint
} from "@/lib/types";

export const DIRECT_DRAG_FINE_TOLERANCE_PX = 6;
export const DIRECT_DRAG_COARSE_TOLERANCE_PX = 8;
export const TOUCH_CONTEXT_MENU_HOLD_MS = 520;
export const MOVEMENT_CREATION_MIN_DISTANCE_PX = 12;
export const SHOT_OVERHEAD_FINE_VISIBLE_HANDLE_DIAMETER_PX = 10;
export const SHOT_OVERHEAD_COARSE_VISIBLE_HANDLE_DIAMETER_PX = 12;
export const SHOT_OVERHEAD_FINE_HANDLE_HIT_DIAMETER_PX = 28;
export const SHOT_OVERHEAD_COARSE_HANDLE_HIT_DIAMETER_PX = 44;
export const SHOT_OVERHEAD_FINE_PATH_HIT_WIDTH_PX = 28;
export const SHOT_OVERHEAD_COARSE_PATH_HIT_WIDTH_PX = 44;
export const SHOT_OVERHEAD_FINE_FOV_HIT_WIDTH_PX = 16;
export const SHOT_OVERHEAD_COARSE_FOV_HIT_WIDTH_PX = 28;
export const SHOT_OVERHEAD_FINE_ROOM_STROKE_HIT_WIDTH_PX = 16;
export const SHOT_OVERHEAD_COARSE_ROOM_STROKE_HIT_WIDTH_PX = 28;

export type ShotOverheadViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ShotOverheadViewportTransform = {
  rect: ShotOverheadViewportRect;
  canvas: { width: number; height: number };
  pan?: ShotOverheadPoint;
};

export type ShotOverheadPointGrab = {
  pointAtStart: ShotOverheadPoint;
  pointerAtStart: ShotOverheadPoint;
};

export type ShotOverheadHandleCandidate<T> = {
  value: T;
  stableId: string;
  center: ShotOverheadPoint;
  hitRadiusPx: number;
  hovered?: boolean;
  priority?: number;
};

export type ShotOverheadStrokeCandidate<T> = {
  value: T;
  stableId: string;
  start: ShotOverheadPoint;
  end: ShotOverheadPoint;
  hitWidthPx: number;
  priority?: number;
};

export type ShotOverheadInteractionTargetMetrics = {
  visibleHandleDiameterPx: number;
  handleHitDiameterPx: number;
  pathHitWidthPx: number;
  fovHitWidthPx: number;
  roomStrokeHitWidthPx: number;
};

export type ShotOverheadPointTarget = {
  target: "line-start" | "line-end" | "shape-point" | "path-point";
  id: string;
  index?: number;
};

export type ShotOverheadRotatableTarget = {
  kind: "person" | "camera" | "shape";
  id: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizedAngleDelta(value: number) {
  return ((value + 540) % 360) - 180;
}

function pointerAngle(point: ShotOverheadPoint, pivot: ShotOverheadPoint) {
  return Math.atan2(point.y - pivot.y, point.x - pivot.x) * (180 / Math.PI);
}

function distanceToSegment(
  point: ShotOverheadPoint,
  start: ShotOverheadPoint,
  end: ShotOverheadPoint
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.001) return Math.hypot(point.x - start.x, point.y - start.y);
  const progress = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1
  );
  return Math.hypot(
    point.x - (start.x + dx * progress),
    point.y - (start.y + dy * progress)
  );
}

/**
 * Mirror SVG's `preserveAspectRatio="xMidYMid meet"` layout for the rare
 * fallback where getScreenCTM is unavailable. The returned scale is CSS
 * screen pixels per diagram world unit and deliberately does not use DPR.
 */
function getShotOverheadMeetViewport(transform: ShotOverheadViewportTransform) {
  const { rect, canvas } = transform;
  const safeCanvasWidth = Math.max(0.01, canvas.width);
  const safeCanvasHeight = Math.max(0.01, canvas.height);
  const safeRectWidth = Math.max(0.01, rect.width);
  const safeRectHeight = Math.max(0.01, rect.height);
  const scale = Math.max(
    0.0001,
    Math.min(safeRectWidth / safeCanvasWidth, safeRectHeight / safeCanvasHeight)
  );
  const renderedWidth = safeCanvasWidth * scale;
  const renderedHeight = safeCanvasHeight * scale;
  return {
    scale,
    originX: rect.left + (safeRectWidth - renderedWidth) / 2,
    originY: rect.top + (safeRectHeight - renderedHeight) / 2
  };
}

/** Convert a viewport client point to diagram world coordinates. */
export function clientPointToShotOverheadWorld(
  client: ShotOverheadPoint,
  transform: ShotOverheadViewportTransform,
  clampToCanvas = false
): ShotOverheadPoint {
  const viewport = getShotOverheadMeetViewport(transform);
  const pan = transform.pan ?? { x: 0, y: 0 };
  const point = {
    x: (client.x - viewport.originX) / viewport.scale - pan.x,
    y: (client.y - viewport.originY) / viewport.scale - pan.y
  };
  if (!clampToCanvas) return point;
  return {
    x: clamp(point.x, 0, transform.canvas.width),
    y: clamp(point.y, 0, transform.canvas.height)
  };
}

/** Convert a diagram world point to its CSS viewport position. */
export function shotOverheadWorldPointToClient(
  point: ShotOverheadPoint,
  transform: ShotOverheadViewportTransform
): ShotOverheadPoint {
  const viewport = getShotOverheadMeetViewport(transform);
  const pan = transform.pan ?? { x: 0, y: 0 };
  return {
    x: viewport.originX + (point.x + pan.x) * viewport.scale,
    y: viewport.originY + (point.y + pan.y) * viewport.scale
  };
}

/** Convert a client-space drag delta to a world delta using the same meet scale. */
export function screenDeltaToShotOverheadWorld(
  delta: ShotOverheadPoint,
  transform: Pick<ShotOverheadViewportTransform, "rect" | "canvas">
): ShotOverheadPoint {
  const viewport = getShotOverheadMeetViewport(transform);
  return {
    x: delta.x / viewport.scale,
    y: delta.y / viewport.scale
  };
}

/** Capture a point drag without snapping an edge hit to the pointer on move one. */
export function createShotOverheadPointGrab(
  point: ShotOverheadPoint,
  pointerWorld: ShotOverheadPoint
): ShotOverheadPointGrab {
  return {
    pointAtStart: { x: point.x, y: point.y },
    pointerAtStart: { x: pointerWorld.x, y: pointerWorld.y }
  };
}

/** Apply the pointer delta to the original point, optionally clamped to the board. */
export function applyShotOverheadPointGrab(
  grab: ShotOverheadPointGrab,
  pointerWorld: ShotOverheadPoint,
  canvas?: { width: number; height: number }
): ShotOverheadPoint {
  const point = {
    x: grab.pointAtStart.x + pointerWorld.x - grab.pointerAtStart.x,
    y: grab.pointAtStart.y + pointerWorld.y - grab.pointerAtStart.y
  };
  if (!canvas) return point;
  return {
    x: clamp(point.x, 0, canvas.width),
    y: clamp(point.y, 0, canvas.height)
  };
}

/** Apply one selected geometry handle without mutating unrelated diagram data. */
export function applyShotOverheadPointTarget(
  diagram: ShotOverheadDiagram,
  target: ShotOverheadPointTarget,
  point: ShotOverheadPoint
): ShotOverheadDiagram {
  if (target.target === "line-start") return {
    ...diagram,
    lines: diagram.lines.map((item) => item.id === target.id
      ? { ...item, x1: point.x, y1: point.y }
      : item)
  };
  if (target.target === "line-end") return {
    ...diagram,
    lines: diagram.lines.map((item) => item.id === target.id
      ? { ...item, x2: point.x, y2: point.y }
      : item)
  };
  if (target.target === "shape-point") return {
    ...diagram,
    shapes: diagram.shapes.map((item) => (
      item.id === target.id && item.type === "polyline"
        ? {
            ...item,
            points: item.points.map((existing, index) => (
              index === target.index ? { ...point } : existing
            ))
          }
        : item
    ))
  };
  return {
    ...diagram,
    movementPaths: diagram.movementPaths.map((item) => item.id === target.id
      ? {
          ...item,
          points: item.points.map((existing, index) => (
            index === target.index ? { ...point } : existing
          ))
        }
      : item)
  };
}

/** Apply a rotation and keep a camera's PAN origin attached to its current icon. */
export function applyShotOverheadRotation(
  diagram: ShotOverheadDiagram,
  target: ShotOverheadRotatableTarget,
  rotation: number
): ShotOverheadDiagram {
  const normalized = ((rotation % 360) + 360) % 360;
  if (target.kind === "person") return {
    ...diagram,
    people: diagram.people.map((item) => item.id === target.id
      ? { ...item, rotation: normalized }
      : item)
  };
  if (target.kind === "camera") return {
    ...diagram,
    cameras: diagram.cameras.map((item) => item.id === target.id
      ? { ...item, rotation: normalized }
      : item),
    cameraPans: diagram.cameraPans.map((item) => item.cameraId === target.id
      ? { ...item, startRotation: normalized }
      : item)
  };
  return {
    ...diagram,
    shapes: diagram.shapes.map((item) => (
      item.id === target.id && item.type === "rect"
        ? { ...item, rotation: normalized }
        : item
    ))
  };
}

export function getShotOverheadInteractionTargetMetrics(
  pointerType: string
): ShotOverheadInteractionTargetMetrics {
  const coarse = pointerType !== "mouse";
  return coarse
    ? {
        visibleHandleDiameterPx: SHOT_OVERHEAD_COARSE_VISIBLE_HANDLE_DIAMETER_PX,
        handleHitDiameterPx: SHOT_OVERHEAD_COARSE_HANDLE_HIT_DIAMETER_PX,
        pathHitWidthPx: SHOT_OVERHEAD_COARSE_PATH_HIT_WIDTH_PX,
        fovHitWidthPx: SHOT_OVERHEAD_COARSE_FOV_HIT_WIDTH_PX,
        roomStrokeHitWidthPx: SHOT_OVERHEAD_COARSE_ROOM_STROKE_HIT_WIDTH_PX
      }
    : {
        visibleHandleDiameterPx: SHOT_OVERHEAD_FINE_VISIBLE_HANDLE_DIAMETER_PX,
        handleHitDiameterPx: SHOT_OVERHEAD_FINE_HANDLE_HIT_DIAMETER_PX,
        pathHitWidthPx: SHOT_OVERHEAD_FINE_PATH_HIT_WIDTH_PX,
        fovHitWidthPx: SHOT_OVERHEAD_FINE_FOV_HIT_WIDTH_PX,
        roomStrokeHitWidthPx: SHOT_OVERHEAD_FINE_ROOM_STROKE_HIT_WIDTH_PX
      };
}

/**
 * Resolve overlapping screen-space handles deterministically. Distance wins,
 * then an already-hovered handle, semantic priority, and finally stableId.
 */
export function resolveNearestShotOverheadHandle<T>(
  pointerClient: ShotOverheadPoint,
  candidates: readonly ShotOverheadHandleCandidate<T>[]
): ShotOverheadHandleCandidate<T> | null {
  const eligible = candidates
    .map((candidate) => ({
      candidate,
      distance: Math.hypot(
        pointerClient.x - candidate.center.x,
        pointerClient.y - candidate.center.y
      )
    }))
    .filter(({ candidate, distance }) => (
      Number.isFinite(distance)
      && Number.isFinite(candidate.hitRadiusPx)
      && candidate.hitRadiusPx >= 0
      && distance <= candidate.hitRadiusPx
    ));

  eligible.sort((left, right) => {
    const distanceDelta = left.distance - right.distance;
    if (Math.abs(distanceDelta) > 0.001) return distanceDelta;
    if (Boolean(left.candidate.hovered) !== Boolean(right.candidate.hovered)) {
      return left.candidate.hovered ? -1 : 1;
    }
    const priorityDelta = (right.candidate.priority ?? 0) - (left.candidate.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return left.candidate.stableId < right.candidate.stableId
      ? -1
      : left.candidate.stableId > right.candidate.stableId
        ? 1
        : 0;
  });

  return eligible[0]?.candidate ?? null;
}

/** Resolve a thin visual stroke through a larger screen-space interaction width. */
export function resolveNearestShotOverheadStroke<T>(
  pointerClient: ShotOverheadPoint,
  candidates: readonly ShotOverheadStrokeCandidate<T>[]
): ShotOverheadStrokeCandidate<T> | null {
  const eligible = candidates
    .map((candidate) => ({
      candidate,
      distance: distanceToSegment(pointerClient, candidate.start, candidate.end)
    }))
    .filter(({ candidate, distance }) => (
      Number.isFinite(distance)
      && Number.isFinite(candidate.hitWidthPx)
      && candidate.hitWidthPx >= 0
      && distance <= candidate.hitWidthPx / 2
    ));

  eligible.sort((left, right) => {
    const distanceDelta = left.distance - right.distance;
    if (Math.abs(distanceDelta) > 0.001) return distanceDelta;
    const priorityDelta = (right.candidate.priority ?? 0) - (left.candidate.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return left.candidate.stableId < right.candidate.stableId
      ? -1
      : left.candidate.stableId > right.candidate.stableId
        ? 1
        : 0;
  });

  return eligible[0]?.candidate ?? null;
}

/** Rotate around a fixed pivot while preserving where on a FOV ray was grabbed. */
export function getShotOverheadRotationFromPointerDrag(
  startRotation: number,
  pivot: ShotOverheadPoint,
  pointerAtStart: ShotOverheadPoint,
  pointerCurrent: ShotOverheadPoint
) {
  const delta = normalizedAngleDelta(
    pointerAngle(pointerCurrent, pivot) - pointerAngle(pointerAtStart, pivot)
  );
  return ((startRotation + delta) % 360 + 360) % 360;
}

export function getDirectDragTolerance(pointerType: string) {
  return pointerType === "mouse"
    ? DIRECT_DRAG_FINE_TOLERANCE_PX
    : DIRECT_DRAG_COARSE_TOLERANCE_PX;
}

export function shouldBeginDirectDrag(
  startClient: ShotOverheadPoint,
  currentClient: ShotOverheadPoint,
  pointerType: string
) {
  return Math.hypot(
    currentClient.x - startClient.x,
    currentClient.y - startClient.y
  ) >= getDirectDragTolerance(pointerType);
}

export function hasMinimumMovementDraft(
  startWorld: ShotOverheadPoint,
  endWorld: ShotOverheadPoint,
  viewportScale: number
) {
  return Math.hypot(
    endWorld.x - startWorld.x,
    endWorld.y - startWorld.y
  ) * Math.max(0.01, viewportScale) >= MOVEMENT_CREATION_MIN_DISTANCE_PX;
}

export function getMovementEndPoint(
  sourceOrigin: ShotOverheadPoint,
  pointerStart: ShotOverheadPoint,
  pointerCurrent: ShotOverheadPoint,
  canvas: { width: number; height: number }
) {
  return {
    x: Math.min(
      canvas.width,
      Math.max(0, sourceOrigin.x + pointerCurrent.x - pointerStart.x)
    ),
    y: Math.min(
      canvas.height,
      Math.max(0, sourceOrigin.y + pointerCurrent.y - pointerStart.y)
    )
  };
}

export function createMovementPath(
  id: string,
  sourceType: ShotOverheadMovementPath["sourceType"],
  sourceId: string,
  start: ShotOverheadPoint,
  end: ShotOverheadPoint
): ShotOverheadMovementPath {
  return {
    id,
    sourceType,
    sourceId,
    points: [
      { x: start.x, y: start.y },
      { x: end.x, y: end.y }
    ]
  };
}

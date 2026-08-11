import type {
  ShotOverheadMovementPath,
  ShotOverheadPoint
} from "@/lib/types";

export const DIRECT_DRAG_FINE_TOLERANCE_PX = 6;
export const DIRECT_DRAG_COARSE_TOLERANCE_PX = 8;
export const TOUCH_CONTEXT_MENU_HOLD_MS = 520;
export const MOVEMENT_CREATION_MIN_DISTANCE_PX = 12;

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

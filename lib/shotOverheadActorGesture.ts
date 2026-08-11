import type { ShotOverheadMovementPath, ShotOverheadPoint } from "@/lib/types";

export const ACTOR_MOVEMENT_FINE_HOLD_MS = 300;
export const ACTOR_MOVEMENT_COARSE_HOLD_MS = 380;
export const ACTOR_REPOSITION_FINE_TOLERANCE_PX = 6;
export const ACTOR_REPOSITION_COARSE_TOLERANCE_PX = 9;
export const ACTOR_MOVEMENT_MIN_DISTANCE_PX = 12;

export function getActorMovementHoldDuration(pointerType: string) {
  return pointerType === "mouse"
    ? ACTOR_MOVEMENT_FINE_HOLD_MS
    : ACTOR_MOVEMENT_COARSE_HOLD_MS;
}

export function getActorRepositionTolerance(pointerType: string) {
  return pointerType === "mouse"
    ? ACTOR_REPOSITION_FINE_TOLERANCE_PX
    : ACTOR_REPOSITION_COARSE_TOLERANCE_PX;
}

export function shouldBeginActorReposition(
  startClient: ShotOverheadPoint,
  currentClient: ShotOverheadPoint,
  pointerType: string
) {
  return Math.hypot(
    currentClient.x - startClient.x,
    currentClient.y - startClient.y
  ) > getActorRepositionTolerance(pointerType);
}

export function hasMinimumActorMovement(
  startWorld: ShotOverheadPoint,
  endWorld: ShotOverheadPoint,
  viewportScale: number
) {
  const visualDistance = Math.hypot(
    endWorld.x - startWorld.x,
    endWorld.y - startWorld.y
  ) * Math.max(0.01, viewportScale);
  return visualDistance >= ACTOR_MOVEMENT_MIN_DISTANCE_PX;
}

export function getActorMovementEndPoint(
  actorOrigin: ShotOverheadPoint,
  pointerStart: ShotOverheadPoint,
  pointerCurrent: ShotOverheadPoint,
  canvas: { width: number; height: number }
) {
  return {
    x: Math.min(
      canvas.width,
      Math.max(0, actorOrigin.x + pointerCurrent.x - pointerStart.x)
    ),
    y: Math.min(
      canvas.height,
      Math.max(0, actorOrigin.y + pointerCurrent.y - pointerStart.y)
    )
  };
}

export function createActorMovementPath(
  id: string,
  sourceId: string,
  start: ShotOverheadPoint,
  end: ShotOverheadPoint
): ShotOverheadMovementPath {
  return {
    id,
    sourceType: "person",
    sourceId,
    points: [
      { x: start.x, y: start.y },
      { x: end.x, y: end.y }
    ]
  };
}

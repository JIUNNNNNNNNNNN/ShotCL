import type { ShotStatus } from "@/lib/types";

export type ProgressPointerIntent = "pending" | "horizontal" | "vertical";

export const PROGRESS_SWIPE_ACTIVATION_PX = 10;
export const PROGRESS_SWIPE_DOMINANCE_RATIO = 1.2;
export const PROGRESS_SWIPE_COMMIT_RATIO = 0.3;
export const PROGRESS_SWIPE_DISARM_RATIO = 0.2;

export type ProgressSwipeArmedStatus = Extract<ShotStatus, "ok" | "omit"> | null;

/** A persistent card uses its measured midpoint rather than DOM child overlays. */
export function resolveProgressCardHalfStatus(
  clientX: number,
  rect: Pick<DOMRect, "left" | "width">
): Extract<ShotStatus, "ok" | "omit"> | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) {
    return null;
  }
  return clientX < rect.left + rect.width / 2 ? "omit" : "ok";
}

/** Re-selecting the current terminal status keeps the existing pending-toggle semantics. */
export function resolveProgressStatusToggle(
  current: ShotStatus,
  requested: Extract<ShotStatus, "ok" | "omit">
): ShotStatus {
  return current === requested ? "pending" : requested;
}

/** Resolve one gesture axis only after the audited movement tolerance is crossed. */
export function resolveProgressPointerIntent(
  deltaX: number,
  deltaY: number,
  activationPx = PROGRESS_SWIPE_ACTIVATION_PX,
  dominanceRatio = PROGRESS_SWIPE_DOMINANCE_RATIO
): ProgressPointerIntent {
  const x = Math.abs(Number.isFinite(deltaX) ? deltaX : 0);
  const y = Math.abs(Number.isFinite(deltaY) ? deltaY : 0);
  const threshold = Number.isFinite(activationPx) ? Math.max(0, activationPx) : PROGRESS_SWIPE_ACTIVATION_PX;
  if (Math.max(x, y) <= threshold) return "pending";
  const dominance = Number.isFinite(dominanceRatio)
    ? Math.max(1, dominanceRatio)
    : PROGRESS_SWIPE_DOMINANCE_RATIO;
  if (x >= y * dominance) return "horizontal";
  if (y >= x * dominance) return "vertical";
  return "pending";
}

/** Phone status commits only after crossing a width-relative threshold. */
export function resolveProgressSwipeStatus(
  deltaX: number,
  cardWidth: number,
  commitRatio = PROGRESS_SWIPE_COMMIT_RATIO
): Extract<ShotStatus, "ok" | "omit"> | null {
  if (!Number.isFinite(deltaX) || !Number.isFinite(cardWidth) || cardWidth <= 0) return null;
  const safeRatio = Number.isFinite(commitRatio)
    ? Math.min(0.5, Math.max(0.1, commitRatio))
    : PROGRESS_SWIPE_COMMIT_RATIO;
  if (Math.abs(deltaX) < cardWidth * safeRatio) return null;
  return deltaX > 0 ? "ok" : "omit";
}

/**
 * Swipe ownership and release commitment are separate. Once armed, a small
 * backwards tremor keeps the same result until the card returns clearly near
 * center; crossing to the other side must arm that direction independently.
 */
export function resolveProgressSwipeArmedStatus(
  deltaX: number,
  cardWidth: number,
  previous: ProgressSwipeArmedStatus,
  armRatio = PROGRESS_SWIPE_COMMIT_RATIO,
  disarmRatio = PROGRESS_SWIPE_DISARM_RATIO
): ProgressSwipeArmedStatus {
  if (!Number.isFinite(deltaX) || !Number.isFinite(cardWidth) || cardWidth <= 0) return null;
  const safeArmRatio = Number.isFinite(armRatio)
    ? Math.min(0.5, Math.max(0.1, armRatio))
    : PROGRESS_SWIPE_COMMIT_RATIO;
  const safeDisarmRatio = Number.isFinite(disarmRatio)
    ? Math.min(safeArmRatio, Math.max(0, disarmRatio))
    : PROGRESS_SWIPE_DISARM_RATIO;
  const direction: Exclude<ProgressSwipeArmedStatus, null> | null = deltaX === 0
    ? null
    : deltaX > 0
      ? "ok"
      : "omit";
  const distance = Math.abs(deltaX);

  if (!previous) {
    return direction && distance >= cardWidth * safeArmRatio ? direction : null;
  }
  if (direction !== previous) {
    return direction && distance >= cardWidth * safeArmRatio ? direction : null;
  }
  return distance <= cardWidth * safeDisarmRatio ? null : previous;
}

import type { ShotStatus } from "@/lib/types";

export type ProgressPointerIntent = "pending" | "horizontal" | "vertical";

export const PROGRESS_SWIPE_ACTIVATION_PX = 10;
export const PROGRESS_SWIPE_COMMIT_RATIO = 0.3;

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
  activationPx = PROGRESS_SWIPE_ACTIVATION_PX
): ProgressPointerIntent {
  const x = Math.abs(Number.isFinite(deltaX) ? deltaX : 0);
  const y = Math.abs(Number.isFinite(deltaY) ? deltaY : 0);
  const threshold = Number.isFinite(activationPx) ? Math.max(0, activationPx) : PROGRESS_SWIPE_ACTIVATION_PX;
  if (Math.max(x, y) <= threshold) return "pending";
  return y > x ? "vertical" : "horizontal";
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

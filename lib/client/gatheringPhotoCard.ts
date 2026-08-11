export const GATHERING_PHOTO_LONG_PRESS_MS = 500;
export const GATHERING_PHOTO_LONG_PRESS_MOVE_PX = 10;

export type GatheringPhotoPointerOrigin = {
  x: number;
  y: number;
};

/** Legacy arrays remain intact; the progress card only exposes the canonical first photo. */
export function selectActiveGatheringPhoto<Photo>(photos: readonly Photo[]) {
  return photos[0] ?? null;
}

export function didGatheringPhotoPointerMove(
  origin: GatheringPhotoPointerOrigin,
  current: GatheringPhotoPointerOrigin,
  tolerance = GATHERING_PHOTO_LONG_PRESS_MOVE_PX
) {
  return Math.hypot(current.x - origin.x, current.y - origin.y) > tolerance;
}

/**
 * Optimistic delete hides only the photo the user deleted. It deliberately
 * does not promote a legacy sibling while the canonical mutation is pending.
 */
export function shouldHideActiveGatheringPhoto(
  activePhotoId: string | null | undefined,
  optimisticallyDeletedPhotoId: string | null
) {
  return Boolean(activePhotoId && activePhotoId === optimisticallyDeletedPhotoId);
}

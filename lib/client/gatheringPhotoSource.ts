export type GatheringPhotoPickerPresentation = "album-direct" | "source-sheet";
export type GatheringPhotoSource = "camera" | "album";

export const GATHERING_PHOTO_FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
export const GATHERING_PHOTO_TOUCH_POINTER_QUERY = "(any-pointer: coarse)";
export const GATHERING_PHOTO_SOURCE_SHEET_DRAWER_DELAY_MS = 160;

export type GatheringPhotoInputPolicy = {
  accept: "image/*";
  capture?: "environment";
  multiple: boolean;
};

/**
 * The project shell already separates compact/drawer viewports from persistent
 * tablet and desktop layouts. Pointer capability then keeps touch tablets on
 * the source chooser while a persistent mouse/trackpad desktop opens the
 * existing album picker directly.
 */
export function resolveGatheringPhotoPickerPresentation({
  persistentProjectShell,
  finePointer,
  touchCapable = false
}: {
  persistentProjectShell: boolean;
  finePointer: boolean;
  touchCapable?: boolean;
}): GatheringPhotoPickerPresentation {
  return persistentProjectShell && finePointer && !touchCapable
    ? "album-direct"
    : "source-sheet";
}

export function resolveGatheringPhotoSourceSheetDelay({
  triggeredFromActionDrawer,
  reducedMotion
}: {
  triggeredFromActionDrawer: boolean;
  reducedMotion: boolean;
}) {
  if (!triggeredFromActionDrawer || reducedMotion) return 0;
  return GATHERING_PHOTO_SOURCE_SHEET_DRAWER_DELAY_MS;
}

/**
 * Compact project actions always originate in the transient action drawer,
 * even on mobile browsers that do not move focus to the tapped button.
 */
export function requiresGatheringPhotoDrawerHandoff({
  persistentProjectShell,
  triggerInsideActionDrawer
}: {
  persistentProjectShell: boolean;
  triggerInsideActionDrawer: boolean;
}) {
  return !persistentProjectShell || triggerInsideActionDrawer;
}

export function getGatheringPhotoInputPolicy(
  source: GatheringPhotoSource,
  allowMultipleAlbum = true
): GatheringPhotoInputPolicy {
  if (source === "camera") {
    return {
      accept: "image/*",
      capture: "environment",
      multiple: false
    };
  }

  return {
    accept: "image/*",
    multiple: allowMultipleAlbum
  };
}

/**
 * A file input must be cleared both before opening and after consuming change
 * so choosing the same image twice still emits a later change event.
 */
export function resetGatheringPhotoInput(input: { value: string } | null) {
  if (input) input.value = "";
}

export function consumeAndResetGatheringPhotoInput<T>(input: {
  files: ArrayLike<T> | null;
  value: string;
}) {
  const files = Array.from(input.files ?? []);
  resetGatheringPhotoInput(input);
  return files;
}

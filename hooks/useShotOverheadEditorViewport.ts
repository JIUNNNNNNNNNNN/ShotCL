"use client";

import { useSyncExternalStore } from "react";

/**
 * The editor uses pointer events and screen-space hit targets, so it can keep
 * the same direct-drag/context-menu model on phones, tablets, and desktop.
 * Only extremely small embedded viewports stay read-only.
 */
export const SHOT_OVERHEAD_EDITOR_VIEWPORT_QUERY =
  "(min-width: 320px) and (min-height: 480px), (min-width: 640px) and (min-height: 360px)";

export function useShotOverheadEditorViewport() {
  return useSyncExternalStore(
    subscribeToShotOverheadEditorViewport,
    isShotOverheadEditorViewport,
    getServerShotOverheadEditorViewport
  );
}

export function isShotOverheadEditorViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(SHOT_OVERHEAD_EDITOR_VIEWPORT_QUERY).matches;
}

function subscribeToShotOverheadEditorViewport(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(SHOT_OVERHEAD_EDITOR_VIEWPORT_QUERY);
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", onStoreChange);
  } else {
    mediaQuery.addListener(onStoreChange);
  }

  return () => {
    if (typeof mediaQuery.removeEventListener === "function") {
      mediaQuery.removeEventListener("change", onStoreChange);
    } else {
      mediaQuery.removeListener(onStoreChange);
    }
  };
}

function getServerShotOverheadEditorViewport() {
  return false;
}

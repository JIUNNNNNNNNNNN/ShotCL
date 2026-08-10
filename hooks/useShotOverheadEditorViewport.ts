"use client";

import { useSyncExternalStore } from "react";

/**
 * Keep the diagram editor on desktop-class pointers and tablet-sized screens.
 * The height guard prevents landscape phones from being treated as tablets.
 */
export const SHOT_OVERHEAD_EDITOR_VIEWPORT_QUERY =
  "(min-width: 720px) and (min-height: 700px), (min-width: 900px) and (min-height: 500px) and (hover: hover) and (pointer: fine)";

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

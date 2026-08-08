"use client";

import { useSyncExternalStore } from "react";

/**
 * Tablet-class usable viewports keep the project navigation and contextual
 * actions persistent. The height guard prevents landscape phones from being
 * mistaken for tablets solely because their CSS viewport is wide.
 */
export const PERSISTENT_PROJECT_SHELL_QUERY = "(min-width: 720px) and (min-height: 700px)";

export function usePersistentProjectShell() {
  return useSyncExternalStore(
    subscribeToProjectShellMode,
    isPersistentProjectShellViewport,
    getServerProjectShellMode
  );
}

export function isPersistentProjectShellViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(PERSISTENT_PROJECT_SHELL_QUERY).matches;
}

function subscribeToProjectShellMode(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(PERSISTENT_PROJECT_SHELL_QUERY);
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

function getServerProjectShellMode() {
  return false;
}

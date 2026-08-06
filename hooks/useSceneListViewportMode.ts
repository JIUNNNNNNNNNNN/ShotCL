"use client";

import { useSyncExternalStore } from "react";

export type SceneListViewportMode = "portrait" | "editor";

export const SCENE_LIST_EDITOR_MIN_WIDTH_PX = 1024;
export const SCENE_LIST_READ_ONLY_MEDIA_QUERY =
  `(max-width: ${SCENE_LIST_EDITOR_MIN_WIDTH_PX - 1}px)`;

const subscribeToPortraitMode = (onStoreChange: () => void) => {
  const mediaQuery = window.matchMedia(SCENE_LIST_READ_ONLY_MEDIA_QUERY);
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
};

const getPortraitSnapshot = () =>
  window.matchMedia(SCENE_LIST_READ_ONLY_MEDIA_QUERY).matches;

const getServerPortraitSnapshot = () => null;

/**
 * 기기명이나 방향 대신 씬리스트 편집 표를 안전하게 쓸 수 있는 usable width를
 * 기준으로 합니다. SSR·hydration 중에는 mode를 확정하지 않아 편집 표가 좁은
 * 화면에 잠깐 마운트되지 않습니다.
 */
export function useSceneListViewportMode(): SceneListViewportMode | null {
  const isPortrait = useSyncExternalStore<boolean | null>(
    subscribeToPortraitMode,
    getPortraitSnapshot,
    getServerPortraitSnapshot
  );

  if (isPortrait === null) return null;
  return isPortrait ? "portrait" : "editor";
}

"use client";

import { useSyncExternalStore } from "react";

export type SceneListViewportMode = "portrait" | "editor";

export const SCENE_LIST_EDITOR_MIN_WIDTH_PX = 700;
export const SCENE_LIST_EDITOR_MIN_HEIGHT_PX = 600;
export const SCENE_LIST_DESKTOP_MIN_WIDTH_PX = 1100;
/**
 * Tablets use the horizontally scrollable editor once both dimensions provide
 * a stable touch workspace. Wide desktop windows remain editable at shorter
 * heights, while phone portrait and landscape sizes keep the read-only cards.
 */
export const SCENE_LIST_EDITOR_MEDIA_QUERY = [
  `(min-width: ${SCENE_LIST_DESKTOP_MIN_WIDTH_PX}px)`,
  `(min-width: ${SCENE_LIST_EDITOR_MIN_WIDTH_PX}px) and (min-height: ${SCENE_LIST_EDITOR_MIN_HEIGHT_PX}px)`
].join(", ");

export function resolveSceneListViewportModeForSize(
  width: number,
  height: number
): SceneListViewportMode {
  const editor = width >= SCENE_LIST_DESKTOP_MIN_WIDTH_PX
    || (
      width >= SCENE_LIST_EDITOR_MIN_WIDTH_PX
      && height >= SCENE_LIST_EDITOR_MIN_HEIGHT_PX
    );
  return editor ? "editor" : "portrait";
}

const subscribeToPortraitMode = (onStoreChange: () => void) => {
  const mediaQuery = window.matchMedia(SCENE_LIST_EDITOR_MEDIA_QUERY);
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
  !window.matchMedia(SCENE_LIST_EDITOR_MEDIA_QUERY).matches;

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

"use client";

import { useSyncExternalStore } from "react";
import { APP_MOBILE_MEDIA_QUERY } from "@/lib/dailyPlan/documentLayout";

export type SceneListViewportMode = "portrait" | "editor";

export const SCENE_LIST_PORTRAIT_MEDIA_QUERY =
  `${APP_MOBILE_MEDIA_QUERY} and (orientation: portrait)`;

const subscribeToPortraitMode = (onStoreChange: () => void) => {
  const mediaQuery = window.matchMedia(SCENE_LIST_PORTRAIT_MEDIA_QUERY);
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
  window.matchMedia(SCENE_LIST_PORTRAIT_MEDIA_QUERY).matches;

const getServerPortraitSnapshot = () => null;

/**
 * 공통 768px breakpoint와 세로 방향을 함께 사용합니다. SSR·hydration 중에는
 * mode를 확정하지 않아 데스크톱 편집 표가 모바일에 잠깐 마운트되지 않습니다.
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

"use client";

import { useSyncExternalStore } from "react";
import {
  APP_MOBILE_MEDIA_QUERY,
  getAutomaticDailyPlanOrientation,
  type DailyPlanDocumentOrientation
} from "@/lib/dailyPlan/documentLayout";

const subscribeToMobileLayout = (onStoreChange: () => void) => {
  const mediaQuery = window.matchMedia(APP_MOBILE_MEDIA_QUERY);
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

const getMobileLayoutSnapshot = () =>
  window.matchMedia(APP_MOBILE_MEDIA_QUERY).matches;

const getServerMobileLayoutSnapshot = () => null;

/**
 * 현재 공통 mobile breakpoint에서 일촬표 문서 방향을 파생합니다.
 * SSR·hydration 중에는 방향을 확정하지 않고 null을 반환합니다.
 */
export function useDailyPlanDocumentOrientation(): DailyPlanDocumentOrientation | null {
  const isMobile = useSyncExternalStore<boolean | null>(
    subscribeToMobileLayout,
    getMobileLayoutSnapshot,
    getServerMobileLayoutSnapshot
  );

  return isMobile === null ? null : getAutomaticDailyPlanOrientation(isMobile);
}

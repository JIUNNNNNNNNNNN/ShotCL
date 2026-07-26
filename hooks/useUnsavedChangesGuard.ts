"use client";

import { useEffect, useRef } from "react";

const activeGuards = new Set<symbol>();

/** 브라우저 이탈 경고와 앱 내부 공통 이동 확인에 같은 dirty 상태를 사용합니다. */
export function useUnsavedChangesGuard(active: boolean) {
  const guardIdRef = useRef(Symbol("unsaved-changes"));

  useEffect(() => {
    const guardId = guardIdRef.current;
    if (!active) {
      activeGuards.delete(guardId);
      return;
    }

    activeGuards.add(guardId);
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      activeGuards.delete(guardId);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [active]);
}

export function confirmUnsavedChangesNavigation() {
  if (activeGuards.size === 0) return true;
  return window.confirm("저장되지 않은 변경사항이 있습니다. 저장하지 않고 이동할까요?");
}

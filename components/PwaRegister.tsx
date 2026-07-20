"use client";

import { useEffect } from "react";

/** 브라우저가 지원할 때만 서비스 워커를 등록해 PWA 설치 기반을 만듭니다. */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 개발 중 서비스 워커 등록 실패가 앱 사용을 막지 않도록 조용히 무시합니다.
      });
    }
  }, []);

  return null;
}

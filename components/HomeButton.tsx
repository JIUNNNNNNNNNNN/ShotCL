"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { House } from "lucide-react";
import { confirmUnsavedChangesNavigation } from "@/hooks/useUnsavedChangesGuard";

const LONG_PRESS_MS = 700;

/** 짧게 누르면 현재 프로젝트 회차선택, 길게 누르면 메인 화면으로 이동합니다. */
export function HomeButton() {
  const pathname = usePathname();
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const navigatingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [isPressing, setIsPressing] = useState(false);

  useEffect(() => () => {
    clearPressTimer(timerRef);
    clearPressTimer(navigationUnlockTimerRef);
  }, []);

  if (pathname === "/") return null;

  const projectId = getProjectIdFromPathname(pathname);
  const projectEpisodePath = projectId
    ? `/projects/${encodeURIComponent(projectId)}`
    : "/";

  function navigate(destination: string) {
    if (navigatingRef.current || !confirmUnsavedChangesNavigation()) return;
    navigatingRef.current = true;
    router.push(destination);
    clearPressTimer(navigationUnlockTimerRef);
    navigationUnlockTimerRef.current = setTimeout(() => {
      navigatingRef.current = false;
      navigationUnlockTimerRef.current = null;
    }, 800);
  }

  function beginPress() {
    if (navigatingRef.current) return;
    clearPressTimer(timerRef);
    longPressTriggeredRef.current = false;
    setIsPressing(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      longPressTriggeredRef.current = true;
      setIsPressing(false);
      navigate("/");
    }, LONG_PRESS_MS);
  }

  function finishPress() {
    clearPressTimer(timerRef);
    setIsPressing(false);
  }

  function cancelPress(suppressClick = false) {
    clearPressTimer(timerRef);
    if (suppressClick) longPressTriggeredRef.current = true;
    activePointerIdRef.current = null;
    setIsPressing(false);
  }

  return (
    <button
      type="button"
      aria-label={projectId ? "회차 선택으로 이동, 길게 누르면 메인 홈으로 이동" : "메인 홈으로 이동"}
      title={projectId ? "회차 선택 · 길게 누르면 메인 홈" : "메인 홈"}
      className={`fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] flex h-10 w-10 select-none items-center justify-center rounded-full border bg-white/95 text-field-primary shadow-[0_3px_10px_rgba(28,28,26,0.08)] backdrop-blur-sm transition-[background-color,border-color,transform] hover:border-field-primary hover:bg-field-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2 md:left-5 md:h-11 md:w-11 ${
        isPressing ? "scale-90 border-[#d7b95f] bg-field-light" : "border-field-secondary active:scale-95"
      }`}
      style={{ touchAction: "manipulation", WebkitTouchCallout: "none" }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        activePointerIdRef.current = event.pointerId;
        beginPress();
      }}
      onPointerUp={(event) => {
        if (activePointerIdRef.current !== event.pointerId) return;
        activePointerIdRef.current = null;
        const wasLongPress = longPressTriggeredRef.current;
        finishPress();
        longPressTriggeredRef.current = false;
        suppressClickUntilRef.current = Date.now() + 500;
        if (!wasLongPress) navigate(projectEpisodePath);
      }}
      onPointerCancel={() => {
        suppressClickUntilRef.current = Date.now() + 500;
        cancelPress(true);
      }}
      onPointerLeave={() => {
        suppressClickUntilRef.current = Date.now() + 500;
        cancelPress(true);
      }}
      onClick={(event) => {
        event.preventDefault();
        if (Date.now() < suppressClickUntilRef.current) return;
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          return;
        }
        navigate(projectEpisodePath);
      }}
      onBlur={() => {
        suppressClickUntilRef.current = Date.now() + 500;
        cancelPress(true);
      }}
    >
      <House className="h-[18px] w-[18px] md:h-5 md:w-5" aria-hidden />
    </button>
  );
}

function clearPressTimer(timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = null;
}

function getProjectIdFromPathname(pathname: string) {
  const match = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  if (!match || match[1] === "new") return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

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
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressArmedRef = useRef(false);
  const navigatingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [isPressing, setIsPressing] = useState(false);
  const [isArmed, setIsArmed] = useState(false);

  useEffect(() => {
    const handleWindowBlur = () => {
      cleanupPress({ suppressClick: true });
    };

    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      cleanupPress({ suppressClick: true });
      clearPressTimer(navigationUnlockTimerRef);
    };
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

  function beginPress(pointerId: number, clientX: number, clientY: number) {
    if (navigatingRef.current) return;
    clearPressTimer(timerRef);
    longPressArmedRef.current = false;
    pointerStartRef.current = { x: clientX, y: clientY };
    activePointerIdRef.current = pointerId;
    setIsArmed(false);
    setIsPressing(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      longPressArmedRef.current = true;
      setIsArmed(true);
    }, LONG_PRESS_MS);
  }

  function cleanupPress({ suppressClick = false }: { suppressClick?: boolean } = {}) {
    clearPressTimer(timerRef);
    const pointerId = activePointerIdRef.current;
    const button = buttonRef.current;
    if (pointerId !== null && button?.hasPointerCapture(pointerId)) {
      try {
        button.releasePointerCapture(pointerId);
      } catch {
        // 이미 브라우저가 capture를 해제한 경우에도 나머지 상태는 정리합니다.
      }
    }
    if (suppressClick) suppressClickUntilRef.current = Date.now() + 500;
    activePointerIdRef.current = null;
    pointerStartRef.current = null;
    longPressArmedRef.current = false;
    setIsPressing(false);
    setIsArmed(false);
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={projectId ? "회차 선택으로 이동, 길게 누르면 메인 홈으로 이동" : "메인 홈으로 이동"}
      title={projectId ? "회차 선택 · 길게 누르면 메인 홈" : "메인 홈"}
      className={`fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] flex h-10 w-10 select-none items-center justify-center border bg-field-floating text-field-text shadow-floating transition-[background-color,border-color,transform] hover:border-field-primary/60 hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg md:left-5 md:h-11 md:w-11 ${
        isArmed
          ? "scale-95 border-field-primary bg-field-primary/15 text-field-primary"
          : isPressing
            ? "scale-90 border-field-primary/80 bg-field-primary/10 text-field-primary"
            : "border-field-divider active:scale-95"
      }`}
      style={{ touchAction: "none", WebkitTouchCallout: "none" }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // capture 미지원 환경에서도 동일한 timer/cleanup 흐름을 사용합니다.
        }
        beginPress(event.pointerId, event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (activePointerIdRef.current !== event.pointerId || !pointerStartRef.current) return;
        const distance = Math.hypot(
          event.clientX - pointerStartRef.current.x,
          event.clientY - pointerStartRef.current.y
        );
        const cancelDistance = event.pointerType === "mouse" ? 14 : 24;
        if (distance > cancelDistance) cleanupPress({ suppressClick: true });
      }}
      onPointerUp={(event) => {
        if (activePointerIdRef.current !== event.pointerId) return;
        const wasArmed = longPressArmedRef.current;
        cleanupPress({ suppressClick: true });
        navigate(wasArmed ? "/" : projectEpisodePath);
      }}
      onPointerCancel={() => {
        cleanupPress({ suppressClick: true });
      }}
      onClick={(event) => {
        event.preventDefault();
        if (Date.now() < suppressClickUntilRef.current) return;
        navigate(projectEpisodePath);
      }}
      onBlur={() => {
        cleanupPress({ suppressClick: true });
      }}
    >
      <svg
        aria-hidden
        viewBox="0 0 44 44"
        className={`pointer-events-none absolute -inset-[3px] h-[calc(100%+6px)] w-[calc(100%+6px)] ${
          isPressing || isArmed ? "opacity-100" : "opacity-0"
        }`}
      >
        <rect
          x="3"
          y="3"
          width="38"
          height="38"
          rx="0"
          fill="none"
          stroke="var(--field-accent)"
          strokeWidth="2.5"
          strokeLinecap="square"
          strokeLinejoin="miter"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={isPressing || isArmed ? 0 : 100}
          className="transition-[stroke-dashoffset] ease-linear motion-reduce:transition-none"
          style={{ transitionDuration: `${LONG_PRESS_MS}ms` }}
        />
      </svg>
      <House className="relative h-[18px] w-[18px] md:h-5 md:w-5" aria-hidden />
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

"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const CLOSE_DURATION_MS = 120;

/** 짧은 surface 닫힘 motion이 끝난 뒤 DOM을 정리하고, 닫는 동안 focus를 차단합니다. */
export function MotionPresence({
  show,
  children,
  className,
  id
}: {
  show: boolean;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const [mounted, setMounted] = useState(show);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (show) {
      setMounted(true);
      setClosing(false);
      return undefined;
    }
    if (!mounted) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMounted(false);
      setClosing(false);
      return undefined;
    }

    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, CLOSE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [mounted, show]);

  if (!mounted) return null;

  return (
    <div
      id={id}
      className={cn("ui-motion-presence", className)}
      data-motion-state={closing ? "closing" : "open"}
      aria-hidden={closing || undefined}
      inert={closing}
    >
      <div className="ui-motion-presence__inner">{children}</div>
    </div>
  );
}

"use client";

import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProgressStatusSectionProps = {
  okCount: number;
  omitCount: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
  className?: string;
};

/** Canonical 촬영 순서를 유지한 채 OK와 OMIT 컷을 하나의 하단 묶음으로 표시합니다. */
export function ProgressStatusSection({
  okCount,
  omitCount,
  expanded,
  onExpandedChange,
  children,
  className
}: ProgressStatusSectionProps) {
  const contentId = useId();
  const safeOkCount = Number.isFinite(okCount) ? Math.max(0, Math.trunc(okCount)) : 0;
  const safeOmitCount = Number.isFinite(omitCount) ? Math.max(0, Math.trunc(omitCount)) : 0;
  const safeCount = safeOkCount + safeOmitCount;

  return (
    <section
      className={cn("ui-motion-surface overflow-hidden rounded-[var(--radius-card)] border border-field-divider bg-field-section", className)}
      aria-label="처리된 컷"
    >
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => onExpandedChange(!expanded)}
          className="relative flex min-h-11 w-full items-center justify-center gap-2 border-0 bg-field-section px-10 py-2.5 text-center text-sm font-bold text-field-text transition-colors hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-field-primary"
        >
          <span>처리 완료</span>
          <span className="tabular-nums text-field-subtle">{safeCount}</span>
          <span className="text-xs font-semibold text-status-ok">OK {safeOkCount}</span>
          <span className="text-xs font-semibold text-field-danger">OMIT {safeOmitCount}</span>
          <ChevronDown
            className={cn("absolute right-3 h-4 w-4 shrink-0 text-field-muted transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
        </button>
      </h3>
      <div
        id={contentId}
        data-expanded={expanded ? "true" : "false"}
        aria-hidden={!expanded}
        inert={!expanded}
        className="ui-accordion"
      >
        <div className="ui-accordion-inner min-h-0">
          <div className="border-t border-field-divider bg-field-panel p-2">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

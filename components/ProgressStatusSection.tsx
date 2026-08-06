"use client";

import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProgressStatusSectionKind = "ok" | "omit";

export type ProgressStatusSectionProps = {
  kind: ProgressStatusSectionKind;
  count: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
  className?: string;
};

const LABEL_BY_KIND: Record<ProgressStatusSectionKind, string> = {
  ok: "OK",
  omit: "OMIT"
};

/** OK 또는 OMIT 컷 전체를 하나의 상태로 여닫는 진행표 section입니다. */
export function ProgressStatusSection({
  kind,
  count,
  expanded,
  onExpandedChange,
  children,
  className
}: ProgressStatusSectionProps) {
  const contentId = useId();
  const label = LABEL_BY_KIND[kind];
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;

  return (
    <section
      className={cn("ui-motion-surface overflow-hidden rounded-[var(--radius-card)] border border-field-divider bg-field-section", className)}
      aria-label={`${label} 컷`}
    >
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => onExpandedChange(!expanded)}
          className="relative flex min-h-11 w-full items-center justify-center gap-2 border-0 bg-field-section px-10 py-2.5 text-center text-sm font-bold text-field-text transition-colors hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-field-primary"
        >
          <span className={kind === "ok" ? "text-status-ok" : "text-field-danger"}>{label}</span>
          <span className="tabular-nums text-field-subtle">{safeCount}</span>
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

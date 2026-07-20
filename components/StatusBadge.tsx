import { shotStatusLabels, shotStatusStyles, type ShotStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: ShotStatus;
  compact?: boolean;
};

/** 컷 상태를 현장에서 빠르게 구분할 수 있는 고정 배지입니다. */
export function StatusBadge({ status, compact = false }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border font-black",
        compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
        shotStatusStyles[status]
      )}
    >
      {shotStatusLabels[status]}
    </span>
  );
}

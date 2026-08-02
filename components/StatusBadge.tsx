import { shotStatusLabels, type ShotStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: ShotStatus;
  compact?: boolean;
};

const statusClassNames: Record<ShotStatus, string> = {
  pending: "border-field-border bg-field-panel text-field-muted",
  ok: "border-field-primary bg-field-primary text-black",
  omit: "border-field-danger bg-field-danger text-white"
};

/** 컷 상태를 현장에서 빠르게 구분할 수 있는 고정 배지입니다. */
export function StatusBadge({ status, compact = false }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center  border font-bold",
        compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
        statusClassNames[status]
      )}
    >
      {shotStatusLabels[status]}
    </span>
  );
}

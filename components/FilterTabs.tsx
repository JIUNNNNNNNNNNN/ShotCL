import { cn } from "@/lib/utils";

export type ShotFilter = "all" | "remaining" | "ok" | "omit";

const labels: Record<ShotFilter, string> = {
  all: "전체",
  remaining: "남은 컷",
  ok: "OK",
  omit: "omit"
};

/** 컷 리스트 상단에서 현장 스탭이 빠르게 상태별로 걸러보는 필터입니다. */
export function FilterTabs({
  value,
  onChange
}: {
  value: ShotFilter;
  onChange: (filter: ShotFilter) => void;
}) {
  const filters: ShotFilter[] = ["all", "remaining", "ok", "omit"];

  return (
    <div className="grid grid-cols-2 gap-1 rounded-2xl border border-field-border bg-white p-1 sm:grid-cols-4">
      {filters.map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => onChange(filter)}
          className={cn(
            "min-h-9 rounded-xl px-2 text-sm font-black transition-colors",
            value === filter ? "bg-field-primary text-white" : "bg-white text-field-muted"
          )}
        >
          {labels[filter]}
        </button>
      ))}
    </div>
  );
}

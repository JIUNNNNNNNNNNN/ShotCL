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
    <div className="grid grid-cols-4 gap-1 rounded-full border border-field-border bg-white p-1">
      {filters.map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => onChange(filter)}
          className={cn(
            "min-h-[38px] rounded-full px-1 text-xs font-black leading-[1.25] tracking-[-0.015em] transition-[background-color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] md:text-sm",
            value === filter ? "bg-field-primary text-white" : "bg-transparent text-field-muted hover:bg-field-soft"
          )}
        >
          {labels[filter]}
        </button>
      ))}
    </div>
  );
}

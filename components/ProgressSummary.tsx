import type { Shot } from "@/lib/types";

type ProgressSummaryProps = {
  shots: Shot[];
};

/** 전체 진행률과 상태별 개수를 한 화면에 압축해서 보여줍니다. */
export function ProgressSummary({ shots }: ProgressSummaryProps) {
  const total = shots.length;
  const ok = shots.filter((shot) => shot.status === "ok").length;
  const omit = shots.filter((shot) => shot.status === "omit").length;
  const remaining = Math.max(total - ok - omit, 0);
  const progress = total === 0 ? 0 : Math.round((ok / total) * 100);

  return (
    <section className="rounded-md border border-field-border bg-field-soft p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-field-muted">현재 진행률</p>
          <p className="mt-1 text-3xl font-black text-field-primary">{progress}%</p>
        </div>
        <p className="text-right text-sm font-bold text-field-muted">{ok}/{total} OK</p>
      </div>

      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white">
        <div className="h-full bg-field-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        <Stat label="전체" value={total} />
        <Stat label="OK" value={ok} />
        <Stat label="omit" value={omit} danger />
        <Stat label="남은 컷" value={remaining} />
      </div>
    </section>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-md border border-field-border bg-white p-2 text-center">
      <p className="text-xs font-bold text-field-muted">{label}</p>
      <p className={danger ? "mt-1 text-xl font-black text-field-danger" : "mt-1 text-xl font-black text-field-primary"}>{value}</p>
    </div>
  );
}

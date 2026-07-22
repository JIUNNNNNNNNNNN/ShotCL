import type { Shot } from "@/lib/types";

type ProgressSummaryProps = {
  shots: Shot[];
};

/** 전체 진행률과 상태별 개수를 한 화면에 압축해서 보여줍니다. */
export function ProgressSummary({ shots }: ProgressSummaryProps) {
  const total = shots.length;
  const ok = shots.filter((shot) => shot.status === "ok").length;
  const omit = shots.filter((shot) => shot.status === "omit").length;
  const completed = ok + omit;
  const remaining = Math.max(total - completed, 0);
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);
  const isComplete = total > 0 && completed === total;

  return (
    <section className="field-section bg-field-light/55 p-3 md:p-4" aria-labelledby="today-progress-title">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-field-muted">오늘 컷 진행률</p>
          <h2 id="today-progress-title" className="mt-0.5 text-lg font-black text-field-primary md:text-xl">
            {isComplete ? "즐거운 바라시" : "집에 가기까지"}
          </h2>
          <p className="mt-1 text-3xl font-black leading-none text-field-primary md:text-4xl">{progress}%</p>
        </div>
        <p className="text-right text-xs font-bold text-field-muted">{completed}/{total} 처리 완료</p>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-sm border border-field-border bg-white">
        <div className="h-full bg-field-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
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
    <div className="field-cell grid min-h-11 place-items-center gap-0 px-1 py-1.5 text-center md:flex md:justify-between md:px-3">
      <p className="text-[10px] font-bold text-field-muted md:text-xs">{label}</p>
      <p className={danger ? "text-base font-black text-field-danger md:text-lg" : "text-base font-black text-field-primary md:text-lg"}>{value}</p>
    </div>
  );
}

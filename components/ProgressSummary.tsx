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
    <section className="rounded-[2rem] border border-field-border bg-field-light/55 p-3 md:p-4" aria-labelledby="today-progress-title">
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 md:grid-cols-[6.5rem_minmax(0,1fr)_auto] md:gap-5">
        <div
          className="grid h-[5.5rem] w-[5.5rem] shrink-0 place-items-center rounded-full p-1.5 md:h-[6.5rem] md:w-[6.5rem]"
          style={{ background: `conic-gradient(#0f3d2e ${progress}%, #e8eee9 ${progress}% 100%)` }}
          aria-label={`진행률 ${progress}%`}
        >
          <div className="grid h-full w-full place-items-center rounded-full border border-field-border bg-white">
            <p className="text-xl font-black leading-[1.15] text-field-primary md:text-2xl">{progress}%</p>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-field-muted">오늘 컷 진행률</p>
          <h2 id="today-progress-title" className="mt-0.5 truncate text-lg font-black tracking-[-0.015em] text-field-primary md:text-xl">
            {isComplete ? "즐거운 바라시" : "집에 가기까지"}
          </h2>
          <p className="mt-1 text-xs font-bold text-field-muted">{completed}/{total} 처리 완료</p>
        </div>

        <div className="col-span-2 grid grid-cols-4 gap-1.5 md:col-span-1 md:min-w-[22rem]">
        <Stat label="전체" value={total} />
        <Stat label="OK" value={ok} />
        <Stat label="omit" value={omit} danger />
        <Stat label="남은 컷" value={remaining} />
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="grid min-h-11 place-items-center gap-0 rounded-full border border-field-border bg-white px-1 py-1.5 text-center md:min-h-12">
      <p className="text-[10px] font-bold tracking-[-0.015em] text-field-muted md:text-xs">{label}</p>
      <p className={danger ? "text-base font-black text-field-danger md:text-lg" : "text-base font-black text-field-primary md:text-lg"}>{value}</p>
    </div>
  );
}

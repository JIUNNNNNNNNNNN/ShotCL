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
    <section className="rounded-3xl border border-field-border bg-field-light/70 p-4 md:p-5" aria-labelledby="today-progress-title">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black text-field-muted">오늘 컷 진행률</p>
          <h2 id="today-progress-title" className="mt-1 text-xl font-black text-field-primary md:text-2xl">집에 가기까지</h2>
          <p className="mt-1 text-4xl font-black leading-none text-field-primary">{progress}%</p>
        </div>
        <p className="text-right text-sm font-bold text-field-muted">{completed}/{total} 처리 완료</p>
      </div>

      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white shadow-inner">
        <div className="h-full bg-field-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      {isComplete ? (
        <p className="mt-3 rounded-2xl border border-field-primary/20 bg-white px-4 py-2 text-center text-sm font-black text-field-primary">
          즐거운 바라시
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
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
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-field-border bg-white px-4 py-2">
      <p className="text-xs font-bold text-field-muted">{label}</p>
      <p className={danger ? "text-xl font-black text-field-danger" : "text-xl font-black text-field-primary"}>{value}</p>
    </div>
  );
}

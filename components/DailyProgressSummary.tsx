import type { DailyProgressSummary as DailyProgressSummaryValue } from "@/lib/progress/dailyProgress";

type DailyProgressSummaryProps = {
  progress: DailyProgressSummaryValue;
};

/** 일일 진행표 상단에서 퍼센트와 상태별 컷 수를 compact하게 보여줍니다. */
export function DailyProgressSummary({ progress }: DailyProgressSummaryProps) {
  return (
    <section className="mb-3 border border-field-border bg-white p-3" aria-label="일일 촬영 진행률">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-black text-field-primary">
          진행률 <span className="tabular-nums">{progress.progressPercent}%</span>
        </h2>
        <span className="text-[11px] font-bold text-field-muted">
          처리 {progress.processedCutCount}/{progress.totalCutCount}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-[2px] border border-field-border bg-field-soft"
        role="progressbar"
        aria-label="촬영 진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.progressPercent}
      >
        <div
          className="h-full bg-field-primary transition-[width] duration-200"
          style={{ width: `${progress.progressPercent}%` }}
        />
      </div>
      <p className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-bold leading-5 text-field-muted">
        <span>OK <strong className="tabular-nums text-field-primary">{progress.okCutCount}</strong></span>
        <span aria-hidden>·</span>
        <span>OMIT <strong className="tabular-nums text-field-danger">{progress.omitCutCount}</strong></span>
        <span aria-hidden>·</span>
        <span>남은 컷 <strong className="tabular-nums text-field-text">{progress.remainingCutCount}</strong></span>
        <span aria-hidden>·</span>
        <span>전체 <strong className="tabular-nums text-field-text">{progress.totalCutCount}</strong></span>
      </p>
    </section>
  );
}

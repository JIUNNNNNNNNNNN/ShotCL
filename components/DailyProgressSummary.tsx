import {
  getDailyProgressMessage,
  normalizeProgressPercent,
  type DailyProgressSummary as DailyProgressSummaryValue
} from "@/lib/progress/dailyProgress";

type DailyProgressSummaryProps = {
  progress: DailyProgressSummaryValue;
};

/** 일일 진행표 상단에서 퍼센트와 상태별 컷 수를 compact하게 보여줍니다. */
export function DailyProgressSummary({ progress }: DailyProgressSummaryProps) {
  const progressPercent = normalizeProgressPercent(progress.progressPercent);
  const progressMessage = getDailyProgressMessage(progressPercent);

  return (
    <section className="ui-motion-surface mb-3 rounded-[var(--radius-card)] border border-field-border bg-field-section p-3 text-center" aria-label="일일 촬영 진행률">
      <div className="grid justify-items-center gap-1">
        <div className="min-w-0 text-center">
          <h2 className="break-words text-sm font-bold leading-[1.35] text-field-text">
            {progressMessage}
          </h2>
          <p className="mt-0.5 text-2xl font-bold leading-none text-field-primary tabular-nums">
            {progressPercent}%
          </p>
        </div>
        <span className="text-[11px] font-normal text-field-muted">
          처리 {progress.processedCutCount}/{progress.totalCutCount}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden border border-field-border bg-field-input"
        role="progressbar"
        aria-label="촬영 진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent}
      >
        <div
          className="h-full bg-field-primary transition-[width] duration-200"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <p className="mt-2 flex flex-wrap justify-center gap-x-2 gap-y-0.5 text-[11px] font-normal leading-5 text-field-muted">
        <span>OK <strong className="tabular-nums text-status-ok">{progress.okCutCount}</strong></span>
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

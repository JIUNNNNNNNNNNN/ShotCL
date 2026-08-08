import type { ReactNode } from "react";

type ProgressDetailHeaderProps = {
  projectName: string;
  episodeLabel: string;
  shootingDate: string;
  action: ReactNode;
};

/** 진행도 상세 화면의 프로젝트명·회차 계층을 한 곳에서 유지합니다. */
export function ProgressDetailHeader({
  projectName,
  episodeLabel,
  shootingDate,
  action
}: ProgressDetailHeaderProps) {
  return (
    <div className="relative z-30 mb-[var(--ui-section-gap)] flex min-w-0 items-start justify-between gap-[var(--ui-card-gap)]" aria-label="진행 페이지 이동 메뉴">
      <div className="min-w-0 flex-1 pr-3 text-left md:text-center">
        <h1 className="ui-density-heading max-w-full break-words font-black leading-[1.25] text-field-text">
          {projectName}
        </h1>
        <p className="mt-1 text-sm font-black leading-[1.35] text-field-subtle">
          {episodeLabel}
        </p>
        <p className="mt-0.5 text-[11px] font-bold leading-[1.35] text-field-muted">
          {shootingDate || "촬영일 미정"}
        </p>
      </div>
      {action}
    </div>
  );
}

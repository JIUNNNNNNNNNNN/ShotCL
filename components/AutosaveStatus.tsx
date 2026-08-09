"use client";

import type { AutosaveStatus as AutosaveStatusValue } from "@/lib/client/latestAutosaveQueue";

type AutosaveStatusProps = {
  status: AutosaveStatusValue;
  onRetry?: () => void;
  className?: string;
};

const statusLabels: Record<AutosaveStatusValue, string> = {
  idle: "",
  dirty: "저장 대기",
  saving: "저장 중…",
  saved: "저장됨",
  error: "저장 실패"
};

/** 입력과 레이아웃을 막지 않는 작은 자동저장 상태 표시입니다. */
export function AutosaveStatus({ status, onRetry, className = "" }: AutosaveStatusProps) {
  return (
    <span
      className={`inline-flex min-h-7 w-[7.75rem] shrink-0 items-center justify-end gap-2 text-xs font-semibold ${
        status === "error" ? "text-field-danger" : "text-field-subtle"
      } ${status === "idle" ? "invisible" : ""} ${className}`}
      role={status === "idle" ? undefined : "status"}
      aria-live={status === "idle" ? undefined : "polite"}
      aria-hidden={status === "idle" ? true : undefined}
    >
      {statusLabels[status] || "저장 상태"}
      {status === "error" && onRetry ? (
        <button
          type="button"
          className="min-h-7 rounded-md border border-field-danger/70 px-2 py-1 text-xs text-field-danger"
          onClick={onRetry}
        >
          다시 시도
        </button>
      ) : null}
    </span>
  );
}

"use client";

import { useId } from "react";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import type { ProjectAccountPermissionNotice as PermissionNotice } from "@/lib/projectAccess/accountPresentation";

export function ProjectAccountPermissionNotice({
  notice,
  disabled = false,
  onGoogleLogin,
  onDismiss
}: {
  notice: PermissionNotice;
  disabled?: boolean;
  onGoogleLogin?: () => void;
  onDismiss?: () => void;
}) {
  const titleId = useId();
  const Icon = notice.kind === "google-required" ? KeyRound : ShieldCheck;

  return (
    <section
      role="status"
      aria-labelledby={titleId}
      data-project-account-notice={notice.kind}
      className="rounded-[var(--radius-card)] border border-field-divider bg-field-panel px-4 py-3 shadow-card sm:px-5 sm:py-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--ui-radius-control)] border border-field-divider bg-field-input text-field-primary"
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={titleId}
            className="text-sm font-black leading-5 text-field-text"
          >
            {notice.title}
          </h2>
          <p className="mt-1 text-xs leading-5 text-field-muted">
            {notice.description}
          </p>
        </div>
      </div>

      {notice.actionLabel && onGoogleLogin ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-0 sm:pl-12">
          <button
            type="button"
            disabled={disabled}
            onClick={onGoogleLogin}
            className="neon-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--ui-radius-control)] border px-4 text-xs font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:cursor-wait disabled:opacity-55"
          >
            {notice.actionLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--ui-radius-control)] px-3 text-xs font-bold text-field-muted hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
            >
              나중에
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function ProjectAccountAuthErrorNotice({
  onRetry
}: {
  onRetry: () => void;
}) {
  const titleId = useId();
  return (
    <section
      role="alert"
      aria-labelledby={titleId}
      data-project-account-notice="auth-error"
      className="rounded-[var(--radius-card)] border border-field-danger/60 bg-field-panel px-4 py-3 shadow-card sm:px-5 sm:py-4"
    >
      <h2 id={titleId} className="text-sm font-black leading-5 text-field-text">
        Google 로그인에 실패했습니다.
      </h2>
      <p className="mt-1 text-xs leading-5 text-field-danger">다시 시도해 주세요.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-[var(--ui-radius-control)] border border-field-divider bg-field-input px-4 text-xs font-black text-field-text hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
      >
        Google 로그인 다시 시도
      </button>
    </section>
  );
}

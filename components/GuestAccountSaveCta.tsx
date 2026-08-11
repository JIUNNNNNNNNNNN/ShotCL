"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";
import { useAuthSession } from "@/components/AuthSessionProvider";

/** 링크 게스트가 현재 프로젝트를 자신의 Google 계정에 연결하는 축소 CTA입니다. */
export function GuestAccountSaveCta({ nextPath }: { nextPath: string }) {
  const { startGoogleOAuth, status } = useAuthSession();
  const [errorMessage, setErrorMessage] = useState("");
  const pending = status === "loading" || status === "syncing";

  return (
    <div className="mt-auto border-t border-field-divider pt-3">
      <button
        type="button"
        disabled={pending || status === "unavailable"}
        onClick={() => {
          setErrorMessage("");
          void startGoogleOAuth(nextPath).catch((error) => {
            setErrorMessage(error instanceof Error ? error.message : "Google 로그인을 시작하지 못했습니다.");
          });
        }}
        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-field-divider bg-field-input px-3 py-2 text-xs font-black text-field-text transition hover:border-field-primary/70 hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:cursor-not-allowed disabled:opacity-55"
      >
        <LogIn className="h-4 w-4" aria-hidden />
        {pending ? "Google 연결 중…" : "Google 계정으로 저장"}
      </button>
      <p className="mt-1.5 text-center text-[10px] leading-4 text-field-muted">
        계정에 저장하면 다음에도 이 프로젝트를 찾을 수 있습니다.
      </p>
      {errorMessage ? (
        <p role="alert" className="mt-1 text-center text-[10px] font-bold leading-4 text-field-danger">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

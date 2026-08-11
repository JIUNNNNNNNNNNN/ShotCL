"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LogOut, ShieldCheck } from "lucide-react";
import { useAuthSession } from "@/components/AuthSessionProvider";
import { InlineLoader } from "@/components/PixelDogLoader";
import { PageHeader } from "@/components/PageHeader";
import { getSafeInternalPath } from "@/lib/auth/client";
import { hasSupabaseEnv } from "@/lib/supabase/client";

/** Google 계정 한 가지 흐름만 제공하는 compact 로그인 화면입니다. */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    email,
    errorMessage: sessionError,
    isEditorEligible,
    isGoogle,
    signOut,
    startGoogleOAuth,
    status
  } = useAuthSession();
  const [actionError, setActionError] = useState("");
  const nextPath = getSafeInternalPath(searchParams.get("next"));
  const isBusy = status === "loading" || status === "syncing";

  async function handleGoogleLogin() {
    setActionError("");
    try {
      await startGoogleOAuth(nextPath);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Google 로그인을 시작하지 못했습니다.");
    }
  }

  async function handleLogout() {
    setActionError("");
    try {
      await signOut();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "로그아웃하지 못했습니다.");
    }
  }

  if (!hasSupabaseEnv() || status === "unavailable") {
    return (
      <>
        <PageHeader
          title="Google 계정"
          description="현재 환경에서는 계정 로그인을 사용할 수 없습니다."
        />
        <div className="mx-auto max-w-md rounded-[var(--radius-card)] border border-field-border bg-field-panel p-5 text-sm leading-6 text-field-muted shadow-card">
          Supabase URL과 anon key를 연결한 뒤 Google 로그인을 사용할 수 있습니다.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Google 계정" description="ShotCL 계정 상태를 확인합니다." />
      <section className="mx-auto grid w-full max-w-md gap-4 rounded-[var(--radius-card)] border border-field-divider bg-field-panel p-5 shadow-card">
        {isBusy ? (
          <div className="flex min-h-28 items-center justify-center" aria-label="계정 확인 중">
            <InlineLoader />
          </div>
        ) : status === "error" ? (
          <div className="py-4 text-center">
            <p className="text-sm font-black text-field-text">Google 계정 상태를 확인하지 못했습니다.</p>
            <p className="mt-1 text-xs leading-5 text-field-muted">잠시 후 다시 로그인해 주세요.</p>
          </div>
        ) : isGoogle && status === "authenticated" ? (
          <>
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] border border-field-primary/55 bg-field-primary/10 text-sm font-black text-field-primary" aria-hidden>
                G
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-field-text">{email || "Google 계정"}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-field-muted">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  {isEditorEligible
                    ? "프로젝트 생성·수정 가능"
                    : "Google 로그인 완료 · 수정 권한 없음"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push(nextPath)}
              className="neon-primary flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border px-4 text-sm font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
            >
              계속하기
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-field-divider bg-field-input px-4 text-sm font-bold text-field-text hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              로그아웃
            </button>
          </>
        ) : (
          <>
            <div className="text-center">
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-[var(--radius-control)] border border-field-divider bg-field-input text-base font-black text-field-text" aria-hidden>
                G
              </span>
              <p className="mt-3 text-sm font-black text-field-text">Google 계정으로 시작</p>
              <p className="mt-1 text-xs leading-5 text-field-muted">
                프로젝트 참여 내역을 계정에 안전하게 연결합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleGoogleLogin()}
              className="neon-primary min-h-11 w-full rounded-[var(--radius-control)] border px-4 text-sm font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
            >
              Google로 로그인
            </button>
          </>
        )}

        {actionError || sessionError ? (
          <p role="alert" className="text-center text-xs font-bold leading-5 text-field-danger">
            {actionError || sessionError}
          </p>
        ) : null}
      </section>
    </>
  );
}

function LoginFallback() {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <InlineLoader />
    </div>
  );
}

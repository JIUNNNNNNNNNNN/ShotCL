"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useAuthSession } from "@/components/AuthSessionProvider";
import { InlineLoader } from "@/components/PixelDogLoader";
import { getSafeInternalPath } from "@/lib/auth/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const GOOGLE_LOGIN_ERROR_MESSAGE = "Google 로그인에 실패했습니다. 다시 시도해 주세요.";

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackStatus />}>
      <AuthCallbackContent />
    </Suspense>
  );
}

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshAccount } = useAuthSession();
  const completionRef = useRef<Promise<string> | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const nextPath = getSafeInternalPath(searchParams.get("next"));

  useEffect(() => {
    let cancelled = false;

    if (!completionRef.current) {
      completionRef.current = finishGoogleLogin(searchParams, nextPath, refreshAccount);
    }
    void completionRef.current.then((destination) => {
      if (cancelled) return;
      router.replace(destination);
    }).catch((error) => {
      if (!cancelled) {
        setErrorMessage(
          error instanceof PublicAuthError ? error.message : GOOGLE_LOGIN_ERROR_MESSAGE
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [nextPath, refreshAccount, router, searchParams]);

  if (errorMessage) {
    return (
      <section className="mx-auto flex min-h-[70dvh] w-full max-w-md items-center justify-center px-4">
        <div className="w-full rounded-[var(--radius-card)] border border-field-danger/60 bg-field-panel p-5 text-center shadow-card">
          <h1 className="text-lg font-black text-field-text">Google 로그인에 실패했습니다.</h1>
          <p role="alert" className="mt-2 text-sm leading-6 text-field-danger">{errorMessage}</p>
          <Link
            href={nextPath}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-control)] border border-field-primary/60 bg-field-primary/10 px-4 text-sm font-bold text-field-primary hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
          >
            이전 화면으로 돌아가기
          </Link>
        </div>
      </section>
    );
  }
  return <CallbackStatus />;
}

async function finishGoogleLogin(
  searchParams: { get: (name: string) => string | null },
  nextPath: string,
  refreshAccount: (nextPath?: string) => Promise<{ destination: string | null } | null>
) {
  const providerError = searchParams.get("error_description") || searchParams.get("error");
  if (providerError) throw new PublicAuthError(GOOGLE_LOGIN_ERROR_MESSAGE);
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new PublicAuthError("Google 로그인을 사용할 수 없습니다.");

  const code = searchParams.get("code")?.trim();
  let session: Session | null = null;
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    session = data.session;
  } else {
    session = await waitForRedirectSession(supabase);
  }
  if (!session) throw new PublicAuthError(GOOGLE_LOGIN_ERROR_MESSAGE);

  const account = await refreshAccount(nextPath);
  return getSafeInternalPath(account?.destination, nextPath);
}

class PublicAuthError extends Error {}

function CallbackStatus() {
  return (
    <section className="flex min-h-[70dvh] items-center justify-center" aria-label="Google 로그인 연결 중">
      <div className="grid justify-items-center gap-3 text-sm font-bold text-field-muted">
        <InlineLoader />
        계정을 연결하는 중입니다.
      </div>
    </section>
  );
}

async function waitForRedirectSession(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session) return data.session;

  return new Promise<Session | null>((resolve) => {
    let settled = false;
    let timeoutId = 0;
    let subscription: { unsubscribe: () => void } | null = null;
    const finish = (session: Session | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      subscription?.unsubscribe();
      resolve(session);
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish(session);
    });
    subscription = listener.subscription;
    if (settled) subscription.unsubscribe();
    else timeoutId = window.setTimeout(() => finish(null), 6000);
  });
}

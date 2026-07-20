"use client";

import { FormEvent, useEffect, useState } from "react";
import { LogIn, LogOut, Mail } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { getSupabaseBrowserClient, hasSupabaseEnv } from "@/lib/supabase/client";

const fieldClass =
  "min-h-12 w-full rounded-md border border-field-border bg-white px-3 py-3 text-base text-field-text outline-none focus:border-field-primary";

/** Supabase Auth 이메일 매직링크 로그인 화면입니다. */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => {
      setCurrentEmail(data.user?.email ?? null);
    });
  }, []);

  /** 입력한 이메일로 Supabase 매직링크를 보냅니다. */
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setErrorMessage("Supabase 환경변수가 없어 개발 모드로 실행 중입니다.");
      return;
    }

    setIsBusy(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin
        }
      });

      if (error) throw error;
      setMessage("이메일로 로그인 링크를 보냈습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "로그인 링크를 보내지 못했습니다.");
    } finally {
      setIsBusy(false);
    }
  }

  /** 현재 Supabase 세션을 로그아웃합니다. */
  async function handleLogout() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setIsBusy(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setCurrentEmail(null);
      setMessage("로그아웃했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "로그아웃하지 못했습니다.");
    } finally {
      setIsBusy(false);
    }
  }

  if (!hasSupabaseEnv()) {
    return (
      <>
        <PageHeader title="로그인" description="현재는 Supabase 환경변수가 없어 개발 모드로 실행 중입니다." />
        <div className="rounded-md border border-field-border bg-white p-5 text-field-muted">
          `.env.local`에 Supabase URL과 anon key를 넣으면 이메일 로그인을 사용할 수 있습니다.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="로그인" description="Supabase 이메일 매직링크로 접속합니다." />

      {message ? <div className="mb-4 rounded-md border border-field-primary bg-field-light p-4 text-sm font-bold text-field-primary">{message}</div> : null}
      {errorMessage ? <div className="mb-4 rounded-md border border-field-danger bg-white p-4 text-sm font-bold text-field-danger">{errorMessage}</div> : null}

      {currentEmail ? (
        <section className="rounded-md border border-field-border bg-white p-4">
          <p className="text-sm font-bold text-field-muted">현재 로그인</p>
          <p className="mt-2 break-words text-lg font-black">{currentEmail}</p>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isBusy}
            className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-field-border bg-white px-4 font-black text-field-primary disabled:opacity-50"
          >
            <LogOut className="h-5 w-5" aria-hidden />
            로그아웃
          </button>
        </section>
      ) : (
        <form onSubmit={handleLogin} className="grid gap-4 rounded-md border border-field-border bg-field-soft p-4">
          <label className="grid gap-2">
            <span className="text-sm font-bold text-field-muted">이메일</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="crew@example.com"
              className={fieldClass}
            />
          </label>

          <button
            type="submit"
            disabled={isBusy || !email.trim()}
            className="flex min-h-12 items-center justify-center gap-2 rounded-md bg-field-primary px-4 font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? <Mail className="h-5 w-5" aria-hidden /> : <LogIn className="h-5 w-5" aria-hidden />}
            {isBusy ? "전송 중" : "로그인 링크 받기"}
          </button>
        </form>
      )}
    </>
  );
}

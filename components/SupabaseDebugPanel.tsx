"use client";

import { useState } from "react";
import { Bug, Database } from "lucide-react";
import { ensureSupabaseDevSession, getSupabaseBrowserClient, getSupabaseEnvStatus } from "@/lib/supabase/client";

type CheckResult = {
  label: string;
  ok: boolean;
  detail: string;
};

/** 개발 중에만 Supabase 연결, 인증 세션, select, insert 실패 원인을 화면에서 확인합니다. */
export function SupabaseDebugPanel() {
  const [isChecking, setIsChecking] = useState(false);
  const [results, setResults] = useState<CheckResult[]>([]);

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  async function runChecks() {
    setIsChecking(true);
    const env = getSupabaseEnvStatus();
    const nextResults: CheckResult[] = [
      {
        label: "Supabase URL",
        ok: env.hasUrl,
        detail: env.hasUrl ? "설정됨" : "NEXT_PUBLIC_SUPABASE_URL이 비어 있습니다."
      },
      {
        label: "Supabase anon key",
        ok: env.hasAnonKey,
        detail: env.hasAnonKey ? "설정됨" : "NEXT_PUBLIC_SUPABASE_ANON_KEY가 비어 있습니다."
      },
      {
        label: "데이터 모드",
        ok: true,
        detail: env.forceLocalData
          ? "localStorage 강제 사용 중"
          : env.canUseSupabase
            ? env.enableDevAnonAuth
              ? "Supabase + 개발용 익명 인증"
              : "Supabase 사용 중"
            : "localStorage 개발 모드"
      }
    ];

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setResults(nextResults);
      setIsChecking(false);
      return;
    }

    try {
      await ensureSupabaseDevSession();
      nextResults.push({
        label: "auth session",
        ok: true,
        detail: env.enableDevAnonAuth ? "익명 인증 세션 준비 완료" : "개발용 익명 인증을 사용하지 않습니다."
      });
    } catch (error) {
      nextResults.push({
        label: "auth session",
        ok: false,
        detail: error instanceof Error ? error.message : "익명 인증 세션 준비 실패"
      });
      setResults(nextResults);
      setIsChecking(false);
      return;
    }

    const selectResult = await supabase.from("projects").select("id,name,created_at").order("created_at", { ascending: false }).limit(1);
    nextResults.push({
      label: "projects select",
      ok: !selectResult.error,
      detail: selectResult.error
        ? formatSupabaseDebugError(selectResult.error)
        : `성공: ${selectResult.data?.length ?? 0}개 행 확인`
    });

    const today = new Date().toISOString().slice(0, 10);
    const insertResult = await supabase
      .from("projects")
      .insert({
        name: "[debug] 프로젝트 생성 테스트",
        shoot_date: today,
        description: "Supabase insert 점검용으로 생성되었습니다."
      })
      .select("id")
      .single();

    nextResults.push({
      label: "projects insert",
      ok: !insertResult.error,
      detail: insertResult.error ? formatSupabaseDebugError(insertResult.error) : `성공: ${insertResult.data.id}`
    });

    setResults(nextResults);
    setIsChecking(false);
  }

  return (
    <section className="mt-5 rounded-md border border-field-border bg-field-soft p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-field-light text-field-primary">
          <Bug className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-black text-field-primary">개발용 Supabase 점검</h2>
          <p className="mt-1 text-sm leading-5 text-field-muted">
            키 값은 표시하지 않고, 설정 여부와 projects select/insert 결과만 확인합니다.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={runChecks}
        disabled={isChecking}
        className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-field-primary px-4 text-sm font-black text-white disabled:opacity-60"
      >
        <Database className="h-5 w-5" aria-hidden />
        {isChecking ? "점검 중" : "연결 점검"}
      </button>

      {results.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {results.map((result) => (
            <div key={result.label} className="rounded-md border border-field-border bg-white p-3">
              <p className="text-sm font-black text-field-text">
                {result.ok ? "OK" : "FAIL"} · {result.label}
              </p>
              <p className="mt-1 break-words text-sm leading-5 text-field-muted">{result.detail}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** Supabase의 code/details/hint를 콘솔 대신 화면에 표시할 수 있게 정리합니다. */
function formatSupabaseDebugError(error: { message?: string; code?: string; details?: string; hint?: string }) {
  return [
    error.message,
    error.code ? `code: ${error.code}` : "",
    error.details ? `details: ${error.details}` : "",
    error.hint ? `hint: ${error.hint}` : ""
  ]
    .filter(Boolean)
    .join(" / ");
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, LogIn, Plus } from "lucide-react";
import { hasSupabaseEnv } from "@/lib/supabase/client";

type AppShellProps = {
  children: React.ReactNode;
};

/** 모든 페이지가 공유하는 반응형 웹앱 프레임입니다. */
export function AppShell({ children }: AppShellProps) {
  const modeLabel = hasSupabaseEnv() ? "Supabase" : "DEV";

  return (
    <div className="min-h-screen bg-field-soft text-field-text">
      <header className="safe-top sticky top-0 z-40 border-b border-field-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 pb-3 md:px-8 lg:px-12">
          <Link href="/" className="flex min-w-0 items-center gap-3" title="프로젝트 목록">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-field-border bg-field-light">
              <Clapperboard className="h-6 w-6 text-field-primary" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-lg font-black tracking-normal text-field-primary">오늘의 보드</span>
              <span className="block text-xs font-bold text-field-muted">{modeLabel}</span>
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            {hasSupabaseEnv() ? (
              <Link
                href="/login"
                className="flex h-11 w-11 items-center justify-center rounded-md border border-field-border bg-white text-field-primary"
                title="로그인"
              >
                <LogIn className="h-5 w-5" aria-hidden />
                <span className="sr-only">로그인</span>
              </Link>
            ) : null}

            <Link
              href="/projects/new"
              className="flex h-11 items-center gap-2 rounded-md bg-field-primary px-3 text-sm font-black text-white"
              title="새 프로젝트 만들기"
            >
              <Plus className="h-5 w-5" aria-hidden />
              <span className="hidden min-[360px]:inline">새 프로젝트</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="safe-bottom mx-auto w-full max-w-6xl px-4 py-6 md:px-8 lg:px-12">{children}</main>
      <DevRuntimeInfo />
    </div>
  );
}

/** 개발 중 사용자가 실제로 연 주소를 헷갈리지 않도록 화면 아래에 표시합니다. */
function DevRuntimeInfo() {
  const pathname = usePathname();
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <footer className="mx-auto w-full max-w-6xl px-4 pb-24 md:px-8 md:pb-6 lg:px-12">
      <div className="rounded-md border border-field-border bg-white/90 p-3 text-xs font-bold leading-5 text-field-muted shadow-sm">
        <p>현재 접속 주소: {origin || "확인 중"}</p>
        <p>현재 페이지: {pathname || "/"}</p>
      </div>
    </footer>
  );
}

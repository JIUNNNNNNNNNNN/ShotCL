"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { HomeButton } from "@/components/HomeButton";
import { isDemoStorageMode } from "@/lib/runtimeMode";

type AppShellProps = {
  children: React.ReactNode;
};

/** 모든 페이지가 공유하는 반응형 웹앱 프레임입니다. */
export function AppShell({ children }: AppShellProps) {
  const demoStorageMode = isDemoStorageMode();
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isProjectDashboard = /^\/projects\/[^/]+$/.test(pathname);

  return (
    <div className="min-h-screen bg-field-bg text-field-text">
      <HomeButton />
      <main className={
        isHome
          ? "min-h-screen w-full"
          : isProjectDashboard
            ? "safe-bottom mx-auto w-full max-w-5xl px-3 pb-6 pt-[max(4rem,calc(env(safe-area-inset-top)+3.25rem))] md:px-8 md:pb-8"
            : "safe-bottom mx-auto w-full max-w-6xl px-3 pb-4 pt-[max(4rem,calc(env(safe-area-inset-top)+3.25rem))] md:px-8 md:pb-6 lg:px-12"
      }>
        {demoStorageMode && !isHome ? <TestModeWarning compact={isProjectDashboard} /> : null}
        {children}
      </main>
      {!isHome ? <DevRuntimeInfo /> : null}
    </div>
  );
}

/** localStorage 테스트 흐름을 실사용 저장소로 오인하지 않도록 모든 화면에 표시합니다. */
function TestModeWarning({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <aside role="alert" className="mb-3 rounded-[1.25rem] border border-amber-400 bg-amber-50/80 px-3 py-2.5 text-amber-950">
        <details>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-black marker:content-none">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
            테스트 모드 · 이 브라우저에만 저장됩니다.
            <span className="ml-auto text-xs font-bold text-amber-800">안내 보기</span>
          </summary>
          <p className="mt-2 pl-6 text-xs font-bold leading-5 text-amber-900">
            Supabase Auth/RLS가 연결되지 않아 프로젝트는 다른 사람과 공유되지 않습니다. 실제 작품 정보, 배우 연락처, 촬영 장소, PDF·콘티 파일을 입력하지 마세요. 협업 공유 기능은 Supabase Auth/RLS 연결 후 사용할 수 있습니다.
          </p>
        </details>
      </aside>
    );
  }

  return (
    <aside
      role="alert"
      className="mb-3 rounded-[1.25rem] border border-amber-500 bg-amber-50 p-3 text-amber-950"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-black">현재 앱은 테스트 모드입니다.</p>
          <p className="mt-1 text-sm font-bold leading-6">
            Supabase Auth/RLS가 연결되지 않아 프로젝트는 다른 사람과 공유되지 않으며, 데이터는 이 브라우저에만 임시 저장될 수 있습니다.
            실제 작품 정보, 배우 연락처, 촬영 장소, PDF·콘티 파일을 입력하지 마세요. 협업 공유 기능은 Supabase Auth/RLS 연결 후 사용할 수 있습니다.
          </p>
        </div>
      </div>
    </aside>
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
      <div className="rounded-[1.25rem] border border-field-border bg-white/90 p-3 text-xs font-bold leading-5 text-field-muted">
        <p>현재 접속 주소: {origin || "확인 중"}</p>
        <p>현재 페이지: {pathname || "/"}</p>
      </div>
    </footer>
  );
}

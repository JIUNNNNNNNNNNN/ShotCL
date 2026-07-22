"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House } from "lucide-react";

/** 홈을 제외한 모든 주요 화면에서 동일하게 사용하는 원형 홈 버튼입니다. */
export function HomeButton() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <Link
      href="/"
      aria-label="메인 홈으로 이동"
      title="메인 홈"
      className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] flex h-10 w-10 items-center justify-center rounded-full border border-field-secondary bg-white/95 text-field-primary shadow-[0_3px_10px_rgba(28,28,26,0.08)] backdrop-blur-sm transition-[background-color,border-color,transform] hover:border-field-primary hover:bg-field-light active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2 md:left-5 md:h-11 md:w-11"
    >
      <House className="h-[18px] w-[18px] md:h-5 md:w-5" aria-hidden />
    </Link>
  );
}

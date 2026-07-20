import { cn } from "@/lib/utils";

/** 흰 바탕 현장 UI에서 쓰는 기본 카드 컨테이너입니다. */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-md border border-field-border bg-white p-4", className)}>{children}</section>;
}

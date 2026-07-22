import { cn } from "@/lib/utils";

/** 종이 문서의 얇은 구획처럼 보이는 기본 섹션 컨테이너입니다. */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("field-section p-3 md:p-4", className)}>{children}</section>;
}

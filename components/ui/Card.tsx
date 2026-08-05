import { cn } from "@/lib/utils";

/** 새 다크 surface 계층과 얇은 경계선을 쓰는 기본 카드 컨테이너입니다. */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("field-card min-w-0 p-3 md:p-4", className)}>{children}</section>;
}

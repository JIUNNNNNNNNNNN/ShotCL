import { cn } from "@/lib/utils";

/** 새 다크 surface 계층과 얇은 경계선을 쓰는 기본 카드 컨테이너입니다. */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "field-card ui-density-card ui-motion-surface min-w-0 text-center [&_input]:text-left [&_select]:text-left [&_textarea]:text-left",
        className
      )}
    >
      {children}
    </section>
  );
}

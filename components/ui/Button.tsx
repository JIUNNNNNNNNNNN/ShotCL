import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variantClass: Record<ButtonVariant, string> = {
  primary: "neon-primary font-semibold",
  secondary: "border-field-divider bg-field-input font-medium text-field-text hover:border-field-subtle hover:bg-field-hover",
  ghost: "border-transparent bg-transparent font-medium text-field-subtle hover:border-field-border hover:bg-field-hover hover:text-field-text",
  danger: "border-field-danger/70 bg-field-input font-semibold text-field-danger hover:border-field-danger hover:bg-field-danger/10"
};

type BaseProps = {
  variant?: ButtonVariant;
  className?: string;
  children: React.ReactNode;
};

/** 현장 문서 UI에 맞춘 낮은 높이와 명확한 위계를 쓰는 공통 버튼입니다. */
export function Button({ variant = "primary", className, children, ...props }: BaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "ui-density-control inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm leading-[1.35] transition-[background-color,border-color,color,transform] focus-visible:outline-none active:scale-[0.98] disabled:cursor-not-allowed disabled:border-field-border disabled:bg-field-section disabled:text-field-disabled disabled:opacity-100",
        variantClass[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** 링크도 버튼과 같은 모양으로 보이게 맞춥니다. */
export function ButtonLink({
  variant = "primary",
  className,
  children,
  href,
  ...props
}: BaseProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "ui-density-control inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm leading-[1.35] transition-[background-color,border-color,color,transform] focus-visible:outline-none active:scale-[0.98]",
        variantClass[variant],
        className
      )}
      {...props}
    >
      {children}
    </Link>
  );
}

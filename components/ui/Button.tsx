import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variantClass: Record<ButtonVariant, string> = {
  primary: "border-field-primary/70 bg-field-primary/10 font-black text-field-primary hover:border-field-secondary/80 hover:bg-field-primary/15 hover:text-field-secondary",
  secondary: "border-field-border bg-field-input text-field-text hover:border-field-divider hover:bg-field-hover",
  ghost: "border-field-border bg-field-input text-field-text hover:border-field-divider hover:bg-field-hover",
  danger: "border-field-danger/70 bg-field-input font-black text-field-danger hover:border-field-danger hover:bg-field-danger/10"
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
        "inline-flex min-h-10 items-center justify-center gap-1.5 border px-3 py-2 text-sm leading-[1.35] transition-[background-color,border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
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
        "inline-flex min-h-10 items-center justify-center gap-1.5 border px-3 py-2 text-sm leading-[1.35] transition-[background-color,border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary active:scale-[0.98]",
        variantClass[variant],
        className
      )}
      {...props}
    >
      {children}
    </Link>
  );
}

import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variantClass: Record<ButtonVariant, string> = {
  primary: "border-field-primary bg-field-primary text-white",
  secondary: "border-field-border bg-field-light text-field-primary",
  ghost: "border-field-border bg-white text-field-text",
  danger: "border-field-danger bg-white text-field-danger"
};

type BaseProps = {
  variant?: ButtonVariant;
  className?: string;
  children: React.ReactNode;
};

/** 모든 화면에서 같은 터치 영역과 색을 쓰는 공통 버튼입니다. */
export function Button({ variant = "primary", className, children, ...props }: BaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50",
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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-black transition",
        variantClass[variant],
        className
      )}
      {...props}
    >
      {children}
    </Link>
  );
}

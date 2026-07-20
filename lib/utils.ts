/** 조건부 Tailwind className을 읽기 쉽게 합칩니다. */
export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

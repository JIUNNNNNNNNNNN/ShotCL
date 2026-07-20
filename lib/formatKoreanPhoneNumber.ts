/** 숫자만 입력해도 국내 전화번호 구간에 맞춰 대시를 붙입니다. */
export function formatKoreanPhoneNumber(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";

  if (digits.startsWith("02")) {
    const local = digits.slice(2, 10);
    if (!local) return "02";
    if (local.length <= 4) return `02-${local}`;
    return `02-${local.slice(0, local.length - 4)}-${local.slice(-4)}`;
  }

  if (digits.length <= 3) return digits;
  const prefix = digits.slice(0, 3);
  const local = digits.slice(3);
  if (local.length <= 4) return `${prefix}-${local}`;

  return `${prefix}-${local.slice(0, local.length - 4)}-${local.slice(-4)}`;
}

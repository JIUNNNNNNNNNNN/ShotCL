/** 입력값에서 국내 전화번호 저장에 사용하는 숫자만 남깁니다. */
export function sanitizeKoreanPhoneDigits(value: string) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 11);
}

/** 빈 값 또는 지원하는 국내 휴대전화/지역번호 형식인지 확인합니다. */
export function isValidKoreanPhoneNumber(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return true;
  if (!/^0\d{8,10}$/.test(digits)) return false;

  if (digits.startsWith("02")) {
    return digits.length === 9 || digits.length === 10;
  }
  if (digits.startsWith("010")) {
    return digits.length === 11;
  }
  if (/^01[1-9]/.test(digits)) {
    return digits.length === 10 || digits.length === 11;
  }
  if (/^0[3-6]\d/.test(digits)) {
    return digits.length === 10 || digits.length === 11;
  }
  if (digits.startsWith("070")) {
    return digits.length === 11;
  }
  if (digits.startsWith("080")) {
    return digits.length === 10 || digits.length === 11;
  }

  return false;
}

/** 숫자만 입력해도 국내 전화번호 구간에 맞춰 대시를 붙입니다. */
export function formatKoreanPhoneNumber(value: string) {
  const digits = sanitizeKoreanPhoneDigits(value);
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

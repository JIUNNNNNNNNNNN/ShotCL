const SCENE_NUMBER_PATTERN =
  /^\s*(?:S\s*#?\s*|SCENE\s*#?\s*|씬\s*#?\s*|#\s*)?0*(\d{1,4})(?:\s*-\s*(\d{1,4}))?(?!\s*-\s*[\p{L}\p{N}])(?=\s|[.():\-–—)\]}]|$)/iu;

/** 다양한 씬 번호 표기를 숫자 또는 숫자-숫자 문자열로 통일합니다. */
export function normalizeSceneNumber(value: unknown): string {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/(\d)\s*-\s*(?=\d)/g, "$1-")
    .trim();
  if (!text || isDateOrTimeLine(text)) return "";
  const match = text.match(SCENE_NUMBER_PATTERN);
  if (!match) return "";
  const major = match[1].replace(/^0+(?=\d)/, "");
  // 기존 숫자 씬의 leading zero 정책은 유지하되, 새 하위 번호는 문자열
  // identity 그대로 둬서 1-1과 1-01을 임의로 합치지 않습니다.
  return match[2] ? `${major}-${match[2]}` : major;
}

export function isDateOrTimeLine(value: string) {
  const text = value.trim();
  // 숫자-숫자 한 구간은 유효한 Scene identity입니다. 본문 오인은 이 helper가
  // 아니라 명시적 heading prefix를 요구하는 scenario marker parser가 막습니다.
  return /^\d{4}\s*[-./]\s*\d{1,2}(?:\s*[-./]\s*\d{1,2})?/.test(text)
    || /^\d{1,2}\s*:\s*\d{2}(?::\d{2})?/.test(text)
    || /^\d{1,4}\s*\.\s*\d+$/.test(text);
}

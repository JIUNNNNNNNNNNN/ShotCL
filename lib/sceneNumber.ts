const SCENE_NUMBER_PATTERN =
  /^\s*(?:S\s*#?\s*|SCENE\s*#?\s*|씬\s*#?\s*|#\s*)?0*(\d{1,4})(?=\s|[.():-]|$)/i;

/** 다양한 씬 번호 표기를 숫자 문자열 하나로 통일합니다. */
export function normalizeSceneNumber(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || isDateOrTimeLine(text)) return "";
  const match = text.match(SCENE_NUMBER_PATTERN);
  if (!match) return "";
  const number = Number.parseInt(match[1], 10);
  return Number.isFinite(number) ? String(number) : "";
}

export function isDateOrTimeLine(value: string) {
  const text = value.trim();
  return /^\d{4}\s*[-./]\s*\d{1,2}(?:\s*[-./]\s*\d{1,2})?/.test(text)
    || /^\d{1,2}\s*:\s*\d{2}(?::\d{2})?/.test(text)
    || /^\d{1,4}\s*(?:-\s*\d{1,4}|\.\d+)$/.test(text);
}

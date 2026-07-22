const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** DB 조회에는 Supabase projects.id와 같은 raw UUID를 사용합니다. */
export function normalizeProjectId(input: string) {
  const value = String(input ?? "").trim();
  const legacyMatch = value.match(/^project_([0-9a-f-]{36})$/i);
  if (legacyMatch && UUID_PATTERN.test(legacyMatch[1])) return legacyMatch[1];
  return value;
}

export function isValidDatabaseProjectId(input: string) {
  return UUID_PATTERN.test(normalizeProjectId(input));
}

/** localStorage에는 예전 project_<uuid> ID도 남아 있을 수 있어 두 형태를 모두 확인합니다. */
export function getLocalProjectIdCandidates(input: string) {
  const original = String(input ?? "").trim();
  const normalized = normalizeProjectId(original);
  return [...new Set([original, normalized, UUID_PATTERN.test(normalized) ? `project_${normalized}` : ""].filter(Boolean))];
}

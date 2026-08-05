export type PreviewDisplayField = {
  key: string;
  label: string;
  span: number;
  value: unknown;
};

const previewPresenceWhitespacePattern = /[\s\u00a0\u200b-\u200d\u2060\ufeff]/g;

/** 표시 문자열은 바꾸지 않고, 빈 행 판정에서만 공백·NBSP·zero-width 문자를 제거합니다. */
export function normalizePreviewCellValueForPresence(value: string): string {
  return value.replace(previewPresenceWhitespacePattern, "");
}

/** 행에 실제로 출력할 수 있는 값이 하나라도 있는지 공통 기준으로 판정합니다. */
export function hasMeaningfulRowValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return normalizePreviewCellValueForPresence(value).length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulRowValue);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasMeaningfulRowValue);
  }
  return true;
}

/** 값이 하나라도 있는 반복 행만 남깁니다. 숫자 0과 false는 유효한 값으로 유지합니다. */
export function filterRenderablePreviewRows<T>(
  rows: readonly T[],
  getDisplayValue: (row: T) => unknown
): T[] {
  return rows.filter((row) => hasMeaningfulRowValue(getDisplayValue(row)));
}

/** 고정 cell에 넣을 값을 안전하게 문자열로 바꿉니다. null/undefined는 빈칸으로 유지합니다. */
export function getPreviewCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

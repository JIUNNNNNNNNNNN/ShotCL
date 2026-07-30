export type PreviewDisplayField = {
  key: string;
  label: string;
  span: number;
  value: unknown;
};

export type PreviewDisplayCell = PreviewDisplayField & {
  span: number;
};

/** 미리보기에서 실제로 읽을 수 있는 값이 있는지 공통 기준으로 판정합니다. */
export function hasDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasDisplayValue);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasDisplayValue);
  }
  return true;
}

/** 값이 하나라도 있는 행만 남깁니다. 숫자 0과 false는 유효한 값으로 유지합니다. */
export function compactPreviewRows<T>(
  rows: readonly T[],
  getDisplayValue: (row: T) => unknown
): T[] {
  return rows.filter((row) => hasDisplayValue(getDisplayValue(row)));
}

/** 전체 표에서 한 번도 사용되지 않는 optional 열을 제거합니다. */
export function compactPreviewFields<T extends PreviewDisplayField>(
  fields: readonly T[]
): T[] {
  return fields.filter((field) => hasDisplayValue(field.value));
}

export function getPreviewColumnCount(fields: readonly Pick<PreviewDisplayField, "span">[]) {
  return fields.reduce((total, field) => total + normalizeSpan(field.span), 0);
}

/**
 * 한 행에서 비어 있는 cell은 렌더링하지 않고 그 폭을 인접한 유효 cell에 합칩니다.
 * 반환 cell의 span 합은 입력 field의 span 합과 항상 같습니다.
 */
export function compactPreviewRowCells(
  fields: readonly PreviewDisplayField[]
): PreviewDisplayCell[] {
  const cells: PreviewDisplayCell[] = [];
  let pendingSpan = 0;

  fields.forEach((field) => {
    const span = normalizeSpan(field.span);
    if (!hasDisplayValue(field.value)) {
      pendingSpan += span;
      return;
    }
    cells.push({ ...field, span: span + pendingSpan });
    pendingSpan = 0;
  });

  if (pendingSpan > 0 && cells.length > 0) {
    const lastIndex = cells.length - 1;
    cells[lastIndex] = {
      ...cells[lastIndex],
      span: cells[lastIndex].span + pendingSpan
    };
  }

  return cells;
}

function normalizeSpan(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 1;
}

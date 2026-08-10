export function normalizeAllocatedCutNumbers(value: unknown, totalCuts: unknown): number[] {
  const total = normalizeTotalCuts(totalCuts);
  if (total == null || !Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => typeof item === "number" ? item : Number(String(item).trim()))
      .filter((item) => Number.isInteger(item) && item >= 1 && item <= total)
  )).sort((left, right) => left - right);
}

export function getAllCutNumbers(totalCuts: unknown): number[] {
  const total = normalizeTotalCuts(totalCuts);
  return total == null ? [] : Array.from({ length: total }, (_, index) => index + 1);
}

export function resolveAllocatedCutNumbers(selection: number[] | null, totalCuts: unknown): number[] {
  return selection === null
    ? getAllCutNumbers(totalCuts)
    : normalizeAllocatedCutNumbers(selection, totalCuts);
}

export function getRemainingCutNumbers(totalCuts: unknown, assignedCutNumbers: Iterable<number>): number[] {
  const assigned = new Set(assignedCutNumbers);
  return getAllCutNumbers(totalCuts).filter((cutNumber) => !assigned.has(cutNumber));
}

export function formatCutRanges(value: Iterable<number>): string {
  const numbers = Array.from(new Set(value))
    .filter((item) => Number.isInteger(item) && item > 0)
    .sort((left, right) => left - right);
  if (numbers.length === 0) return "";

  const ranges: string[] = [];
  let start = numbers[0];
  let end = start;
  for (let index = 1; index <= numbers.length; index += 1) {
    const next = numbers[index];
    if (next === end + 1) {
      end = next;
      continue;
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    start = next;
    end = next;
  }
  return ranges.join(", ");
}

export function formatCutAllocationLabel(value: Iterable<number>, emptyLabel = "컷 미지정") {
  const numbers = Array.from(new Set(value))
    .filter((item) => Number.isInteger(item) && item > 0)
    .sort((left, right) => left - right);
  const ranges = formatCutRanges(numbers);
  return ranges ? `C${ranges} · ${numbers.length}컷` : emptyLabel;
}

/**
 * TIME TABLE의 좁은 Cut 셀에 표시할 한 줄 요약입니다.
 *
 * `null`은 일반 촬영(전체 컷), 배열은 사용자가 명시적으로 켠 다회차 촬영을
 * 뜻합니다. 배열 길이로 모드를 추론하지 않아 전체 컷을 직접 선택한 N/N도
 * 다회차 상태로 유지합니다.
 */
export function formatTimetableCutDisplay(
  selectedCutNumbers: number[] | null,
  totalCuts: unknown
): string {
  const total = normalizeTotalCuts(totalCuts);
  if (total == null) return "";
  if (selectedCutNumbers === null) return String(total);
  return `${normalizeAllocatedCutNumbers(selectedCutNumbers, total).length}/${total}`;
}

function normalizeTotalCuts(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

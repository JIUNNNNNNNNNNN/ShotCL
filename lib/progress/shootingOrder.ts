import type { DailyPlanTimetableSceneMeta } from "@/lib/dailyPlan/printMeta";
import { getShootingOrderValidation } from "@/lib/dailyPlan/shootingOrder";

export type ProgressShootingOrderShot = {
  id?: unknown;
  sceneNumber: unknown;
  cutNumber: unknown;
};

/**
 * 현재 회차의 일촬표 행을 source of truth로 삼아 Progress 컷의 표시 순서만
 * 계산합니다. 반환 배열은 새 배열이지만 컷 객체 자체와 stable id는 그대로
 * 유지하며, metadata가 실제 컷 membership을 확장하지 않습니다.
 */
export function orderProgressShotsByShootingOrder<T extends ProgressShootingOrderShot>(
  shots: readonly T[],
  timetableScenes: readonly DailyPlanTimetableSceneMeta[]
): T[] {
  if (shots.length === 0) return [];

  const seenStableIds = new Set<string>();
  const indexedShots = shots.flatMap((shot, index) => {
    const stableId = normalizeStableId(shot.id);
    if (stableId && seenStableIds.has(stableId)) return [];
    if (stableId) seenStableIds.add(stableId);
    return [{
      shot,
      index,
      sceneNumber: normalizeProgressSceneKey(shot.sceneNumber),
      cutNumber: normalizeCutNumber(shot.cutNumber)
    }];
  });
  const shotsByScene = new Map<string, typeof indexedShots>();
  indexedShots.forEach((entry) => {
    if (!entry.sceneNumber) return;
    const sceneShots = shotsByScene.get(entry.sceneNumber) ?? [];
    sceneShots.push(entry);
    shotsByScene.set(entry.sceneNumber, sceneShots);
  });

  const consumedIndexes = new Set<number>();
  const ordered: T[] = [];

  timetableScenes.forEach((row) => {
    const sceneNumber = normalizeProgressSceneKey(
      row.rowSnapshot.sceneNumber || row.sourceSnapshot?.sceneNumber
    );
    if (!sceneNumber) return;

    const available = (shotsByScene.get(sceneNumber) ?? [])
      .filter((entry) => !consumedIndexes.has(entry.index));
    if (available.length === 0) return;

    const totalCuts = Object.prototype.hasOwnProperty.call(row, "totalCutsOverride")
      ? row.totalCutsOverride ?? 0
      : row.rowSnapshot.totalCuts ?? row.sourceSnapshot?.totalCuts ?? 0;
    const isSplitRow = Object.prototype.hasOwnProperty.call(row, "selectedCutNumbers");
    const selectedCuts = isSplitRow
      ? new Set(normalizeSelectedCutNumbers(row.selectedCutNumbers, totalCuts))
      : null;
    const relevant = selectedCuts === null
      ? available
      : available.filter((entry) => entry.cutNumber !== null && selectedCuts.has(entry.cutNumber));
    if (relevant.length === 0) return;

    const validation = getShootingOrderValidation(
      row.rowSnapshot.shootingOrder,
      totalCuts,
      selectedCuts === null ? null : [...selectedCuts]
    );
    // Legacy rows can predate today's validation. Reuse the canonical parser's
    // safe numeric tokens even when it reports a duplicate/range/allocation
    // error; the actual row membership intersection below prevents expansion,
    // and stable consumption prevents duplicate cards. Invalid characters
    // already yield no canonical tokens and therefore use the natural fallback.
    const explicitOrder = validation.numbers;
    appendOrderedRowShots(ordered, consumedIndexes, relevant, explicitOrder);
  });

  // Metadata가 없거나 연결되지 않는 legacy 씬도 기존 씬 그룹의 첫 등장 순서는
  // 유지하면서 숫자 Cut은 canonical natural fallback을 사용합니다. 씬/컷 번호를
  // 해석할 수 없는 수동 항목은 같은 그룹 뒤에서 기존 상대 순서를 유지합니다.
  const unmatchedGroups = new Map<string, typeof indexedShots>();
  indexedShots.forEach((entry) => {
    if (consumedIndexes.has(entry.index)) return;
    const groupKey = getFallbackSceneGroupKey(entry.shot.sceneNumber, entry.sceneNumber, entry.index);
    const group = unmatchedGroups.get(groupKey) ?? [];
    group.push(entry);
    unmatchedGroups.set(groupKey, group);
  });
  unmatchedGroups.forEach((entries) => {
    appendOrderedRowShots(ordered, consumedIndexes, entries, []);
  });

  return ordered;
}

function appendOrderedRowShots<T extends ProgressShootingOrderShot>(
  ordered: T[],
  consumedIndexes: Set<number>,
  entries: Array<{ shot: T; index: number; cutNumber: number | null }>,
  explicitOrder: readonly number[]
) {
  const entriesByCut = new Map<number, typeof entries>();
  entries.forEach((entry) => {
    if (entry.cutNumber === null) return;
    const sameCut = entriesByCut.get(entry.cutNumber) ?? [];
    sameCut.push(entry);
    entriesByCut.set(entry.cutNumber, sameCut);
  });

  const usedCutNumbers = new Set<number>();
  explicitOrder.forEach((cutNumber) => {
    if (usedCutNumbers.has(cutNumber)) return;
    usedCutNumbers.add(cutNumber);
    appendEntries(ordered, consumedIndexes, entriesByCut.get(cutNumber) ?? []);
  });

  const remainingNumericCuts = [...entriesByCut.keys()]
    .filter((cutNumber) => !usedCutNumbers.has(cutNumber))
    .sort((left, right) => left - right);
  remainingNumericCuts.forEach((cutNumber) => {
    appendEntries(ordered, consumedIndexes, entriesByCut.get(cutNumber) ?? []);
  });

  // A row can contain legacy/manual non-numeric cuts. Keep those objects and
  // their existing row-relative order after the safely orderable numeric cuts.
  appendEntries(
    ordered,
    consumedIndexes,
    entries.filter((entry) => entry.cutNumber === null)
  );
}

function appendEntries<T extends ProgressShootingOrderShot>(
  ordered: T[],
  consumedIndexes: Set<number>,
  entries: Array<{ shot: T; index: number }>
) {
  entries.forEach((entry) => {
    if (consumedIndexes.has(entry.index)) return;
    consumedIndexes.add(entry.index);
    ordered.push(entry.shot);
  });
}

function normalizeSelectedCutNumbers(value: unknown, totalCuts: unknown) {
  if (!Array.isArray(value)) return [];
  const total = normalizeNonNegativeInteger(totalCuts);
  return Array.from(new Set(value.map(normalizeCutNumber).filter((cutNumber): cutNumber is number => (
    cutNumber !== null && (total === null || cutNumber <= total)
  )))).sort((left, right) => left - right);
}

function normalizeCutNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  return normalizePositiveInteger(text);
}

function normalizePositiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeNonNegativeInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeStableId(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function getFallbackSceneGroupKey(value: unknown, normalized: string, index: number) {
  if (normalized) return `scene:${normalized}`;
  const legacyLabel = String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
  return legacyLabel ? `legacy:${legacyLabel}` : `unscoped:${index}`;
}

// Match the Daily Plan shooting-order save boundary: preserve suffix-bearing
// scene identities such as `1A` while folding only presentation prefixes and
// spacing. The stable current-round scope stays `dailyPlanId`; this key is the
// compatibility join because Progress Shot does not carry timetable row IDs.
function normalizeProgressSceneKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "")
    .replace(/^(?:scene|씬|s)#?/iu, "")
    .replace(/^#+/u, "")
    .replace(/^0+(?=\d)/u, "");
}

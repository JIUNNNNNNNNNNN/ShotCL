import type { DailyPlanTimetableSceneMeta } from "@/lib/dailyPlan/printMeta";

type ReorderableProgressShot = {
  id: unknown;
  sceneNumber: unknown;
  cutNumber: unknown;
};

/**
 * Progress의 stable Shot 순서를 일촬표 행별 촬영 순서 문자열로 투영합니다.
 * 행/Cut membership은 늘리지 않으며 split 행은 자신의 선택 Cut만 소비합니다.
 */
export function applyProgressOrderToTimetableScenes(
  timetableScenes: readonly DailyPlanTimetableSceneMeta[],
  orderedShots: readonly ReorderableProgressShot[]
): DailyPlanTimetableSceneMeta[] {
  const usedShotIds = new Set<string>();

  return timetableScenes.map((row) => {
    const sceneKey = normalizeSceneKey(
      row.rowSnapshot.sceneNumber || row.sourceSnapshot?.sceneNumber
    );
    if (!sceneKey) return row;

    const selectedCuts = Object.prototype.hasOwnProperty.call(row, "selectedCutNumbers")
      ? new Set((row.selectedCutNumbers ?? []).filter(isPositiveInteger))
      : null;
    const rowCuts: number[] = [];

    orderedShots.forEach((shot) => {
      const shotId = String(shot.id ?? "").trim();
      const cutNumber = parseCutNumber(shot.cutNumber);
      if (
        !shotId
        || usedShotIds.has(shotId)
        || cutNumber === null
        || normalizeSceneKey(shot.sceneNumber) !== sceneKey
        || (selectedCuts && !selectedCuts.has(cutNumber))
      ) return;
      usedShotIds.add(shotId);
      rowCuts.push(cutNumber);
    });

    if (rowCuts.length === 0) return row;
    const shootingOrder = rowCuts.join("-");
    if (row.rowSnapshot.shootingOrder === shootingOrder) return row;
    return {
      ...row,
      rowSnapshot: {
        ...row.rowSnapshot,
        shootingOrder
      }
    };
  });
}

function parseCutNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/u.test(text)) return null;
  const number = Number(text);
  return isPositiveInteger(number) ? number : null;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function normalizeSceneKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/gu, "")
    .replace(/^(?:scene|씬|s)#?/iu, "")
    .replace(/^#+/u, "")
    .replace(/^0+(?=\d)/u, "");
}

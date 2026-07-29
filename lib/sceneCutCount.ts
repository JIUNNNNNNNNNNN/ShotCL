import { normalizeSceneNumber } from "@/lib/sceneNumber";

export const MAX_SCENE_CUT_COUNT = 80;

export type SceneCutCountValidation = {
  value: number | null;
  error: string;
};

const CUT_COUNT_ERROR = `Cut은 0부터 ${MAX_SCENE_CUT_COUNT}까지의 정수만 입력할 수 있습니다.`;

/**
 * 씬리스트와 일촬표가 공유하는 씬별 총 컷수 규칙입니다.
 * 빈 값은 아직 정하지 않은 상태(null)이며, 0은 컷이 없는 씬을 뜻합니다.
 */
export function validateSceneCutCountInput(raw: unknown): SceneCutCountValidation {
  if (raw === null || raw === undefined) return { value: null, error: "" };

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { value: null, error: "" };
    if (!/^\d+$/.test(trimmed)) return { value: null, error: CUT_COUNT_ERROR };
    const value = Number(trimmed);
    return isValidSceneCutCount(value)
      ? { value, error: "" }
      : { value: null, error: CUT_COUNT_ERROR };
  }

  if (typeof raw === "number" && isValidSceneCutCount(raw)) {
    return { value: raw, error: "" };
  }

  return { value: null, error: CUT_COUNT_ERROR };
}

/** 이전 localStorage/DB payload의 문자열 값을 안전한 number|null로 변환합니다. */
export function normalizeSceneCutCount(raw: unknown): number | null {
  const result = validateSceneCutCountInput(raw);
  return result.error ? null : result.value;
}

export type SceneCutCountMap = Record<string, number>;

/**
 * 씬 번호가 유일하고 Cut이 입력된 행만 일촬표 연동 값으로 사용합니다.
 * 같은 씬 번호에 서로 다른 값이 있으면 어느 행도 임의 선택하지 않습니다.
 */
export function buildSceneCutCountMap(
  items: Array<{ sceneNo: string; cutCount: number | null }>
): SceneCutCountMap {
  const result: SceneCutCountMap = {};
  const conflicts = new Set<string>();

  items.forEach((item) => {
    const sceneKey = normalizeSceneNumber(item.sceneNo);
    if (!sceneKey || item.cutCount == null || conflicts.has(sceneKey)) return;
    if (sceneKey in result && result[sceneKey] !== item.cutCount) {
      delete result[sceneKey];
      conflicts.add(sceneKey);
      return;
    }
    result[sceneKey] = item.cutCount;
  });

  return result;
}

function isValidSceneCutCount(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_SCENE_CUT_COUNT;
}

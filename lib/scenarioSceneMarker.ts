import { isDateOrTimeLine, normalizeSceneNumber } from "@/lib/sceneNumber";

export type ScenarioSceneMarker = {
  sceneNo: string;
  originalLine: string;
};

export const SCENARIO_MARKER_NOT_FOUND_MESSAGE =
  "씬 표기를 찾지 못했습니다. S#1, Scene1, #1, 씬1 같은 표기만 자동 인식합니다.";

const MAX_MARKER_LINE_LENGTH = 79;
const SCENE_MARKER_REGEX =
  /^(?:S\s*#?\s*|SCENE\s*#?\s*|씬\s*#?\s*|#\s*)0*(\d{1,4})(?=$|[\s.:–—-])([\s\S]*)$/i;

/**
 * PDF의 줄 시작에 명시적인 씬 prefix가 있는 경우만 marker로 인식합니다.
 * 숫자만 있는 줄은 씬리스트 값 정규화에는 사용할 수 있지만 PDF marker에서는 제외합니다.
 */
export function parseScenarioSceneMarker(rawLine: string): ScenarioSceneMarker | null {
  const line = rawLine.trim();
  if (!line || line.length > MAX_MARKER_LINE_LENGTH || isDateOrTimeLine(line)) return null;

  const marker = line.match(SCENE_MARKER_REGEX);
  if (!marker) return null;
  const sceneNo = normalizeSceneNumber(marker[1]);
  return sceneNo ? { sceneNo, originalLine: line } : null;
}

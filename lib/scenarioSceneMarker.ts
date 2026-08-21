import { isDateOrTimeLine, normalizeSceneNumber } from "@/lib/sceneNumber";

export type ScenarioSceneMarker = {
  sceneNo: string;
  originalLine: string;
};

export type ScenarioSceneMarkerInspection = {
  rawLine: string;
  cleanedLine: string;
  marker: ScenarioSceneMarker | null;
  isCandidate: boolean;
  rejectReason: string | null;
};

export const SCENARIO_MARKER_NOT_FOUND_MESSAGE =
  "씬 표기를 찾지 못했습니다. S#1, S#1-1, Scene1, #1, 씬1 같은 표기만 자동 인식합니다.";

export const MAX_SCENARIO_SCENE_TEXT_LENGTH = 50_000;
const MAX_MARKER_LINE_LENGTH = 120;
const SCENE_MARKER_REGEX =
  /^(?:S\s*#?\s*|SCENE\s*#?\s*|씬\s*#?\s*|#\s*)0*(\d{1,4})(?:\s*-\s*(\d{1,4}))?(?!\s*-\s*\d)(?=$|[\s.:\-–—)\]}])([\s\S]*)$/i;

const EXPLICIT_PREFIX_REGEX = /^(?:S(?:\s|#|\d)|SCENE(?:\s|#|\d)|씬(?:\s|#|\d)|#)/i;
const BARE_SCENE_NUMBER_REGEX = /^\d{1,4}(?:\s*-\s*\d{1,4})?(?:\s|$)/;

/**
 * PDF의 줄 시작에 명시적인 씬 prefix가 있는 경우만 marker로 인식합니다.
 * 숫자만 있는 줄은 씬리스트 값 정규화에는 사용할 수 있지만 PDF marker에서는 제외합니다.
 */
export function parseScenarioSceneMarker(rawLine: string): ScenarioSceneMarker | null {
  return inspectScenarioSceneMarker(rawLine).marker;
}

export function inspectScenarioSceneMarker(rawLine: string): ScenarioSceneMarkerInspection {
  const line = cleanScenarioMarkerLine(rawLine);
  const isCandidate = EXPLICIT_PREFIX_REGEX.test(line) || BARE_SCENE_NUMBER_REGEX.test(line);
  if (!line) return rejected(rawLine, line, false, "empty");
  if (line.length > MAX_MARKER_LINE_LENGTH) {
    return rejected(rawLine, line, isCandidate, "line_too_long");
  }
  if (isDateOrTimeLine(line)) return rejected(rawLine, line, isCandidate, "date_or_time");
  if (BARE_SCENE_NUMBER_REGEX.test(line)) return rejected(rawLine, line, true, "bare_number");
  if (!EXPLICIT_PREFIX_REGEX.test(line)) return rejected(rawLine, line, false, "missing_prefix");

  const marker = line.match(SCENE_MARKER_REGEX);
  if (!marker) return rejected(rawLine, line, true, "invalid_marker_boundary");
  const sceneNo = normalizeSceneNumber(marker[2] ? `${marker[1]}-${marker[2]}` : marker[1]);
  if (!sceneNo) return rejected(rawLine, line, true, "invalid_scene_number");
  return {
    rawLine,
    cleanedLine: line,
    marker: { sceneNo, originalLine: line },
    isCandidate: true,
    rejectReason: null
  };
}

export function cleanScenarioMarkerLine(rawLine: string) {
  return rawLine
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/^\s*(?:[•·▪◦●○▶▷※*]+\s*|[-–—]+\s*)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rejected(
  rawLine: string,
  cleanedLine: string,
  isCandidate: boolean,
  rejectReason: string
): ScenarioSceneMarkerInspection {
  return {
    rawLine,
    cleanedLine,
    marker: null,
    isCandidate,
    rejectReason
  };
}

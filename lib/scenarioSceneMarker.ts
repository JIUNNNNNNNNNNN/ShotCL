import { isDateOrTimeLine, normalizeSceneNumber } from "@/lib/sceneNumber";

export type ScenarioSceneMarker = {
  sceneNo: string;
  originalLine: string;
  isBare: boolean;
};

export type ScenarioSceneMarkerOptions = {
  /** Positional PDF callers set this false for embedded/item-only candidates. */
  allowBare?: boolean;
};

export type ScenarioPdfMarkerEdge = "header" | "body" | "footer";

export type ScenarioPdfPaginationCandidate = {
  pageNumber: number;
  edge: ScenarioPdfMarkerEdge;
  marker: ScenarioSceneMarker;
};

export type ScenarioSceneMarkerInspection = {
  rawLine: string;
  cleanedLine: string;
  marker: ScenarioSceneMarker | null;
  isCandidate: boolean;
  rejectReason: string | null;
};

export const SCENARIO_MARKER_NOT_FOUND_MESSAGE =
  "씬 표기를 찾지 못했습니다. 1, 1-1, S#1, S#1-1, Scene 1, #1, 씬1 등의 씬 번호를 자동 인식합니다.";

export const MAX_SCENARIO_SCENE_TEXT_LENGTH = 50_000;
const MAX_MARKER_LINE_LENGTH = 120;
const EXPLICIT_SCENE_MARKER_REGEX =
  /^(?:S\s*#?\s*|SCENE\s*#?\s*|씬\s*#?\s*|#\s*)0*(\d{1,4})(?:\s*-\s*(\d{1,4}))?(?!\s*-\s*\d)(?=$|[\s.:\-–—)\]}])([\s\S]*)$/i;
const BARE_SCENE_MARKER_REGEX =
  /^0*(\d{1,4})(?:\s*-\s*(\d{1,4}))?(?!\s*-\s*\d)(?=$|[\s.:\-)\]}])([\s\S]*)$/i;

const EXPLICIT_PREFIX_REGEX = /^(?:S(?:\s|#|\d)|SCENE(?:\s|#|\d)|씬(?:\s|#|\d)|#)/i;
const BARE_SCENE_NUMBER_REGEX = /^\d{1,4}(?:\s*-\s*\d{1,4})?(?=$|[\s.:\-)\]}])/;
const BARE_TIME_RANGE_REGEX = /^(?:[01]\d|2[0-3])-(?:[0-5]\d)$/;
const BARE_HEADING_CUE_REGEX =
  /(?:^|[\s./])(INT|EXT|I\s*\/\s*E|D|N|DAY|NIGHT|낮|밤|새벽|아침|저녁)(?=$|[\s./:()\-])/i;

/**
 * 숫자 token은 반드시 줄 시작에 있어야 합니다. Positional PDF caller는
 * allowBare=false로 본문 중간의 숫자-only text item 승격을 막을 수 있습니다.
 */
export function parseScenarioSceneMarker(
  rawLine: string,
  options: ScenarioSceneMarkerOptions = {}
): ScenarioSceneMarker | null {
  return inspectScenarioSceneMarker(rawLine, options).marker;
}

export function inspectScenarioSceneMarker(
  rawLine: string,
  options: ScenarioSceneMarkerOptions = {}
): ScenarioSceneMarkerInspection {
  const line = cleanScenarioMarkerLine(rawLine);
  const isCandidate = EXPLICIT_PREFIX_REGEX.test(line) || BARE_SCENE_NUMBER_REGEX.test(line);
  if (!line) return rejected(rawLine, line, false, "empty");
  if (line.length > MAX_MARKER_LINE_LENGTH) {
    return rejected(rawLine, line, isCandidate, "line_too_long");
  }
  if (isDateOrTimeLine(line)) return rejected(rawLine, line, isCandidate, "date_or_time");
  const isExplicit = EXPLICIT_PREFIX_REGEX.test(line);
  if (!isExplicit && options.allowBare === false && BARE_SCENE_NUMBER_REGEX.test(line)) {
    return rejected(rawLine, line, true, "bare_not_at_line_start");
  }
  if (!isExplicit && !BARE_SCENE_NUMBER_REGEX.test(line)) {
    return rejected(rawLine, line, false, "missing_scene_number");
  }

  const marker = line.match(isExplicit ? EXPLICIT_SCENE_MARKER_REGEX : BARE_SCENE_MARKER_REGEX);
  if (!marker) return rejected(rawLine, line, true, "invalid_marker_boundary");
  if (/^\s*-\s*[\p{L}]/u.test(marker[3] ?? "")) {
    return rejected(rawLine, line, true, "unsupported_alphabetic_suffix");
  }
  if (!isExplicit && isAmbiguousBareNumber(line, marker[3] ?? "")) {
    return rejected(rawLine, line, true, "ambiguous_bare_number");
  }
  const sceneNo = normalizeSceneNumber(marker[2] ? `${marker[1]}-${marker[2]}` : marker[1]);
  if (!sceneNo) return rejected(rawLine, line, true, "invalid_scene_number");
  return {
    rawLine,
    cleanedLine: line,
    marker: { sceneNo, originalLine: line, isBare: !isExplicit },
    isCandidate: true,
    rejectReason: null
  };
}

export function cleanScenarioMarkerLine(rawLine: string) {
  return rawLine
    .normalize("NFKC")
    .replace(/\u0000/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/(\d)\s*-\s*(?=\d)/g, "$1-")
    .replace(/^\s*(?:[•·▪◦●○▶▷※*]+\s*|[-–—]+\s*)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasScenarioHeadingCue(rawLine: string) {
  return BARE_HEADING_CUE_REGEX.test(cleanScenarioMarkerLine(rawLine));
}

/**
 * Repeated bare integers at the same page edge with a stable page-number
 * offset are pagination, not Scene markers. Requiring two pages avoids
 * discarding a legitimate single Scene heading at a page boundary.
 */
export function findLikelyPdfPaginationMarkerIndices(
  candidates: ScenarioPdfPaginationCandidate[]
) {
  const groups = new Map<string, Array<{ index: number; pageNumber: number }>>();
  candidates.forEach((candidate, index) => {
    if (
      candidate.edge === "body"
      || !candidate.marker.isBare
      || !/^\d{1,4}$/.test(candidate.marker.originalLine)
      || candidate.marker.sceneNo.includes("-")
    ) return;
    const value = Number(candidate.marker.sceneNo);
    const key = `${candidate.edge}:${value - candidate.pageNumber}`;
    const entries = groups.get(key) ?? [];
    entries.push({ index, pageNumber: candidate.pageNumber });
    groups.set(key, entries);
  });

  const rejected = new Set<number>();
  groups.forEach((entries) => {
    if (new Set(entries.map((entry) => entry.pageNumber)).size < 2) return;
    entries.forEach((entry) => rejected.add(entry.index));
  });
  return rejected;
}

export function isExactBareScenarioMarker(marker: ScenarioSceneMarker) {
  return marker.isBare
    && /^\d{1,4}(?:-\d{1,4})?[.:)\]}]*$/.test(marker.originalLine);
}

function isAmbiguousBareNumber(line: string, rawRemainder: string) {
  const compactToken = line.match(/^\d{1,4}(?:-\d{1,4})?/)?.[0] ?? "";
  const remainder = rawRemainder.trim();
  if (/^[.]\s*\d/.test(remainder)) return true;
  const headingText = remainder.replace(/^[.:)\]}-]+\s*/, "");
  if (BARE_TIME_RANGE_REGEX.test(compactToken)) {
    return !BARE_HEADING_CUE_REGEX.test(headingText);
  }
  if (!remainder || /^[.:)\]}-]*$/.test(remainder)) return false;
  return !BARE_HEADING_CUE_REGEX.test(headingText);
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

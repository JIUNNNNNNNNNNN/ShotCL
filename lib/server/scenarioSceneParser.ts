import { randomUUID } from "node:crypto";
import {
  findLikelyPdfPaginationMarkerIndices,
  isExactBareScenarioMarker,
  MAX_SCENARIO_SCENE_TEXT_LENGTH,
  parseScenarioSceneMarker
} from "../scenarioSceneMarker";
import type { ProjectScenarioScene } from "../types";

export type ScenarioPageText = {
  page: number;
  text: string;
};

export { parseScenarioSceneMarker } from "../scenarioSceneMarker";

/** 각 번호의 첫 marker부터 문서상 다음 marker 직전까지를 한 씬으로 자릅니다. */
export function splitScenarioScenesByNumber(
  pages: ScenarioPageText[]
): ProjectScenarioScene[] {
  const lines = pages.flatMap(({ page, text }) => {
    const pageLines = text.split(/\r?\n/);
    const nonemptyIndices = pageLines.flatMap((line, index) => line.trim() ? [index] : []);
    const firstNonemptyIndex = nonemptyIndices[0] ?? -1;
    const lastNonemptyIndex = nonemptyIndices.at(-1) ?? -1;
    return pageLines.map((line, pageLineIndex) => ({
      page,
      line,
      edge: firstNonemptyIndex !== lastNonemptyIndex && pageLineIndex === firstNonemptyIndex
        ? "header" as const
        : firstNonemptyIndex !== lastNonemptyIndex && pageLineIndex === lastNonemptyIndex
          ? "footer" as const
          : "body" as const
    }));
  });
  const markerCandidates = lines.flatMap(({ line, page, edge }, lineIndex) => {
    const marker = parseScenarioSceneMarker(line);
    return marker ? [{ marker, pageNumber: page, edge, lineIndex }] : [];
  });
  const paginationCandidateIndices = findLikelyPdfPaginationMarkerIndices(markerCandidates);
  const paginationLineIndices = new Set(
    [...paginationCandidateIndices].map((index) => markerCandidates[index].lineIndex)
  );
  const nonPaginationCandidates = markerCandidates.filter(
    (_, index) => !paginationCandidateIndices.has(index)
  );
  const hasContextualMarker = nonPaginationCandidates.some(
    ({ marker }) => !isExactBareScenarioMarker(marker)
  );
  const acceptedMarkerLineIndices = new Set(
    nonPaginationCandidates.flatMap(({ marker, lineIndex }) => {
      if (!hasContextualMarker || !isExactBareScenarioMarker(marker)) return [lineIndex];
      const previousLine = lines[lineIndex - 1];
      const nextLine = lines[lineIndex + 1];
      const blankBefore = !previousLine || previousLine.page !== lines[lineIndex].page
        || !previousLine.line.trim();
      const blankAfter = !nextLine || nextLine.page !== lines[lineIndex].page
        || !nextLine.line.trim();
      return blankBefore && blankAfter ? [lineIndex] : [];
    })
  );
  const firstMarkerByNumber = new Map<string, {
    sceneNo: string;
    originalLine: string;
    lineIndex: number;
    page: number;
  }>();

  lines.forEach(({ line, page }, lineIndex) => {
    if (paginationLineIndices.has(lineIndex) || !acceptedMarkerLineIndices.has(lineIndex)) return;
    const marker = parseScenarioSceneMarker(line);
    if (!marker || firstMarkerByNumber.has(marker.sceneNo)) return;
    firstMarkerByNumber.set(marker.sceneNo, {
      ...marker,
      lineIndex,
      page
    });
  });

  const markers = [...firstMarkerByNumber.values()]
    .sort((left, right) => left.lineIndex - right.lineIndex);

  return markers.slice(0, 2_000).map((marker, markerIndex) => {
    const nextMarker = markers[markerIndex + 1];
    const endIndex = nextMarker?.lineIndex ?? lines.length;
    const blockLines = lines.slice(marker.lineIndex, endIndex);
    const lastLine = [...blockLines].reverse().find(({ line }) => line.trim());
    return {
      id: randomUUID(),
      sceneNo: marker.sceneNo,
      title: marker.originalLine.slice(0, 240),
      pageStart: marker.page,
      pageEnd: lastLine?.page ?? marker.page,
      // title이 heading 원문을 보존하므로 body에는 다음 줄부터 다음 marker
      // 직전까지만 담습니다. 내부 줄 순서는 바꾸지 않습니다.
      text: blockLines
        .slice(1)
        .filter((_, blockLineIndex) => !paginationLineIndices.has(marker.lineIndex + blockLineIndex + 1))
        .map(({ line }) => line.trimEnd())
        .join("\n")
        .trim()
        .slice(0, MAX_SCENARIO_SCENE_TEXT_LENGTH),
      imageSegments: []
    };
  });
}

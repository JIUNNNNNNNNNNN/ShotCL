import { randomUUID } from "node:crypto";
import { parseScenarioSceneMarker } from "../scenarioSceneMarker";
import type { ProjectScenarioScene } from "../types";

export type ScenarioPageText = {
  page: number;
  text: string;
};

export { parseScenarioSceneMarker } from "../scenarioSceneMarker";

/**
 * 각 번호의 첫 marker부터 다음으로 큰 번호 marker 직전까지를 한 씬으로 자릅니다.
 * 마지막 씬은 추출된 PDF 텍스트 끝까지 포함합니다.
 */
export function splitScenarioScenesByNumber(
  pages: ScenarioPageText[]
): ProjectScenarioScene[] {
  const lines = pages.flatMap(({ page, text }) =>
    text.split(/\r?\n/).map((line) => ({ page, line }))
  );
  const firstMarkerByNumber = new Map<string, {
    sceneNo: string;
    number: number;
    originalLine: string;
    lineIndex: number;
    page: number;
  }>();

  lines.forEach(({ line, page }, lineIndex) => {
    const marker = parseScenarioSceneMarker(line);
    if (!marker || firstMarkerByNumber.has(marker.sceneNo)) return;
    firstMarkerByNumber.set(marker.sceneNo, {
      ...marker,
      number: Number(marker.sceneNo),
      lineIndex,
      page
    });
  });

  const markers = [...firstMarkerByNumber.values()]
    .sort((left, right) => left.number - right.number || left.lineIndex - right.lineIndex);

  return markers.slice(0, 2_000).map((marker) => {
    const nextMarker = markers.find((candidate) =>
      candidate.number > marker.number &&
      candidate.lineIndex > marker.lineIndex
    );
    const endIndex = nextMarker?.lineIndex ?? lines.length;
    const blockLines = lines.slice(marker.lineIndex, endIndex);
    const lastLine = [...blockLines].reverse().find(({ line }) => line.trim());
    return {
      id: randomUUID(),
      sceneNo: marker.sceneNo,
      title: marker.originalLine.slice(0, 240),
      pageStart: marker.page,
      pageEnd: lastLine?.page ?? marker.page,
      text: "",
      imageSegments: []
    };
  });
}

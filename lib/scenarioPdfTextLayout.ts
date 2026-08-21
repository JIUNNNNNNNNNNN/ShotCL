export type ScenarioPositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const MAX_SCENARIO_PDF_PAGES = 2_000;
export const MAX_SCENARIO_PDF_TEXT_ITEMS = 250_000;
export const MAX_SCENARIO_PDF_TEXT_CHARACTERS = 2_000_000;
export const SCENARIO_PDF_ANALYSIS_RANGE_MESSAGE =
  "PDF 페이지 또는 텍스트 양이 자동 분석 범위를 벗어났습니다. 원본 PDF 보기 또는 수동 씬 추가를 사용하세요.";

export function isScenarioPdfAnalysisRangeExceeded(input: {
  pageCount?: number;
  textItemCount?: number;
  textCharacterCount?: number;
}) {
  return (input.pageCount ?? 0) > MAX_SCENARIO_PDF_PAGES
    || (input.textItemCount ?? 0) > MAX_SCENARIO_PDF_TEXT_ITEMS
    || (input.textCharacterCount ?? 0) > MAX_SCENARIO_PDF_TEXT_CHARACTERS;
}

/**
 * PDF.js text items are emitted as positioned fragments, not reliable source
 * lines. Group them by their visual baseline so browser and server parsing use
 * the same reconstructed text lines.
 */
export function groupScenarioPdfTextItemsIntoLines(items: ScenarioPositionedText[]) {
  const sorted = [...items].sort((left, right) => left.y - right.y || left.x - right.x);
  const lines: Array<{ y: number; items: ScenarioPositionedText[] }> = [];

  sorted.forEach((item) => {
    const tolerance = Math.max(2, Math.min(5, item.height * 0.3));
    let line: { y: number; items: ScenarioPositionedText[] } | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const candidate = lines[index];
      const distance = Math.abs(candidate.y - item.y);
      if (item.y - candidate.y > 8) break;
      if (distance <= tolerance && distance < closestDistance) {
        line = candidate;
        closestDistance = distance;
      }
    }
    if (line) {
      line.items.push(item);
      line.y = line.items.reduce((sum, current) => sum + current.y, 0) / line.items.length;
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  });

  return lines
    .sort((left, right) => left.y - right.y)
    .map((line) => ({
      y: Math.min(...line.items.map((item) => item.y)),
      items: [...line.items].sort((left, right) => left.x - right.x)
    }));
}

export function joinScenarioPdfTextItems(items: ScenarioPositionedText[]) {
  let rightEdge = 0;
  let text = "";
  items.forEach((item, index) => {
    const averageCharacterWidth = item.text.length > 0
      ? item.width / item.text.length
      : item.height * 0.5;
    const gap = item.x - rightEdge;
    if (index > 0 && gap > Math.max(1.5, averageCharacterWidth * 0.35)) text += " ";
    text += item.text;
    rightEdge = Math.max(rightEdge, item.x + item.width);
  });
  return text.trim();
}

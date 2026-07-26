"use client";

import {
  inspectScenarioSceneMarker,
  SCENARIO_MARKER_NOT_FOUND_MESSAGE
} from "@/lib/scenarioSceneMarker";
import type {
  ProjectScenarioImageSegment,
  ProjectScenarioScene
} from "@/lib/types";

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

export type ScenarioPositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScenarioMarkerPosition = {
  sceneNo: string;
  title: string;
  pageIndex: number;
  lineIndex: number;
  y: number;
  pageHeight: number;
};

type MarkerDebugEntry = {
  pageIndex: number;
  lineIndex: number;
  source: "line" | "cluster" | "item";
  rawLine: string;
  cleanedLine: string;
  normalizedSceneNo: string;
  y: number;
  accepted: boolean;
  rejectReason: string;
};

type PageMarkerAnalysis = {
  markers: ScenarioMarkerPosition[];
  debugEntries: MarkerDebugEntry[];
  itemCount: number;
  lineCount: number;
};

const MARKER_START_PADDING = 12;
const MARKER_END_PADDING = 8;

let configuredPdfJs:
  | Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>
  | null = null;

export async function loadScenarioPdfDocument(url: string) {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({ url }).promise;
}

export async function analyzeScenarioPdfImages(url: string): Promise<ProjectScenarioScene[]> {
  const pdfjs = await loadPdfJs();
  const document = await pdfjs.getDocument({ url }).promise;
  const markers: ScenarioMarkerPosition[] = [];
  const debugEntries: MarkerDebugEntry[] = [];
  const pageDebug: Array<{ pageIndex: number; textItemCount: number; lineCount: number }> = [];
  const firstMarkerNumbers = new Set<string>();
  const pageHeights: number[] = [];
  let lineOffset = 0;

  try {
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      pageHeights[pageIndex] = viewport.height;
      const textContent = await page.getTextContent();
      const positionedItems = textContent.items.flatMap((item) => {
          if (!isPdfTextItem(item) || !item.str.trim()) return [];
          const transform = pdfjs.Util.transform(viewport.transform, item.transform);
          const height = Math.max(item.height || 0, Math.abs(transform[3]) || 0, 1);
          return [{
            text: item.str,
            x: transform[4],
            y: clamp(transform[5] - height, 0, viewport.height),
            width: Math.max(item.width, 0),
            height
          }];
        });
      const pageAnalysis = detectScenarioMarkersOnPage(
        positionedItems,
        pageIndex,
        viewport.height,
        lineOffset
      );
      pageDebug.push({
        pageIndex,
        textItemCount: pageAnalysis.itemCount,
        lineCount: pageAnalysis.lineCount
      });
      debugEntries.push(...pageAnalysis.debugEntries);
      lineOffset += pageAnalysis.lineCount;

      pageAnalysis.markers.forEach((marker) => {
        if (firstMarkerNumbers.has(marker.sceneNo)) {
          debugEntries.push({
            pageIndex: marker.pageIndex,
            lineIndex: marker.lineIndex,
            source: "line",
            rawLine: marker.title,
            cleanedLine: marker.title,
            normalizedSceneNo: marker.sceneNo,
            y: marker.y,
            accepted: false,
            rejectReason: "duplicate_scene_number"
          });
          return;
        }
        firstMarkerNumbers.add(marker.sceneNo);
        markers.push(marker);
      });
      page.cleanup();
    }

    if (markers.length === 0) {
      throw new Error(SCENARIO_MARKER_NOT_FOUND_MESSAGE);
    }

    markers.sort((left, right) =>
      left.pageIndex - right.pageIndex || left.y - right.y || left.lineIndex - right.lineIndex
    );

    const scenes = markers.slice(0, 2_000).map((marker, index) => {
      const next = markers[index + 1] ?? null;
      const imageSegments = buildImageSegments(marker, next, pageHeights, document.numPages);
      return {
        id: createSceneId(index),
        sceneNo: marker.sceneNo,
        title: marker.title,
        pageStart: marker.pageIndex + 1,
        pageEnd: (imageSegments.at(-1)?.pageIndex ?? marker.pageIndex) + 1,
        text: "",
        imageSegments
      };
    });
    logScenarioAnalysis(document.numPages, pageDebug, debugEntries, markers, scenes);
    return scenes;
  } finally {
    await document.cleanup();
  }
}

/**
 * 한 페이지의 좌표 text item을 line/공간 cluster/item 순으로 검사합니다.
 * 완성된 line이 다른 문장과 합쳐져 실패해도 prefix item/cluster가 marker를 복구합니다.
 */
export function detectScenarioMarkersOnPage(
  items: ScenarioPositionedText[],
  pageIndex: number,
  pageHeight: number,
  lineOffset = 0
): PageMarkerAnalysis {
  const lines = groupTextItemsIntoLines(items);
  const markers: ScenarioMarkerPosition[] = [];
  const debugEntries: MarkerDebugEntry[] = [];
  const acceptedPositions = new Set<string>();

  lines.forEach((line, pageLineIndex) => {
    const lineIndex = lineOffset + pageLineIndex;
    const candidates = buildLineCandidates(line.items);
    candidates.forEach((candidate) => {
      const inspection = inspectScenarioSceneMarker(candidate.text);
      if (!inspection.isCandidate) return;
      const normalizedSceneNo = inspection.marker?.sceneNo ?? "";
      const positionKey = normalizedSceneNo
        ? `${normalizedSceneNo}:${Math.round(candidate.y * 2)}`
        : "";
      const duplicatePosition = Boolean(positionKey && acceptedPositions.has(positionKey));
      const accepted = Boolean(inspection.marker && !duplicatePosition);
      debugEntries.push({
        pageIndex,
        lineIndex,
        source: candidate.source,
        rawLine: inspection.rawLine,
        cleanedLine: inspection.cleanedLine,
        normalizedSceneNo,
        y: candidate.y,
        accepted,
        rejectReason: duplicatePosition
          ? "duplicate_position"
          : inspection.rejectReason ?? ""
      });
      if (!inspection.marker || duplicatePosition) return;
      acceptedPositions.add(positionKey);
      markers.push({
        sceneNo: inspection.marker.sceneNo,
        title: inspection.marker.originalLine.slice(0, 240),
        pageIndex,
        lineIndex,
        y: candidate.y,
        pageHeight
      });
    });
  });

  markers.sort((left, right) => left.y - right.y || left.lineIndex - right.lineIndex);
  return {
    markers,
    debugEntries,
    itemCount: items.length,
    lineCount: lines.length
  };
}

async function loadPdfJs() {
  if (!configuredPdfJs) {
    configuredPdfJs = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
      return pdfjs;
    });
  }
  return configuredPdfJs;
}

function isPdfTextItem(value: unknown): value is PdfTextItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PdfTextItem>;
  return typeof item.str === "string"
    && Array.isArray(item.transform)
    && item.transform.length >= 6
    && typeof item.width === "number"
    && typeof item.height === "number";
}

function groupTextItemsIntoLines(items: ScenarioPositionedText[]) {
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

function buildLineCandidates(items: ScenarioPositionedText[]) {
  const candidates: Array<{
    source: "line" | "cluster" | "item";
    text: string;
    y: number;
  }> = [];
  const seen = new Set<string>();
  const add = (source: "line" | "cluster" | "item", row: ScenarioPositionedText[]) => {
    if (row.length === 0) return;
    const text = joinTextItems(row);
    const key = `${text}:${Math.round(Math.min(...row.map((item) => item.y)) * 2)}`;
    if (!text || seen.has(key)) return;
    seen.add(key);
    candidates.push({
      source,
      text,
      y: Math.min(...row.map((item) => item.y))
    });
  };

  add("line", items);
  splitIntoHorizontalClusters(items).forEach((cluster) => add("cluster", cluster));
  items.forEach((item, startIndex) => {
    if (!mayStartSceneMarker(item.text)) return;
    for (
      let endIndex = startIndex + 2;
      endIndex <= Math.min(items.length, startIndex + 6);
      endIndex += 1
    ) {
      add("cluster", items.slice(startIndex, endIndex));
    }
  });
  items.forEach((item) => add("item", [item]));
  return candidates;
}

function mayStartSceneMarker(value: string) {
  const text = value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/^\s*(?:[•·▪◦●○▶▷※*]+\s*|[-–—]+\s*)/, "")
    .trim();
  return /^(?:S|SCENE|씬|#)/i.test(text);
}

function splitIntoHorizontalClusters(items: ScenarioPositionedText[]) {
  const clusters: ScenarioPositionedText[][] = [];
  items.forEach((item) => {
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous) {
      clusters.push([item]);
      return;
    }
    const previousRight = previous.x + previous.width;
    const gap = item.x - previousRight;
    const splitThreshold = Math.max(20, previous.height * 3.5, item.height * 3.5);
    if (gap > splitThreshold) clusters.push([item]);
    else current.push(item);
  });
  return clusters;
}

function joinTextItems(items: ScenarioPositionedText[]) {
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

export function buildImageSegments(
  marker: ScenarioMarkerPosition,
  next: ScenarioMarkerPosition | null,
  pageHeights: number[],
  pageCount: number
): ProjectScenarioImageSegment[] {
  const finalPageIndex = next?.pageIndex ?? pageCount - 1;
  const segments: ProjectScenarioImageSegment[] = [];

  for (let pageIndex = marker.pageIndex; pageIndex <= finalPageIndex; pageIndex += 1) {
    const height = pageHeights[pageIndex] || marker.pageHeight || 1;
    const startY = pageIndex === marker.pageIndex
      ? clamp(marker.y - MARKER_START_PADDING, 0, height)
      : 0;
    const endY = next && pageIndex === next.pageIndex
      ? clamp(next.y - MARKER_END_PADDING, 0, height)
      : height;
    if (endY - startY < 1) continue;
    segments.push({
      pageIndex,
      startYRatio: clamp(startY / height, 0, 1),
      endYRatio: clamp(endY / height, 0, 1)
    });
  }
  return segments;
}

function logScenarioAnalysis(
  pageCount: number,
  pages: Array<{ pageIndex: number; textItemCount: number; lineCount: number }>,
  candidates: MarkerDebugEntry[],
  markers: ScenarioMarkerPosition[],
  scenes: ProjectScenarioScene[]
) {
  if (process.env.NODE_ENV === "production") return;
  console.groupCollapsed(`[scenario-pdf] analyzed ${pageCount} pages, accepted ${markers.length} markers`);
  console.info("[scenario-pdf] page count", pageCount);
  console.table(pages);
  console.info("[scenario-pdf] marker candidates");
  console.table(candidates);
  console.info("[scenario-pdf] accepted markers");
  console.table(markers.map((marker) => ({
    sceneNo: marker.sceneNo,
    pageIndex: marker.pageIndex,
    lineIndex: marker.lineIndex,
    rawLine: marker.title,
    y: marker.y
  })));
  console.info("[scenario-pdf] scene blocks");
  console.table(scenes.map((scene) => ({
    sceneNo: scene.sceneNo,
    pageStart: scene.pageStart,
    pageEnd: scene.pageEnd,
    segmentCount: scene.imageSegments.length
  })));
  console.groupEnd();
}

function createSceneId(index: number) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `scenario-scene-${Date.now()}-${index}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

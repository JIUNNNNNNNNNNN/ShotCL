"use client";

import {
  findLikelyPdfPaginationMarkerIndices,
  inspectScenarioSceneMarker,
  isExactBareScenarioMarker,
  SCENARIO_MARKER_NOT_FOUND_MESSAGE,
  type ScenarioPdfMarkerEdge
} from "@/lib/scenarioSceneMarker";
import {
  groupScenarioPdfTextItemsIntoLines,
  isScenarioPdfAnalysisRangeExceeded,
  joinScenarioPdfTextItems,
  SCENARIO_PDF_ANALYSIS_RANGE_MESSAGE,
  type ScenarioPositionedText
} from "@/lib/scenarioPdfTextLayout";
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

export type { ScenarioPositionedText } from "@/lib/scenarioPdfTextLayout";

export type ScenarioMarkerPosition = {
  sceneNo: string;
  title: string;
  pageIndex: number;
  lineIndex: number;
  y: number;
  pageHeight: number;
  x: number;
  height: number;
  isBare: boolean;
  edge: ScenarioPdfMarkerEdge;
};

type MarkerDebugEntry = {
  pageIndex: number;
  lineIndex: number;
  source: "line" | "cluster" | "item";
  rawLength: number;
  cleanedLength: number;
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
  const loadingTask = pdfjs.getDocument({ url });
  const document = await loadingTask.promise;
  const markers: ScenarioMarkerPosition[] = [];
  const debugEntries: MarkerDebugEntry[] = [];
  const pageDebug: Array<{ pageIndex: number; textItemCount: number; lineCount: number }> = [];
  const pageHeights: number[] = [];
  let lineOffset = 0;
  let totalTextItems = 0;
  let totalTextCharacters = 0;

  try {
    if (isScenarioPdfAnalysisRangeExceeded({ pageCount: document.numPages })) {
      throw new Error(SCENARIO_PDF_ANALYSIS_RANGE_MESSAGE);
    }
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex + 1);
      try {
        const viewport = page.getViewport({ scale: 1 });
        pageHeights[pageIndex] = viewport.height;
        const positionedItems: ScenarioPositionedText[] = [];
        const reader = page.streamTextContent().getReader();
        let completed = false;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
              completed = true;
              break;
            }
            for (const item of chunk.value.items) {
              if (!isPdfTextItem(item) || !item.str.trim()) continue;
              totalTextItems += 1;
              totalTextCharacters += item.str.length;
              if (isScenarioPdfAnalysisRangeExceeded({
                textItemCount: totalTextItems,
                textCharacterCount: totalTextCharacters
              })) {
                throw new Error(SCENARIO_PDF_ANALYSIS_RANGE_MESSAGE);
              }
              const transform = pdfjs.Util.transform(viewport.transform, item.transform);
              const height = Math.max(item.height || 0, Math.abs(transform[3]) || 0, 1);
              positionedItems.push({
                text: item.str,
                x: transform[4],
                y: clamp(transform[5] - height, 0, viewport.height),
                width: Math.max(item.width, 0),
                height
              });
            }
          }
        } finally {
          if (!completed) await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
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

        markers.push(...pageAnalysis.markers);
      } finally {
        page.cleanup();
      }
    }

    const selection = selectCanonicalScenarioMarkers(markers);
    selection.rejected.forEach(({ marker, reason }) => {
      debugEntries.push(markerDebugEntry(marker, reason));
    });
    const acceptedMarkers = selection.markers;

    if (acceptedMarkers.length === 0) {
      throw new Error(SCENARIO_MARKER_NOT_FOUND_MESSAGE);
    }

    const scenes = acceptedMarkers.slice(0, 2_000).map((marker, index) => {
      const next = acceptedMarkers[index + 1] ?? null;
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
    logScenarioAnalysis(document.numPages, pageDebug, debugEntries, acceptedMarkers, scenes);
    return scenes;
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
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
  const lines = groupScenarioPdfTextItemsIntoLines(items);
  const markers: ScenarioMarkerPosition[] = [];
  const debugEntries: MarkerDebugEntry[] = [];
  const acceptedPositions = new Set<string>();

  lines.forEach((line, pageLineIndex) => {
    const lineIndex = lineOffset + pageLineIndex;
    const candidates = buildLineCandidates(line.items);
    candidates.forEach((candidate) => {
      const inspection = inspectScenarioSceneMarker(candidate.text, {
        allowBare: candidate.allowBare
      });
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
        rawLength: inspection.rawLine.length,
        cleanedLength: inspection.cleanedLine.length,
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
        pageHeight,
        x: candidate.x,
        height: candidate.height,
        isBare: inspection.marker.isBare,
        edge: markerEdge(candidate.y, pageHeight)
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

export function selectCanonicalScenarioMarkers(markers: ScenarioMarkerPosition[]) {
  const ordered = [...markers].sort((left, right) =>
    left.pageIndex - right.pageIndex || left.y - right.y || left.lineIndex - right.lineIndex
  );
  const paginationIndices = findLikelyPdfPaginationMarkerIndices(
    ordered.map((marker) => ({
      pageNumber: marker.pageIndex + 1,
      edge: marker.edge,
      marker: {
        sceneNo: marker.sceneNo,
        originalLine: marker.title,
        isBare: marker.isBare
      }
    }))
  );
  const firstMarkerNumbers = new Set<string>();
  const contextualMarkers = ordered.filter(
    (marker, markerIndex) => !paginationIndices.has(markerIndex)
      && !isExactBareScenarioMarker(toScenarioSceneMarker(marker))
  );
  const accepted: ScenarioMarkerPosition[] = [];
  const rejected: Array<{
    marker: ScenarioMarkerPosition;
    reason: "pdf_pagination" | "ambiguous_bare_number" | "duplicate_scene_number";
  }> = [];
  ordered.forEach((marker, markerIndex) => {
    if (paginationIndices.has(markerIndex)) {
      rejected.push({ marker, reason: "pdf_pagination" });
      return;
    }
    if (
      contextualMarkers.length > 0
      && isExactBareScenarioMarker(toScenarioSceneMarker(marker))
      && !isAlignedWithContextualMarker(marker, contextualMarkers)
    ) {
      rejected.push({ marker, reason: "ambiguous_bare_number" });
      return;
    }
    if (firstMarkerNumbers.has(marker.sceneNo)) {
      rejected.push({ marker, reason: "duplicate_scene_number" });
      return;
    }
    firstMarkerNumbers.add(marker.sceneNo);
    accepted.push(marker);
  });
  return { markers: accepted, rejected };
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

function buildLineCandidates(items: ScenarioPositionedText[]) {
  const candidates: Array<{
    source: "line" | "cluster" | "item";
    text: string;
    y: number;
    allowBare: boolean;
    x: number;
    height: number;
  }> = [];
  const seen = new Set<string>();
  const add = (
    source: "line" | "cluster" | "item",
    row: ScenarioPositionedText[],
    allowBare: boolean
  ) => {
    if (row.length === 0) return;
    const text = joinScenarioPdfTextItems(row);
    const key = `${text}:${Math.round(Math.min(...row.map((item) => item.y)) * 2)}`;
    if (!text || seen.has(key)) return;
    seen.add(key);
    candidates.push({
      source,
      text,
      y: Math.min(...row.map((item) => item.y)),
      allowBare,
      x: Math.min(...row.map((item) => item.x)),
      height: Math.max(...row.map((item) => item.height))
    });
  };

  add("line", items, true);
  splitIntoHorizontalClusters(items).forEach((cluster, clusterIndex) => (
    add("cluster", cluster, clusterIndex === 0)
  ));
  items.forEach((item, startIndex) => {
    if (!mayStartSceneMarker(item.text)) return;
    for (
      let endIndex = startIndex + 2;
      endIndex <= Math.min(items.length, startIndex + 6);
      endIndex += 1
    ) {
      add("cluster", items.slice(startIndex, endIndex), startIndex === 0);
    }
  });
  items.forEach((item) => add("item", [item], items.length === 1));
  return candidates;
}

function mayStartSceneMarker(value: string) {
  const text = value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/^\s*(?:[•·▪◦●○▶▷※*]+\s*|[-–—]+\s*)/, "")
    .trim();
  return /^(?:S|SCENE|씬|#|\d)/i.test(text);
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

function markerEdge(y: number, pageHeight: number): ScenarioPdfMarkerEdge {
  const ratio = pageHeight > 0 ? y / pageHeight : 0.5;
  if (ratio <= 0.08) return "header";
  if (ratio >= 0.92) return "footer";
  return "body";
}

function toScenarioSceneMarker(marker: ScenarioMarkerPosition) {
  return {
    sceneNo: marker.sceneNo,
    originalLine: marker.title,
    isBare: marker.isBare
  };
}

function isAlignedWithContextualMarker(
  marker: ScenarioMarkerPosition,
  contextualMarkers: ScenarioMarkerPosition[]
) {
  return contextualMarkers.some((anchor) => {
    const horizontalTolerance = Math.max(12, anchor.height * 1.5);
    const heightRatio = marker.height / Math.max(anchor.height, 1);
    return Math.abs(marker.x - anchor.x) <= horizontalTolerance
      && heightRatio >= 0.65
      && heightRatio <= 1.55;
  });
}

function markerDebugEntry(marker: ScenarioMarkerPosition, rejectReason: string): MarkerDebugEntry {
  return {
    pageIndex: marker.pageIndex,
    lineIndex: marker.lineIndex,
    source: "line",
    rawLength: marker.title.length,
    cleanedLength: marker.title.length,
    normalizedSceneNo: marker.sceneNo,
    y: marker.y,
    accepted: false,
    rejectReason
  };
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

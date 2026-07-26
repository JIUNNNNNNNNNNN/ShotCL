"use client";

import {
  parseScenarioSceneMarker,
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

type PositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type MarkerPosition = {
  sceneNo: string;
  title: string;
  pageIndex: number;
  y: number;
  pageHeight: number;
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
  const markers: MarkerPosition[] = [];
  const firstMarkerNumbers = new Set<string>();
  const pageHeights: number[] = [];

  try {
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      pageHeights[pageIndex] = viewport.height;
      const textContent = await page.getTextContent();
      const lines = groupTextItemsIntoLines(
        textContent.items.flatMap((item) => {
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
        })
      );

      lines.forEach((line) => {
        const marker = parseScenarioSceneMarker(line.text);
        if (!marker || firstMarkerNumbers.has(marker.sceneNo)) return;
        firstMarkerNumbers.add(marker.sceneNo);
        markers.push({
          sceneNo: marker.sceneNo,
          title: marker.originalLine.slice(0, 240),
          pageIndex,
          y: line.y,
          pageHeight: viewport.height
        });
      });
      page.cleanup();
    }

    if (markers.length === 0) {
      throw new Error(SCENARIO_MARKER_NOT_FOUND_MESSAGE);
    }

    markers.sort((left, right) =>
      left.pageIndex - right.pageIndex || left.y - right.y
    );

    return markers.slice(0, 2_000).map((marker, index) => {
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
  } finally {
    await document.cleanup();
  }
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

function groupTextItemsIntoLines(items: PositionedText[]) {
  const sorted = [...items].sort((left, right) => left.y - right.y || left.x - right.x);
  const lines: Array<{ y: number; items: PositionedText[] }> = [];

  sorted.forEach((item) => {
    const tolerance = Math.max(3, Math.min(7, item.height * 0.45));
    const line = lines.findLast((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (line) {
      line.items.push(item);
      line.y = Math.min(line.y, item.y);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  });

  return lines.map((line) => {
    const row = [...line.items].sort((left, right) => left.x - right.x);
    let rightEdge = 0;
    let text = "";
    row.forEach((item, index) => {
      const averageCharacterWidth = item.text.length > 0
        ? item.width / item.text.length
        : item.height * 0.5;
      const gap = item.x - rightEdge;
      if (index > 0 && gap > Math.max(2, averageCharacterWidth * 0.45)) text += " ";
      text += item.text;
      rightEdge = Math.max(rightEdge, item.x + item.width);
    });
    return { text: text.trim(), y: Math.min(...row.map((item) => item.y)) };
  });
}

function buildImageSegments(
  marker: MarkerPosition,
  next: MarkerPosition | null,
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

function createSceneId(index: number) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `scenario-scene-${Date.now()}-${index}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

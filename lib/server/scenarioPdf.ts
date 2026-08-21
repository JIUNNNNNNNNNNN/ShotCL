import { SCENARIO_MARKER_NOT_FOUND_MESSAGE } from "@/lib/scenarioSceneMarker";
import {
  groupScenarioPdfTextItemsIntoLines,
  isScenarioPdfAnalysisRangeExceeded,
  joinScenarioPdfTextItems,
  SCENARIO_PDF_ANALYSIS_RANGE_MESSAGE,
  type ScenarioPositionedText
} from "@/lib/scenarioPdfTextLayout";
import { splitScenarioScenesByNumber } from "@/lib/server/scenarioSceneParser";
import type { ProjectScenarioScene } from "@/lib/types";

type PageText = {
  page: number;
  text: string;
};

const MAX_PDF_BYTES = 50 * 1024 * 1024;

export type ScenarioPdfExtraction = {
  scenes: ProjectScenarioScene[];
  error: string | null;
};

/** 기존 pdf.js의 visual text layout만 사용하며 원문은 외부로 전송하지 않습니다. */
export async function extractScenarioScenesFromPdf(buffer: Buffer): Promise<ScenarioPdfExtraction> {
  try {
    if (buffer.length === 0 || buffer.length > MAX_PDF_BYTES) {
      return failed("PDF 크기가 자동 분석 범위를 벗어났습니다. 원본 PDF 보기 또는 수동 씬 추가를 사용하세요.");
    }
    if (!buffer.subarray(0, 8).toString("latin1").startsWith("%PDF-")) {
      return failed("올바른 PDF 형식을 확인할 수 없습니다. 원본 PDF 보기 또는 수동 씬 추가를 사용하세요.");
    }

    const pages = await extractPageTextsWithPdfJs(buffer);
    const readablePages = pages.filter((page) => countReadableCharacters(page.text) >= 8);
    if (readablePages.length === 0) {
      return failed("텍스트를 추출할 수 없습니다. 원본 PDF 보기 또는 수동 씬 추가를 사용하세요.");
    }

    const scenes = splitScenarioScenesByNumber(readablePages);
    if (scenes.length === 0) {
      return failed(SCENARIO_MARKER_NOT_FOUND_MESSAGE);
    }
    return { scenes, error: null };
  } catch (error) {
    if (error instanceof ScenarioPdfAnalysisRangeError) return failed(error.message);
    return failed("PDF 텍스트 분석에 실패했습니다. 원본 PDF 보기 또는 수동 씬 추가를 사용하세요.");
  }
}

class ScenarioPdfAnalysisRangeError extends Error {}

type PdfJsTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

async function extractPageTextsWithPdfJs(buffer: Buffer): Promise<PageText[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const document = await loadingTask.promise;

  try {
    if (isScenarioPdfAnalysisRangeExceeded({ pageCount: document.numPages })) {
      throw new ScenarioPdfAnalysisRangeError(SCENARIO_PDF_ANALYSIS_RANGE_MESSAGE);
    }
    const pages: PageText[] = [];
    let totalCharacters = 0;
    let totalItems = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const items: ScenarioPositionedText[] = [];
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
              if (!isPdfJsTextItem(item) || !item.str.trim()) continue;
              totalItems += 1;
              totalCharacters += item.str.length;
              if (isScenarioPdfAnalysisRangeExceeded({
                textItemCount: totalItems,
                textCharacterCount: totalCharacters
              })) {
                throw new ScenarioPdfAnalysisRangeError(SCENARIO_PDF_ANALYSIS_RANGE_MESSAGE);
              }
              const transform = pdfjs.Util.transform(viewport.transform, item.transform);
              const height = Math.max(item.height || 0, Math.abs(transform[3]) || 0, 1);
              items.push({
                text: item.str,
                x: transform[4],
                y: clampPdfCoordinate(transform[5] - height, 0, viewport.height),
                width: Math.max(item.width, 0),
                height
              });
            }
          }
        } finally {
          if (!completed) await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        const text = groupScenarioPdfTextItemsIntoLines(items)
          .map((line) => joinScenarioPdfTextItems(line.items))
          .filter(Boolean)
          .join("\n");
        pages.push({ page: pageNumber, text: cleanExtractedText(text) });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }
}

function isPdfJsTextItem(value: unknown): value is PdfJsTextItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PdfJsTextItem>;
  return typeof item.str === "string"
    && Array.isArray(item.transform)
    && item.transform.length >= 6
    && typeof item.width === "number"
    && typeof item.height === "number";
}

function clampPdfCoordinate(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function failed(error: string): ScenarioPdfExtraction {
  return { scenes: [], error };
}

function cleanExtractedText(value: string) {
  return value
    .replace(/\u0000/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countReadableCharacters(value: string) {
  return (value.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

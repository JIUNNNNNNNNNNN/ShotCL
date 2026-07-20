import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { analyzeShotCandidates } from "@/lib/ai/analyzeShotCandidates";
import { analyzePdfWithVision, type VisionPdfAnalysisDebug } from "@/lib/analyzers/analyzePdfWithVision";
import { buildShotCandidates } from "@/lib/analyzers/buildShotCandidates";
import { detectTextCorruption } from "@/lib/analyzers/detectTextCorruption";
import type { ExtractedDocument } from "@/lib/analyzers/types";
import type { RenderedPdfPage } from "@/lib/analyzers/renderPdfPages";
import type { AnalysisDebugInfo, ExtractionPreview, ShotDraft, StoryboardAnalysisResult, TextQualityResult } from "@/lib/types";

const execFileAsync = promisify(execFile);

export type PdfImageAnalysisOutput =
  | {
      ok: true;
      result: StoryboardAnalysisResult & {
        extractionMethod: "ocr_image" | "vision_image";
        pageCount: number;
        extractedTextPreview: string;
      };
    }
  | {
      ok: false;
      error: string;
      failureReason: string;
      extractionPreview: ExtractionPreview;
      textQuality: TextQualityResult;
      warnings: string[];
      debug: AnalysisDebugInfo;
    };

type AnalyzePdfImagesInput = {
  fileName: string;
  fileType: string;
  projectName?: string;
  shootDate?: string;
  pages: RenderedPdfPage[];
  renderDpi: number;
  fallbackReason: string;
  nativeTextPreview: string;
  nativeTextQuality: TextQualityResult;
  warnings: string[];
};

type TesseractOcrResult = {
  engine: "tesseract";
  language: string;
  availableLanguages: string[];
  tesseractDataPath: string;
  text: string;
  textQuality: TextQualityResult;
  succeeded: boolean;
  failureReason: string;
  errorMessage: string;
};

/** PDF 렌더링 이미지에서 OCR을 보조로 시도하고, OCR 실패 시 비전 이미지 분석으로 자동 전환합니다. */
export async function analyzePdfImages(input: AnalyzePdfImagesInput): Promise<PdfImageAnalysisOutput> {
  const renderedImageInfo = buildRenderedImageInfo(input.pages, input.renderDpi);
  const renderedImagePreviewDataUrl = buildFirstPagePreview(input.pages);
  const ocrResult = await runTesseractOcr(input.pages);

  if (ocrResult.succeeded) {
    return analyzeSuccessfulOcr({ input, ocrResult, renderedImageInfo, renderedImagePreviewDataUrl });
  }

  const visionFallbackReason = "ocr_korean_recognition_failed";
  const visionAnalysis = await analyzePdfWithVision({
    fileName: input.fileName,
    fileType: input.fileType,
    pages: input.pages,
    renderDpi: input.renderDpi,
    fallbackReason: visionFallbackReason,
    ocrFailureReason: ocrResult.failureReason || "ocr_text_corrupted_or_no_korean_detected"
  });

  if (visionAnalysis.ok) {
    const visionResult = visionAnalysis.result;
    const combinedText = buildCombinedShotText(visionResult.shots);
    const visionTextQuality = detectTextCorruption(combinedText);
    const shotWarnings = findCorruptedShotWarnings(visionResult.shots);
    const warnings = [
      ...new Set([
        ...input.warnings,
        visionFallbackReason,
        "used_vision_image",
        ...visionResult.warnings,
        ...shotWarnings
      ])
    ];
    const extractionPreview = buildPreview({
      input,
      extractionMethod: "vision_image",
      fallbackReason: visionFallbackReason,
      textSample: combinedText.slice(0, 1000),
      textQuality: visionTextQuality,
      ocrResult,
      renderedImageInfo,
      renderedImagePreviewDataUrl,
      hasEncodingWarning: shotWarnings.length > 0,
      visionDebug: visionResult.debugPayload
    });
    const debug: AnalysisDebugInfo = {
      extractedTextSample: combinedText.slice(0, 4000),
      rawCandidates: visionResult.candidates,
      aiRawResponse: visionResult.rawResponse,
      textQuality: visionTextQuality,
      extractionPreview,
      promptPayloadSummary: {
        extractionMethod: "vision_image",
        fallbackReason: visionFallbackReason,
        ocrSucceeded: false,
        ocrFailureReason: ocrResult.failureReason,
        ocrEngine: ocrResult.engine,
        ocrLanguage: ocrResult.language,
        visionSucceeded: true,
        ...visionResult.debugPayload,
        renderedPageCount: input.pages.length,
        renderedImageInfo
      }
    };

    return {
      ok: true,
      result: {
        source: "openai",
        extractionMethod: "vision_image",
        pageCount: input.pages.length,
        extractedTextPreview: combinedText.slice(0, 1000),
        analyzerType: "vision_image",
        extractionPreview,
        textQuality: visionTextQuality,
        isTextCorrupted: shotWarnings.length > 0,
        failureReason: shotWarnings.length > 0 ? "shot_text_corrupted" : null,
        summary: {
          detectedSheetNames: ["PDF 이미지"],
          detectedHeaderRow: null,
          detectedColumns: {},
          detectedCandidateCount: visionResult.detectedShotCandidateCount,
          detectedShotCandidateCount: visionResult.detectedShotCandidateCount,
          detectedRowCount: input.pages.length,
          generatedShotCount: visionResult.generatedShotCount,
          confidence: visionResult.confidence,
          warnings,
          warning: warnings[0],
          rawTextSample: combinedText.slice(0, 1000)
        },
        stats: {
          detectedSheetNames: ["PDF 이미지"],
          detectedHeaderRow: null,
          detectedColumns: {},
          detectedCandidateCount: visionResult.detectedShotCandidateCount,
          detectedShotCandidateCount: visionResult.detectedShotCandidateCount,
          detectedRowCount: input.pages.length,
          generatedShotCount: visionResult.generatedShotCount,
          confidence: visionResult.confidence,
          warnings,
          warning: warnings[0],
          rawTextSample: combinedText.slice(0, 1000)
        },
        warning: warnings[0],
        shots: visionResult.shots,
        candidates: visionResult.candidates,
        debug
      }
    };
  }

  const failureTextQuality = ocrResult.textQuality;
  const warnings = [
    ...input.warnings,
    visionFallbackReason,
    ...visionAnalysis.warnings,
    "manual_review_required"
  ].filter(Boolean);
  const extractionPreview = buildPreview({
    input,
    extractionMethod: "manual_review",
    fallbackReason: visionAnalysis.failureReason || visionFallbackReason,
    textSample: ocrResult.text.slice(0, 1000),
    textQuality: failureTextQuality,
    ocrResult,
    renderedImageInfo,
    renderedImagePreviewDataUrl,
    hasEncodingWarning: true,
    visionDebug: visionAnalysis.debugPayload
  });
  const debug: AnalysisDebugInfo = {
    extractedTextSample: ocrResult.text.slice(0, 4000),
    rawCandidates: [],
    textQuality: failureTextQuality,
    extractionPreview,
    parseError: `${ocrResult.errorMessage}\n${visionAnalysis.error}`.trim(),
    promptPayloadSummary: {
      extractionMethod: "manual_review",
      fallbackReason: visionAnalysis.failureReason || visionFallbackReason,
      ocrEngine: ocrResult.engine,
      ocrLanguage: ocrResult.language,
      availableLanguages: ocrResult.availableLanguages,
      tesseractDataPath: ocrResult.tesseractDataPath,
      ocrSucceeded: false,
      ocrFailureReason: ocrResult.failureReason,
      visionSucceeded: false,
      ...visionAnalysis.debugPayload,
      renderedPageCount: input.pages.length,
      renderedImageInfo
    }
  };

  return {
    ok: false,
    error:
      visionAnalysis.failureReason === "vision_ai_not_configured"
        ? "PDF 이미지는 선명하지만 비전 AI 분석에 필요한 OPENAI_API_KEY가 설정되지 않았습니다. API 키를 설정하면 OCR 실패 후 vision_image로 자동 분석합니다."
        : visionAnalysis.failureReason === "vision_request_failed"
          ? visionAnalysis.error
        : "PDF 이미지는 렌더링됐지만 OCR과 비전 AI 분석이 모두 실패했습니다. 더 선명한 PDF 또는 페이지 캡처 이미지를 업로드하거나 비전 AI 설정을 확인해주세요.",
    failureReason: visionAnalysis.failureReason || "vision_image_failed",
    extractionPreview,
    textQuality: failureTextQuality,
    warnings,
    debug
  };
}

async function analyzeSuccessfulOcr(input: {
  input: AnalyzePdfImagesInput;
  ocrResult: TesseractOcrResult;
  renderedImageInfo: ExtractionPreview["renderedImageInfo"];
  renderedImagePreviewDataUrl: string;
}): Promise<PdfImageAnalysisOutput> {
  const document = buildOcrDocument(input.input, input.ocrResult.text);
  const candidateResult = buildShotCandidates(document);
  const result = await analyzeShotCandidates({
    fileName: input.input.fileName,
    fileType: input.input.fileType,
    projectName: input.input.projectName,
    shootDate: input.input.shootDate,
    detectedSheetNames: document.sheetNames,
    detectedHeaderRow: candidateResult.detectedHeaderRow,
    detectedColumns: candidateResult.detectedColumns,
    detectedRowCount: document.rows.length,
    candidates: candidateResult.candidates,
    rawTextSample: input.ocrResult.text.slice(0, 4000),
    warnings: [
      ...input.input.warnings,
      "used_pdf_image_ocr",
      ...candidateResult.warnings,
      ...findCorruptedShotWarnings(candidateResult.candidates.map(candidateToShotDraft))
    ]
  });
  const shotWarnings = findCorruptedShotWarnings(result.shots);
  const warnings = [...new Set([...(result.summary.warnings ?? []), ...shotWarnings])];
  const extractionPreview = buildPreview({
    input: input.input,
    extractionMethod: "ocr_image",
    fallbackReason: input.input.fallbackReason,
    textSample: input.ocrResult.text.slice(0, 1000),
    textQuality: input.ocrResult.textQuality,
    ocrResult: input.ocrResult,
    renderedImageInfo: input.renderedImageInfo,
    renderedImagePreviewDataUrl: input.renderedImagePreviewDataUrl,
    hasEncodingWarning: shotWarnings.length > 0
  });

  return {
    ok: true,
    result: {
      ...result,
      source: result.source,
      extractionMethod: "ocr_image",
      pageCount: input.input.pages.length,
      extractedTextPreview: input.ocrResult.text.slice(0, 1000),
      summary: {
        ...result.summary,
        warnings,
        warning: warnings[0]
      },
      stats: {
        ...result.stats,
        warnings,
        warning: warnings[0]
      },
      warning: warnings[0],
      extractionPreview,
      textQuality: input.ocrResult.textQuality,
      isTextCorrupted: shotWarnings.length > 0,
      failureReason: shotWarnings.length > 0 ? "shot_text_corrupted" : null,
      analyzerType: "ocr_image",
      debug: {
        ...result.debug,
        extractedTextSample: input.ocrResult.text.slice(0, 4000),
        textQuality: input.ocrResult.textQuality,
        extractionPreview,
        promptPayloadSummary: {
          ...(result.debug.promptPayloadSummary ?? {}),
          extractionMethod: "ocr_image",
          fallbackReason: input.input.fallbackReason,
          ocrEngine: input.ocrResult.engine,
          ocrLanguage: input.ocrResult.language,
          visionRequestSent: false,
          visionResponseReceived: false,
          renderedPageCount: input.input.pages.length,
          renderedImageInfo: input.renderedImageInfo
        }
      }
    }
  };
}

async function runTesseractOcr(pages: RenderedPdfPage[]): Promise<TesseractOcrResult> {
  const language = process.env.TESSERACT_LANG || process.env.OCR_LANG || "kor+eng";
  const tesseractDataPath = process.env.TESSDATA_PREFIX || "";
  const emptyQuality = detectTextCorruption("");
  const tesseractPath = resolveTesseractPath();
  const base: Omit<TesseractOcrResult, "text" | "textQuality" | "succeeded" | "failureReason" | "errorMessage"> = {
    engine: "tesseract",
    language,
    availableLanguages: [],
    tesseractDataPath
  };

  try {
    const availableLanguages = await listTesseractLanguages(tesseractPath);
    const languageCheck = checkRequestedLanguages(language, availableLanguages);

    if (!languageCheck.ok) {
      return {
        ...base,
        availableLanguages,
        text: "",
        textQuality: emptyQuality,
        succeeded: false,
        failureReason: languageCheck.reason,
        errorMessage: `요청 언어 ${language} / 사용 가능 언어 ${availableLanguages.join(", ") || "없음"}`
      };
    }

    const text = await ocrPagesWithTesseract(tesseractPath, pages, language);
    const textQuality = detectTextCorruption(text);
    const koreanUsable = isUsableKoreanText(textQuality);

    return {
      ...base,
      availableLanguages,
      text,
      textQuality,
      succeeded: koreanUsable,
      failureReason: koreanUsable ? "" : "ocr_text_corrupted_or_no_korean_detected",
      errorMessage: koreanUsable ? "" : "OCR 결과에서 정상 한글을 충분히 찾지 못했습니다."
    };
  } catch (error) {
    return {
      ...base,
      text: "",
      textQuality: emptyQuality,
      succeeded: false,
      failureReason: "tesseract_not_available_or_failed",
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

function resolveTesseractPath() {
  const configuredPath = process.env.TESSERACT_PATH;
  if (configuredPath && existsSync(configuredPath)) return configuredPath;
  return configuredPath || "tesseract";
}

async function listTesseractLanguages(tesseractPath: string) {
  const { stdout } = await execFileAsync(tesseractPath, ["--list-langs"], {
    env: process.env,
    maxBuffer: 1024 * 1024
  });

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^List of available languages/i.test(line));
}

function checkRequestedLanguages(language: string, availableLanguages: string[]) {
  const requested = language.split("+").map((item) => item.trim()).filter(Boolean);
  const missing = requested.filter((item) => !availableLanguages.includes(item));

  if (!requested.includes("kor")) {
    return { ok: false, reason: "tesseract_korean_language_not_requested" };
  }

  if (missing.includes("kor")) {
    return { ok: false, reason: "tesseract_korean_language_missing" };
  }

  if (missing.length > 0) {
    return { ok: false, reason: "tesseract_requested_language_missing" };
  }

  return { ok: true, reason: "" };
}

async function ocrPagesWithTesseract(tesseractPath: string, pages: RenderedPdfPage[], language: string) {
  const workDir = await mkdtemp(path.join(tmpdir(), "storyboard-ocr-"));
  const texts: string[] = [];

  try {
    for (const page of pages) {
      const imagePath = path.join(workDir, `page-${page.pageNumber}.png`);
      await writeFile(imagePath, page.imageBuffer);
      const { stdout } = await execFileAsync(tesseractPath, [imagePath, "stdout", "-l", language, "--psm", "6"], {
        env: process.env,
        maxBuffer: 1024 * 1024 * 20
      });
      texts.push(`--- page ${page.pageNumber} ---\n${stdout.trim()}`);
    }

    return texts.join("\n\n").trim();
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function buildOcrDocument(input: AnalyzePdfImagesInput, text: string): ExtractedDocument {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 2)
    .slice(0, 1000);

  return {
    kind: "pdf",
    fileName: input.fileName,
    fileType: input.fileType,
    extractionMethod: "ocr-image-tesseract",
    sheetNames: ["PDF OCR"],
    rows: lines.map((line, index) => ({ rowNumber: index + 1, cells: [line] })),
    rawText: text.slice(0, 8000),
    warnings: []
  };
}

function buildPreview(input: {
  input: AnalyzePdfImagesInput;
  extractionMethod: "ocr_image" | "vision_image" | "manual_review";
  fallbackReason: string;
  textSample: string;
  textQuality: TextQualityResult;
  ocrResult: TesseractOcrResult;
  renderedImageInfo: ExtractionPreview["renderedImageInfo"];
  renderedImagePreviewDataUrl: string;
  hasEncodingWarning: boolean;
  visionDebug?: VisionPdfAnalysisDebug;
}): ExtractionPreview {
  return {
    fileName: input.input.fileName,
    fileType: input.input.fileType,
    extractionMethod: input.extractionMethod,
    nativeTextPreview: input.input.nativeTextPreview,
    nativeTextQuality: input.input.nativeTextQuality,
    usedFallback: true,
    fallbackReason: input.fallbackReason,
    ocrPageCount: input.input.pages.length,
    renderedPageCount: input.input.pages.length,
    renderedImageInfo: input.renderedImageInfo,
    renderedImagePreviewDataUrl: input.renderedImagePreviewDataUrl,
    ocrTextPreview: input.ocrResult.text.slice(0, 1000),
    ocrTextQuality: input.ocrResult.textQuality,
    ocrEngine: input.ocrResult.engine,
    ocrLanguage: input.ocrResult.language,
    availableLanguages: input.ocrResult.availableLanguages,
    tesseractDataPath: input.ocrResult.tesseractDataPath,
    ocrErrorMessage: input.ocrResult.errorMessage,
    ocrSucceeded: input.ocrResult.succeeded,
    ocrFailureReason: input.ocrResult.failureReason,
    openaiApiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    visionSucceeded: input.extractionMethod === "vision_image",
    visionModelUsed: input.visionDebug?.visionModelUsed ?? "",
    visionRequestSent: Boolean(input.visionDebug?.visionRequestSent),
    visionResponseReceived: Boolean(input.visionDebug?.visionResponseReceived),
    visionRawResponsePreview: input.visionDebug?.visionRawResponsePreview ?? "",
    parsedShotCount: input.visionDebug?.parsedShotCount ?? 0,
    imageMimeType: input.visionDebug?.imageMimeType ?? "image/png",
    imageByteSize: input.visionDebug?.imageByteSize ?? input.input.pages[0]?.imageBuffer.byteLength ?? 0,
    firstPageImageWidth: input.visionDebug?.firstPageImageWidth ?? input.input.pages[0]?.width ?? 0,
    firstPageImageHeight: input.visionDebug?.firstPageImageHeight ?? input.input.pages[0]?.height ?? 0,
    firstPageImageDpi: input.visionDebug?.firstPageImageDpi ?? input.input.renderDpi,
    textSample: input.textSample,
    textQuality: input.textQuality,
    hasEncodingWarning: input.hasEncodingWarning
  };
}

function buildRenderedImageInfo(pages: RenderedPdfPage[], dpi: number) {
  return pages.map((page) => ({
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    byteSize: page.imageBuffer.byteLength,
    dpi
  }));
}

function buildFirstPagePreview(pages: RenderedPdfPage[]) {
  const firstPage = pages[0];
  if (!firstPage) return "";
  return `data:image/png;base64,${firstPage.imageBuffer.toString("base64")}`;
}

function isUsableKoreanText(quality: TextQualityResult) {
  return (
    quality.totalLength >= 20 &&
    quality.koreanCharCount >= 10 &&
    quality.koreanRatio >= 0.03 &&
    quality.suspiciousRatio < 0.05 &&
    !quality.warnings.some((warning) => warning.includes("깨진"))
  );
}

function findCorruptedShotWarnings(shots: ShotDraft[]) {
  const warnings: string[] = [];

  shots.forEach((shot, index) => {
    const combined = [shot.title, shot.description, shot.location, shot.memo, ...shot.characters].join(" ");
    const quality = detectTextCorruption(combined);

    if (quality.suspiciousRatio >= 0.05 || quality.suspiciousCharCount >= 5 || combined.includes("�")) {
      warnings.push(`${index + 1}번 컷에 깨진 문자로 보이는 내용이 있습니다. 확정 전에 수정해주세요.`);
    }
  });

  return warnings;
}

function candidateToShotDraft(candidate: StoryboardAnalysisResult["candidates"][number]): ShotDraft {
  return {
    sceneNumber: candidate.sceneNumber || "1",
    cutNumber: candidate.cutNumber || String(candidate.orderIndex),
    title: candidate.title,
    description: candidate.description,
    location: candidate.location,
    characters: candidate.characters,
    memo: candidate.memo,
    orderIndex: candidate.orderIndex,
    status: "pending",
    sourceSheet: candidate.sourceSheet,
    sourcePage: candidate.sourcePage ?? null,
    sourceRow: candidate.sourceRow ?? null
  };
}

function buildCombinedShotText(shots: ShotDraft[]) {
  return shots
    .map((shot) => [shot.sceneNumber, shot.cutNumber, shot.title, shot.description, shot.location, shot.characters.join(", "), shot.memo].filter(Boolean).join(" "))
    .join("\n");
}

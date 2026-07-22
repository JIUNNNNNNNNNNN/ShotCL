import { NextRequest, NextResponse } from "next/server";
import { analyzeShotCandidates } from "@/lib/ai/analyzeShotCandidates";
import { extractExcel } from "@/lib/analyzers/extractExcel";
import { extractPdf } from "@/lib/analyzers/extractPdf";
import { buildShotCandidates } from "@/lib/analyzers/buildShotCandidates";
import { decodeTextBuffer, detectTextCorruption } from "@/lib/analyzers/detectTextCorruption";
import { analyzePdfImages } from "@/lib/analyzers/analyzePdfImages";
import { renderPdfPages } from "@/lib/analyzers/renderPdfPages";
import { createAnalysisRunOnServer } from "@/lib/data/analysisRunServer";
import type { ExtractedDocument } from "@/lib/analyzers/types";
import type { ExtractionPreview } from "@/lib/types";
import { canAdministerProject, ProjectAccessUnavailableError } from "@/lib/projectAccess/server";

export const runtime = "nodejs";

/** 업로드된 원본 파일을 분석해 컷 후보와 미리보기용 shots를 반환합니다. 저장은 하지 않습니다. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    try {
      if (!(await canAdministerProject(request, projectId))) {
        return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
      }
    } catch (error) {
      if (!(error instanceof ProjectAccessUnavailableError)) throw error;
      // Supabase가 없는 로컬 개발 모드에서는 기존 분석 흐름을 유지합니다.
    }
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "분석할 파일이 없습니다." }, { status: 400 });
    }

    const fileName = String(formData.get("fileName") || file.name || "storyboard");
    const projectName = String(formData.get("projectName") || "");
    const shootDate = String(formData.get("shootDate") || "");
    const sourceFileUrl = String(formData.get("sourceFileUrl") || formData.get("storagePath") || "") || null;
    const buffer = Buffer.from(await file.arrayBuffer());
    const document = extractDocument(buffer, fileName, file.type || "unknown");
    const textQuality = detectTextCorruption(document.rawText);
    const extractionPreview = buildExtractionPreview(document, textQuality);

    if (shouldUsePdfImageFallback(document, textQuality)) {
      const fallbackReason = document.rawText.replace(/\s+/g, "").length < 80 ? "scanned_pdf_likely" : "native_pdf_text_corrupted";
      let renderedPageCount = 0;
      const renderDpi = 300;

      try {
        const pages = await renderPdfPages(buffer, { dpi: renderDpi, maxPages: 5 });
        renderedPageCount = pages.length;

        if (pages.length === 0) {
          throw new Error("PDF 페이지 이미지가 생성되지 않았습니다.");
        }

        const imageAnalysis = await analyzePdfImages({
          fileName,
          fileType: file.type || "application/pdf",
          projectName,
          shootDate,
          pages,
          renderDpi,
          fallbackReason,
          nativeTextPreview: document.rawText.slice(0, 1000),
          nativeTextQuality: textQuality,
          warnings: [...document.warnings, fallbackReason]
        });

        if (!imageAnalysis.ok) {
          return createFailedPdfImageResponse({
            projectId,
            fileName,
            fileType: file.type || "application/pdf",
            sourceFileUrl,
            document,
            textQuality,
            extractionPreview: imageAnalysis.extractionPreview,
            fallbackReason,
            renderedPageCount,
            authorizationHeader: request.headers.get("authorization"),
            cause: imageAnalysis.error,
            failureReason: imageAnalysis.failureReason,
            warnings: imageAnalysis.warnings,
            debug: imageAnalysis.debug,
            responseError: imageAnalysis.error,
            responseTextQuality: imageAnalysis.textQuality
          });
        }

        const imageResult = imageAnalysis.result;
        const imageTextQuality = imageResult.textQuality ?? imageResult.extractionPreview?.textQuality ?? detectTextCorruption(imageResult.extractedTextPreview);
        const fallbackPreview = imageResult.extractionPreview ?? extractionPreview;
        const persistencePreview = stripPreviewImages(fallbackPreview);
        const resultWithFallback = {
          ...imageResult,
          extractionPreview: fallbackPreview,
          textQuality: imageTextQuality,
          isTextCorrupted: Boolean(imageResult.isTextCorrupted),
          failureReason: imageResult.failureReason ?? null,
          analyzerType: imageResult.analyzerType ?? fallbackPreview.extractionMethod,
          debug: {
            ...imageResult.debug,
            textQuality: imageTextQuality,
            extractionPreview: persistencePreview,
            nativeTextQuality: textQuality
          }
        };
        const persistedResultWithFallback = {
          ...resultWithFallback,
          extractionPreview: persistencePreview,
          debug: {
            ...resultWithFallback.debug,
            extractionPreview: persistencePreview
          }
        };
        let analysisRunId: string | null = null;
        let analysisRunPersistenceWarning = "";

        try {
          const run = await createAnalysisRunOnServer(
            {
              projectId,
              sourceFileName: fileName,
              sourceFileType: file.type || "application/pdf",
              sourceFileUrl,
              analyzerType: resultWithFallback.analyzerType,
              status: "preview",
              detectedRowCount: pages.length,
              detectedShotCandidateCount: imageResult.summary.detectedShotCandidateCount ?? imageResult.summary.detectedCandidateCount,
              generatedShotCount: imageResult.summary.generatedShotCount,
              finalShotCount: 0,
              aiRawResult: persistedResultWithFallback,
              aiNormalizedShots: imageResult.shots,
              finalConfirmedShots: [],
              warnings: resultWithFallback.summary.warnings ?? [],
              debugPayload: {
                ...resultWithFallback.debug,
                extraction_method: fallbackPreview.extractionMethod,
                native_text_preview: document.rawText.slice(0, 1000),
                native_text_quality: textQuality,
                ocr_text_preview: fallbackPreview.ocrTextPreview ?? "",
                ocr_text_quality: fallbackPreview.ocrTextQuality ?? null,
                ocr_engine: fallbackPreview.ocrEngine ?? "",
                ocr_language: fallbackPreview.ocrLanguage ?? "",
                available_languages: fallbackPreview.availableLanguages ?? [],
                tesseract_data_path: fallbackPreview.tesseractDataPath ?? "",
                ocr_error_message: fallbackPreview.ocrErrorMessage ?? "",
                ocr_succeeded: Boolean(fallbackPreview.ocrSucceeded),
                ocr_failure_reason: fallbackPreview.ocrFailureReason ?? "",
                openai_api_key_configured: Boolean(fallbackPreview.openaiApiKeyConfigured),
                vision_succeeded: Boolean(fallbackPreview.visionSucceeded),
                vision_model_used: fallbackPreview.visionModelUsed ?? "",
                vision_request_sent: Boolean(fallbackPreview.visionRequestSent),
                vision_response_received: Boolean(fallbackPreview.visionResponseReceived),
                vision_raw_response_preview: fallbackPreview.visionRawResponsePreview ?? "",
                parsed_shot_count: fallbackPreview.parsedShotCount ?? 0,
                image_mime_type: fallbackPreview.imageMimeType ?? "",
                image_byte_size: fallbackPreview.imageByteSize ?? 0,
                first_page_image_width: fallbackPreview.firstPageImageWidth ?? 0,
                first_page_image_height: fallbackPreview.firstPageImageHeight ?? 0,
                first_page_image_dpi: fallbackPreview.firstPageImageDpi ?? 0,
                used_fallback: true,
                fallback_reason: fallbackReason,
                rendered_page_count: pages.length,
                rendered_image_info: fallbackPreview.renderedImageInfo ?? [],
                ocr_page_count: pages.length,
                extracted_text_preview: imageResult.extractedTextPreview,
                is_text_corrupted: Boolean(imageResult.isTextCorrupted),
                failure_reason: imageResult.failureReason ?? ""
              },
              textQuality: imageTextQuality,
              isTextCorrupted: Boolean(imageResult.isTextCorrupted),
              failureReason: imageResult.failureReason ?? ""
            },
            request.headers.get("authorization")
          );

          analysisRunId = run?.id ?? null;
        } catch (error) {
          analysisRunPersistenceWarning =
            error instanceof Error
              ? `분석 기록 저장 실패: ${error.message}. Supabase SQL migration을 실행했는지 확인하세요.`
              : "분석 기록 저장 실패: Supabase SQL migration을 실행했는지 확인하세요.";
        }

        return NextResponse.json({
          ...resultWithFallback,
          analysisRunId,
          analysisRunPersistenceWarning,
          analyzerType: resultWithFallback.analyzerType,
          projectId,
          fileName,
          fileType: file.type || "application/pdf",
          sourceFileUrl
        });
      } catch (error) {
        return createFailedPdfImageResponse({
          projectId,
          fileName,
          fileType: file.type || "application/pdf",
          sourceFileUrl,
          document,
          textQuality,
          extractionPreview,
          fallbackReason,
          renderedPageCount,
          authorizationHeader: request.headers.get("authorization"),
          cause: error
        });
      }
    }

    if (textQuality.isLikelyCorrupted) {
      let analysisRunId: string | null = null;
      const warnings = ["encoding_error", ...document.warnings, ...textQuality.warnings];

      try {
        const run = await createAnalysisRunOnServer(
          {
            projectId,
            sourceFileName: fileName,
            sourceFileType: file.type || "unknown",
            sourceFileUrl,
            analyzerType: getAnalyzerType(document, "rules"),
            status: "failed",
            detectedRowCount: document.rows.length,
            detectedShotCandidateCount: 0,
            generatedShotCount: 0,
            finalShotCount: 0,
            aiRawResult: null,
            aiNormalizedShots: [],
            finalConfirmedShots: [],
            warnings,
            debugPayload: {
              extractionPreview,
              textQuality,
              detectedRows: document.rows.slice(0, 30)
            },
            textQuality,
            isTextCorrupted: true,
            failureReason: "encoding_error"
          },
          request.headers.get("authorization")
        );

        analysisRunId = run?.id ?? null;
      } catch {
        analysisRunId = null;
      }

      return NextResponse.json(
        {
          error:
            document.kind === "pdf"
              ? "이 PDF는 한글 텍스트 추출이 제대로 되지 않았습니다. 현재 단계에서는 Excel(.xlsx) 파일로 업로드하면 더 정확하게 분석할 수 있습니다."
              : "파일의 한글 텍스트가 깨져서 분석할 수 없습니다. Excel 원본 파일(.xlsx)로 다시 업로드해주세요. 깨진 결과는 AI 분석 기록이나 컷 리스트에 저장하지 않았습니다.",
          analysisRunId,
          extractionPreview,
          textQuality,
          isTextCorrupted: true,
          failureReason: "encoding_error",
          warnings
        },
        { status: 422 }
      );
    }

    const candidateResult = buildShotCandidates(document);
    const result = await analyzeShotCandidates({
      fileName,
      fileType: file.type || "unknown",
      projectName,
      shootDate,
      detectedSheetNames: document.sheetNames,
      detectedHeaderRow: candidateResult.detectedHeaderRow,
      detectedColumns: candidateResult.detectedColumns,
      detectedRowCount: document.rows.length,
      candidates: candidateResult.candidates,
      rawTextSample: document.rawText.slice(0, 4000),
      warnings: [...document.warnings, ...candidateResult.warnings]
    });
    const analyzerType = getAnalyzerType(document, result.source);
    const resultWithQuality = {
      ...result,
      extractionPreview,
      textQuality,
      isTextCorrupted: false,
      failureReason: null,
      debug: {
        ...result.debug,
        textQuality,
        extractionPreview
      }
    };
    let analysisRunId: string | null = null;
    let analysisRunPersistenceWarning = "";

    try {
      const run = await createAnalysisRunOnServer(
        {
          projectId,
          sourceFileName: fileName,
          sourceFileType: file.type || "unknown",
          sourceFileUrl,
          analyzerType,
          detectedRowCount: result.summary.detectedRowCount,
          detectedShotCandidateCount: result.summary.detectedShotCandidateCount ?? result.summary.detectedCandidateCount,
          generatedShotCount: result.summary.generatedShotCount,
          aiRawResult: resultWithQuality,
          aiNormalizedShots: result.shots,
          warnings: result.summary.warnings ?? (result.warning ? [result.warning] : []),
          debugPayload: resultWithQuality.debug,
          textQuality,
          isTextCorrupted: false,
          failureReason: ""
        },
        request.headers.get("authorization")
      );

      analysisRunId = run?.id ?? null;
    } catch (error) {
      analysisRunPersistenceWarning =
        error instanceof Error
          ? `분석 기록 저장 실패: ${error.message}. Supabase SQL migration을 실행했는지 확인하세요.`
          : "분석 기록 저장 실패: Supabase SQL migration을 실행했는지 확인하세요.";
    }

    return NextResponse.json({
      ...resultWithQuality,
      analysisRunId,
      analysisRunPersistenceWarning,
      analyzerType,
      projectId,
      fileName,
      fileType: file.type || "unknown",
      sourceFileUrl
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "분석 중 알 수 없는 오류가 발생했습니다."
      },
      { status: 500 }
    );
  }
}

function getAnalyzerType(document: ExtractedDocument, source: string) {
  if (source === "openai") return "openai";
  if (source === "mock" || source === "mock-fallback") return source;
  if (document.kind === "excel") return "excel-rule";
  if (document.kind === "pdf") return "pdf-rule";
  return "mock";
}

function shouldUsePdfImageFallback(document: ExtractedDocument, textQuality: ReturnType<typeof detectTextCorruption>) {
  if (document.kind !== "pdf") return false;
  const compactTextLength = document.rawText.replace(/\s+/g, "").length;
  return textQuality.isLikelyCorrupted || compactTextLength < 80;
}

async function createFailedPdfImageResponse(input: {
  projectId: string;
  fileName: string;
  fileType: string;
  sourceFileUrl: string | null;
  document: ExtractedDocument;
  textQuality: ReturnType<typeof detectTextCorruption>;
  extractionPreview: ExtractionPreview;
  fallbackReason: string;
  renderedPageCount: number;
  authorizationHeader: string | null;
  cause: unknown;
  failureReason?: string;
  warnings?: string[];
  debug?: unknown;
  responseError?: string;
  responseTextQuality?: ReturnType<typeof detectTextCorruption>;
}) {
  let analysisRunId: string | null = null;
  const failureReason = input.failureReason ?? "ocr_image_failed";
  const responseTextQuality = input.responseTextQuality ?? input.extractionPreview.ocrTextQuality ?? input.textQuality;
  const warnings = input.warnings ?? ["ocr_image_failed", input.fallbackReason, ...input.document.warnings, ...input.textQuality.warnings];
  const persistencePreview = stripPreviewImages(input.extractionPreview);

  try {
    const run = await createAnalysisRunOnServer(
      {
        projectId: input.projectId,
        sourceFileName: input.fileName,
        sourceFileType: input.fileType,
        sourceFileUrl: input.sourceFileUrl,
        analyzerType: input.extractionPreview.extractionMethod || "manual_review",
        status: "failed",
        detectedRowCount: input.renderedPageCount,
        detectedShotCandidateCount: 0,
        generatedShotCount: 0,
        finalShotCount: 0,
        aiRawResult: null,
        aiNormalizedShots: [],
        finalConfirmedShots: [],
        warnings,
        debugPayload: {
          ...sanitizeDebugPayload(input.debug),
          extraction_method: input.extractionPreview.extractionMethod,
          native_text_preview: input.document.rawText.slice(0, 1000),
          native_text_quality: input.textQuality,
          ocr_text_preview: input.extractionPreview.ocrTextPreview ?? "",
          ocr_text_quality: input.extractionPreview.ocrTextQuality ?? null,
          ocr_engine: input.extractionPreview.ocrEngine ?? "",
          ocr_language: input.extractionPreview.ocrLanguage ?? "",
          available_languages: input.extractionPreview.availableLanguages ?? [],
          tesseract_data_path: input.extractionPreview.tesseractDataPath ?? "",
          ocr_error_message: input.extractionPreview.ocrErrorMessage ?? "",
          ocr_succeeded: Boolean(input.extractionPreview.ocrSucceeded),
          ocr_failure_reason: input.extractionPreview.ocrFailureReason ?? failureReason,
          openai_api_key_configured: Boolean(input.extractionPreview.openaiApiKeyConfigured),
          vision_succeeded: Boolean(input.extractionPreview.visionSucceeded),
          vision_model_used: input.extractionPreview.visionModelUsed ?? "",
          vision_request_sent: Boolean(input.extractionPreview.visionRequestSent),
          vision_response_received: Boolean(input.extractionPreview.visionResponseReceived),
          vision_raw_response_preview: input.extractionPreview.visionRawResponsePreview ?? "",
          parsed_shot_count: input.extractionPreview.parsedShotCount ?? 0,
          image_mime_type: input.extractionPreview.imageMimeType ?? "",
          image_byte_size: input.extractionPreview.imageByteSize ?? 0,
          first_page_image_width: input.extractionPreview.firstPageImageWidth ?? 0,
          first_page_image_height: input.extractionPreview.firstPageImageHeight ?? 0,
          first_page_image_dpi: input.extractionPreview.firstPageImageDpi ?? 0,
          used_fallback: true,
          fallback_reason: input.fallbackReason,
          rendered_page_count: input.renderedPageCount,
          rendered_image_info: input.extractionPreview.renderedImageInfo ?? [],
          extraction_preview: persistencePreview,
          ocr_page_count: input.renderedPageCount,
          extracted_text_preview: input.document.rawText.slice(0, 1000),
          is_text_corrupted: true,
          failure_reason: failureReason,
          cause: input.cause instanceof Error ? input.cause.message : String(input.cause)
        },
        textQuality: responseTextQuality,
        isTextCorrupted: true,
        failureReason
      },
      input.authorizationHeader
    );

    analysisRunId = run?.id ?? null;
  } catch {
    analysisRunId = null;
  }

  return NextResponse.json(
    {
      error:
        input.responseError ??
        "PDF 이미지 분석도 실패했습니다. 이 파일은 스캔 상태가 좋지 않거나 글자가 너무 작을 수 있습니다. 더 선명한 PDF 또는 페이지 캡처 이미지를 업로드해주세요.",
      analysisRunId,
      extractionPreview: input.extractionPreview,
      textQuality: responseTextQuality,
      isTextCorrupted: true,
      failureReason,
      warnings
    },
    { status: 422 }
  );
}

function buildExtractionPreview(document: ExtractedDocument, textQuality: ReturnType<typeof detectTextCorruption>): ExtractionPreview {
  return {
    fileName: document.fileName,
    fileType: document.fileType,
    extractionMethod: document.extractionMethod,
    nativeTextPreview: document.rawText.slice(0, 1000),
    nativeTextQuality: textQuality,
    usedFallback: false,
    fallbackReason: "",
    ocrPageCount: 0,
    textSample: document.rawText.slice(0, 1000),
    textQuality,
    hasEncodingWarning: textQuality.isLikelyCorrupted
  };
}

function stripPreviewImages(preview: ExtractionPreview): ExtractionPreview {
  return {
    ...preview,
    renderedImagePreviewDataUrl: preview.renderedImagePreviewDataUrl ? "[development preview omitted from database]" : ""
  };
}

function sanitizeDebugPayload(debug: unknown) {
  if (typeof debug !== "object" || debug === null) return {};
  const payload = debug as Record<string, unknown>;
  const extractionPreview = payload.extractionPreview;

  return {
    ...payload,
    extractionPreview: typeof extractionPreview === "object" && extractionPreview !== null ? stripPreviewImages(extractionPreview as ExtractionPreview) : extractionPreview
  };
}

function extractDocument(buffer: Buffer, fileName: string, fileType: string): ExtractedDocument {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (["xlsx", "xls", "csv", "tsv"].includes(extension) || /spreadsheet|excel|csv/.test(fileType)) {
    return extractExcel(buffer, fileName, fileType);
  }

  if (extension === "pdf" || fileType === "application/pdf") {
    return extractPdf(buffer, fileName, fileType);
  }

  const decoded = decodeTextBuffer(buffer);
  return {
    kind: "text",
    fileName,
    fileType,
    extractionMethod: `text-${decoded.encoding}`,
    sheetNames: [],
    rows: decoded.text
      .split(/\r?\n/)
      .map((line, index) => ({ rowNumber: index + 1, cells: [line.trim()] }))
      .filter((row) => row.cells.some(Boolean)),
    rawText: decoded.text.slice(0, 8000),
    warnings: ["이미지 OCR은 이번 단계에서 제외되어 텍스트 파일처럼 분석했습니다."]
  };
}

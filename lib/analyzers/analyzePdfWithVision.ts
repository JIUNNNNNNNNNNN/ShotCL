import type { RenderedPdfPage } from "@/lib/analyzers/renderPdfPages";
import type { AnalyzeStats, ShotCandidate, ShotDraft } from "@/lib/types";

export type VisionPdfAnalysisDebug = {
  renderedPageCount: number;
  firstPageImageWidth: number;
  firstPageImageHeight: number;
  firstPageImageDpi: number;
  imageMimeType: string;
  imageByteSize: number;
  visionModelUsed: string;
  openaiApiKeyConfigured: boolean;
  visionRequestSent: boolean;
  visionResponseReceived: boolean;
  visionRawResponsePreview: string;
  parsedShotCount: number;
  warnings: string[];
};

export type VisionPdfAnalysisResult = {
  extractionMethod: "vision_image";
  pageCount: number;
  detectedShotCandidateCount: number;
  generatedShotCount: number;
  confidence: "low" | "medium" | "high";
  shots: ShotDraft[];
  candidates: ShotCandidate[];
  warnings: string[];
  rawResponse: string;
  debugPayload: VisionPdfAnalysisDebug;
};

export type VisionPdfAnalysisOutput =
  | { ok: true; result: VisionPdfAnalysisResult }
  | { ok: false; error: string; failureReason: string; debugPayload: VisionPdfAnalysisDebug; warnings: string[] };

type AnalyzePdfWithVisionInput = {
  fileName: string;
  fileType: string;
  pages: RenderedPdfPage[];
  renderDpi: number;
  fallbackReason: string;
  ocrFailureReason: string;
};

const imageMimeType = "image/png";

/** PDF 페이지 이미지를 비전 AI에 직접 전달해 일촬영표의 컷 리스트 JSON을 생성합니다. */
export async function analyzePdfWithVision(input: AnalyzePdfWithVisionInput): Promise<VisionPdfAnalysisOutput> {
  const model = process.env.OPENAI_PDF_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-5";
  const apiKey = process.env.OPENAI_API_KEY;
  const firstPage = input.pages[0] ?? null;
  const baseDebug: VisionPdfAnalysisDebug = {
    renderedPageCount: input.pages.length,
    firstPageImageWidth: firstPage?.width ?? 0,
    firstPageImageHeight: firstPage?.height ?? 0,
    firstPageImageDpi: input.renderDpi,
    imageMimeType,
    imageByteSize: firstPage?.imageBuffer.byteLength ?? 0,
    visionModelUsed: model,
    openaiApiKeyConfigured: Boolean(apiKey),
    visionRequestSent: false,
    visionResponseReceived: false,
    visionRawResponsePreview: "",
    parsedShotCount: 0,
    warnings: []
  };

  if (!apiKey) {
    return {
      ok: false,
      error: "PDF 이미지는 선명하지만 비전 AI 분석에 필요한 OPENAI_API_KEY가 설정되지 않았습니다.",
      failureReason: "vision_ai_not_configured",
      debugPayload: {
        ...baseDebug,
        warnings: ["vision_ai_not_configured"]
      },
      warnings: ["vision_ai_not_configured"]
    };
  }

  try {
    const requestBody = buildVisionRequestBody(input, model);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const readableError = summarizeVisionError(errorText);
      return {
        ok: false,
        error: readableError,
        failureReason: "vision_request_failed",
        debugPayload: {
          ...baseDebug,
          visionRequestSent: true,
          visionResponseReceived: true,
          visionRawResponsePreview: errorText.slice(0, 1000),
          warnings: ["vision_request_failed"]
        },
        warnings: ["vision_request_failed"]
      };
    }

    const data = (await response.json()) as { output_text?: string; output?: unknown };
    const rawResponse = data.output_text || extractResponseOutputText(data.output);
    const parsed = parseVisionJson(rawResponse);
    const shots = normalizeVisionShots(parsed.shots);
    const warnings = Array.isArray(parsed.summary?.warnings) ? parsed.summary.warnings.map(String) : [];

    if (shots.length === 0) {
      return {
        ok: false,
        error: "비전 AI가 PDF 이미지를 분석했지만 컷 리스트를 만들지 못했습니다.",
        failureReason: "vision_empty_shots",
        debugPayload: {
          ...baseDebug,
          visionRequestSent: true,
          visionResponseReceived: true,
          visionRawResponsePreview: rawResponse.slice(0, 1000),
          parsedShotCount: 0,
          warnings: ["vision_empty_shots", ...warnings]
        },
        warnings: ["vision_empty_shots", ...warnings]
      };
    }

    const candidates = shots.map(shotToCandidate);
    const detectedShotCandidateCount = Number(parsed.summary?.detectedShotCandidateCount ?? shots.length) || shots.length;
    const confidence = normalizeConfidence(parsed.summary?.confidence);
    const summaryWarnings = [...new Set([input.fallbackReason, input.ocrFailureReason, "used_vision_image", ...warnings].filter(Boolean))];
    const debugPayload: VisionPdfAnalysisDebug = {
      ...baseDebug,
      visionRequestSent: true,
      visionResponseReceived: true,
      visionRawResponsePreview: rawResponse.slice(0, 1000),
      parsedShotCount: shots.length,
      warnings: summaryWarnings
    };

    return {
      ok: true,
      result: {
        extractionMethod: "vision_image",
        pageCount: input.pages.length,
        detectedShotCandidateCount,
        generatedShotCount: shots.length,
        confidence,
        shots,
        candidates,
        warnings: summaryWarnings,
        rawResponse,
        debugPayload
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `비전 AI 분석 중 오류가 발생했습니다. ${message}`,
      failureReason: "vision_analysis_failed",
      debugPayload: {
        ...baseDebug,
        visionRequestSent: true,
        visionResponseReceived: false,
        visionRawResponsePreview: message.slice(0, 1000),
        warnings: ["vision_analysis_failed"]
      },
      warnings: ["vision_analysis_failed"]
    };
  }
}

function summarizeVisionError(errorText: string) {
  if (/quota|billing|insufficient_quota/i.test(errorText)) {
    return "비전 AI 요청은 전송됐지만 OpenAI 사용량 한도 또는 결제 설정 문제로 실패했습니다. OpenAI 결제/크레딧 상태를 확인해주세요.";
  }

  return `비전 AI 분석 요청이 실패했습니다. ${errorText.slice(0, 300)}`.trim();
}

export const pdfVisionAnalysisPrompt = `
당신은 영화/광고 촬영 현장의 조감독입니다.
이 이미지는 일일촬영계획서, 콘티, 스토리보드, 촬영 진행표 중 하나입니다.
목표는 씬 목록이 아니라 오늘 실제로 촬영할 컷 리스트를 만드는 것입니다.

중요 원칙:
- 절대 씬 단위로 뭉뚱그리지 마세요.
- 표 형태라면 각 행을 하나의 컷 후보로 봅니다.
- 한 씬 안에 여러 컷이 있으면 반드시 여러 개의 컷으로 분리하세요.
- 컷 번호, 콘티 번호, Shot, Cut, C#, 컷, 쇼트, 내용, 장소, 비고, 인물, 시간 정보를 기준으로 컷을 분리하세요.
- 분석 결과가 적게 나오는 것보다 많이 나와서 사용자가 지우는 편이 낫습니다.
- 확신이 없으면 합치지 말고 분리하세요.
- 이미지에 보이는 표의 행 구조를 유지하세요.
- 일촬표 상단의 제목, 날짜, 스태프 정보, 주의사항은 컷으로 만들지 마세요.
- 실제 촬영 진행 행만 컷으로 만드세요.
- 빈 행은 제외하세요.
- 반드시 JSON만 반환하세요.
`;

function buildVisionRequestBody(input: AnalyzePdfWithVisionInput, model: string) {
  const pageParts = input.pages.slice(0, 5).flatMap((page) => [
    {
      type: "input_text",
      text: `PDF ${page.pageNumber}페이지입니다. 표의 각 촬영 진행 행을 컷 후보로 분리하세요.`
    },
    {
      type: "input_image",
      image_url: `data:${imageMimeType};base64,${page.imageBuffer.toString("base64")}`
    }
  ]);

  return {
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${pdfVisionAnalysisPrompt}

파일명: ${input.fileName}
파일 타입: ${input.fileType}
OCR 실패 이유: ${input.ocrFailureReason}

반환 JSON 형식:
{
  "summary": {
    "extractionMethod": "vision_image",
    "pageCount": ${input.pages.length},
    "detectedShotCandidateCount": 10,
    "generatedShotCount": 10,
    "confidence": "medium",
    "warnings": []
  },
  "shots": [
    {
      "sceneNumber": "3",
      "cutNumber": "4",
      "title": "컷 제목",
      "description": "촬영 내용",
      "location": "장소",
      "characters": [],
      "memo": "비고",
      "orderIndex": 1,
      "status": "pending",
      "sourcePage": 1,
      "sourceRow": null
    }
  ]
}`
          },
          ...pageParts
        ]
      }
    ]
  };
}

function extractResponseOutputText(output: unknown) {
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      const content = item && typeof item === "object" && "content" in item && Array.isArray(item.content) ? item.content : [];
      return content.map((contentItem: unknown) => {
        if (!contentItem || typeof contentItem !== "object") return "";
        if ("text" in contentItem && typeof contentItem.text === "string") return contentItem.text;
        return "";
      });
    })
    .join("\n")
    .trim();
}

function parseVisionJson(rawResponse: string) {
  const jsonText = rawResponse.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const direct = tryParseJson(jsonText);
  if (direct) return direct;

  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  const matched = objectMatch ? tryParseJson(objectMatch[0]) : null;
  if (matched) return matched;

  throw new Error("비전 분석 JSON을 파싱하지 못했습니다.");
}

function tryParseJson(value: string) {
  try {
    return JSON.parse(value) as { summary?: { detectedShotCandidateCount?: unknown; confidence?: unknown; warnings?: unknown }; shots?: unknown };
  } catch {
    return null;
  }
}

function normalizeVisionShots(value: unknown): ShotDraft[] {
  if (!Array.isArray(value)) return [];

  const shots: ShotDraft[] = [];

  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const row = item as Record<string, unknown>;
    const characters = Array.isArray(row.characters) ? row.characters.map(String).filter(Boolean) : [];
    const title = String(row.title ?? "").trim();
    const description = String(row.description ?? "").trim();

    shots.push({
      sceneNumber: String(row.sceneNumber ?? "1").trim() || "1",
      cutNumber: String(row.cutNumber ?? row.shotNumber ?? index + 1).trim() || String(index + 1),
      title: title || description.slice(0, 24) || `PDF 이미지 컷 ${index + 1}`,
      description,
      location: String(row.location ?? "").trim(),
      characters,
      memo: String(row.memo ?? row.notes ?? "").trim(),
      orderIndex: Number(row.orderIndex ?? index + 1) || index + 1,
      status: "pending",
      sourcePage: Number(row.sourcePage ?? 0) || null,
      sourceRow: Number(row.sourceRow ?? 0) || null
    });
  });

  return shots.sort((left, right) => left.orderIndex - right.orderIndex).map((shot, index) => ({ ...shot, orderIndex: index + 1 }));
}

function shotToCandidate(shot: ShotDraft): ShotCandidate {
  return {
    sceneNumber: shot.sceneNumber,
    cutNumber: shot.cutNumber,
    title: shot.title,
    description: shot.description,
    location: shot.location,
    characters: shot.characters,
    memo: shot.memo,
    orderIndex: shot.orderIndex,
    sourceSheet: null,
    sourcePage: shot.sourcePage ?? null,
    sourceRow: shot.sourceRow ?? null,
    rawText: [shot.title, shot.description, shot.location, shot.memo].filter(Boolean).join(" "),
    rawData: {}
  };
}

function normalizeConfidence(value: unknown): "low" | "medium" | "high" {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

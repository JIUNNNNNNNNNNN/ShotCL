import { storyboardAnalysisPrompt } from "@/lib/ai/analysisRules";
import type { AnalyzeStats, ShotCandidate, ShotDraft, StoryboardAnalysisResult } from "@/lib/types";

type AnalyzeShotCandidateInput = {
  fileName: string;
  fileType: string;
  projectName?: string;
  shootDate?: string;
  detectedSheetNames: string[];
  detectedHeaderRow: number | null;
  detectedColumns: Record<string, string | null>;
  detectedRowCount: number;
  candidates: ShotCandidate[];
  rawTextSample: string;
  warnings: string[];
};

/** 컷 후보를 ShotDraft JSON으로 정리합니다. 실제 OpenAI 연결 전에는 규칙 기반으로 1후보=1컷을 유지합니다. */
export async function analyzeShotCandidates(input: AnalyzeShotCandidateInput): Promise<StoryboardAnalysisResult> {
  const shouldUseRealAI = process.env.USE_REAL_AI === "true" && Boolean(process.env.OPENAI_API_KEY);
  const payloadSummary = buildPromptPayloadSummary(input);

  if (shouldUseRealAI) {
    /*
     * 실제 OpenAI 연결 위치:
     * - storyboardAnalysisPrompt를 system prompt로 사용합니다.
     * - payloadSummary와 candidates를 user prompt에 포함합니다.
     * - 응답은 { summary, shots } JSON으로만 받습니다.
     * - 검증 실패 시 아래 규칙 기반 결과로 fallback합니다.
     */
    void storyboardAnalysisPrompt;
  }

  const shots = input.candidates.map(candidateToShotDraft);
  const summary = buildSummary(input, shots);

  return {
    source: "rules",
    summary,
    stats: summary,
    warning: summary.warning,
    shots,
    candidates: input.candidates,
    debug: {
      extractedTextSample: input.rawTextSample,
      rawCandidates: input.candidates.slice(0, 100),
      promptPayloadSummary: payloadSummary
    }
  };
}

function candidateToShotDraft(candidate: ShotCandidate): ShotDraft {
  return {
    sceneNumber: candidate.sceneNumber || "1",
    cutNumber: candidate.cutNumber || String(candidate.orderIndex),
    title: candidate.title || `S#${candidate.sceneNumber || "1"} C#${candidate.cutNumber || candidate.orderIndex}`,
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

function buildSummary(input: AnalyzeShotCandidateInput, shots: ShotDraft[]): AnalyzeStats {
  const warnings = [...input.warnings];
  const generatedShotCount = shots.length;
  const detectedShotCandidateCount = input.candidates.length;
  const cutNumberCount = shots.filter((shot) => shot.cutNumber).length;
  const uniqueSceneCount = new Set(shots.map((shot) => shot.sceneNumber).filter(Boolean)).size;

  if (detectedShotCandidateCount >= 10 && generatedShotCount <= 3) {
    warnings.push(
      `문서에서는 약 ${detectedShotCandidateCount}개의 컷 후보가 감지되었지만 ${generatedShotCount}개의 컷만 생성되었습니다. 씬 단위로 뭉쳐졌을 가능성이 있습니다.`
    );
  }

  if (input.detectedRowCount >= 10 && generatedShotCount <= 5) {
    warnings.push("감지된 행 수에 비해 생성된 컷 수가 적습니다. 원본 문서와 분석 결과를 다시 확인해주세요.");
  }

  if (generatedShotCount >= 5 && cutNumberCount <= 1) {
    warnings.push("컷 번호가 충분히 분리되지 않았습니다. 분석 결과를 확인해주세요.");
  }

  if (generatedShotCount >= 8 && uniqueSceneCount <= 1 && cutNumberCount <= 3) {
    warnings.push("같은 씬 번호만 반복되고 컷 번호가 적습니다. 씬 단위로 뭉쳐졌는지 확인해주세요.");
  }

  return {
    detectedSheetNames: input.detectedSheetNames,
    detectedHeaderRow: input.detectedHeaderRow,
    detectedColumns: input.detectedColumns,
    detectedCandidateCount: detectedShotCandidateCount,
    detectedShotCandidateCount,
    detectedRowCount: input.detectedRowCount,
    generatedShotCount,
    confidence: generatedShotCount > 0 ? "medium" : "low",
    warnings,
    warning: warnings[0],
    rawTextSample: input.rawTextSample
  };
}

function buildPromptPayloadSummary(input: AnalyzeShotCandidateInput) {
  return {
    fileName: input.fileName,
    fileType: input.fileType,
    projectName: input.projectName,
    shootDate: input.shootDate,
    detectedSheetNames: input.detectedSheetNames,
    detectedHeaderRow: input.detectedHeaderRow,
    detectedColumns: input.detectedColumns,
    detectedRowCount: input.detectedRowCount,
    detectedShotCandidateCount: input.candidates.length,
    candidateSample: input.candidates.slice(0, 20).map((candidate) => ({
      sceneNumber: candidate.sceneNumber,
      cutNumber: candidate.cutNumber,
      description: candidate.description,
      sourceSheet: candidate.sourceSheet,
      sourceRow: candidate.sourceRow
    }))
  };
}

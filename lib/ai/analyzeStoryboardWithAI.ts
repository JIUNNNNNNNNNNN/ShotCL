import { mockAnalyzeStoryboard } from "@/lib/ai/mockAnalyzeStoryboard";
import { storyboardAnalysisPrompt } from "@/lib/ai/analysisRules";
import type { ShotDraft } from "@/lib/types";

type AnalyzeInput = {
  fileName: string;
  projectId: string;
};

/** 나중에 OpenAI API를 연결할 서버 전용 함수입니다. 현재는 mock 결과로 안전하게 되돌립니다. */
export async function analyzeStoryboardWithAI(input: AnalyzeInput): Promise<ShotDraft[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  }

  /*
   * 실제 연결 위치:
   * 1. Supabase Storage에서 input.projectId/input.fileName에 해당하는 파일을 서버에서 읽습니다.
   * 2. OpenAI Responses API에 PDF, Excel 텍스트, 이미지 입력과 storyboardAnalysisPrompt를 전달합니다.
   * 3. 모델 응답을 ShotDraft[] JSON으로 검증한 뒤 반환합니다.
   * 4. 검증 실패 시 mockAnalyzeStoryboard(input.fileName) 또는 빈 배열로 fallback합니다.
   */
  void storyboardAnalysisPrompt;

  return mockAnalyzeStoryboard(input.fileName);
}

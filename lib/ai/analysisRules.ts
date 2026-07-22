import type { AnalyzeStats, ShotDraft } from "@/lib/types";

export const storyboardAnalysisPrompt = `
당신은 영화 / 광고 촬영 현장의 조감독입니다.
사용자가 업로드한 문서는 일일촬영계획서, 콘티, 스토리보드, 촬영 진행표 중 하나입니다.
당신의 목표는 씬 목록이 아니라 "오늘 실제로 촬영할 컷 리스트"를 만드는 것입니다.

절대 씬 단위로 뭉뚱그리지 마세요.
하나의 씬 안에 여러 컷이 있으면 반드시 여러 개의 컷으로 분리하세요.
표 형태 문서는 각 행을 하나의 컷 후보로 봅니다.
컷 번호, 콘티 번호, Shot, Cut, C#, 컷, 쇼트, 내용, 장소, 비고, 인물, 시간 정보를 기준으로 컷을 분리하세요.
확신이 없으면 합치지 말고 분리하세요.
분석 결과가 너무 적게 나오는 것보다 많이 나와서 사람이 수정하는 편이 낫습니다.

반드시 아래 JSON 형태로만 반환하세요.
{
  "summary": {
    "detectedRowCount": 0,
    "detectedShotCandidateCount": 0,
    "generatedShotCount": 0,
    "confidence": "medium",
    "warnings": []
  },
  "shots": [
    {
      "sceneNumber": "1",
      "cutNumber": "1",
      "title": "한 줄 제목",
      "description": "촬영 내용",
      "location": "장소",
      "characters": [],
      "memo": "비고",
      "orderIndex": 1,
      "status": "pending",
      "sourceSheet": null,
      "sourcePage": null,
      "sourceRow": null
    }
  ]
}
`;

const cutPattern = /(S\s*#?\s*\d+\s*[-/]?\s*)?(C\s*#?\s*\d+|Cut\s*\d+|Shot\s*\d+|컷\s*\d+|\d+\s*컷|콘티\s*\d+|쇼트\s*\d+|\d+-\d+|[①②③④⑤⑥⑦⑧⑨⑩])/gi;

/** 파일명과 선택적으로 전달된 텍스트에서 컷 후보 수를 보수적으로 추정합니다. */
export function estimateAnalysisStats(input: { fileName: string; rawText?: string; shots: ShotDraft[] }): AnalyzeStats {
  const text = `${input.fileName}\n${input.rawText ?? ""}`;
  const patternMatches = text.match(cutPattern)?.length ?? 0;
  const generatedShotCount = input.shots.length;

  const detectedRowCount = input.rawText
    ? input.rawText.split(/\r?\n/).filter((line) => line.trim().length > 0).length
    : Math.max(patternMatches, generatedShotCount);

  const detectedCandidateCount = Math.max(patternMatches, generatedShotCount);
  const warning =
    (detectedCandidateCount >= 10 && generatedShotCount <= 3) ||
    (patternMatches >= 6 && generatedShotCount <= 3)
      ? `문서에서는 약 ${detectedCandidateCount}개의 컷 후보가 감지되었지만 ${generatedShotCount}개의 컷만 생성되었습니다. 분석 결과를 확인해주세요.`
      : undefined;

  return {
    detectedCandidateCount,
    detectedRowCount,
    generatedShotCount,
    warning
  };
}

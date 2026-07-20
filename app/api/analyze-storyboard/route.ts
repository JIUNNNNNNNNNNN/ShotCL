import { NextResponse } from "next/server";
import { estimateAnalysisStats } from "@/lib/ai/analysisRules";
import { mockAnalyzeStoryboard } from "@/lib/ai/mockAnalyzeStoryboard";

type AnalyzeRequest = {
  projectId?: string;
  fileId?: string;
  fileName?: string;
  rawText?: string;
};

/** 업로드 파일을 분석해 컷 리스트 초안을 반환합니다. 지금은 mock 분석이 기본값입니다. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequest;
    const fileName = body.fileName?.trim() || "storyboard";
    const projectId = body.projectId?.trim() || "unknown";
    try {
      const shots = mockAnalyzeStoryboard(fileName);
      const stats = estimateAnalysisStats({ fileName, rawText: body.rawText, shots });

      return NextResponse.json({
        source: "mock",
        stats,
        summary: stats,
        warning: stats.warning,
        shots,
        candidates: [],
        debug: {
          extractedTextSample: body.rawText?.slice(0, 2000) ?? "",
          rawCandidates: []
        }
      });
    } catch (analysisError) {
      const shots = mockAnalyzeStoryboard(fileName);
      const stats = estimateAnalysisStats({ fileName, rawText: body.rawText, shots });
      return NextResponse.json({
        source: "mock-fallback",
        warning: analysisError instanceof Error ? analysisError.message : stats.warning,
        stats,
        summary: stats,
        shots,
        candidates: [],
        debug: {
          extractedTextSample: body.rawText?.slice(0, 2000) ?? "",
          rawCandidates: [],
          parseError: analysisError instanceof Error ? analysisError.message : undefined
        }
      });
    }
  } catch {
    return NextResponse.json({ error: "분석 요청을 읽을 수 없습니다." }, { status: 400 });
  }
}

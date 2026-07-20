import { analysisRunFromRow, analysisRunToRow } from "@/lib/data/mappers";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AnalysisRun } from "@/lib/types";
import type { CreateAnalysisRunInput } from "@/lib/data/analysisRuns";

/** 서버 API route에서 분석 preview 기록을 Supabase에 저장합니다. */
export async function createAnalysisRunOnServer(input: CreateAnalysisRunInput, authorizationHeader?: string | null): Promise<AnalysisRun | null> {
  const accessToken = authorizationHeader?.replace(/^Bearer\s+/i, "") ?? null;
  const supabase = getSupabaseServerClient(accessToken);

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("analysis_runs")
    .insert(
      analysisRunToRow({
        ...input,
        status: "preview",
        finalShotCount: 0,
        finalConfirmedShots: [],
        userFeedback: "",
        confirmedAt: null
      })
    )
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return analysisRunFromRow(data);
}

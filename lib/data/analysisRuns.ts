import { ensureSupabaseDevSession, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { analysisRunFromRow, analysisRunItemFromRow, analysisRunItemToRow, analysisRunToRow } from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import type { AnalysisReviewedShot, AnalysisRun, AnalysisRunAction, AnalysisRunItem, AnalysisRunStatus, ShotDraft, TextQualityResult } from "@/lib/types";

export type CreateAnalysisRunInput = {
  projectId: string;
  sourceFileName: string;
  sourceFileType: string;
  sourceFileUrl?: string | null;
  analyzerType: string;
  detectedRowCount: number;
  detectedShotCandidateCount: number;
  generatedShotCount: number;
  finalShotCount?: number;
  aiRawResult: unknown;
  aiNormalizedShots: ShotDraft[];
  finalConfirmedShots?: ShotDraft[];
  warnings: string[];
  debugPayload: unknown;
  status?: AnalysisRunStatus;
  textQuality?: TextQualityResult | null;
  isTextCorrupted?: boolean;
  failureReason?: string;
};

export type ConfirmAnalysisRunInput = {
  analysisRunId: string;
  projectId: string;
  aiShots: ShotDraft[];
  reviewedShots: AnalysisReviewedShot[];
  finalShots: ShotDraft[];
  userFeedback: string;
};

export type SaveAnalysisRunFeedbackInput = {
  analysisRunId: string;
  projectId: string;
  userFeedback: string;
};

/** 프로젝트의 분석 실행 기록을 최신순으로 가져옵니다. */
export async function listAnalysisRuns(projectId: string): Promise<AnalysisRun[]> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    await ensureSupabaseDevSession();
    const { data, error } = await supabase
      .from("analysis_runs")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data.map(analysisRunFromRow);
  }

  const { analysisRuns } = readLocalBuckets();
  return analysisRuns.filter((run) => run.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 분석 기록 하나를 ID로 가져옵니다. */
export async function getAnalysisRun(analysisRunId: string): Promise<AnalysisRun | null> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    await ensureSupabaseDevSession();
    const { data, error } = await supabase.from("analysis_runs").select("*").eq("id", analysisRunId).maybeSingle();
    if (error) throw error;
    return data ? analysisRunFromRow(data) : null;
  }

  const { analysisRuns } = readLocalBuckets();
  return analysisRuns.find((run) => run.id === analysisRunId) ?? null;
}

/** 분석 기록에 연결된 컷 단위 비교 결과를 가져옵니다. */
export async function listAnalysisRunItems(analysisRunId: string): Promise<AnalysisRunItem[]> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    await ensureSupabaseDevSession();
    const { data, error } = await supabase
      .from("analysis_run_items")
      .select("*")
      .eq("analysis_run_id", analysisRunId)
      .order("original_order_index", { ascending: true, nullsFirst: false })
      .order("final_order_index", { ascending: true, nullsFirst: false });

    if (error) throw error;
    return data.map(analysisRunItemFromRow);
  }

  const { analysisRunItems } = readLocalBuckets();
  return analysisRunItems
    .filter((item) => item.analysisRunId === analysisRunId)
    .sort((a, b) => (a.originalOrderIndex ?? 99999) - (b.originalOrderIndex ?? 99999) || (a.finalOrderIndex ?? 99999) - (b.finalOrderIndex ?? 99999));
}

/** 분석 직후, 아직 shots에 저장하기 전의 AI 원본 결과를 기록합니다. */
export async function createAnalysisRun(input: CreateAnalysisRunInput): Promise<AnalysisRun> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    await ensureSupabaseDevSession();
    const { data, error } = await supabase
      .from("analysis_runs")
      .insert(
        analysisRunToRow({
          ...input,
          status: input.status ?? "preview",
          finalShotCount: input.finalShotCount ?? 0,
          finalConfirmedShots: input.finalConfirmedShots ?? [],
          userFeedback: "",
          confirmedAt: null
        })
      )
      .select("*")
      .single();

    if (error) throw error;
    return analysisRunFromRow(data);
  }

  const now = new Date().toISOString();
  const run: AnalysisRun = {
    id: createLocalId("analysis_run"),
    projectId: input.projectId,
    sourceFileName: input.sourceFileName,
    sourceFileType: input.sourceFileType,
    sourceFileUrl: input.sourceFileUrl ?? null,
    analyzerType: input.analyzerType,
    status: input.status ?? "preview",
    detectedRowCount: input.detectedRowCount,
    detectedShotCandidateCount: input.detectedShotCandidateCount,
    generatedShotCount: input.generatedShotCount,
    finalShotCount: input.finalShotCount ?? 0,
    aiRawResult: input.aiRawResult,
    aiNormalizedShots: input.aiNormalizedShots,
    finalConfirmedShots: input.finalConfirmedShots ?? [],
    warnings: input.warnings,
    debugPayload: input.debugPayload,
    textQuality: input.textQuality ?? null,
    isTextCorrupted: Boolean(input.isTextCorrupted),
    failureReason: input.failureReason ?? "",
    userFeedback: "",
    createdAt: now,
    confirmedAt: null
  };

  const { analysisRuns } = readLocalBuckets();
  writeLocalBuckets({ analysisRuns: [run, ...analysisRuns] }, input.projectId);
  return run;
}

/** 컷 리스트 확정 전에도 사용자 피드백만 analysis_runs.user_feedback에 저장합니다. */
export async function saveAnalysisRunFeedback(input: SaveAnalysisRunFeedbackInput): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    await ensureSupabaseDevSession();
    const { error } = await supabase
      .from("analysis_runs")
      .update(analysisRunToRow({ userFeedback: input.userFeedback }))
      .eq("id", input.analysisRunId);

    if (error) throw error;
    return;
  }

  const buckets = readLocalBuckets();
  writeLocalBuckets(
    {
      analysisRuns: buckets.analysisRuns.map((run) =>
        run.id === input.analysisRunId ? { ...run, userFeedback: input.userFeedback } : run
      )
    },
    input.projectId
  );
}

/** 사용자가 미리보기를 취소했을 때 preview 기록을 폐기 상태로 표시합니다. */
export async function discardAnalysisRun(analysisRunId: string, projectId: string, userFeedback = "") {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    await ensureSupabaseDevSession();
    const { error } = await supabase
      .from("analysis_runs")
      .update(analysisRunToRow({ status: "discarded", userFeedback }))
      .eq("id", analysisRunId);

    if (error) throw error;
    return;
  }

  const buckets = readLocalBuckets();
  writeLocalBuckets(
    {
      analysisRuns: buckets.analysisRuns.map((run) =>
        run.id === analysisRunId ? { ...run, status: "discarded", userFeedback } : run
      )
    },
    projectId
  );
}

/** 확정된 최종 컷과 AI 원본 컷을 함께 저장하고, 컷 단위 비교 결과도 남깁니다. */
export async function confirmAnalysisRun(input: ConfirmAnalysisRunInput): Promise<void> {
  const confirmedAt = new Date().toISOString();
  const finalShots = input.finalShots.map((shot, index) => ({
    ...shot,
    analysisRunId: input.analysisRunId,
    orderIndex: index + 1,
    status: "pending" as const
  }));
  const items = buildAnalysisRunItems({
    analysisRunId: input.analysisRunId,
    projectId: input.projectId,
    aiShots: input.aiShots,
    reviewedShots: input.reviewedShots,
    finalShots
  });
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    await ensureSupabaseDevSession();
    const updateResult = await supabase
      .from("analysis_runs")
      .update(
        analysisRunToRow({
          status: "confirmed",
          finalConfirmedShots: finalShots,
          finalShotCount: finalShots.length,
          userFeedback: input.userFeedback,
          confirmedAt
        })
      )
      .eq("id", input.analysisRunId);

    if (updateResult.error) throw updateResult.error;

    const deleteResult = await supabase.from("analysis_run_items").delete().eq("analysis_run_id", input.analysisRunId);
    if (deleteResult.error) throw deleteResult.error;

    if (items.length > 0) {
      const insertResult = await supabase.from("analysis_run_items").insert(items.map(analysisRunItemToRow));
      if (insertResult.error) throw insertResult.error;
    }

    return;
  }

  const buckets = readLocalBuckets();
  const now = new Date().toISOString();
  const localItems: AnalysisRunItem[] = items.map((item) => ({
    ...item,
    id: createLocalId("analysis_item"),
    createdAt: now
  }));

  writeLocalBuckets(
    {
      analysisRuns: buckets.analysisRuns.map((run) =>
        run.id === input.analysisRunId
          ? {
              ...run,
              status: "confirmed",
              finalConfirmedShots: finalShots,
              finalShotCount: finalShots.length,
              userFeedback: input.userFeedback,
              confirmedAt
            }
          : run
      ),
      analysisRunItems: [...buckets.analysisRunItems.filter((item) => item.analysisRunId !== input.analysisRunId), ...localItems]
    },
    input.projectId
  );
}

type BuildAnalysisRunItemsInput = {
  analysisRunId: string;
  projectId: string;
  aiShots: ShotDraft[];
  reviewedShots: AnalysisReviewedShot[];
  finalShots: ShotDraft[];
};

/** orderIndex/sourceRow 기준으로 AI 원본과 사람이 확정한 결과를 단순 비교합니다. */
export function buildAnalysisRunItems(input: BuildAnalysisRunItemsInput): Omit<AnalysisRunItem, "id" | "createdAt">[] {
  const maxLength = Math.max(input.aiShots.length, input.reviewedShots.length);
  let finalOrder = 0;
  const items: Omit<AnalysisRunItem, "id" | "createdAt">[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const aiShot = input.aiShots[index] ?? null;
    const reviewedShot = input.reviewedShots[index] ?? null;
    const isExcluded = Boolean(reviewedShot?.excluded);
    const finalShot = reviewedShot && !isExcluded ? input.finalShots[finalOrder] ?? reviewedShot : null;

    if (finalShot) {
      finalOrder += 1;
    }

    items.push({
      analysisRunId: input.analysisRunId,
      projectId: input.projectId,
      originalOrderIndex: aiShot?.orderIndex ?? index + 1,
      finalOrderIndex: finalShot?.orderIndex ?? null,
      aiSceneNumber: aiShot?.sceneNumber ?? "",
      aiCutNumber: aiShot?.cutNumber ?? "",
      aiTitle: aiShot?.title ?? "",
      aiDescription: aiShot?.description ?? "",
      aiLocation: aiShot?.location ?? "",
      aiCharacters: aiShot?.characters ?? [],
      aiMemo: aiShot?.memo ?? "",
      finalSceneNumber: finalShot?.sceneNumber ?? "",
      finalCutNumber: finalShot?.cutNumber ?? "",
      finalTitle: finalShot?.title ?? "",
      finalDescription: finalShot?.description ?? "",
      finalLocation: finalShot?.location ?? "",
      finalCharacters: finalShot?.characters ?? [],
      finalMemo: finalShot?.memo ?? "",
      action: getComparisonAction(aiShot, finalShot, isExcluded),
      sourceSheet: reviewedShot?.sourceSheet ?? aiShot?.sourceSheet ?? null,
      sourcePage: reviewedShot?.sourcePage ?? aiShot?.sourcePage ?? null,
      sourceRow: reviewedShot?.sourceRow ?? aiShot?.sourceRow ?? null
    });
  }

  return items;
}

function getComparisonAction(aiShot: ShotDraft | null, finalShot: ShotDraft | null, isExcluded: boolean): AnalysisRunAction {
  if (!aiShot && finalShot) return "added";
  if (aiShot && (!finalShot || isExcluded)) return "deleted";
  if (!aiShot || !finalShot) return "unchanged";

  return areShotsEquivalent(aiShot, finalShot) ? "unchanged" : "edited";
}

function areShotsEquivalent(left: ShotDraft, right: ShotDraft) {
  return (
    normalizeText(left.sceneNumber) === normalizeText(right.sceneNumber) &&
    normalizeText(left.cutNumber) === normalizeText(right.cutNumber) &&
    normalizeText(left.title) === normalizeText(right.title) &&
    normalizeText(left.description) === normalizeText(right.description) &&
    normalizeText(left.location) === normalizeText(right.location) &&
    normalizeText(left.memo) === normalizeText(right.memo) &&
    JSON.stringify(left.characters.map(normalizeText)) === JSON.stringify(right.characters.map(normalizeText))
  );
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

import "server-only";

import { shotDraftToInsertRow } from "@/lib/data/mappers";
import { buildProgressShotDrafts } from "@/lib/dailyPlan/progressShots";
import type { DailyPlanDraft, DailyPlanShotDraft, ShotDraft } from "@/lib/types";
import type { requireProjectAccessDb } from "@/lib/projectAccess/server";

type ProjectAccessDb = ReturnType<typeof requireProjectAccessDb>;

/** 저장된 회차의 shots만 scene + cutNumber 기준으로 맞추고 기존 진행 상태는 보존합니다. */
export async function syncProgressShotsForDailyPlan(
  supabase: ProjectAccessDb,
  projectId: string,
  dailyPlanId: string,
  plan: DailyPlanDraft,
  dailyPlanShots: DailyPlanShotDraft[]
) {
  const drafts = buildProgressShotDrafts(plan, dailyPlanShots);
  const { data: existingRows, error: existingError } = await supabase
    .from("shots")
    .select("*")
    .eq("project_id", projectId)
    .eq("daily_plan_id", dailyPlanId)
    .order("order_index", { ascending: true });
  if (existingError) throw existingError;

  const desiredByKey = new Map(drafts.map((draft) => [getDraftKey(draft), draft]));
  const existingByKey = new Map<string, Record<string, unknown>>();
  const duplicateIds: string[] = [];

  for (const row of existingRows ?? []) {
    const key = getRowKey(row);
    const current = existingByKey.get(key);
    if (!current) {
      existingByKey.set(key, row);
      continue;
    }
    if (statusRank(row.status) > statusRank(current.status)) {
      duplicateIds.push(String(current.id));
      existingByKey.set(key, row);
    } else {
      duplicateIds.push(String(row.id));
    }
  }

  const missingDrafts: ShotDraft[] = [];
  const updateTasks: Array<PromiseLike<unknown>> = [];
  desiredByKey.forEach((draft, key) => {
    const existing = existingByKey.get(key);
    if (!existing) {
      missingDrafts.push(draft);
      return;
    }
    updateTasks.push(
      supabase
        .from("shots")
        .update(progressShotUpdateRow(draft))
        .eq("id", String(existing.id))
        .eq("project_id", projectId)
        .eq("daily_plan_id", dailyPlanId)
        .then(({ error }) => {
          if (error) throw error;
        })
    );
  });
  await Promise.all(updateTasks);

  if (missingDrafts.length > 0) {
    const rows = missingDrafts.map((draft) => shotDraftToInsertRow(projectId, draft, draft.orderIndex, dailyPlanId));
    const { error } = await supabase.from("shots").insert(rows);
    if (error) throw error;
  }

  const staleIds = (existingRows ?? [])
    .filter((row) => !desiredByKey.has(getRowKey(row)))
    .map((row) => String(row.id));
  const idsToDelete = [...new Set([...staleIds, ...duplicateIds])];
  if (idsToDelete.length > 0) {
    const { error } = await supabase
      .from("shots")
      .delete()
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId)
      .in("id", idsToDelete);
    if (error) throw error;
  }

  return { count: drafts.length };
}

function getDraftKey(draft: Pick<ShotDraft, "sceneNumber" | "cutNumber">) {
  return `${draft.sceneNumber.trim()}\u0000${draft.cutNumber.trim()}`;
}

function getRowKey(row: Record<string, unknown>) {
  return `${String(row.scene_number ?? "").trim()}\u0000${String(row.cut_number ?? row.shot_number ?? "").trim()}`;
}

function statusRank(status: unknown) {
  return String(status) === "pending" ? 0 : 1;
}

function progressShotUpdateRow(draft: ShotDraft) {
  return {
    scene_number: draft.sceneNumber,
    cut_number: draft.cutNumber,
    shot_number: draft.cutNumber,
    title: draft.title,
    description: draft.description,
    location: draft.location,
    characters: draft.characters,
    memo: draft.memo,
    notes: draft.memo,
    order_index: draft.orderIndex,
    updated_at: new Date().toISOString()
  };
}

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeShotStatus, shotDraftToInsertRow, shotFromRow, shotPatchToRow } from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import type { Shot, ShotDraft, ShotStatus } from "@/lib/types";

/** 프로젝트의 컷 리스트를 촬영 순서대로 가져옵니다. */
export async function listShots(projectId: string): Promise<Shot[]> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("shots")
      .select("*")
      .eq("project_id", projectId)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data.map(shotFromRow);
  }

  const { shots } = readLocalBuckets();
  return shots
    .filter((shot) => shot.projectId === projectId)
    .map((shot) => ({
      ...shot,
      cutNumber: shot.cutNumber ?? (shot as unknown as { shotNumber?: string }).shotNumber ?? "",
      memo: shot.memo ?? (shot as unknown as { notes?: string }).notes ?? "",
      status: normalizeShotStatus(shot.status),
      analysisRunId: shot.analysisRunId ?? null,
      storyboardImageUrl: shot.storyboardImageUrl ?? null,
      sourceFileId: shot.sourceFileId ?? null,
      sourcePage: shot.sourcePage ?? null,
      sourceRow: shot.sourceRow ?? null
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt));
}

/** AI 분석 결과나 수동 입력 컷을 프로젝트에 추가합니다. */
export async function createShotsFromDrafts(projectId: string, drafts: ShotDraft[]): Promise<Shot[]> {
  const existingShots = await listShots(projectId);
  const maxOrder = existingShots.reduce((max, shot) => Math.max(max, shot.orderIndex), 0);
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const rows = drafts.map((draft, index) => shotDraftToInsertRow(projectId, draft, maxOrder + index + 1));
    const { data, error } = await supabase.from("shots").insert(rows).select("*").order("order_index");
    if (error) throw error;
    return data.map(shotFromRow);
  }

  const now = new Date().toISOString();
  const newShots: Shot[] = drafts.map((draft, index) => ({
    id: createLocalId("shot"),
    projectId,
    sceneNumber: draft.sceneNumber,
    cutNumber: draft.cutNumber,
    title: draft.title,
    description: draft.description,
    location: draft.location,
    characters: draft.characters,
    memo: draft.memo,
    orderIndex: maxOrder + index + 1,
    status: normalizeShotStatus(draft.status),
    analysisRunId: draft.analysisRunId ?? null,
    storyboardImageUrl: draft.storyboardImageUrl ?? null,
    sourceFileId: draft.sourceFileId ?? null,
    sourcePage: draft.sourcePage ?? null,
    sourceRow: draft.sourceRow ?? null,
    createdAt: now,
    updatedAt: now
  }));

  const { shots } = readLocalBuckets();
  writeLocalBuckets({ shots: [...shots, ...newShots] }, projectId);
  return newShots;
}

/** 컷 하나의 제목, 설명, 상태 같은 일부 필드를 수정합니다. */
export async function updateShot(shotId: string, patch: Partial<Shot>): Promise<Shot> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const { data, error } = await supabase.from("shots").update(shotPatchToRow(patch)).eq("id", shotId).select("*").single();
    if (error) throw error;
    return shotFromRow(data);
  }

  const buckets = readLocalBuckets();
  const existingShot = buckets.shots.find((shot) => shot.id === shotId);

  if (!existingShot) {
    throw new Error("수정할 컷을 찾을 수 없습니다.");
  }

  const normalizedExistingShot: Shot = {
    ...existingShot,
    id: existingShot.id,
    projectId: existingShot.projectId,
    cutNumber: existingShot.cutNumber ?? (existingShot as unknown as { shotNumber?: string }).shotNumber ?? "",
    memo: existingShot.memo ?? (existingShot as unknown as { notes?: string }).notes ?? "",
    status: normalizeShotStatus(existingShot.status),
    analysisRunId: existingShot.analysisRunId ?? null,
    storyboardImageUrl: existingShot.storyboardImageUrl ?? null,
    sourceFileId: existingShot.sourceFileId ?? null,
    sourcePage: existingShot.sourcePage ?? null,
    sourceRow: existingShot.sourceRow ?? null
  };

  const updatedShot: Shot = {
    ...normalizedExistingShot,
    ...patch,
    id: normalizedExistingShot.id,
    projectId: normalizedExistingShot.projectId,
    status: patch.status ? normalizeShotStatus(patch.status) : normalizedExistingShot.status,
    updatedAt: new Date().toISOString()
  };

  const shots = buckets.shots.map((shot) => (shot.id === shotId ? updatedShot : shot));
  writeLocalBuckets({ shots }, updatedShot.projectId);
  return updatedShot;
}

/** 상태 변경은 별도 함수로 두어 로그를 남기고, 버튼 동작을 단순하게 유지합니다. */
export async function updateShotStatus(shot: Shot, newStatus: ShotStatus): Promise<Shot> {
  if (shot.status === newStatus) {
    return shot;
  }

  const supabase = getSupabaseBrowserClient();
  const updatedShot = await updateShot(shot.id, { status: newStatus });

  if (!supabase) {
    const buckets = readLocalBuckets();
    writeLocalBuckets(
      {
        logs: [
          ...buckets.logs,
          {
            id: createLocalId("status_log"),
            shotId: shot.id,
            previousStatus: shot.status,
            newStatus,
            changedBy: null,
            createdAt: new Date().toISOString()
          }
        ]
      },
      shot.projectId
    );
  }

  return updatedShot;
}

/** 분석 결과로 기존 컷 리스트를 교체할 때 사용합니다. */
export async function deleteAllShots(projectId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const { error } = await supabase.from("shots").delete().eq("project_id", projectId);
    if (error) throw error;
    return;
  }

  const buckets = readLocalBuckets();
  writeLocalBuckets({ shots: buckets.shots.filter((shot) => shot.projectId !== projectId) }, projectId);
}

/** 컷을 삭제합니다. */
export async function deleteShot(shot: Shot): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const { error } = await supabase.from("shots").delete().eq("id", shot.id);
    if (error) throw error;
    return;
  }

  const buckets = readLocalBuckets();
  writeLocalBuckets({ shots: buckets.shots.filter((item) => item.id !== shot.id) }, shot.projectId);
}

/** 드래그 앤 드롭 대신 위/아래 버튼으로 촬영 순서를 바꿉니다. */
export async function moveShot(projectId: string, shotId: string, direction: "up" | "down") {
  const shots = await listShots(projectId);
  const currentIndex = shots.findIndex((shot) => shot.id === shotId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= shots.length) {
    return shots;
  }

  const current = shots[currentIndex];
  const target = shots[targetIndex];
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const [currentResult, targetResult] = await Promise.all([
      supabase.from("shots").update({ order_index: target.orderIndex }).eq("id", current.id),
      supabase.from("shots").update({ order_index: current.orderIndex }).eq("id", target.id)
    ]);

    if (currentResult.error) throw currentResult.error;
    if (targetResult.error) throw targetResult.error;
  } else {
    const buckets = readLocalBuckets();
    const nextShots = buckets.shots.map((shot) => {
      if (shot.id === current.id) return { ...shot, orderIndex: target.orderIndex, updatedAt: new Date().toISOString() };
      if (shot.id === target.id) return { ...shot, orderIndex: current.orderIndex, updatedAt: new Date().toISOString() };
      return shot;
    });
    writeLocalBuckets({ shots: nextShots }, projectId);
  }

  return listShots(projectId);
}

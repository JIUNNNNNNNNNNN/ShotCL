import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeShotStatus, shotDraftToInsertRow, shotFromRow, shotPatchToRow } from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import type { Shot, ShotDraft, ShotStatus } from "@/lib/types";

const shotListColumns = "id,project_id,daily_plan_id,analysis_run_id,scene_number,cut_number,shot_number,title,description,location,characters,memo,notes,order_index,status,storyboard_image_url,source_file_id,source_page,source_row,created_at,updated_at";

async function getSharedRole(projectId: string): Promise<"admin" | "progress" | null> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/access`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as { role?: "admin" | "progress" };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

/** 프로젝트의 컷 리스트를 촬영 순서대로 가져옵니다. */
export async function listShots(projectId: string, dailyPlanId?: string): Promise<Shot[]> {
  try {
    const query = dailyPlanId ? `?dailyPlanId=${encodeURIComponent(dailyPlanId)}` : "";
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shots${query}`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { shots: Record<string, unknown>[] };
      return payload.shots.map(shotFromRow);
    }
  } catch {
    // 공유 세션이 없는 레거시 프로젝트는 기존 저장소 조회로 이어집니다.
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    let query = supabase
      .from("shots")
      .select(shotListColumns)
      .eq("project_id", projectId)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true });
    if (dailyPlanId) query = query.eq("daily_plan_id", dailyPlanId);
    const { data, error } = await query;

    if (error) throw error;
    return data.map(shotFromRow);
  }

  const buckets = readLocalBuckets();
  const firstPlanId = buckets.dailyPlans
    .filter((plan) => plan.projectId === projectId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id ?? null;
  let didMigrateLegacyShots = false;
  const locallyScopedShots = buckets.shots.map((shot) => {
    if (shot.projectId !== projectId || shot.dailyPlanId || !firstPlanId) return shot;
    didMigrateLegacyShots = true;
    return { ...shot, dailyPlanId: firstPlanId };
  });
  if (didMigrateLegacyShots) writeLocalBuckets({ shots: locallyScopedShots }, projectId);

  return locallyScopedShots
    .filter((shot) => shot.projectId === projectId && (!dailyPlanId || shot.dailyPlanId === dailyPlanId))
    .map((shot) => ({
      ...shot,
      dailyPlanId: shot.dailyPlanId ?? null,
      cutNumber: shot.cutNumber ?? (shot as unknown as { shotNumber?: string }).shotNumber ?? "",
      memo: shot.memo ?? (shot as unknown as { notes?: string }).notes ?? "",
      status: normalizeShotStatus(shot.status),
      analysisRunId: shot.analysisRunId ?? null,
      storyboardImageUrl: shot.storyboardImageUrl ?? null,
      overheadDiagram: null,
      sourceFileId: shot.sourceFileId ?? null,
      sourcePage: shot.sourcePage ?? null,
      sourceRow: shot.sourceRow ?? null
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt));
}

/** 일촬표 동기화 결과나 수동 입력 컷을 프로젝트에 추가합니다. */
export async function createShotsFromDrafts(projectId: string, drafts: ShotDraft[], dailyPlanId?: string): Promise<Shot[]> {
  const existingShots = await listShots(projectId, dailyPlanId);
  const maxOrder = existingShots.reduce((max, shot) => Math.max(max, shot.orderIndex), 0);
  if (await getSharedRole(projectId)) {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drafts, dailyPlanId: dailyPlanId ?? null })
    });
    const payload = (await response.json()) as { shots?: Record<string, unknown>[]; error?: string };
    if (!response.ok || !payload.shots) throw new Error(payload.error || "컷을 추가하지 못했습니다.");
    return payload.shots.map(shotFromRow);
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const rows = drafts.map((draft, index) => shotDraftToInsertRow(projectId, draft, maxOrder + index + 1, dailyPlanId));
    const { data, error } = await supabase.from("shots").insert(rows).select("*").order("order_index");
    if (error) throw error;
    return data.map(shotFromRow);
  }

  const now = new Date().toISOString();
  const newShots: Shot[] = drafts.map((draft, index) => ({
    id: createLocalId("shot"),
    projectId,
    dailyPlanId: dailyPlanId ?? null,
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
    overheadDiagram: null,
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

/** 일촬표에서 파생된 컷 목록을 scene + cutNumber 기준으로 동기화합니다. */
export async function syncShotsFromDrafts(projectId: string, dailyPlanId: string, drafts: ShotDraft[], previouslyManagedKeys: ReadonlySet<string>): Promise<Shot[]> {
  const existingShots = await listShots(projectId, dailyPlanId);
  const desiredByKey = new Map<string, ShotDraft>();
  drafts.forEach((draft) => desiredByKey.set(getShotIdentityKey(draft, dailyPlanId), draft));

  const existingByKey = new Map<string, Shot>();
  const duplicateShots: Shot[] = [];
  existingShots.forEach((shot) => {
    const key = getShotIdentityKey(shot, dailyPlanId);
    const existing = existingByKey.get(key);
    if (!existing) {
      existingByKey.set(key, shot);
      return;
    }

    if (shotStatusRank(shot.status) > shotStatusRank(existing.status)) {
      existingByKey.set(key, shot);
      duplicateShots.push(existing);
    } else {
      duplicateShots.push(shot);
    }
  });

  const staleShots = existingShots.filter((shot) => {
    const key = getShotIdentityKey(shot, dailyPlanId);
    return previouslyManagedKeys.has(key) && !desiredByKey.has(key);
  });
  const managedDuplicates = duplicateShots.filter((shot) => previouslyManagedKeys.has(getShotIdentityKey(shot, dailyPlanId)));
  const shotsToDelete = new Map([...staleShots, ...managedDuplicates].map((shot) => [shot.id, shot]));
  await Promise.all([...shotsToDelete.values()].map((shot) => deleteShot(shot)));

  const missingDrafts: ShotDraft[] = [];
  const updateTasks: Array<Promise<Shot>> = [];
  desiredByKey.forEach((draft, key) => {
    const existing = existingByKey.get(key);
    if (!existing) {
      missingDrafts.push(draft);
      return;
    }

    const patch: Partial<Shot> = {
      sceneNumber: draft.sceneNumber,
      cutNumber: draft.cutNumber,
      title: draft.title,
      description: draft.description,
      location: draft.location,
      characters: draft.characters,
      memo: draft.memo,
      orderIndex: draft.orderIndex
    };
    if (hasShotDraftChanges(existing, patch)) updateTasks.push(updateShot(existing.id, patch, projectId));
  });

  await Promise.all(updateTasks);
  if (missingDrafts.length > 0) await createShotsFromDrafts(projectId, missingDrafts, dailyPlanId);
  return listShots(projectId, dailyPlanId);
}

export function getShotIdentityKey(shot: Pick<Shot, "sceneNumber" | "cutNumber"> | Pick<ShotDraft, "sceneNumber" | "cutNumber">, dailyPlanId?: string | null) {
  const planId = dailyPlanId ?? ("dailyPlanId" in shot ? shot.dailyPlanId : null) ?? "legacy";
  return `${planId}\u0000${shot.sceneNumber.trim()}\u0000${shot.cutNumber.trim()}`;
}

function hasShotDraftChanges(existing: Shot, patch: Partial<Shot>) {
  return existing.sceneNumber !== patch.sceneNumber
    || existing.cutNumber !== patch.cutNumber
    || existing.title !== patch.title
    || existing.description !== patch.description
    || existing.location !== patch.location
    || existing.memo !== patch.memo
    || existing.orderIndex !== patch.orderIndex
    || JSON.stringify(existing.characters) !== JSON.stringify(patch.characters);
}

function shotStatusRank(status: ShotStatus) {
  return status === "pending" ? 0 : 1;
}

/** 컷 하나의 제목, 설명, 상태 같은 일부 필드를 수정합니다. */
export async function updateShot(shotId: string, patch: Partial<Shot>, projectId?: string): Promise<Shot> {
  if (projectId && await getSharedRole(projectId)) {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch })
    });
    const payload = (await response.json()) as { shot?: Record<string, unknown>; error?: string };
    if (!response.ok || !payload.shot) throw new Error(payload.error || "컷을 수정하지 못했습니다.");
    return shotFromRow(payload.shot);
  }
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
    dailyPlanId: existingShot.dailyPlanId ?? null,
    cutNumber: existingShot.cutNumber ?? (existingShot as unknown as { shotNumber?: string }).shotNumber ?? "",
    memo: existingShot.memo ?? (existingShot as unknown as { notes?: string }).notes ?? "",
    status: normalizeShotStatus(existingShot.status),
    analysisRunId: existingShot.analysisRunId ?? null,
    storyboardImageUrl: existingShot.storyboardImageUrl ?? null,
    overheadDiagram: null,
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

  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(shot.projectId)}/shots/${encodeURIComponent(shot.id)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus })
    });
    const payload = (await response.json().catch(() => ({}))) as { shot?: Record<string, unknown>; error?: string };
    if (response.ok && payload.shot) return shotFromRow(payload.shot);
    if (![400, 401, 404, 503].includes(response.status)) {
      throw new Error(payload.error || "상태를 변경하지 못했습니다.");
    }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
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

/** 현재 회차의 컷 목록을 초기화할 때 사용합니다. */
export async function deleteAllShots(projectId: string, dailyPlanId?: string): Promise<void> {
  if (await getSharedRole(projectId)) {
    const query = dailyPlanId ? `?dailyPlanId=${encodeURIComponent(dailyPlanId)}` : "";
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shots${query}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error || "컷 목록을 삭제하지 못했습니다.");
    }
    return;
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    let query = supabase.from("shots").delete().eq("project_id", projectId);
    if (dailyPlanId) query = query.eq("daily_plan_id", dailyPlanId);
    const { error } = await query;
    if (error) throw error;
    return;
  }

  const buckets = readLocalBuckets();
  writeLocalBuckets({ shots: buckets.shots.filter((shot) => shot.projectId !== projectId || (dailyPlanId ? shot.dailyPlanId !== dailyPlanId : false)) }, projectId);
}

/** 컷을 삭제합니다. */
export async function deleteShot(shot: Shot): Promise<void> {
  if (await getSharedRole(shot.projectId)) {
    const response = await fetch(`/api/projects/${encodeURIComponent(shot.projectId)}/shots/${encodeURIComponent(shot.id)}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error || "컷을 삭제하지 못했습니다.");
    }
    return;
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const { error } = await supabase.from("shots").delete().eq("id", shot.id);
    if (error) throw error;
    return;
  }

  const buckets = readLocalBuckets();
  writeLocalBuckets({ shots: buckets.shots.filter((item) => item.id !== shot.id) }, shot.projectId);
}

/** 편집 모달의 기존 위/아래 버튼으로 촬영 순서를 한 칸 바꿉니다. */
export async function moveShot(projectId: string, shotId: string, direction: "up" | "down", dailyPlanId?: string) {
  if (await getSharedRole(projectId)) {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction, dailyPlanId: dailyPlanId ?? null })
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error || "컷 순서를 변경하지 못했습니다.");
    }
    return listShots(projectId, dailyPlanId);
  }
  const shots = await listShots(projectId, dailyPlanId);
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

  return listShots(projectId, dailyPlanId);
}

/** 같은 프로젝트·회차의 전체 컷 순서를 order_index에 일괄 저장합니다. */
export async function reorderShots(projectId: string, dailyPlanId: string, orderedShotIds: string[]): Promise<Shot[]> {
  if (!dailyPlanId.trim() || orderedShotIds.length === 0 || new Set(orderedShotIds).size !== orderedShotIds.length) {
    throw new Error("저장할 컷 순서가 올바르지 않습니다.");
  }

  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shots/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyPlanId, shotIds: orderedShotIds })
    });
    const payload = (await response.json().catch(() => ({}))) as { shots?: Record<string, unknown>[]; error?: string };
    if (response.ok && payload.shots) return payload.shots.map(shotFromRow);
    if (![400, 401, 404, 503].includes(response.status)) {
      throw new Error(payload.error || "컷 순서를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }

  const scopedShots = await listShots(projectId, dailyPlanId);
  const scopedIds = new Set(scopedShots.map((shot) => shot.id));
  if (scopedIds.size !== orderedShotIds.length || orderedShotIds.some((id) => !scopedIds.has(id))) {
    throw new Error("현재 프로젝트와 회차의 전체 컷만 정렬할 수 있습니다.");
  }

  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { data: rawShots, error: selectError } = await supabase
      .from("shots")
      .select(shotListColumns)
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId);
    if (selectError) throw selectError;
    const rawById = new Map(rawShots.map((shot) => [shot.id, shot]));
    const rows = orderedShotIds.map((id, index) => ({
      ...rawById.get(id),
      order_index: index + 1
    }));
    const { error } = await supabase.from("shots").upsert(rows, { onConflict: "id" });
    if (error) throw error;
    return listShots(projectId, dailyPlanId);
  }

  const orderById = new Map(orderedShotIds.map((id, index) => [id, index + 1]));
  const now = new Date().toISOString();
  const buckets = readLocalBuckets();
  const nextShots = buckets.shots.map((shot) => {
    if (shot.projectId !== projectId || shot.dailyPlanId !== dailyPlanId) return shot;
    const orderIndex = orderById.get(shot.id);
    return orderIndex === undefined ? shot : { ...shot, orderIndex, updatedAt: now };
  });
  writeLocalBuckets({ shots: nextShots }, projectId);
  return listShots(projectId, dailyPlanId);
}

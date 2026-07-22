import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeShotStatus, shotDraftToInsertRow, shotFromRow, shotPatchToRow } from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import type { Shot, ShotDraft, ShotStatus } from "@/lib/types";

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
export async function listShots(projectId: string): Promise<Shot[]> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shots`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { shots: Record<string, unknown>[] };
      return payload.shots.map(shotFromRow);
    }
  } catch {
    // 공유 세션이 없는 레거시 프로젝트는 기존 저장소 조회로 이어집니다.
  }
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
  if (await getSharedRole(projectId)) {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drafts })
    });
    const payload = (await response.json()) as { shots?: Record<string, unknown>[]; error?: string };
    if (!response.ok || !payload.shots) throw new Error(payload.error || "컷을 추가하지 못했습니다.");
    return payload.shots.map(shotFromRow);
  }
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

  try {
    const accessResponse = await fetch(`/api/projects/${encodeURIComponent(shot.projectId)}/access`, { cache: "no-store" });
    if (accessResponse.ok) {
      const response = await fetch(`/api/projects/${encodeURIComponent(shot.projectId)}/shots/${encodeURIComponent(shot.id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      const payload = (await response.json()) as { shot?: Record<string, unknown>; error?: string };
      if (!response.ok || !payload.shot) throw new Error(payload.error || "상태를 변경하지 못했습니다.");
      return shotFromRow(payload.shot);
    }
  } catch (error) {
    if (error instanceof Error && !error.message.includes("fetch")) throw error;
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
  if (await getSharedRole(projectId)) {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shots`, { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error || "컷 목록을 삭제하지 못했습니다.");
    }
    return;
  }
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

/** 드래그 앤 드롭 대신 위/아래 버튼으로 촬영 순서를 바꿉니다. */
export async function moveShot(projectId: string, shotId: string, direction: "up" | "down") {
  if (await getSharedRole(projectId)) {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction })
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error || "컷 순서를 변경하지 못했습니다.");
    }
    return listShots(projectId);
  }
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

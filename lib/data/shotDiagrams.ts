import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeProjectId } from "@/lib/projectId";
import { normalizeShotOverheadDiagram } from "@/lib/shotOverhead";
import type { Shot, ShotOverheadDiagram } from "@/lib/types";

const DIAGRAM_TYPE = "overhead";
const LOCAL_STORAGE_KEY = "today-board-shot-diagrams-v1";

type ShotDiagramKey = {
  projectId: string;
  dailyPlanId: string;
  shotRef: string;
};

type LocalDiagramEntry = ShotDiagramKey & {
  diagramType: typeof DIAGRAM_TYPE;
  data: ShotOverheadDiagram;
};

/** shot id를 우선 쓰고, 없을 때만 회차/씬/컷 조합으로 안정적인 참조값을 만듭니다. */
export function getShotDiagramKey(shot: Pick<Shot, "id" | "projectId" | "dailyPlanId" | "sceneNumber" | "cutNumber">): ShotDiagramKey {
  const projectId = normalizeProjectId(shot.projectId);
  const dailyPlanId = shot.dailyPlanId?.trim() || "unassigned";
  const shotId = shot.id?.trim();
  const shotRef = shotId || [
    "fallback",
    encodeURIComponent(dailyPlanId),
    `scene-${encodeURIComponent(shot.sceneNumber.trim() || "unknown")}`,
    `cut-${encodeURIComponent(shot.cutNumber.trim() || "unknown")}`
  ].join(":");
  return { projectId, dailyPlanId, shotRef };
}

/** project_id + daily_plan_id + shot_ref + overhead 복합 키로 부감도를 조회합니다. */
export async function loadShotOverheadDiagram(shot: Shot): Promise<ShotOverheadDiagram | null> {
  const key = getShotDiagramKey(shot);
  const query = new URLSearchParams({
    dailyPlanId: key.dailyPlanId,
    shotRef: key.shotRef
  });

  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(key.projectId)}/shot-diagrams?${query}`, { cache: "no-store" });
    const payload = (await response.json()) as { diagram?: unknown; error?: string };
    if (response.ok) return normalizeShotOverheadDiagram(payload.diagram);
    if (![401, 404, 503].includes(response.status)) throw new Error(payload.error || "부감도를 불러오지 못했습니다.");
  } catch (error) {
    if (error instanceof Error && !error.message.includes("fetch")) throw error;
  }

  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("shot_diagrams")
      .select("data")
      .eq("project_id", key.projectId)
      .eq("daily_plan_id", key.dailyPlanId)
      .eq("shot_ref", key.shotRef)
      .eq("diagram_type", DIAGRAM_TYPE)
      .maybeSingle();
    if (error) throw error;
    return normalizeShotOverheadDiagram(data?.data);
  }

  const entry = readLocalEntries().find((item) => isSameKey(item, key));
  return normalizeShotOverheadDiagram(entry?.data);
}

/** 회차 카드 미리보기용 부감도를 한 번의 요청으로 읽습니다. 편집기 코드는 불러오지 않습니다. */
export async function loadShotOverheadDiagrams(shots: Shot[]): Promise<Map<string, ShotOverheadDiagram>> {
  const diagramsByShotId = new Map<string, ShotOverheadDiagram>();
  const firstShot = shots[0];
  if (!firstShot) return diagramsByShotId;

  const keys = shots.map((shot) => ({ shot, key: getShotDiagramKey(shot) }));
  const query = new URLSearchParams({ dailyPlanId: keys[0].key.dailyPlanId });

  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(keys[0].key.projectId)}/shot-diagrams?${query}`, { cache: "no-store" });
    const payload = (await response.json()) as {
      diagrams?: Array<{ shotRef?: unknown; diagram?: unknown }>;
      error?: string;
    };
    if (response.ok) {
      const diagramsByRef = new Map(
        (payload.diagrams ?? [])
          .map((item) => [String(item.shotRef ?? ""), normalizeShotOverheadDiagram(item.diagram)] as const)
          .filter((entry): entry is readonly [string, ShotOverheadDiagram] => Boolean(entry[0] && entry[1]))
      );
      keys.forEach(({ shot, key }) => {
        const diagram = diagramsByRef.get(key.shotRef);
        if (diagram) diagramsByShotId.set(shot.id, diagram);
      });
      return diagramsByShotId;
    }
    if (![401, 404, 503].includes(response.status)) throw new Error(payload.error || "부감도를 불러오지 못했습니다.");
  } catch (error) {
    if (error instanceof Error && !error.message.includes("fetch")) throw error;
  }

  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const shotRefs = keys.map(({ key }) => key.shotRef);
    const { data, error } = await supabase
      .from("shot_diagrams")
      .select("shot_ref,data")
      .eq("project_id", keys[0].key.projectId)
      .eq("daily_plan_id", keys[0].key.dailyPlanId)
      .eq("diagram_type", DIAGRAM_TYPE)
      .in("shot_ref", shotRefs);
    if (error) throw error;
    const diagramsByRef = new Map(
      (data ?? [])
        .map((item) => [String(item.shot_ref ?? ""), normalizeShotOverheadDiagram(item.data)] as const)
        .filter((entry): entry is readonly [string, ShotOverheadDiagram] => Boolean(entry[0] && entry[1]))
    );
    keys.forEach(({ shot, key }) => {
      const diagram = diagramsByRef.get(key.shotRef);
      if (diagram) diagramsByShotId.set(shot.id, diagram);
    });
    return diagramsByShotId;
  }

  const localEntries = readLocalEntries();
  keys.forEach(({ shot, key }) => {
    const entry = localEntries.find((item) => isSameKey(item, key));
    const diagram = normalizeShotOverheadDiagram(entry?.data);
    if (diagram) diagramsByShotId.set(shot.id, diagram);
  });
  return diagramsByShotId;
}

/** 동일 복합 키에 upsert하여 다른 컷의 부감도를 덮어쓰지 않습니다. */
export async function saveShotOverheadDiagram(shot: Shot, value: ShotOverheadDiagram): Promise<ShotOverheadDiagram> {
  const key = getShotDiagramKey(shot);
  const diagram = normalizeShotOverheadDiagram(value);
  if (!diagram) throw new Error("부감도 데이터 형식이 올바르지 않습니다.");

  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(key.projectId)}/shot-diagrams`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dailyPlanId: key.dailyPlanId,
        shotRef: key.shotRef,
        data: diagram
      })
    });
    const payload = (await response.json()) as { diagram?: unknown; error?: string };
    if (response.ok) return normalizeShotOverheadDiagram(payload.diagram) ?? diagram;
    if (![401, 404, 503].includes(response.status)) throw new Error(payload.error || "부감도를 저장하지 못했습니다.");
  } catch (error) {
    if (error instanceof Error && !error.message.includes("fetch")) throw error;
  }

  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("shot_diagrams")
      .upsert(
        {
          project_id: key.projectId,
          daily_plan_id: key.dailyPlanId,
          shot_ref: key.shotRef,
          diagram_type: DIAGRAM_TYPE,
          data: diagram,
          updated_at: new Date().toISOString()
        },
        { onConflict: "project_id,daily_plan_id,shot_ref,diagram_type" }
      )
      .select("data")
      .single();
    if (error) throw error;
    return normalizeShotOverheadDiagram(data.data) ?? diagram;
  }

  const entries = readLocalEntries().filter((item) => !isSameKey(item, key));
  entries.push({ ...key, diagramType: DIAGRAM_TYPE, data: diagram });
  writeLocalEntries(entries);
  return diagram;
}

function isSameKey(entry: LocalDiagramEntry, key: ShotDiagramKey) {
  return entry.projectId === key.projectId
    && entry.dailyPlanId === key.dailyPlanId
    && entry.shotRef === key.shotRef
    && entry.diagramType === DIAGRAM_TYPE;
}

function readLocalEntries(): LocalDiagramEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeLocalEntries(entries: LocalDiagramEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries));
}

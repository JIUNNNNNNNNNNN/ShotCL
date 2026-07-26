import { getShotDiagramKey } from "@/lib/data/shotDiagrams";
import { normalizeShotOverheadDiagram } from "@/lib/shotOverhead";
import type {
  OverheadDiagramArchiveItem,
  Shot,
  ShotMediaLink,
  ShotMediaType,
  ShotOverheadDiagram
} from "@/lib/types";

type ApiError = { error?: string; detail?: string };

export async function listOverheadDiagramArchive(projectId: string): Promise<OverheadDiagramArchiveItem[]> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/shot-diagrams?archive=1`,
    { cache: "no-store" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    archives?: OverheadDiagramArchiveItem[];
  };
  if (!response.ok) throw new Error(payload.error || "직접 만든 부감도를 불러오지 못했습니다.");
  return (payload.archives ?? []).flatMap((item) => {
    const diagram = normalizeShotOverheadDiagram(item.diagram);
    return diagram ? [{ ...item, diagram }] : [];
  });
}

export async function saveOverheadDiagramArchive(
  projectId: string,
  diagram: ShotOverheadDiagram,
  metadata: {
    id?: string;
    title?: string;
    memo?: string;
    sceneNo?: string;
    cutNo?: string;
  } = {}
): Promise<OverheadDiagramArchiveItem> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shot-diagrams`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "save_archive",
      archiveId: metadata.id,
      title: metadata.title,
      memo: metadata.memo,
      sceneNo: metadata.sceneNo,
      cutNo: metadata.cutNo,
      data: diagram
    })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    archive?: OverheadDiagramArchiveItem;
  };
  if (!response.ok || !payload.archive) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "부감도를 아카이브에 저장하지 못했습니다.");
  }
  return payload.archive;
}

export async function deleteOverheadDiagramArchive(projectId: string, archiveId: string) {
  const query = new URLSearchParams({ archiveId });
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/shot-diagrams?${query}`,
    { method: "DELETE" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) throw new Error(payload.error || "부감도 자료를 삭제하지 못했습니다.");
}

export async function loadShotMediaLinks(shots: Shot[]): Promise<Map<string, ShotMediaLink[]>> {
  const result = new Map<string, ShotMediaLink[]>();
  const firstShot = shots[0];
  if (!firstShot?.dailyPlanId) return result;
  const firstKey = getShotDiagramKey(firstShot);
  const query = new URLSearchParams({
    links: "1",
    dailyPlanId: firstKey.dailyPlanId
  });
  const response = await fetch(
    `/api/projects/${encodeURIComponent(firstKey.projectId)}/shot-diagrams?${query}`,
    { cache: "no-store" }
  );
  const payload = (await response.json().catch(() => ({}))) as ApiError & {
    links?: ShotMediaLink[];
  };
  if (!response.ok) throw new Error(payload.error || "컷별 자료 연결을 불러오지 못했습니다.");
  (payload.links ?? []).forEach((link) => {
    result.set(link.shotRef, [...(result.get(link.shotRef) ?? []), {
      ...link,
      diagram: normalizeShotOverheadDiagram(link.diagram)
    }]);
  });
  return result;
}

export async function saveShotMediaLink(
  shot: Shot,
  mediaType: ShotMediaType,
  selection: { assetId: string; source: "reference" | "diagram" } | null
) {
  const key = getShotDiagramKey(shot);
  const response = await fetch(`/api/projects/${encodeURIComponent(key.projectId)}/shot-diagrams`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "save_link",
      dailyPlanId: key.dailyPlanId,
      shotRef: key.shotRef,
      mediaType,
      assetId: selection?.assetId ?? "",
      source: selection?.source ?? "reference"
    })
  });
  const payload = (await response.json().catch(() => ({}))) as ApiError;
  if (!response.ok) {
    throw new Error([payload.error, payload.detail].filter(Boolean).join(" · ") || "컷 자료 연결을 저장하지 못했습니다.");
  }
}

export function applyShotMediaLinks(
  shots: Shot[],
  linksByRef: Map<string, ShotMediaLink[]>,
  legacyDiagrams: Map<string, ShotOverheadDiagram>
) {
  return shots.map((shot) => {
    const shotLinks = linksByRef.get(getShotDiagramKey(shot).shotRef) ?? [];
    const storyboard = shotLinks.find((link) => link.mediaType === "storyboard");
    const overhead = shotLinks.find((link) => link.mediaType === "overhead");
    return {
      ...shot,
      storyboardImageUrl: storyboard?.publicUrl || shot.storyboardImageUrl || null,
      overheadImageUrl: overhead?.publicUrl || null,
      overheadDiagram: overhead?.diagram || legacyDiagrams.get(shot.id) || null
    };
  });
}

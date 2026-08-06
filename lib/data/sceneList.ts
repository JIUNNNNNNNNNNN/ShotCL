import { isValidDatabaseProjectId } from "@/lib/projectId";
import { normalizeSceneNumber } from "@/lib/sceneNumber";
import { normalizeSceneCutCount } from "@/lib/sceneCutCount";
import {
  normalizeSceneListCellMerges,
  SCENE_LIST_REORDER_MERGE_ERROR,
  validateSceneListReorderWithMerges
} from "@/lib/sceneListMergeModel";
import type {
  ProjectSceneActorCell,
  ProjectSceneCellMerge,
  ProjectSceneItem,
  ProjectSceneList,
  ProjectSceneMergeColumn
} from "@/lib/types";

const LOCAL_SCENE_LIST_KEY = "today-storyboard-project-scene-lists";

type SceneListPayload = {
  items?: Record<string, unknown>[];
  scenarioReference?: unknown;
  actorRoles?: unknown;
  cellMerges?: unknown;
  cellMergesMaterialized?: unknown;
  cellMergesUpdatedAt?: unknown;
  orderedIds?: unknown;
  error?: string;
};

export type ProjectSceneClearCell = {
  sceneId: string;
  column: ProjectSceneMergeColumn;
};

export type ProjectSceneListResult = ProjectSceneList & {
  actorRoles: string[];
};

export class SceneListMergeMutationError extends Error {
  readonly status: number;
  readonly latestCellMerges: ProjectSceneCellMerge[];
  readonly latestMaterialized: boolean;
  readonly latestUpdatedAt: string | null;

  constructor(
    message: string,
    status: number,
    latestCellMerges: ProjectSceneCellMerge[],
    latestMaterialized: boolean,
    latestUpdatedAt: string | null
  ) {
    super(message);
    this.name = "SceneListMergeMutationError";
    this.status = status;
    this.latestCellMerges = latestCellMerges;
    this.latestMaterialized = latestMaterialized;
    this.latestUpdatedAt = latestUpdatedAt;
  }
}

type ProjectSceneListSaveInput = Pick<ProjectSceneList, "items" | "scenarioReference"> &
  Partial<Pick<
    ProjectSceneList,
    "cellMerges" | "cellMergesMaterialized" | "cellMergesUpdatedAt"
  >>;

type NormalizedProjectSceneListSave = Pick<ProjectSceneList, "items" | "scenarioReference"> & {
  cellMerges?: ProjectSceneCellMerge[];
  cellMergesMaterialized?: true;
  expectedUpdatedAt?: string | null;
};

type LocalSceneListBuckets = Record<string, ProjectSceneList>;

export function createBlankProjectSceneItem(
  projectId: string,
  sortOrder: number
): ProjectSceneItem {
  const now = new Date().toISOString();
  return {
    id: createUuid(),
    projectId,
    sceneNo: "",
    mainLocation: "",
    subLocation: "",
    dayLabel: "",
    dayNight: "",
    interiorExterior: "",
    sceneContent: "",
    characters: "",
    characterNotes: "",
    actorCells: {},
    props: "",
    cutCount: null,
    sortOrder,
    createdAt: now,
    updatedAt: now
  };
}

/** 프로젝트 공통 씬리스트를 불러오며 Cut은 일촬표 컷수 기준값으로 공유합니다. */
export async function getProjectSceneList(projectId: string): Promise<ProjectSceneListResult> {
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/scene-list`,
      { cache: "no-store" }
    );
    const payload = (await response.json().catch(() => ({}))) as SceneListPayload;
    if (response.ok && Array.isArray(payload.items)) {
      return {
        items: sortSceneItems(payload.items.map(sceneItemFromRow)),
        scenarioReference: String(payload.scenarioReference ?? ""),
        cellMerges: normalizeSceneListCellMerges(payload.cellMerges),
        cellMergesMaterialized: payload.cellMergesMaterialized === true
          || Array.isArray(payload.cellMerges),
        cellMergesUpdatedAt: normalizeOptionalTimestamp(payload.cellMergesUpdatedAt),
        actorRoles: normalizeActorRoles(payload.actorRoles)
      };
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "씬리스트를 불러오지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  return { ...readLocalSceneList(projectId), actorRoles: [] };
}

/** 저장 버튼을 누른 시점의 씬 행과 메모만 한 번에 반영합니다. */
export async function saveProjectSceneList(
  projectId: string,
  sceneList: ProjectSceneListSaveInput
): Promise<ProjectSceneList> {
  const normalized = normalizeSceneListContent(projectId, sceneList);
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/scene-list`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized)
      }
    );
    const payload = (await response.json().catch(() => ({}))) as SceneListPayload;
    if (response.ok && Array.isArray(payload.items)) {
      return {
        items: sortSceneItems(payload.items.map(sceneItemFromRow)),
        scenarioReference: String(payload.scenarioReference ?? ""),
        cellMerges: normalizeSceneListCellMerges(payload.cellMerges),
        cellMergesMaterialized: payload.cellMergesMaterialized === true
          || Array.isArray(payload.cellMerges),
        cellMergesUpdatedAt: normalizeOptionalTimestamp(payload.cellMergesUpdatedAt)
      };
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "씬리스트를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  const current = readLocalSceneList(projectId);
  return writeLocalSceneList(projectId, {
    ...current,
    items: normalized.items,
    scenarioReference: normalized.scenarioReference,
    ...(normalized.cellMergesMaterialized ? {
      cellMerges: normalized.cellMerges ?? [],
      cellMergesMaterialized: true,
      cellMergesUpdatedAt: new Date().toISOString()
    } : {})
  });
}

function normalizeSceneListContent(
  projectId: string,
  sceneList: ProjectSceneListSaveInput
): NormalizedProjectSceneListSave {
  return {
    items: sceneList.items.map((item, index) => ({
      ...item,
      projectId,
      sceneNo: normalizeSceneNumber(item.sceneNo) || item.sceneNo.trim().slice(0, 30),
      mainLocation: item.mainLocation.slice(0, 120),
      subLocation: item.subLocation.slice(0, 160),
      dayLabel: item.dayLabel.slice(0, 30),
      dayNight: item.dayNight.slice(0, 10),
      interiorExterior: item.interiorExterior.slice(0, 10),
      sceneContent: item.sceneContent.slice(0, 4000),
      characters: item.characters.slice(0, 1000),
      characterNotes: String(item.characterNotes ?? "").slice(0, 4000),
      actorCells: normalizeActorCells(item.actorCells),
      props: String(item.props ?? "").slice(0, 1000),
      cutCount: normalizeSceneCutCount(item.cutCount),
      sortOrder: index + 1,
      updatedAt: new Date().toISOString()
    })),
    scenarioReference: sceneList.scenarioReference.slice(0, 50000),
    ...(sceneList.cellMergesMaterialized === true ? {
      cellMerges: normalizeSceneListCellMerges(sceneList.cellMerges),
      cellMergesMaterialized: true as const,
      expectedUpdatedAt: sceneList.cellMergesUpdatedAt ?? null
    } : {})
  };
}

/** 사용자가 병합/해제 메뉴를 확정한 시점에 병합 메타데이터만 저장합니다. */
export async function saveProjectSceneCellMerges(
  projectId: string,
  cellMerges: ProjectSceneCellMerge[],
  expectedUpdatedAt: string | null
): Promise<{ cellMerges: ProjectSceneCellMerge[]; updatedAt: string | null }> {
  const normalized = normalizeSceneListCellMerges(cellMerges);
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/scene-list`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cell-merges",
          cellMerges: normalized,
          expectedUpdatedAt
        })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as SceneListPayload;
    if (response.ok) {
      return {
        cellMerges: normalizeSceneListCellMerges(payload.cellMerges),
        updatedAt: normalizeOptionalTimestamp(payload.cellMergesUpdatedAt)
      };
    }
    if (response.status === 409 && isValidDatabaseProjectId(projectId)) {
      throw new SceneListMergeMutationError(
        payload.error || "셀 병합 상태가 다른 변경과 충돌했습니다.",
        response.status,
        normalizeSceneListCellMerges(payload.cellMerges),
        payload.cellMergesMaterialized === true,
        normalizeOptionalTimestamp(payload.cellMergesUpdatedAt)
      );
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "셀 병합 상태를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  const current = readLocalSceneList(projectId);
  const saved = writeLocalSceneList(projectId, {
    ...current,
    cellMerges: normalized,
    cellMergesMaterialized: true,
    cellMergesUpdatedAt: new Date().toISOString()
  });
  return { cellMerges: saved.cellMerges, updatedAt: saved.cellMergesUpdatedAt };
}

/** 선택 칸 비우기를 확정한 시점에 지정된 셀 값만 비웁니다. */
export async function clearProjectSceneCells(
  projectId: string,
  cells: ProjectSceneClearCell[]
): Promise<ProjectSceneClearCell[]> {
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/scene-list`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-cells", cells })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as SceneListPayload & {
      clearedCells?: unknown;
    };
    if (response.ok) return normalizeClearCells(payload.clearedCells);
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "선택 칸을 비우지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  const normalizedCells = normalizeClearCells(cells);
  const clearBySceneId = new Map<string, Set<ProjectSceneMergeColumn>>();
  for (const cell of normalizedCells) {
    const columns = clearBySceneId.get(cell.sceneId) ?? new Set<ProjectSceneMergeColumn>();
    columns.add(cell.column);
    clearBySceneId.set(cell.sceneId, columns);
  }
  const current = readLocalSceneList(projectId);
  writeLocalSceneList(projectId, {
    ...current,
    items: current.items.map((item) => clearLocalSceneItem(
      item,
      clearBySceneId.get(item.id)
    ))
  });
  return normalizedCells;
}

/** Scene 드래그가 끝난 뒤 안정적인 ID 순서와 sort_order만 저장합니다. */
export async function reorderProjectSceneItems(
  projectId: string,
  orderedIds: string[]
): Promise<string[]> {
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/scene-list`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder", orderedIds })
      }
    );
    const payload = (await response.json().catch(() => ({}))) as SceneListPayload;
    if (response.ok && Array.isArray(payload.orderedIds)) {
      return payload.orderedIds.map(String);
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "씬 순서를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  const current = readLocalSceneList(projectId);
  const byId = new Map(current.items.map((item) => [item.id, item]));
  if (orderedIds.length !== current.items.length ||
    new Set(orderedIds).size !== orderedIds.length ||
    orderedIds.some((id) => !byId.has(id))) {
    throw new Error("씬 순서 데이터가 올바르지 않습니다.");
  }
  if (!validateSceneListReorderWithMerges(
    orderedIds,
    current.cellMerges,
    current.items.map((item) => item.id)
  ).ok) {
    throw new Error(SCENE_LIST_REORDER_MERGE_ERROR);
  }
  writeLocalSceneList(projectId, {
    ...current,
    items: orderedIds.map((id, index) => ({
      ...byId.get(id)!,
      sortOrder: index + 1,
      updatedAt: new Date().toISOString()
    }))
  });
  return orderedIds;
}

function sceneItemFromRow(row: Record<string, unknown>): ProjectSceneItem {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    sceneNo: normalizeSceneNumber(row.scene_no) || String(row.scene_no ?? ""),
    mainLocation: String(row.main_location ?? ""),
    subLocation: String(row.sub_location ?? ""),
    dayLabel: String(row.day_label ?? ""),
    dayNight: String(row.day_night ?? ""),
    interiorExterior: String(row.interior_exterior ?? ""),
    sceneContent: String(row.scene_content ?? ""),
    characters: String(row.characters ?? ""),
    characterNotes: String(row.character_notes ?? ""),
    actorCells: normalizeActorCells(row.actor_cells),
    props: String(row.props ?? ""),
    cutCount: normalizeSceneCutCount(row.cut_count),
    sortOrder: Number(row.sort_order) || 1,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function sortSceneItems(items: ProjectSceneItem[]) {
  return [...items].sort((left, right) => (
    left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)
  ));
}

function normalizeActorRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((role): role is string => typeof role === "string")
      .map((role) => role.trim())
      .filter(Boolean)
  ));
}

function readLocalSceneList(projectId: string): ProjectSceneList {
  if (typeof window === "undefined") return emptySceneList();
  try {
    const raw = window.localStorage.getItem(LOCAL_SCENE_LIST_KEY);
    const buckets = raw ? JSON.parse(raw) as LocalSceneListBuckets : {};
    const current = buckets[projectId];
    return current
      ? {
          items: sortSceneItems((current.items ?? []).map((item) => ({
            ...item,
            characterNotes: String(item.characterNotes ?? ""),
            actorCells: normalizeActorCells(item.actorCells),
            props: String(item.props ?? ""),
            cutCount: normalizeSceneCutCount(item.cutCount)
          }))),
          scenarioReference: current.scenarioReference ?? "",
          cellMerges: normalizeSceneListCellMerges(current.cellMerges),
          cellMergesMaterialized: current.cellMergesMaterialized === true,
          cellMergesUpdatedAt: normalizeOptionalTimestamp(current.cellMergesUpdatedAt)
        }
      : emptySceneList();
  } catch {
    window.localStorage.removeItem(LOCAL_SCENE_LIST_KEY);
    return emptySceneList();
  }
}

function writeLocalSceneList(
  projectId: string,
  sceneList: ProjectSceneList
): ProjectSceneList {
  if (typeof window === "undefined") return sceneList;
  let buckets: LocalSceneListBuckets = {};
  try {
    const raw = window.localStorage.getItem(LOCAL_SCENE_LIST_KEY);
    buckets = raw ? JSON.parse(raw) as LocalSceneListBuckets : {};
  } catch {
    buckets = {};
  }
  buckets[projectId] = sceneList;
  window.localStorage.setItem(LOCAL_SCENE_LIST_KEY, JSON.stringify(buckets));
  return sceneList;
}

function normalizeActorCells(value: unknown): Record<string, ProjectSceneActorCell> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, ProjectSceneActorCell> = {};
  for (const [rawRole, rawCell] of Object.entries(value)) {
    const role = rawRole.trim().slice(0, 120);
    if (!role || !rawCell) continue;
    if (rawCell === true || isLegacyPresentValue(rawCell)) {
      normalized[role] = { mode: "color" };
      continue;
    }
    if (typeof rawCell !== "object" || Array.isArray(rawCell)) continue;
    const record = rawCell as Record<string, unknown>;
    if (isPresentMode(record.mode)) {
      normalized[role] = { mode: "color" };
      continue;
    }
    if (record.mode === "text") {
      const text = String(record.text ?? "").replace(/\r\n?/g, "\n").slice(0, 120);
      if (text.trim()) normalized[role] = { mode: "text", text };
    }
  }
  return normalized;
}

function normalizeClearCells(value: unknown): ProjectSceneClearCell[] {
  if (!Array.isArray(value)) return [];
  const columns = new Set<ProjectSceneMergeColumn>([
    "location",
    "subLocation",
    "day",
    "time",
    "intExt"
  ]);
  const seen = new Set<string>();
  const cells: ProjectSceneClearCell[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const sceneId = String(record.sceneId ?? "").trim();
    const column = String(record.column ?? "") as ProjectSceneMergeColumn;
    const key = `${sceneId}:${column}`;
    if (!sceneId || !columns.has(column) || seen.has(key)) continue;
    seen.add(key);
    cells.push({ sceneId, column });
  }
  return cells;
}

function clearLocalSceneItem(
  item: ProjectSceneItem,
  columns: Set<ProjectSceneMergeColumn> | undefined
) {
  if (!columns?.size) return item;
  const next = { ...item, updatedAt: new Date().toISOString() };
  if (columns.has("location")) next.mainLocation = "";
  if (columns.has("subLocation")) next.subLocation = "";
  if (columns.has("day")) next.dayLabel = "";
  if (columns.has("time")) next.dayNight = "";
  if (columns.has("intExt")) next.interiorExterior = "";
  return next;
}

function emptySceneList(): ProjectSceneList {
  return {
    items: [],
    scenarioReference: "",
    cellMerges: [],
    cellMergesUpdatedAt: null,
    cellMergesMaterialized: false
  };
}

function normalizeOptionalTimestamp(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isPresentMode(value: unknown) {
  const mode = String(value ?? "").trim().toLocaleLowerCase();
  return mode === "color" || mode === "colored" || mode === "present";
}

function isLegacyPresentValue(value: unknown) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase();
  return normalized === "o" || normalized === "true" || normalized === "present"
    || normalized === "color" || normalized === "colored";
}

function createUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

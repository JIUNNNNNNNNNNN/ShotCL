import { isValidDatabaseProjectId } from "@/lib/projectId";
import type { ProjectSceneItem, ProjectSceneList } from "@/lib/types";

const LOCAL_SCENE_LIST_KEY = "today-storyboard-project-scene-lists";

type SceneListPayload = {
  items?: Record<string, unknown>[];
  scenarioReference?: unknown;
  actorRoles?: unknown;
  error?: string;
};

export type ProjectSceneListResult = ProjectSceneList & {
  actorRoles: string[];
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
    props: "",
    sortOrder,
    createdAt: now,
    updatedAt: now
  };
}

/** 일촬표와 무관한 프로젝트 공통 씬리스트를 불러옵니다. */
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

/** 저장 버튼을 누른 시점의 씬 행과 시나리오 참고만 한 번에 반영합니다. */
export async function saveProjectSceneList(
  projectId: string,
  sceneList: ProjectSceneList
): Promise<ProjectSceneList> {
  const normalized = normalizeSceneList(projectId, sceneList);
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
        scenarioReference: String(payload.scenarioReference ?? "")
      };
    }
    if (isValidDatabaseProjectId(projectId) || response.status === 403) {
      throw new Error(payload.error || "씬리스트를 저장하지 못했습니다.");
    }
  } catch (error) {
    if (isValidDatabaseProjectId(projectId) || !(error instanceof TypeError)) throw error;
  }

  return writeLocalSceneList(projectId, normalized);
}

function normalizeSceneList(
  projectId: string,
  sceneList: ProjectSceneList
): ProjectSceneList {
  return {
    items: sceneList.items.map((item, index) => ({
      ...item,
      projectId,
      sceneNo: item.sceneNo.slice(0, 30),
      mainLocation: item.mainLocation.slice(0, 120),
      subLocation: item.subLocation.slice(0, 160),
      dayLabel: item.dayLabel.slice(0, 30),
      dayNight: item.dayNight.slice(0, 10),
      interiorExterior: item.interiorExterior.slice(0, 10),
      sceneContent: item.sceneContent.slice(0, 4000),
      characters: item.characters.slice(0, 1000),
      props: String(item.props ?? "").slice(0, 1000),
      sortOrder: index + 1,
      updatedAt: new Date().toISOString()
    })),
    scenarioReference: sceneList.scenarioReference.slice(0, 50000)
  };
}

function sceneItemFromRow(row: Record<string, unknown>): ProjectSceneItem {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    sceneNo: String(row.scene_no ?? ""),
    mainLocation: String(row.main_location ?? ""),
    subLocation: String(row.sub_location ?? ""),
    dayLabel: String(row.day_label ?? ""),
    dayNight: String(row.day_night ?? ""),
    interiorExterior: String(row.interior_exterior ?? ""),
    sceneContent: String(row.scene_content ?? ""),
    characters: String(row.characters ?? ""),
    props: String(row.props ?? ""),
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
  if (typeof window === "undefined") return { items: [], scenarioReference: "" };
  try {
    const raw = window.localStorage.getItem(LOCAL_SCENE_LIST_KEY);
    const buckets = raw ? JSON.parse(raw) as LocalSceneListBuckets : {};
    const current = buckets[projectId];
    return current
      ? {
          items: sortSceneItems((current.items ?? []).map((item) => ({
            ...item,
            props: String(item.props ?? "")
          }))),
          scenarioReference: current.scenarioReference ?? ""
        }
      : { items: [], scenarioReference: "" };
  } catch {
    window.localStorage.removeItem(LOCAL_SCENE_LIST_KEY);
    return { items: [], scenarioReference: "" };
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

function createUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

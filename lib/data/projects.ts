import { ensureSupabaseDevSession, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { toReadableDataError } from "@/lib/data/errors";
import { projectFromRow, projectInputToRow } from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import { getLocalProjectIdCandidates, isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { emptyProjectBasicInfo, normalizeProjectBasicInfo, validateProjectBasicInfo } from "@/lib/projectBasicInfo";
import type { Project, ProjectBasicInfo, ProjectInput } from "@/lib/types";
import type { ProjectAccessGrant } from "@/lib/projectAccess/core";

type ProjectApiErrorPayload = {
  error?: string;
  code?: string;
  debug?: {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  } | null;
};
export type AccessibleProjectList = {
  projects: Project[];
  preferenceScope: string;
};
const projectRequests = new Map<string, Promise<Project | null>>();
const projectCache = new Map<string, { value: Project; expiresAt: number }>();
const projectBasicInfoRequests = new Map<string, Promise<ProjectBasicInfo>>();
const projectBasicInfoCache = new Map<string, { value: ProjectBasicInfo; expiresAt: number }>();
const projectReadCacheGenerations = new Map<string, number>();
const PROJECT_CACHE_MS = 15_000;
const PROJECT_BASIC_INFO_CACHE_MS = 15_000;

/** 프로젝트 목록을 최신 생성순으로 가져옵니다. */
export async function listProjects(): Promise<Project[]> {
  const sharedProjectsRequest = loadSharedProjects();
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const directProjectsRequest = (async () => {
      await ensureSupabaseDevSession();
      return supabase
        .from("projects")
        .select("id,name,created_at,share_enabled")
        .order("created_at", { ascending: false });
    })();
    const [sharedProjects, { data, error }] = await Promise.all([
      sharedProjectsRequest,
      directProjectsRequest
    ]);
    if (error) throw toReadableDataError(error, "프로젝트 목록을 불러오지 못했습니다.");
    const directProjects = data.map(projectFromRow);
    return mergeProjects(sharedProjects, directProjects);
  }

  const sharedProjects = await sharedProjectsRequest;
  const { projects } = readLocalBuckets();
  return mergeProjects(sharedProjects, projects);
}

/** 서버 account cookie와 기존 비밀번호 browser grant를 합친 canonical 프로젝트 목록입니다. */
export async function listAccessibleProjects(): Promise<AccessibleProjectList> {
  // Auth bearer를 여기서 별도로 붙이지 않습니다. AuthSessionProvider가 먼저
  // /api/auth/session을 동기화하므로 서버의 HttpOnly account cookie가 권한 원본입니다.
  const response = await fetch("/api/projects/access-list", {
    cache: "no-store",
    credentials: "same-origin"
  });
  const payload = (await response.json().catch(() => ({}))) as ProjectApiErrorPayload & {
    projects?: Record<string, unknown>[];
    preferenceScope?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "참여한 프로젝트를 불러오지 못했습니다.");
  }
  return {
    projects: (payload.projects ?? []).map(projectFromRow),
    preferenceScope: payload.preferenceScope?.trim() ?? ""
  };
}

/** 저장된 project ID만 믿지 않고 현재 서버 access grant를 다시 확인합니다. */
export async function verifyProjectAccess(projectId: string): Promise<ProjectAccessGrant | null> {
  const databaseProjectId = normalizeProjectId(projectId);
  if (!isValidDatabaseProjectId(databaseProjectId)) return null;
  const response = await fetch(`/api/projects/${encodeURIComponent(databaseProjectId)}/access`, {
    cache: "no-store",
    credentials: "same-origin"
  });
  const payload = (await response.json().catch(() => ({}))) as ProjectApiErrorPayload & {
    shared?: boolean;
    projectId?: string;
    projectName?: string;
    role?: "admin" | "progress" | null;
    joinedAt?: string;
  };
  if (response.status === 401 || response.status === 403 || response.status === 404) return null;
  if (!response.ok) {
    throw new Error(payload.error || "프로젝트 접근 권한을 확인하지 못했습니다.");
  }
  if (!payload.shared || !payload.projectId || !payload.projectName || !payload.role) return null;
  const verifiedProjectId = normalizeProjectId(payload.projectId);
  if (!isValidDatabaseProjectId(verifiedProjectId) || verifiedProjectId !== databaseProjectId) return null;
  return {
    projectId: verifiedProjectId,
    projectName: payload.projectName,
    role: payload.role,
    joinedAt: payload.joinedAt ?? ""
  };
}

async function loadSharedProjects(): Promise<Project[]> {
  try {
    const response = await fetch("/api/projects/access-list", { cache: "no-store" });
    if (!response.ok) return [];
    const payload = (await response.json()) as { projects?: Record<string, unknown>[] };
    return (payload.projects ?? []).map(projectFromRow);
  } catch {
    // 서버 공유 기능이 설정되지 않은 로컬 개발 모드에서는 기존 저장소를 그대로 사용합니다.
    return [];
  }
}

/** 단일 프로젝트를 ID로 조회합니다. */
export function getProject(projectId: string): Promise<Project | null> {
  const cacheKey = normalizeProjectId(projectId);
  const cached = projectCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (cached) projectCache.delete(cacheKey);

  const existingRequest = projectRequests.get(cacheKey);
  if (existingRequest) return existingRequest;

  const cacheGeneration = getProjectReadCacheGeneration(cacheKey);
  const request = loadProject(projectId).then((project) => {
    if (project && getProjectReadCacheGeneration(cacheKey) === cacheGeneration) {
      cacheProject(cacheKey, project);
    }
    return project;
  });
  projectRequests.set(cacheKey, request);
  const clearRequest = () => {
    if (projectRequests.get(cacheKey) === request) projectRequests.delete(cacheKey);
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

/** 서버 layout의 현재 권한 판정 전에 만들어진 프로젝트 단위 client read를 모두 비웁니다. */
export function clearProjectReadCache(projectId: string) {
  const cacheKey = normalizeProjectId(projectId);
  projectReadCacheGenerations.set(cacheKey, getProjectReadCacheGeneration(cacheKey) + 1);
  projectCache.delete(cacheKey);
  projectRequests.delete(cacheKey);
  projectBasicInfoCache.delete(cacheKey);
  projectBasicInfoRequests.delete(cacheKey);
}

async function loadProject(projectId: string): Promise<Project | null> {
  const localCandidates = getLocalProjectIdCandidates(projectId);
  const databaseProjectId = normalizeProjectId(projectId);
  const localProject = () => {
    const { projects } = readLocalBuckets();
    return projects.find((project) => localCandidates.includes(project.id)) ?? null;
  };

  if (!projectId.trim()) throw new Error("프로젝트를 먼저 선택하세요.");
  let serverFallbackError = "";

  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(databaseProjectId)}`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { project: Record<string, unknown> };
      return projectFromRow(payload.project);
    }
    const payload = (await response.json().catch(() => ({}))) as ProjectApiErrorPayload;
    if (response.status === 400) {
      const project = localProject();
      if (project) return project;
      throw new Error(payload.error || "프로젝트를 먼저 선택하세요.");
    }
    if (response.status === 401 || response.status === 403) throw new Error(payload.error || "이 프로젝트에 접근할 권한이 없습니다.");
    if (response.status === 404) return localProject();
    if (response.status !== 503) throw new Error(payload.error || "프로젝트 정보를 불러오지 못했습니다.");
    serverFallbackError = payload.error || "프로젝트 정보를 불러오지 못했습니다.";
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // 서버에 연결할 수 없는 로컬 개발 모드만 기존 저장소 조회로 이어집니다.
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase && isValidDatabaseProjectId(databaseProjectId)) {
    await ensureSupabaseDevSession();
    const { data, error } = await supabase.from("projects").select("*").eq("id", databaseProjectId).maybeSingle();
    if (error) throw toReadableDataError(error, "프로젝트 상세 정보를 불러오지 못했습니다.");
    if (data) return projectFromRow(data);
  }

  const storedProject = localProject();
  if (storedProject) return storedProject;
  if (serverFallbackError) throw new Error(serverFallbackError);
  return null;
}

/** 새 촬영 프로젝트를 만듭니다. */
export async function createProject(input: ProjectInput): Promise<Project> {
  if (!input.name.trim()) {
    throw new Error("프로젝트명을 입력해주세요.");
  }

  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    await ensureSupabaseDevSession();
    const normalizedName = input.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
    const { data: existingProjects, error: duplicateError } = await supabase.from("projects").select("id,name");
    if (duplicateError) throw toReadableDataError(duplicateError, "프로젝트 이름을 확인하지 못했습니다.");
    if (existingProjects.some((project) => String(project.name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR") === normalizedName)) {
      throw new Error("이미 존재하는 프로젝트 이름입니다");
    }
    const { data, error } = await supabase.from("projects").insert(projectInputToRow(input)).select("*").single();
    if (error) throw toReadableDataError(error, "프로젝트 생성에 실패했습니다. 환경변수 또는 DB 권한을 확인하세요.");
    const project = projectFromRow(data);
    cacheProject(normalizeProjectId(project.id), project);
    return project;
  }

  const now = new Date().toISOString();
  const normalizedName = input.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
  const { projects } = readLocalBuckets();
  if (projects.some((project) => project.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR") === normalizedName)) {
    throw new Error("이미 존재하는 프로젝트 이름입니다");
  }
  const project: Project = {
    id: createLocalId("project"),
    name: input.name,
    shootDate: input.shootDate || "",
    description: input.description,
    createdAt: now
  };

  writeLocalBuckets({ projects: [project, ...projects] }, project.id);
  cacheProject(normalizeProjectId(project.id), project);
  return project;
}

/** 프로젝트 단위 기본정보를 읽습니다. 동일 프로젝트의 짧은 중복 조회는 한 요청으로 합칩니다. */
export function getProjectBasicInfo(projectId: string): Promise<ProjectBasicInfo> {
  const cacheKey = normalizeProjectId(projectId);
  const cached = projectBasicInfoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (cached) projectBasicInfoCache.delete(cacheKey);

  const existingRequest = projectBasicInfoRequests.get(cacheKey);
  if (existingRequest) return existingRequest;

  const cacheGeneration = getProjectReadCacheGeneration(cacheKey);
  const request = loadProjectBasicInfo(projectId).then((value) => {
    if (getProjectReadCacheGeneration(cacheKey) === cacheGeneration) {
      cacheProjectBasicInfo(cacheKey, value);
    }
    return value;
  });
  projectBasicInfoRequests.set(cacheKey, request);
  const clearRequest = () => {
    if (projectBasicInfoRequests.get(cacheKey) === request) {
      projectBasicInfoRequests.delete(cacheKey);
    }
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

async function loadProjectBasicInfo(projectId: string): Promise<ProjectBasicInfo> {
  const databaseProjectId = normalizeProjectId(projectId);
  if (!isValidDatabaseProjectId(databaseProjectId)) {
    const { projects } = readLocalBuckets();
    const project = projects.find((item) => getLocalProjectIdCandidates(projectId).includes(item.id));
    return normalizeProjectBasicInfo(project?.basicInfo ?? emptyProjectBasicInfo);
  }

  const response = await fetch(`/api/projects/${encodeURIComponent(databaseProjectId)}/basic-info`, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as ProjectApiErrorPayload & { basicInfo?: unknown };
  if (!response.ok) {
    throw new Error(payload.error || "프로젝트 기본정보를 불러오지 못했습니다.");
  }
  return normalizeProjectBasicInfo(payload.basicInfo);
}

/** 프로젝트 단위 기본정보만 저장합니다. daily_plans에는 어떤 row도 만들지 않습니다. */
export async function saveProjectBasicInfo(projectId: string, basicInfo: ProjectBasicInfo): Promise<ProjectBasicInfo> {
  const validation = validateProjectBasicInfo(basicInfo);
  if (!validation.ok) throw new Error(validation.error);

  const databaseProjectId = normalizeProjectId(projectId);
  if (!isValidDatabaseProjectId(databaseProjectId)) {
    const candidates = getLocalProjectIdCandidates(projectId);
    const { projects } = readLocalBuckets();
    const projectIndex = projects.findIndex((project) => candidates.includes(project.id));
    if (projectIndex < 0) throw new Error("프로젝트를 찾을 수 없습니다.");
    const nextProjects = projects.map((project, index) => (
      index === projectIndex ? { ...project, basicInfo: validation.value } : project
    ));
    writeLocalBuckets({ projects: nextProjects }, projects[projectIndex].id);
    cacheProjectBasicInfo(databaseProjectId, validation.value);
    cacheProject(databaseProjectId, nextProjects[projectIndex]);
    return validation.value;
  }

  const response = await fetch(`/api/projects/${encodeURIComponent(databaseProjectId)}/basic-info`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ basicInfo: validation.value })
  });
  const payload = (await response.json().catch(() => ({}))) as ProjectApiErrorPayload & { basicInfo?: unknown };
  if (!response.ok) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[project-basic-info] save failed", {
        status: response.status,
        code: payload.code,
        error: payload.error,
        debug: payload.debug
      });
    }
    throw new Error(payload.error || "프로젝트 기본정보를 저장하지 못했습니다.");
  }
  const savedBasicInfo = normalizeProjectBasicInfo(payload.basicInfo);
  cacheProjectBasicInfo(databaseProjectId, savedBasicInfo);
  const cachedProject = projectCache.get(databaseProjectId);
  if (cachedProject) {
    cacheProject(databaseProjectId, {
      ...cachedProject.value,
      basicInfo: savedBasicInfo,
      calendarInfo: {
        totalEpisodes: savedBasicInfo.totalEpisodes,
        shootingStartDate: savedBasicInfo.shootingStartDate,
        shootingEndDate: savedBasicInfo.shootingEndDate
      }
    });
  }
  return savedBasicInfo;
}

export type ProjectBasicInfoEntityKind = "staff" | "actor";

export async function deleteProjectBasicInfoEntity(
  projectId: string,
  input: { kind: ProjectBasicInfoEntityKind; id: string }
): Promise<string> {
  const databaseProjectId = normalizeProjectId(projectId);
  if (!isValidDatabaseProjectId(databaseProjectId)) {
    throw new Error("로컬 프로젝트의 기본정보 삭제는 서버 복원 영수증을 사용하지 않습니다.");
  }
  const response = await fetch(`/api/projects/${encodeURIComponent(databaseProjectId)}/basic-info`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "delete_entity", ...input })
  });
  const payload = (await response.json().catch(() => ({}))) as ProjectApiErrorPayload & {
    receipt?: string;
    basicInfo?: unknown;
  };
  if (!response.ok || !payload.receipt) {
    throw new Error(payload.error || "프로젝트 기본정보 항목을 삭제하지 못했습니다.");
  }
  if (payload.basicInfo) cacheProjectBasicInfo(databaseProjectId, normalizeProjectBasicInfo(payload.basicInfo));
  return payload.receipt;
}

export async function restoreDeletedProjectBasicInfoEntity(
  projectId: string,
  receipt: string
): Promise<ProjectBasicInfo> {
  const databaseProjectId = normalizeProjectId(projectId);
  const response = await fetch(`/api/projects/${encodeURIComponent(databaseProjectId)}/basic-info`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "restore_deleted_entity", receipt })
  });
  const payload = (await response.json().catch(() => ({}))) as ProjectApiErrorPayload & { basicInfo?: unknown };
  if (!response.ok || !payload.basicInfo) {
    throw new Error(payload.error || "프로젝트 기본정보 항목을 복원하지 못했습니다.");
  }
  const basicInfo = normalizeProjectBasicInfo(payload.basicInfo);
  cacheProjectBasicInfo(databaseProjectId, basicInfo);
  return basicInfo;
}

export async function finalizeDeletedProjectBasicInfoEntity(
  projectId: string,
  receipt: string
): Promise<void> {
  const databaseProjectId = normalizeProjectId(projectId);
  const response = await fetch(`/api/projects/${encodeURIComponent(databaseProjectId)}/basic-info`, {
    method: "PATCH",
    credentials: "same-origin",
    keepalive: receipt.length <= 48_000,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "finalize_deleted_entity", receipt })
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ProjectApiErrorPayload;
    throw new Error(payload.error || "프로젝트 기본정보 항목 삭제를 확정하지 못했습니다.");
  }
}

function cacheProject(projectId: string, value: Project) {
  projectCache.set(projectId, {
    value,
    expiresAt: Date.now() + PROJECT_CACHE_MS
  });
}

function getProjectReadCacheGeneration(projectId: string) {
  return projectReadCacheGenerations.get(projectId) ?? 0;
}

function cacheProjectBasicInfo(projectId: string, value: ProjectBasicInfo) {
  projectBasicInfoCache.set(projectId, {
    value,
    expiresAt: Date.now() + PROJECT_BASIC_INFO_CACHE_MS
  });
}

function mergeProjects(primary: Project[], secondary: Project[]) {
  const byId = new Map<string, Project>();
  [...secondary, ...primary].forEach((project) => byId.set(project.id, project));
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

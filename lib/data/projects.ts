import { ensureSupabaseDevSession, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { toReadableDataError } from "@/lib/data/errors";
import { projectFromRow, projectInputToRow } from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import type { Project, ProjectInput } from "@/lib/types";

/** 프로젝트 목록을 최신 생성순으로 가져옵니다. */
export async function listProjects(): Promise<Project[]> {
  let sharedProjects: Project[] = [];
  try {
    const response = await fetch("/api/projects/access-list", { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { projects?: Record<string, unknown>[] };
      sharedProjects = (payload.projects ?? []).map(projectFromRow);
    }
  } catch {
    // 서버 공유 기능이 설정되지 않은 로컬 개발 모드에서는 기존 저장소를 그대로 사용합니다.
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    await ensureSupabaseDevSession();
    const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
    if (error) throw toReadableDataError(error, "프로젝트 목록을 불러오지 못했습니다.");
    const directProjects = data.map(projectFromRow);
    return mergeProjects(sharedProjects, directProjects);
  }

  const { projects } = readLocalBuckets();
  return mergeProjects(sharedProjects, projects);
}

/** 단일 프로젝트를 ID로 조회합니다. */
export async function getProject(projectId: string): Promise<Project | null> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { project: Record<string, unknown> };
      return projectFromRow(payload.project);
    }
  } catch {
    // 공유 세션이 없는 레거시 프로젝트는 기존 저장소 조회로 이어집니다.
  }
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    await ensureSupabaseDevSession();
    const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
    if (error) throw toReadableDataError(error, "프로젝트 상세 정보를 불러오지 못했습니다.");
    return data ? projectFromRow(data) : null;
  }

  const { projects } = readLocalBuckets();
  return projects.find((project) => project.id === projectId) ?? null;
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
    return projectFromRow(data);
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
  return project;
}

function mergeProjects(primary: Project[], secondary: Project[]) {
  const byId = new Map<string, Project>();
  [...secondary, ...primary].forEach((project) => byId.set(project.id, project));
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

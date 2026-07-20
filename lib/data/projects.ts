import { ensureSupabaseDevSession, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { toReadableDataError } from "@/lib/data/errors";
import { projectFromRow, projectInputToRow } from "@/lib/data/mappers";
import { createLocalId, readLocalBuckets, writeLocalBuckets } from "@/lib/data/localStore";
import type { Project, ProjectInput } from "@/lib/types";

/** 프로젝트 목록을 최신 생성순으로 가져옵니다. */
export async function listProjects(): Promise<Project[]> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    await ensureSupabaseDevSession();
    const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
    if (error) throw toReadableDataError(error, "프로젝트 목록을 불러오지 못했습니다.");
    return data.map(projectFromRow);
  }

  const { projects } = readLocalBuckets();
  return [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 단일 프로젝트를 ID로 조회합니다. */
export async function getProject(projectId: string): Promise<Project | null> {
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
    const { data, error } = await supabase.from("projects").insert(projectInputToRow(input)).select("*").single();
    if (error) throw toReadableDataError(error, "프로젝트 생성에 실패했습니다. 환경변수 또는 DB 권한을 확인하세요.");
    return projectFromRow(data);
  }

  const now = new Date().toISOString();
  const project: Project = {
    id: createLocalId("project"),
    name: input.name,
    shootDate: input.shootDate || "",
    description: input.description,
    createdAt: now
  };

  const { projects } = readLocalBuckets();
  writeLocalBuckets({ projects: [project, ...projects] }, project.id);
  return project;
}

import { cookies } from "next/headers";
import { ProjectAccessGate } from "@/components/ProjectAccessGate";
import { projectFromRow } from "@/lib/data/mappers";
import {
  getAccountAccessPreferenceScope,
  getAccessPreferenceScope,
  getProjectRequestAccessFromTokens,
  PROJECT_GUEST_INVITE_COOKIE,
  PROJECT_SESSION_COOKIE,
  ProjectAccessUnavailableError,
  requireProjectAccessDb,
  type ProjectRequestProjectSnapshot
} from "@/lib/projectAccess/server";
import { SHOTCL_ACCOUNT_COOKIE } from "@/lib/projectAccess/accountServer";
import { normalizeProjectId } from "@/lib/projectId";
import {
  buildProjectWorkspaceDailyPlanSummaries,
  type ProjectWorkspaceSnapshot
} from "@/lib/projectWorkspaceSnapshot";

const DAILY_PLAN_LIST_COLUMNS = "id,project_id,title,source_type,source_file_name,shooting_date,episode,call_time,meeting_location,shooting_locations,meal_times,memo,created_at,updated_at";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = normalizeProjectId(id);
  const cookieStore = await cookies();
  const projectSessionToken = cookieStore.get(PROJECT_SESSION_COOKIE)?.value ?? null;
  const guestInviteToken = cookieStore.get(PROJECT_GUEST_INVITE_COOKIE)?.value ?? null;
  const accountSessionToken = cookieStore.get(SHOTCL_ACCOUNT_COOKIE)?.value ?? null;
  let role: "admin" | "progress" | null = null;
  let projectName: string | null = null;
  let accessMode: "member" | "guest" | "legacy" | null = null;
  let editorEligible = false;
  let accountUserId: string | null = null;
  let initialWorkspace: ProjectWorkspaceSnapshot = {
    project: null,
    dailyPlans: [],
    error: ""
  };
  try {
    const access = await getProjectRequestAccessFromTokens(projectId, {
      accountSessionToken,
      guestInviteToken,
      legacySessionToken: projectSessionToken
    });
    role = access?.grant.role ?? null;
    projectName = access?.grant.projectName ?? null;
    accessMode = access?.mode ?? null;
    editorEligible = access?.editorEligible ?? false;
    accountUserId = access?.accountUserId ?? null;
    if (access) {
      initialWorkspace = await loadInitialProjectWorkspace(
        projectId,
        access.grant.role,
        access.project
      );
    }
  } catch (error) {
    if (!(error instanceof ProjectAccessUnavailableError)) throw error;
    initialWorkspace = {
      project: null,
      dailyPlans: [],
      error: "프로젝트 메뉴를 불러오지 못했습니다."
    };
  }
  return (
    <ProjectAccessGate
      projectId={projectId}
      projectName={projectName}
      role={role}
      accessMode={accessMode}
      editorEligible={editorEligible}
      accountUserId={accountUserId}
      initialWorkspace={initialWorkspace}
      accessPreferenceScope={accessMode === "member"
        ? getAccountAccessPreferenceScope(accountUserId)
        : getAccessPreferenceScope(
            accessMode === "guest" ? guestInviteToken : projectSessionToken
          )}
    >
      {children}
    </ProjectAccessGate>
  );
}

async function loadInitialProjectWorkspace(
  projectId: string,
  role: "admin" | "progress",
  accessProject?: ProjectRequestProjectSnapshot
): Promise<ProjectWorkspaceSnapshot> {
  const supabase = requireProjectAccessDb();
  const [projectResult, calendarResult, planResult, dailyPlanShotResult, progressShotResult] = await Promise.all([
    accessProject
      ? Promise.resolve({ data: accessProject, error: null })
      : supabase
          .from("projects")
          .select("id,name,shoot_date,description,created_at,share_enabled")
          .eq("id", projectId)
          .maybeSingle(),
    supabase
      .from("project_basic_info")
      .select("total_episodes,shooting_start_date,shooting_end_date")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("daily_plans")
      .select(DAILY_PLAN_LIST_COLUMNS)
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("daily_plan_shots")
      .select("daily_plan_id,scene_number")
      .eq("project_id", projectId),
    supabase
      .from("shots")
      .select("id,daily_plan_id,status")
      .eq("project_id", projectId)
  ]);
  const lookupErrors = [
    projectResult.error,
    calendarResult.error,
    planResult.error,
    dailyPlanShotResult.error,
    progressShotResult.error
  ].filter(Boolean);
  if (lookupErrors.length > 0) {
    console.error("[project-workspace-layout] initial snapshot lookup failed", lookupErrors.map((error) => ({
      code: error?.code,
      message: error?.message
    })));
  }
  // project GET과 마찬가지로 calendar 보조 정보 실패만으로 workspace 전체를 막지 않습니다.
  const workspaceErrors = [
    projectResult.error,
    planResult.error,
    dailyPlanShotResult.error,
    progressShotResult.error
  ].filter(Boolean);

  const project = projectResult.data
    ? projectFromRow({
        ...projectResult.data,
        access_role: role,
        calendar_info: calendarResult.error ? null : calendarResult.data
      })
    : null;
  const dailyPlans = planResult.error || dailyPlanShotResult.error || progressShotResult.error
    ? []
    : buildProjectWorkspaceDailyPlanSummaries(
        (planResult.data ?? []) as Array<Record<string, unknown>>,
        dailyPlanShotResult.data ?? [],
        progressShotResult.data ?? []
      );

  return {
    project,
    dailyPlans,
    error: workspaceErrors.length > 0 ? "프로젝트 메뉴를 불러오지 못했습니다." : ""
  };
}

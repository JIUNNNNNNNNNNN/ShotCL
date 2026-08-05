import { cookies } from "next/headers";
import { ProjectAccessGate } from "@/components/ProjectAccessGate";
import {
  getAccessGrantByToken,
  getAccessPreferenceScope,
  PROJECT_SESSION_COOKIE,
  ProjectAccessUnavailableError
} from "@/lib/projectAccess/server";
import { normalizeProjectId } from "@/lib/projectId";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = normalizeProjectId(id);
  const cookieStore = await cookies();
  const projectSessionToken = cookieStore.get(PROJECT_SESSION_COOKIE)?.value ?? null;
  let role: "admin" | "progress" | null = null;
  let projectName: string | null = null;
  try {
    const grant = await getAccessGrantByToken(projectSessionToken, projectId);
    role = grant?.role ?? null;
    projectName = grant?.projectName ?? null;
  } catch (error) {
    if (!(error instanceof ProjectAccessUnavailableError)) throw error;
  }
  return (
    <ProjectAccessGate
      projectId={projectId}
      projectName={projectName}
      role={role}
      accessPreferenceScope={getAccessPreferenceScope(projectSessionToken)}
    >
      {children}
    </ProjectAccessGate>
  );
}

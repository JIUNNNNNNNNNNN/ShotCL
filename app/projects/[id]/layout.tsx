import { cookies } from "next/headers";
import { ProjectAccessGate } from "@/components/ProjectAccessGate";
import { getAccessGrantByToken, PROJECT_SESSION_COOKIE, ProjectAccessUnavailableError } from "@/lib/projectAccess/server";
import { normalizeProjectId } from "@/lib/projectId";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = normalizeProjectId(id);
  const cookieStore = await cookies();
  let role: "admin" | "progress" | null = null;
  try {
    role = (await getAccessGrantByToken(cookieStore.get(PROJECT_SESSION_COOKIE)?.value ?? null, projectId))?.role ?? null;
  } catch (error) {
    if (!(error instanceof ProjectAccessUnavailableError)) throw error;
  }
  return <ProjectAccessGate projectId={id} role={role}>{children}</ProjectAccessGate>;
}

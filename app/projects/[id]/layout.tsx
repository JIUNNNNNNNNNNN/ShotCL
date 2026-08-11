import { cookies } from "next/headers";
import { ProjectAccessGate } from "@/components/ProjectAccessGate";
import {
  getAccessPreferenceScope,
  getProjectRequestAccessFromTokens,
  PROJECT_GUEST_INVITE_COOKIE,
  PROJECT_SESSION_COOKIE,
  ProjectAccessUnavailableError
} from "@/lib/projectAccess/server";
import { SHOTCL_ACCOUNT_COOKIE } from "@/lib/projectAccess/accountServer";
import { normalizeProjectId } from "@/lib/projectId";

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
  } catch (error) {
    if (!(error instanceof ProjectAccessUnavailableError)) throw error;
  }
  return (
    <ProjectAccessGate
      projectId={projectId}
      projectName={projectName}
      role={role}
      accessMode={accessMode}
      editorEligible={editorEligible}
      accountUserId={accountUserId}
      accessPreferenceScope={getAccessPreferenceScope(
        accessMode === "member"
          ? accountSessionToken
          : accessMode === "guest"
            ? guestInviteToken
            : projectSessionToken
      )}
    >
      {children}
    </ProjectAccessGate>
  );
}

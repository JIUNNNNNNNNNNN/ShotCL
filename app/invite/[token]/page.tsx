import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  ProjectInviteRedeemer,
  type InviteScreenState
} from "@/components/project-invites/ProjectInviteRedeemer";
import {
  getAccessGrantByToken,
  PROJECT_SESSION_COOKIE
} from "@/lib/projectAccess/server";
import {
  inspectProjectStaffInvite,
  ProjectStaffInviteMigrationRequiredError,
  ProjectStaffInviteUnavailableError
} from "@/lib/projectStaffInvites.server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "스탭 초대 · ShotCL",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    noarchive: true
  }
};

export default async function ProjectInvitePage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const initialState = await resolveInitialState(token);
  return <ProjectInviteRedeemer token={token} initialState={initialState} />;
}

async function resolveInitialState(token: string): Promise<InviteScreenState> {
  try {
    const invite = await inspectProjectStaffInvite(token);
    if (!invite) return { status: "invalid" };
    const cookieStore = await cookies();
    const browserToken = cookieStore.get(PROJECT_SESSION_COOKIE)?.value ?? null;
    const grant = await getAccessGrantByToken(browserToken, invite.projectId);
    return {
      status: grant ? "already_member" : "valid",
      projectId: invite.projectId,
      projectName: invite.projectName
    };
  } catch (error) {
    if (
      error instanceof ProjectStaffInviteMigrationRequiredError
      || error instanceof ProjectStaffInviteUnavailableError
    ) {
      return { status: "unavailable" };
    }
    console.error("[project-staff-invite-page]", {
      message: error instanceof Error ? error.message : "Unknown error"
    });
    return { status: "unavailable" };
  }
}

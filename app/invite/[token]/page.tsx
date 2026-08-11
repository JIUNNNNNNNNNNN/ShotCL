import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ProjectInviteRedeemer,
  type InviteScreenState
} from "@/components/project-invites/ProjectInviteRedeemer";
import {
  getProjectRequestAccessFromTokens,
  PROJECT_GUEST_INVITE_COOKIE,
  PROJECT_SESSION_COOKIE
} from "@/lib/projectAccess/server";
import { SHOTCL_ACCOUNT_COOKIE } from "@/lib/projectAccess/accountServer";
import {
  inspectProjectStaffInvite,
  ProjectStaffInviteMigrationRequiredError,
  ProjectStaffInviteUnavailableError
} from "@/lib/projectStaffInvites.server";
import { buildProjectNavigationHref } from "@/lib/projectNavigation";

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
  if (initialState.status === "already_member") redirect(initialState.destination);
  return <ProjectInviteRedeemer token={token} initialState={initialState} />;
}

async function resolveInitialState(token: string): Promise<InviteScreenState> {
  try {
    const invite = await inspectProjectStaffInvite(token);
    if (!invite) return { status: "invalid" };
    const cookieStore = await cookies();
    const access = await getProjectRequestAccessFromTokens(invite.projectId, {
      accountSessionToken: cookieStore.get(SHOTCL_ACCOUNT_COOKIE)?.value ?? null,
      guestInviteToken: cookieStore.get(PROJECT_GUEST_INVITE_COOKIE)?.value ?? null,
      legacySessionToken: cookieStore.get(PROJECT_SESSION_COOKIE)?.value ?? null
    });
    return {
      status: access ? "already_member" : "valid",
      projectId: invite.projectId,
      projectName: invite.projectName,
      destination: buildProjectNavigationHref(invite.projectId, "progress")
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

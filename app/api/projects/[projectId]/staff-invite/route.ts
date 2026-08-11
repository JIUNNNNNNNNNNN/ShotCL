import { NextRequest, NextResponse } from "next/server";
import {
  getProjectRequestAccess,
  getSessionToken,
  hashProjectSessionToken,
  ProjectAccessUnavailableError
} from "@/lib/projectAccess/server";
import {
  ensureProjectStaffInvite,
  ensureProjectStaffInviteForAccount,
  getProjectStaffInviteManagementState,
  ProjectStaffInviteMigrationRequiredError,
  ProjectStaffInviteUnavailableError,
  revokeProjectStaffInvite,
  revokeProjectStaffInviteForAccount
} from "@/lib/projectStaffInvites.server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type RouteContext = { params: Promise<{ projectId: string }> };
type InviteAction = "ensure" | "rotate" | "revoke";

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const access = await requireInviteAdmin(request, context);
    if (access instanceof NextResponse) return access;
    const state = await getProjectStaffInviteManagementState(request, access.projectId);
    return inviteJson({ ok: true, ...state });
  } catch (error) {
    return inviteErrorResponse(error, "스탭 초대 링크 상태를 불러오지 못했습니다.");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const access = await requireInviteAdmin(request, context);
    if (access instanceof NextResponse) return access;
    const action = await readAction(request);
    if (!action) {
      return inviteJson(
        { ok: false, error: "초대 링크 요청이 올바르지 않습니다.", code: "PROJECT_STAFF_INVITE_ACTION_INVALID" },
        400
      );
    }

    if (action === "revoke") {
      const revoked = access.mode === "account"
        ? await revokeProjectStaffInviteForAccount(access.projectId, access.userId)
        : await revokeProjectStaffInvite(access.projectId, access.creatorSessionHash);
      return inviteJson({ ok: true, status: "inactive", revoked });
    }

    const state = access.mode === "account"
      ? await ensureProjectStaffInviteForAccount(
        request,
        access.projectId,
        access.userId,
        action === "rotate"
      )
      : await ensureProjectStaffInvite(
        request,
        access.projectId,
        access.creatorSessionHash,
        action === "rotate"
      );
    return inviteJson({ ok: true, ...state });
  } catch (error) {
    return inviteErrorResponse(error, "스탭 초대 링크를 변경하지 못했습니다.");
  }
}

async function requireInviteAdmin(request: NextRequest, context: RouteContext) {
  const { projectId: routeProjectId } = await context.params;
  const projectId = normalizeProjectId(routeProjectId);
  if (!isValidDatabaseProjectId(projectId)) {
    return inviteJson(
      { ok: false, error: "프로젝트 ID가 올바르지 않습니다.", code: "INVALID_PROJECT_ID" },
      400
    );
  }
  const access = await getProjectRequestAccess(request, projectId);
  if (access?.grant.role !== "admin") {
    return inviteJson(
      { ok: false, error: "스탭 초대 링크는 Key staff만 관리할 수 있습니다.", code: "PROJECT_STAFF_INVITE_FORBIDDEN" },
      403
    );
  }
  if (access.mode === "member" && access.accountUserId) {
    return { projectId, mode: "account" as const, userId: access.accountUserId };
  }
  const sessionToken = getSessionToken(request);
  if (!sessionToken) {
    return inviteJson(
      { ok: false, error: "스탭 초대 링크를 관리할 권한이 없습니다.", code: "PROJECT_STAFF_INVITE_FORBIDDEN" },
      403
    );
  }
  return {
    projectId,
    mode: "legacy" as const,
    creatorSessionHash: hashProjectSessionToken(sessionToken)
  };
}

async function readAction(request: NextRequest): Promise<InviteAction | null> {
  try {
    const body = await request.json() as { action?: unknown };
    return body.action === "ensure" || body.action === "rotate" || body.action === "revoke"
      ? body.action
      : null;
  } catch {
    return null;
  }
}

function inviteErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof ProjectStaffInviteMigrationRequiredError) {
    return inviteJson(
      { ok: false, error: error.message, code: "PROJECT_STAFF_INVITE_MIGRATION_REQUIRED" },
      503
    );
  }
  if (error instanceof ProjectAccessUnavailableError || error instanceof ProjectStaffInviteUnavailableError) {
    return inviteJson(
      { ok: false, error: error.message || fallbackMessage, code: "PROJECT_STAFF_INVITE_UNAVAILABLE" },
      503
    );
  }
  const databaseError = getDatabaseError(error);
  if (databaseError.code === "42501" || databaseError.code === "PGRST301") {
    return inviteJson(
      { ok: false, error: "스탭 초대 링크를 관리할 권한이 없습니다.", code: "PROJECT_STAFF_INVITE_FORBIDDEN" },
      403
    );
  }
  console.error("[project-staff-invite-management]", databaseError);
  return inviteJson(
    { ok: false, error: fallbackMessage, code: "PROJECT_STAFF_INVITE_REQUEST_FAILED" },
    500
  );
}

function inviteJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer"
    }
  });
}

function getDatabaseError(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return { code: "", message: error instanceof Error ? error.message : "Unknown error" };
  }
  const source = error as Record<string, unknown>;
  return {
    code: String(source.code ?? ""),
    message: String(source.message ?? ""),
    details: String(source.details ?? ""),
    hint: String(source.hint ?? "")
  };
}

import { NextRequest, NextResponse } from "next/server";
import {
  createProjectSessionToken,
  getSessionToken,
  hashProjectSessionToken,
  ProjectAccessUnavailableError,
  setProjectSessionCookie
} from "@/lib/projectAccess/server";
import {
  inspectProjectStaffInvite,
  ProjectStaffInviteMigrationRequiredError,
  ProjectStaffInviteUnavailableError,
  redeemProjectStaffInvite
} from "@/lib/projectStaffInvites.server";
import { buildProjectNavigationHref } from "@/lib/projectNavigation";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const invite = await inspectProjectStaffInvite(token);
    if (!invite) return invalidInviteResponse();
    return publicInviteJson({
      ok: true,
      status: "valid",
      projectName: invite.projectName
    });
  } catch (error) {
    return publicInviteErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    if (!(await isSameOriginJoinRequest(request))) {
      return publicInviteJson(
        {
          ok: false,
          status: "forbidden",
          error: "초대 참여 요청을 확인할 수 없습니다.",
          code: "PROJECT_STAFF_INVITE_REQUEST_FORBIDDEN"
        },
        403
      );
    }
    const { token } = await context.params;
    const browserSessionToken = getSessionToken(request) || createProjectSessionToken();
    const result = await redeemProjectStaffInvite(
      token,
      hashProjectSessionToken(browserSessionToken)
    );
    if (!result) return invalidInviteResponse();

    const response = publicInviteJson({
      ok: true,
      status: result.alreadyMember ? "already_member" : "joined",
      projectId: result.projectId,
      projectName: result.projectName,
      alreadyMember: result.alreadyMember,
      destination: buildProjectNavigationHref(result.projectId, "progress")
    });
    setProjectSessionCookie(response, browserSessionToken);
    return response;
  } catch (error) {
    return publicInviteErrorResponse(error);
  }
}

async function isSameOriginJoinRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestOrigins = new Set([request.nextUrl.origin]);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    const host = forwardedHost || request.headers.get("host")?.trim();
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const protocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "");
    if (host && (protocol === "https" || protocol === "http")) {
      requestOrigins.add(new URL(`${protocol}://${host}`).origin);
    }
    if (!requestOrigins.has(new URL(origin).origin)) return false;
  } catch {
    return false;
  }
  try {
    const body = await request.json() as { action?: unknown };
    return body.action === "join";
  } catch {
    return false;
  }
}

function invalidInviteResponse() {
  return publicInviteJson(
    {
      ok: false,
      status: "invalid",
      error: "초대 링크가 유효하지 않거나 비활성화되었습니다.",
      code: "PROJECT_STAFF_INVITE_INVALID"
    },
    404
  );
}

function publicInviteErrorResponse(error: unknown) {
  if (
    error instanceof ProjectStaffInviteMigrationRequiredError
    || error instanceof ProjectAccessUnavailableError
    || error instanceof ProjectStaffInviteUnavailableError
  ) {
    return publicInviteJson(
      {
        ok: false,
        status: "unavailable",
        error: "초대 기능을 준비 중입니다. 잠시 후 다시 시도해주세요.",
        code: "PROJECT_STAFF_INVITE_UNAVAILABLE"
      },
      503
    );
  }
  console.error("[project-staff-invite-redemption]", getSafeDatabaseError(error));
  return publicInviteJson(
    {
      ok: false,
      status: "error",
      error: "프로젝트에 참여하지 못했습니다.",
      code: "PROJECT_STAFF_INVITE_REQUEST_FAILED"
    },
    500
  );
}

function publicInviteJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive"
    }
  });
}

function getSafeDatabaseError(error: unknown) {
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

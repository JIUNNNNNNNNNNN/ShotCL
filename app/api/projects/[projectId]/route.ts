import { NextRequest, NextResponse } from "next/server";
import {
  clearProjectGuestInviteCookie,
  clearProjectGuestProgressTargetCookie,
  getAccessGrant,
  getProjectGuestInviteToken,
  parseProjectGuestProgressTargetCookie,
  ProjectAccessUnavailableError,
  requireProjectAccessDb,
  PROJECT_GUEST_PROGRESS_TARGET_COOKIE
} from "@/lib/projectAccess/server";
import {
  getShotclBearerToken,
  resolveAuthenticatedGoogleAccount,
  ShotclAccountUnavailableError
} from "@/lib/projectAccess/accountServer";
import { parseProjectPermanentDeletionConfirmation } from "@/lib/projectDeletion/core";
import {
  permanentlyDeleteProject,
  ProjectPermanentDeletionError
} from "@/lib/projectDeletion/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { inspectProjectStaffInvite } from "@/lib/projectStaffInvites.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization"
} as const;

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) {
      return NextResponse.json({ error: "프로젝트 ID가 올바르지 않습니다.", code: "INVALID_PROJECT_ID" }, { status: 400 });
    }
    const supabase = requireProjectAccessDb();
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id,name,shoot_date,description,created_at,share_enabled,deletion_started_at")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다.", code: "PROJECT_NOT_FOUND" }, { status: 404 });
    if (project.deletion_started_at) {
      return NextResponse.json(
        { error: "프로젝트가 영구 삭제 중입니다.", code: "PROJECT_DELETING" },
        { status: 410, headers: NO_STORE_HEADERS }
      );
    }
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ error: "이 프로젝트에 접근할 권한이 없습니다.", code: "PROJECT_ACCESS_DENIED" }, { status: 403 });
    const { data: calendarInfo, error: calendarInfoError } = await supabase
      .from("project_basic_info")
      .select("total_episodes,shooting_start_date,shooting_end_date")
      .eq("project_id", projectId)
      .maybeSingle();
    if (calendarInfoError) {
      console.error("[project-calendar] basic info lookup failed", {
        code: calendarInfoError.code,
        message: calendarInfoError.message
      });
    }
    return NextResponse.json({
      project: {
        ...project,
        access_role: grant.role,
        calendar_info: calendarInfoError ? null : calendarInfo
      }
    });
  } catch (error) {
    return NextResponse.json({ error: "프로젝트 정보를 불러오지 못했습니다.", code: "PROJECT_LOOKUP_FAILED" }, { status: error instanceof ProjectAccessUnavailableError ? 503 : 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) {
      return deletionJson(
        { error: "프로젝트 ID가 올바르지 않습니다.", code: "INVALID_PROJECT_ID" },
        400
      );
    }
    if (!isSameOriginJsonRequest(request)) {
      return deletionJson(
        { error: "프로젝트 영구 삭제 요청을 확인할 수 없습니다.", code: "INVALID_DELETE_REQUEST" },
        403
      );
    }

    // Permanent deletion is a step-up action: an opaque app cookie alone is
    // insufficient. Supabase validates the current Google user JWT now.
    const account = await resolveAuthenticatedGoogleAccount(
      getShotclBearerToken(request)
    );
    if (!account) {
      return deletionJson(
        { error: "Google 계정 인증을 다시 확인해 주세요.", code: "GOOGLE_REAUTH_REQUIRED" },
        401
      );
    }
    if (!account.isEditor) {
      return deletionJson(
        { error: "이 계정에는 프로젝트 영구 삭제 권한이 없습니다.", code: "EDITOR_ACCOUNT_REQUIRED" },
        403
      );
    }

    const confirmation = parseProjectPermanentDeletionConfirmation(
      await request.json().catch(() => null)
    );
    if (!confirmation) {
      return deletionJson(
        { error: "프로젝트 이름과 ‘영구 삭제’ 확인 문구를 정확히 입력해 주세요.", code: "INVALID_CONFIRMATION" },
        400
      );
    }

    const clearGuestInvite = await requestGuestInviteMatchesProject(
      request,
      projectId
    );
    const progressTarget = parseProjectGuestProgressTargetCookie(
      request.cookies.get(PROJECT_GUEST_PROGRESS_TARGET_COOKIE)?.value
    );
    const result = await permanentlyDeleteProject({
      projectId,
      ownerUserId: account.userId,
      confirmedProjectName: confirmation.projectName
    });

    const response = deletionJson({
      ok: true,
      deletedProjectId: result.deletedProjectId,
      deletedStorageObjectCount: result.deletedStorageObjectCount,
      message: "프로젝트와 모든 데이터가 영구 삭제되었습니다."
    });
    if (clearGuestInvite) {
      clearProjectGuestInviteCookie(response);
    }
    if (progressTarget?.projectId === projectId) {
      clearProjectGuestProgressTargetCookie(response);
    }
    return response;
  } catch (error) {
    if (error instanceof ProjectPermanentDeletionError) {
      return deletionJson({ error: error.message, code: error.code }, error.status);
    }
    const unavailable = error instanceof ProjectAccessUnavailableError
      || error instanceof ShotclAccountUnavailableError;
    return deletionJson(
      {
        error: unavailable
          ? "프로젝트 영구 삭제 서비스를 사용할 수 없습니다."
          : "프로젝트 영구 삭제를 완료하지 못했습니다.",
        code: unavailable ? "PROJECT_DELETE_UNAVAILABLE" : "PROJECT_DELETE_FAILED"
      },
      unavailable ? 503 : 500
    );
  }
}

function deletionJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function isSameOriginJsonRequest(request: NextRequest) {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const allowedOrigins = new Set([request.nextUrl.origin]);
    const forwardedHost = request.headers.get("x-forwarded-host")
      ?.split(",", 1)[0]
      ?.trim();
    const host = forwardedHost || request.headers.get("host")?.trim();
    const forwardedProtocol = request.headers.get("x-forwarded-proto")
      ?.split(",", 1)[0]
      ?.trim();
    const protocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "");
    if (host && (protocol === "https" || protocol === "http")) {
      allowedOrigins.add(new URL(`${protocol}://${host}`).origin);
    }
    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

async function requestGuestInviteMatchesProject(
  request: NextRequest,
  projectId: string
) {
  const token = getProjectGuestInviteToken(request);
  if (!token) return false;
  try {
    return (await inspectProjectStaffInvite(token))?.projectId === projectId;
  } catch {
    // Cookie cleanup is best effort and must not broaden or block deletion.
    return false;
  }
}

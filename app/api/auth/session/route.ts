import { NextRequest, NextResponse } from "next/server";
import {
  clearShotclAccountSessionCookie,
  createShotclAccountSession,
  deleteShotclAccountSession,
  getShotclBearerToken,
  linkShotclAccountProjectMembership,
  resolveShotclAuthenticatedAccount,
  SHOTCL_ACCOUNT_COOKIE,
  setShotclAccountSessionCookie
} from "@/lib/projectAccess/accountServer";
import {
  clearProjectGuestInviteCookie,
  clearProjectGuestModeCookie,
  clearProjectGuestProgressTargetCookie,
  getLegacyAccessGrant,
  getProjectGuestInviteToken
} from "@/lib/projectAccess/server";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";
import { inspectProjectStaffInvite } from "@/lib/projectStaffInvites.server";
import { getSafeInternalPath } from "@/lib/auth/client";
import { buildProgressRoundHref, buildProjectNavigationHref } from "@/lib/projectNavigation";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;

export async function GET(request: NextRequest) {
  try {
    const account = await resolveShotclAuthenticatedAccount(request);
    const editorAllowed = account?.isEditor ?? false;
    return sessionJson({
      loggedIn: Boolean(account),
      email: account?.email ?? null,
      editorEligible: editorAllowed,
      editorAllowed
    });
  } catch (error) {
    console.error("[shotcl-auth-session:get]", safeErrorMessage(error));
    return sessionJson({
      loggedIn: false,
      email: null,
      editorEligible: false,
      editorAllowed: false
    }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request, true)) {
      return sessionJson({ error: "로그인 요청을 확인할 수 없습니다." }, 403);
    }
    const body = await request.json().catch(() => null) as {
      action?: unknown;
      projectId?: unknown;
      returnTo?: unknown;
    } | null;
    if (body?.action !== "sync") {
      return sessionJson({ error: "로그인 동기화 요청이 올바르지 않습니다." }, 400);
    }
    const bearerToken = getShotclBearerToken(request);
    if (!bearerToken) return sessionJson({ error: "Google 로그인 정보가 필요합니다." }, 401);

    const created = await createShotclAccountSession(
      bearerToken,
      request.cookies.get(SHOTCL_ACCOUNT_COOKIE)?.value ?? null
    );
    if (!created) {
      const response = sessionJson({ error: "Google 계정으로 로그인해 주세요." }, 403);
      // 계정 전환 중 email-only/invalid session이 거절되더라도 이전 사용자의
      // opaque app session cookie가 브라우저에 남아 권한 원본이 되지 않게 합니다.
      clearShotclAccountSessionCookie(response);
      return response;
    }

    let destination: string | null = null;
    let joinedProjectId: string | null = null;
    const requestedProjectId = typeof body?.projectId === "string"
      ? normalizeProjectId(body.projectId)
      : "";
    const requestedProgressReturnTo = resolveProgressReturnTo(
      body?.returnTo,
      requestedProjectId
    );
    const legacyGrant = isValidDatabaseProjectId(requestedProjectId)
      ? await getLegacyAccessGrant(request, requestedProjectId)
      : null;
    const guestInviteToken = getProjectGuestInviteToken(request);
    if (legacyGrant) {
      // 프로젝트 안에서 OAuth를 시작한 경우에는 현재 URL에서 온 한 프로젝트의
      // passcode grant를 먼저 연결합니다. 과거 guest cookie가 남아 있어도 현재
      // 사용자의 명시적 흐름을 가로채지 않습니다.
      await linkShotclAccountProjectMembership(created.account.userId, requestedProjectId);
      joinedProjectId = requestedProjectId;
    } else {
      const guestInvite = guestInviteToken
        ? await inspectProjectStaffInvite(guestInviteToken)
        : null;
      if (guestInvite) {
        await linkShotclAccountProjectMembership(created.account.userId, guestInvite.projectId);
        joinedProjectId = guestInvite.projectId;
        destination = requestedProjectId === guestInvite.projectId && requestedProgressReturnTo
          ? requestedProgressReturnTo
          : buildProjectNavigationHref(guestInvite.projectId, "progress");
      }
    }

    const response = sessionJson({
      loggedIn: true,
      email: created.account.email,
      editorEligible: created.account.isEditor,
      editorAllowed: created.account.isEditor,
      joinedProjectId,
      destination
    });
    setShotclAccountSessionCookie(response, created.token);
    if (guestInviteToken) {
      clearProjectGuestInviteCookie(response);
    } else {
      // Also clear forged/stale non-authoritative hints when no invite cookie
      // exists, without emitting duplicate Set-Cookie headers.
      clearProjectGuestModeCookie(response);
      clearProjectGuestProgressTargetCookie(response);
    }
    return response;
  } catch (error) {
    console.error("[shotcl-auth-session:post]", safeErrorMessage(error));
    const response = sessionJson({ error: "로그인 세션을 만들지 못했습니다." }, 500);
    // 계정 전환 중 새 session 회전·membership 연결이 실패하면 이전 사용자의
    // app cookie가 권한 원본으로 남지 않도록 브라우저 capability를 fail-closed 합니다.
    clearShotclAccountSessionCookie(response);
    return response;
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request, false)) {
      return sessionJson({ error: "로그아웃 요청을 확인할 수 없습니다." }, 403);
    }
    await deleteShotclAccountSession(request);
    const response = sessionJson({
      loggedIn: false,
      email: null,
      editorEligible: false,
      editorAllowed: false
    });
    clearShotclAccountSessionCookie(response);
    clearProjectGuestModeCookie(response);
    clearProjectGuestProgressTargetCookie(response);
    return response;
  } catch (error) {
    console.error("[shotcl-auth-session:delete]", safeErrorMessage(error));
    const response = sessionJson({ error: "로그아웃하지 못했습니다." }, 500);
    // DB revoke 실패가 브라우저의 raw capability까지 보존하게 두지 않습니다.
    clearShotclAccountSessionCookie(response);
    clearProjectGuestModeCookie(response);
    clearProjectGuestProgressTargetCookie(response);
    return response;
  }
}

function sessionJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function isSameOriginRequest(request: NextRequest, requireJson: boolean) {
  if (requireJson) {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const allowedOrigins = new Set([request.nextUrl.origin]);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    const host = forwardedHost || request.headers.get("host")?.trim();
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const protocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "");
    if (host && (protocol === "https" || protocol === "http")) {
      allowedOrigins.add(new URL(`${protocol}://${host}`).origin);
    }
    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function resolveProgressReturnTo(value: unknown, projectId: string) {
  if (!isValidDatabaseProjectId(projectId) || typeof value !== "string") return null;
  const safePath = getSafeInternalPath(value, "/");
  const parsed = new URL(safePath, "https://shotcl.local");
  if (parsed.pathname !== `/projects/${projectId}`) return null;
  const requestedDailyPlanId = parsed.searchParams.get("dailyPlanId");
  const dailyPlanId = requestedDailyPlanId ? normalizeProjectId(requestedDailyPlanId) : "";
  if (isValidDatabaseProjectId(dailyPlanId)) {
    return buildProgressRoundHref(projectId, dailyPlanId);
  }
  return parsed.searchParams.get("view") === "progress"
    ? buildProjectNavigationHref(projectId, "progress")
    : null;
}

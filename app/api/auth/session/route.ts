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
  getProjectGuestInviteToken
} from "@/lib/projectAccess/server";
import { inspectProjectStaffInvite } from "@/lib/projectStaffInvites.server";
import { buildProjectNavigationHref } from "@/lib/projectNavigation";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;

export async function GET(request: NextRequest) {
  try {
    const account = await resolveShotclAuthenticatedAccount(request);
    return sessionJson({
      loggedIn: Boolean(account),
      email: account?.email ?? null,
      editorEligible: account?.isEditor ?? false
    });
  } catch (error) {
    console.error("[shotcl-auth-session:get]", safeErrorMessage(error));
    return sessionJson({ loggedIn: false, email: null, editorEligible: false }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request, true)) {
      return sessionJson({ error: "로그인 요청을 확인할 수 없습니다." }, 403);
    }
    const body = await request.json().catch(() => null) as { action?: unknown } | null;
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
    const guestInviteToken = getProjectGuestInviteToken(request);
    const guestInvite = guestInviteToken
      ? await inspectProjectStaffInvite(guestInviteToken)
      : null;
    if (guestInvite) {
      await linkShotclAccountProjectMembership(created.account.userId, guestInvite.projectId);
      joinedProjectId = guestInvite.projectId;
      destination = buildProjectNavigationHref(guestInvite.projectId, "progress");
    }

    const response = sessionJson({
      loggedIn: true,
      email: created.account.email,
      editorEligible: created.account.isEditor,
      joinedProjectId,
      destination
    });
    setShotclAccountSessionCookie(response, created.token);
    if (guestInviteToken) clearProjectGuestInviteCookie(response);
    return response;
  } catch (error) {
    console.error("[shotcl-auth-session:post]", safeErrorMessage(error));
    return sessionJson({ error: "로그인 세션을 만들지 못했습니다." }, 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request, false)) {
      return sessionJson({ error: "로그아웃 요청을 확인할 수 없습니다." }, 403);
    }
    await deleteShotclAccountSession(request);
    const response = sessionJson({ loggedIn: false, email: null, editorEligible: false });
    clearShotclAccountSessionCookie(response);
    return response;
  } catch (error) {
    console.error("[shotcl-auth-session:delete]", safeErrorMessage(error));
    const response = sessionJson({ error: "로그아웃하지 못했습니다." }, 500);
    // DB revoke 실패가 브라우저의 raw capability까지 보존하게 두지 않습니다.
    clearShotclAccountSessionCookie(response);
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

import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { SHOTCL_ACCOUNT_COOKIE } from "@/lib/projectAccess/accountServer";
import {
  clearProjectGuestProgressTargetCookie,
  getProjectRequestAccessFromTokens,
  PROJECT_SESSION_COOKIE,
  setProjectGuestInviteCookie,
  setProjectGuestProgressTargetCookie
} from "@/lib/projectAccess/server";
import {
  inspectProjectStaffInvite,
  ProjectStaffInviteMigrationRequiredError,
  ProjectStaffInviteUnavailableError
} from "@/lib/projectStaffInvites.server";
import {
  buildProgressRoundHref,
  buildProjectNavigationHref
} from "@/lib/projectNavigation";
import { resolveInviteProgressTarget } from "@/lib/progress/resolveInviteProgressTarget.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ token: string }> };

/**
 * Logged-out Kakao guests redeem on the first document request. An existing
 * account session keeps the mutation-safe JSON POST flow: GET never links an
 * account membership, preventing link previews or cross-site navigation from
 * changing account state.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const invite = await inspectProjectStaffInvite(token);
    if (!invite) {
      return inviteHtml(
        "초대 링크를 열 수 없습니다",
        "초대 링크가 유효하지 않거나 비활성화되었습니다.",
        404
      );
    }

    if (request.cookies.get(SHOTCL_ACCOUNT_COOKIE)?.value) {
      return accountRedemptionBridge(invite.projectName);
    }

    const legacySessionToken = request.cookies.get(PROJECT_SESSION_COOKIE)?.value ?? null;
    const [target, legacyAccess] = await Promise.all([
      resolveInviteProgressTarget(invite.projectId),
      legacySessionToken
        ? getProjectRequestAccessFromTokens(invite.projectId, { legacySessionToken })
        : Promise.resolve(null)
    ]);
    const destination = target.dailyPlanId
      ? buildProgressRoundHref(invite.projectId, target.dailyPlanId)
      : buildProjectNavigationHref(invite.projectId, "progress");
    const response = NextResponse.redirect(new URL(destination, request.url), 307);
    applyPrivateInviteHeaders(response);

    // A valid legacy grant remains authoritative. Otherwise this invite's raw
    // token replaces any previous guest capability in an HttpOnly cookie.
    if (!legacyAccess) {
      setProjectGuestInviteCookie(response, token);
      if (target.dailyPlanId) {
        setProjectGuestProgressTargetCookie(response, invite.projectId, target.dailyPlanId);
      } else {
        clearProjectGuestProgressTargetCookie(response);
      }
    }
    return response;
  } catch (error) {
    if (
      error instanceof ProjectStaffInviteMigrationRequiredError
      || error instanceof ProjectStaffInviteUnavailableError
    ) {
      return inviteHtml(
        "초대 기능을 준비 중입니다",
        "잠시 후 다시 시도해주세요.",
        503
      );
    }
    console.error("[project-staff-invite-landing]", safeErrorMessage(error));
    return inviteHtml(
      "진행도를 열 수 없습니다",
      "잠시 후 다시 시도해주세요.",
      503
    );
  }
}

function accountRedemptionBridge(projectName: string) {
  const scriptNonce = randomBytes(16).toString("base64");
  const safeProjectName = escapeHtml(projectName);
  const body = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>진행도 연결 · ShotCL</title>
<style>${MINIMAL_STYLES}</style>
</head>
<body><main><p class="brand">ShotCL</p><h1>${safeProjectName}</h1><p id="status">진행도를 연결하고 있습니다.</p><a id="retry" href="" hidden>다시 시도</a></main>
<script nonce="${scriptNonce}">
(async()=>{try{const segment=location.pathname.split('/').filter(Boolean).pop()||'';const response=await fetch('/api/project-invites/'+encodeURIComponent(segment),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'join'})});const payload=await response.json().catch(()=>({}));if(!response.ok||payload.ok!==true||typeof payload.destination!=='string'||!payload.destination.startsWith('/')||payload.destination.startsWith('//'))throw new Error();location.replace(payload.destination)}catch{document.getElementById('status').textContent='진행도를 연결하지 못했습니다.';document.getElementById('retry').hidden=false}})();
</script></body></html>`;
  return htmlResponse(body, 200, scriptNonce);
}

function inviteHtml(title: string, message: string, status: number) {
  const body = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(title)} · ShotCL</title><style>${MINIMAL_STYLES}</style></head>
<body><main><p class="brand">ShotCL</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="/">Main으로</a></main></body></html>`;
  return htmlResponse(body, status, null);
}

function htmlResponse(body: string, status: number, scriptNonce: string | null) {
  const response = new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
  applyPrivateInviteHeaders(response);
  response.headers.set(
    "Content-Security-Policy",
    scriptNonce
      ? `default-src 'none'; connect-src 'self'; script-src 'nonce-${scriptNonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
      : "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  return response;
}

function applyPrivateInviteHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

const MINIMAL_STYLES = "*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#070807;color:#f5f5f1;font-family:system-ui,sans-serif;padding:20px}main{width:min(100%,420px);border:1px solid #3b3d38;background:#161715;padding:28px;text-align:center}h1{font-size:20px;line-height:1.4;margin:8px 0}.brand{color:#d8ff50;font-weight:900;font-size:12px;letter-spacing:.08em}p{color:#b8bbb2;font-size:14px;line-height:1.6}a{display:inline-flex;min-height:44px;align-items:center;justify-content:center;margin-top:16px;padding:0 18px;border:1px solid #62665b;color:#f5f5f1;text-decoration:none;font-weight:700}";

import { NextRequest, NextResponse } from "next/server";
import {
  getKeyStaffUpgradeDecision,
  isValidPasscode
} from "@/lib/projectAccess/core";
import {
  clearJoinFailures,
  getAccessGrant,
  getKeyStaffUpgradeAttemptKey,
  isJoinRateLimited,
  ProjectAccessUnavailableError,
  recordJoinFailure,
  requireProjectAccessDb,
  verifyPasscode
} from "@/lib/projectAccess/server";
import {
  resolveShotclAuthenticatedAccount,
  ShotclAccountUnavailableError
} from "@/lib/projectAccess/accountServer";
import { isValidDatabaseProjectId, normalizeProjectId } from "@/lib/projectId";

type RouteContext = { params: Promise<{ projectId: string }> };

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { projectId: routeProjectId } = await context.params;
    const projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) return NextResponse.json({ shared: false, role: null }, { status: 400, headers: NO_STORE_HEADERS });
    const grant = await getAccessGrant(request, projectId);
    if (!grant) return NextResponse.json({ shared: false, role: null }, { status: 401, headers: NO_STORE_HEADERS });
    return NextResponse.json({
      shared: true,
      projectId: grant.projectId,
      role: grant.role,
      projectName: grant.projectName,
      joinedAt: grant.joinedAt
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { shared: false, role: null },
      { status: error instanceof ProjectAccessUnavailableError ? 503 : 500, headers: NO_STORE_HEADERS }
    );
  }
}

/** 현재 브라우저의 현재 프로젝트 Staff grant만 Key staff로 승격합니다. */
export async function POST(request: NextRequest, context: RouteContext) {
  let projectId = "";
  try {
    const { projectId: routeProjectId } = await context.params;
    projectId = normalizeProjectId(routeProjectId);
    if (!isValidDatabaseProjectId(projectId)) {
      return upgradeJson({ ok: false, error: "프로젝트를 확인할 수 없습니다.", code: "PROJECT_ACCESS_INVALID" }, 400);
    }
    if (!isSameOriginJsonRequest(request)) {
      return upgradeJson({ ok: false, error: "권한 변경 요청을 확인할 수 없습니다.", code: "PROJECT_ACCESS_REQUEST_FORBIDDEN" }, 403);
    }

    const account = await resolveShotclAuthenticatedAccount(request);
    if (!account) {
      return upgradeJson({ ok: false, error: "Google 계정으로 로그인해야 합니다.", code: "GOOGLE_ACCOUNT_REQUIRED" }, 401);
    }
    if (!account.isEditor) {
      return upgradeJson({ ok: false, error: "이 계정에는 수정 권한이 없습니다.", code: "EDITOR_ACCOUNT_REQUIRED" }, 403);
    }

    const body = await readUpgradeBody(request);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!isValidPasscode(password)) {
      return upgradeJson({ ok: false, error: "4자리 Key staff 비밀번호를 입력하세요.", code: "PROJECT_ACCESS_PASSWORD_INVALID" }, 400);
    }

    const grant = await getAccessGrant(request, projectId);
    const initialDecision = getKeyStaffUpgradeDecision(grant?.role ?? null, false);
    if (initialDecision === "forbidden") {
      return upgradeJson({ ok: false, error: "현재 프로젝트의 Staff 권한을 확인할 수 없습니다.", code: "PROJECT_ACCESS_FORBIDDEN" }, 403);
    }
    if (initialDecision === "already-key-staff") {
      return upgradeJson({ ok: true, role: "admin", status: "already_key_staff" });
    }

    const attemptKey = getKeyStaffUpgradeAttemptKey(request, projectId);
    if (await isJoinRateLimited(attemptKey)) {
      return upgradeJson(
        { ok: false, error: "잠시 후 다시 시도해주세요.", code: "PROJECT_ACCESS_RATE_LIMITED" },
        429,
        { "Retry-After": "900" }
      );
    }

    const supabase = requireProjectAccessDb();
    const { data: credentials, error: credentialError } = await supabase
      .from("project_access_credentials")
      .select("admin_password_hash,admin_password_salt")
      .eq("project_id", projectId)
      .maybeSingle();
    if (credentialError) throw credentialError;
    if (!credentials) {
      console.error("[project-access-upgrade] Key staff credential row is missing", { projectId });
      return upgradeJson({ ok: false, error: "권한을 변경하지 못했습니다.", code: "PROJECT_ACCESS_UNAVAILABLE" }, 503);
    }

    const passwordMatches = await verifyPasscode(
      password,
      credentials.admin_password_hash,
      credentials.admin_password_salt
    );
    const verifiedDecision = getKeyStaffUpgradeDecision(grant?.role ?? null, passwordMatches);
    if (verifiedDecision !== "upgrade") {
      await recordJoinFailure(attemptKey);
      return upgradeJson({ ok: false, error: "비밀번호가 올바르지 않습니다.", code: "PROJECT_ACCESS_PASSWORD_MISMATCH" }, 401);
    }

    const { error: membershipError } = await supabase.from("project_members").upsert({
      project_id: projectId,
      user_id: account.userId,
      role: "admin"
    }, { onConflict: "project_id,user_id" });
    if (membershipError) throw membershipError;
    try {
      await clearJoinFailures(attemptKey);
    } catch (cleanupError) {
      // role update는 이미 확정됐으므로 rate-limit 정리 실패로 성공을 뒤집지 않습니다.
      console.error("[project-access-upgrade] Unable to clear resolved failures", {
        projectId,
        error: cleanupError instanceof Error ? cleanupError.message : "Unknown error"
      });
    }
    return upgradeJson({
      ok: true,
      role: "admin",
      status: "upgraded"
    });
  } catch (error) {
    if (!(error instanceof ProjectAccessUnavailableError) && !(error instanceof ShotclAccountUnavailableError)) {
      console.error("[project-access-upgrade] Unable to upgrade current grant", {
        projectId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
    return upgradeJson(
      { ok: false, error: "권한을 변경하지 못했습니다.", code: "PROJECT_ACCESS_UNAVAILABLE" },
      error instanceof ProjectAccessUnavailableError || error instanceof ShotclAccountUnavailableError ? 503 : 500
    );
  }
}

function upgradeJson(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {}
) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers }
  });
}

async function readUpgradeBody(request: NextRequest) {
  try {
    return await request.json() as { password?: unknown };
  } catch {
    return null;
  }
}

function isSameOriginJsonRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return false;
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

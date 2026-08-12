import "server-only";

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { normalizeProjectId } from "@/lib/projectId";
import type { ProjectAccessGrant, SharedProjectRole } from "@/lib/projectAccess/core";
import { resolveEffectiveProjectRole } from "@/lib/projectAccess/accountCore";
import {
  getShotclBearerToken,
  resolveShotclAuthenticatedAccountFromCredentials,
  SHOTCL_ACCOUNT_COOKIE,
  type ShotclAuthenticatedAccount
} from "@/lib/projectAccess/accountServer";
import { isGuestProjectApiRequestAllowed } from "@/lib/projectAccess/guestApiAccess";

const scrypt = promisify(scryptCallback);
export const PROJECT_SESSION_COOKIE = "shotcl_project_session";
export const PROJECT_GUEST_INVITE_COOKIE = "shotcl_guest_invite";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const STAFF_INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class ProjectAccessUnavailableError extends Error {}

export type ProjectRequestAccessMode = "member" | "guest" | "legacy";
export type ProjectRequestProjectSnapshot = {
  id: string;
  name: string;
  shoot_date: string | null;
  description: string | null;
  created_at: string;
  share_enabled: boolean;
};
export type ProjectRequestAccess = {
  grant: ProjectAccessGrant;
  mode: ProjectRequestAccessMode;
  editorEligible: boolean;
  accountUserId?: string;
  project?: ProjectRequestProjectSnapshot;
};
export type ProjectRequestAccessTokens = {
  accountSessionToken?: string | null;
  bearerToken?: string | null;
  guestInviteToken?: string | null;
  legacySessionToken?: string | null;
};
export type ProjectRequestAccountAccess = {
  account: ShotclAuthenticatedAccount | null;
  access: ProjectRequestAccess | null;
};

export function requireProjectAccessDb() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new ProjectAccessUnavailableError("프로젝트 공유 기능을 사용하려면 Supabase 서버 환경변수와 migration 적용이 필요합니다.");
  }
  return supabase;
}

export async function hashPasscode(passcode: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(passcode, salt, 64)) as Buffer;
  return { hash: derived.toString("base64"), salt: salt.toString("base64") };
}

export async function verifyPasscode(passcode: string, encodedHash: string, encodedSalt: string) {
  try {
    const expected = Buffer.from(encodedHash, "base64");
    const actual = (await scrypt(passcode, Buffer.from(encodedSalt, "base64"), expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** 프로젝트 존재 여부에 따른 검증 시간 차이를 줄이기 위한 동일 비용 dummy 작업입니다. */
export async function burnPasscodeVerification(passcode: string) {
  await Promise.all([hashPasscode(passcode), hashPasscode(passcode)]);
}

/** 브라우저 원본 session token은 DB에 저장하지 않고 SHA-256 hash만 사용합니다. */
export function hashProjectSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * local UI preference namespace에만 쓰는 비인증용 식별자입니다.
 * DB 조회에 사용하는 token hash와 domain을 분리하며 원본 cookie는 노출하지 않습니다.
 */
export function getAccessPreferenceScope(token: string | null) {
  if (!token) return "";
  return createHash("sha256").update(`shotcl-ui-preferences:${token}`).digest("hex");
}

/** Member preference keys stay compatible with the former browser `auth:<uid>` namespace. */
export function getAccountAccessPreferenceScope(userId: string | null) {
  const normalizedUserId = userId?.trim().toLowerCase() ?? "";
  return normalizedUserId ? `auth:${normalizedUserId}` : "";
}

export function getJoinAttemptKey(request: NextRequest, normalizedProjectName: string) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(`${forwardedFor}:${normalizedProjectName}`).digest("hex");
}

/** 기존 Join rate-limit 저장소를 프로젝트별 Key staff 승격에도 분리해 재사용합니다. */
export function getKeyStaffUpgradeAttemptKey(request: NextRequest, projectId: string) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const databaseProjectId = normalizeProjectId(projectId);
  return createHash("sha256")
    .update(`${forwardedFor}:key-staff-upgrade:${databaseProjectId}`)
    .digest("hex");
}

export async function isJoinRateLimited(attemptKeyHash: string) {
  const supabase = requireProjectAccessDb();
  const { data, error } = await supabase.from("project_access_attempts").select("blocked_until").eq("attempt_key_hash", attemptKeyHash).maybeSingle();
  if (error) throw error;
  return Boolean(data?.blocked_until && new Date(data.blocked_until).getTime() > Date.now());
}

export async function recordJoinFailure(attemptKeyHash: string) {
  const supabase = requireProjectAccessDb();
  const { data, error } = await supabase.from("project_access_attempts").select("attempt_count,window_started_at").eq("attempt_key_hash", attemptKeyHash).maybeSingle();
  if (error) throw error;
  const now = Date.now();
  const windowExpired = !data || now - new Date(data.window_started_at).getTime() > 15 * 60 * 1000;
  const attemptCount = windowExpired ? 1 : data.attempt_count + 1;
  const { error: writeError } = await supabase.from("project_access_attempts").upsert({
    attempt_key_hash: attemptKeyHash,
    attempt_count: attemptCount,
    window_started_at: windowExpired ? new Date(now).toISOString() : data.window_started_at,
    blocked_until: attemptCount >= 8 ? new Date(now + 15 * 60 * 1000).toISOString() : null
  });
  if (writeError) throw writeError;
}

export async function clearJoinFailures(attemptKeyHash: string) {
  const supabase = requireProjectAccessDb();
  const { error } = await supabase.from("project_access_attempts").delete().eq("attempt_key_hash", attemptKeyHash);
  if (error) throw error;
}

export function getSessionToken(request: NextRequest) {
  return request.cookies.get(PROJECT_SESSION_COOKIE)?.value ?? null;
}

export function createProjectSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function setProjectSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(PROJECT_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

/** Staff 초대 원본 token은 JS에 노출하지 않고 활성 invite 확인에만 씁니다. */
export function setProjectGuestInviteCookie(response: NextResponse, rawInviteToken: string) {
  if (!STAFF_INVITE_TOKEN_PATTERN.test(rawInviteToken)) {
    throw new Error("초대 token 형식이 올바르지 않습니다.");
  }
  response.cookies.set(PROJECT_GUEST_INVITE_COOKIE, rawInviteToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export function clearProjectGuestInviteCookie(response: NextResponse) {
  response.cookies.set(PROJECT_GUEST_INVITE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export function getProjectGuestInviteToken(request: NextRequest) {
  const token = request.cookies.get(PROJECT_GUEST_INVITE_COOKIE)?.value ?? "";
  return STAFF_INVITE_TOKEN_PATTERN.test(token) ? token : null;
}

export function ensureSessionToken(request: NextRequest, response: NextResponse) {
  const existing = getSessionToken(request);
  const token = existing || createProjectSessionToken();
  setProjectSessionCookie(response, token);
  return token;
}

export async function saveAccessGrant(token: string, projectId: string, role: SharedProjectRole) {
  const supabase = requireProjectAccessDb();
  const databaseProjectId = normalizeProjectId(projectId);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const { error } = await supabase.from("project_access_sessions").upsert(
    {
      browser_token_hash: hashProjectSessionToken(token),
      project_id: databaseProjectId,
      role,
      joined_at: new Date().toISOString(),
      expires_at: expiresAt
    },
    { onConflict: "browser_token_hash,project_id" }
  );
  if (error) throw error;
}

export type AccessGrantUpgradeResult = "upgraded" | "already-admin" | "missing";

/**
 * 현재 브라우저의 현재 프로젝트 Staff grant 한 행만 Key staff로 올립니다.
 * upsert를 쓰지 않아 만료·누락된 membership을 새로 만들거나 다른 프로젝트를 변경하지 않습니다.
 */
export async function upgradeAccessGrantToAdmin(
  token: string,
  projectId: string
): Promise<AccessGrantUpgradeResult> {
  const supabase = requireProjectAccessDb();
  const databaseProjectId = normalizeProjectId(projectId);
  const now = new Date().toISOString();
  const tokenHash = hashProjectSessionToken(token);
  const { data, error } = await supabase
    .from("project_access_sessions")
    .update({ role: "admin" })
    .eq("browser_token_hash", tokenHash)
    .eq("project_id", databaseProjectId)
    .eq("role", "progress")
    .gt("expires_at", now)
    .select("role")
    .maybeSingle();
  if (error) throw error;
  if (data?.role === "admin") return "upgraded";

  // 동시에 제출된 첫 요청이 이미 승격했다면 두 번째 요청도 안전한 no-op 성공입니다.
  const currentGrant = await getLegacyAccessGrantByToken(token, databaseProjectId);
  return currentGrant?.role === "admin" ? "already-admin" : "missing";
}

export async function getAccessGrant(request: NextRequest, projectId: string): Promise<ProjectAccessGrant | null> {
  return (await getProjectRequestAccess(request, projectId))?.grant ?? null;
}

/**
 * OAuth 직후 account access가 legacy grant를 가리는 경우에도, 요청한 한 프로젝트의
 * 기존 passcode grant만 명시적으로 재검증해 account membership 연결에 사용합니다.
 */
export async function getLegacyAccessGrant(request: NextRequest, projectId: string) {
  return getLegacyAccessGrantByToken(getSessionToken(request), projectId);
}

export async function getProjectRequestAccess(request: NextRequest, projectId: string) {
  return (await getProjectRequestAccountAccess(request, projectId)).access;
}

/** Resolve the request account and its project grant from one account-session lookup. */
export async function getProjectRequestAccountAccess(
  request: NextRequest,
  projectId: string
): Promise<ProjectRequestAccountAccess> {
  const tokens = {
    accountSessionToken: request.cookies.get(SHOTCL_ACCOUNT_COOKIE)?.value ?? null,
    bearerToken: getShotclBearerToken(request),
    guestInviteToken: getProjectGuestInviteToken(request),
    legacySessionToken: getSessionToken(request)
  } satisfies ProjectRequestAccessTokens;
  const account = await resolveShotclAuthenticatedAccountFromCredentials({
    accountSessionToken: tokens.accountSessionToken,
    bearerToken: tokens.bearerToken
  });
  let access = await resolveProjectRequestAccess(
    normalizeProjectId(projectId),
    tokens,
    account
  );
  if (access?.mode === "guest" && !isGuestProjectApiRequestAllowed({
    method: request.method,
    pathname: request.nextUrl.pathname,
    projectId,
    searchParams: request.nextUrl.searchParams
  })) {
    access = null;
  }
  return { account, access };
}

export async function getProjectRequestAccessMode(request: NextRequest, projectId: string) {
  return (await getProjectRequestAccess(request, projectId))?.mode ?? null;
}

async function getLegacyAccessGrantByToken(token: string | null, projectId: string): Promise<ProjectAccessGrant | null> {
  if (!token) return null;
  const supabase = requireProjectAccessDb();
  const databaseProjectId = normalizeProjectId(projectId);
  const { data, error } = await supabase
    .from("project_access_sessions")
    .select("project_id,role,joined_at,expires_at,projects!inner(name,share_enabled)")
    .eq("browser_token_hash", hashProjectSessionToken(token))
    .eq("project_id", databaseProjectId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data || (data.role !== "admin" && data.role !== "progress")) return null;
  const projectRelation = data.projects as unknown as {
    name: string;
    share_enabled: boolean;
  } | Array<{
    name: string;
    share_enabled: boolean;
  }>;
  const projectName = Array.isArray(projectRelation) ? projectRelation[0]?.name : projectRelation?.name;
  const shareEnabled = Array.isArray(projectRelation)
    ? projectRelation[0]?.share_enabled
    : projectRelation?.share_enabled;
  if (!shareEnabled) return null;
  return {
    projectId: data.project_id,
    projectName: projectName ?? "프로젝트",
    role: data.role,
    joinedAt: data.joined_at
  };
}

export async function listAccessGrants(request: NextRequest) {
  const token = getSessionToken(request);
  if (!token) return [];
  const supabase = requireProjectAccessDb();
  const { data, error } = await supabase
    .from("project_access_sessions")
    .select("project_id,role,joined_at,expires_at,projects!inner(id,name,created_at,share_enabled)")
    .eq("browser_token_hash", hashProjectSessionToken(token))
    .gt("expires_at", new Date().toISOString())
    .eq("projects.share_enabled", true)
    .order("joined_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, role: "progress" as SharedProjectRole }));
}

/**
 * 공유 프로젝트는 passcode 세션을, 레거시 프로젝트는 Supabase Auth 소유권/멤버십을 확인합니다.
 * service-role 클라이언트를 쓰는 API가 `share_enabled=false`만으로 권한을 우회하지 않도록
 * 레거시 요청에도 실제 사용자 JWT를 요구합니다.
 */
export async function canAdministerProject(request: NextRequest, projectId: string) {
  return (await getProjectRequestRole(request, projectId)) === "admin";
}

/** Staff가 허용된 제한 mutation을 수행할 때도 allowlisted account인지 확인합니다. */
export async function canMutateProjectAsStaff(request: NextRequest, projectId: string) {
  const access = await getProjectRequestAccess(request, projectId);
  return access?.mode === "member" && access.editorEligible;
}

/** passcode 공유 세션과 레거시 Supabase Auth를 하나의 서버 권한 판정으로 합칩니다. */
export async function getProjectRequestRole(
  request: NextRequest,
  projectId: string
): Promise<SharedProjectRole | null> {
  return (await getProjectRequestAccess(request, projectId))?.grant.role ?? null;
}

export async function getProjectRequestAccessFromTokens(
  projectId: string,
  tokens: ProjectRequestAccessTokens
): Promise<ProjectRequestAccess | null> {
  const databaseProjectId = normalizeProjectId(projectId);
  const account = await resolveShotclAuthenticatedAccountFromCredentials({
    accountSessionToken: tokens.accountSessionToken,
    bearerToken: tokens.bearerToken
  });
  return resolveProjectRequestAccess(databaseProjectId, tokens, account);
}

async function resolveProjectRequestAccess(
  databaseProjectId: string,
  tokens: ProjectRequestAccessTokens,
  account: ShotclAuthenticatedAccount | null
): Promise<ProjectRequestAccess | null> {
  const supabase = requireProjectAccessDb();

  if (account) {
    const [projectResult, membershipResult] = await Promise.all([
      supabase
        .from("projects")
        .select("id,name,shoot_date,description,created_at,share_enabled,created_by")
        .eq("id", databaseProjectId)
        .maybeSingle(),
      supabase
        .from("project_members")
        .select("role,created_at")
        .eq("project_id", databaseProjectId)
        .eq("user_id", account.userId)
        .maybeSingle()
    ]);
    if (projectResult.error) throw projectResult.error;
    if (membershipResult.error) {
      if (membershipResult.error.code !== "42P01" && membershipResult.error.code !== "PGRST205") {
        throw membershipResult.error;
      }
    }
    const project = projectResult.data;
    const membership = membershipResult.data;
    const isOwner = String(project?.created_by ?? "") === account.userId;
    const role = resolveEffectiveProjectRole({
      accountAuthenticated: true,
      accountEligible: account.isEditor,
      isOwner,
      membershipRole: membership?.role,
      guestInviteActive: false,
      legacyGrantRole: null
    });
    if (project && role) {
      return {
        mode: "member",
        editorEligible: account.isEditor,
        accountUserId: account.userId,
        project: {
          id: String(project.id),
          name: String(project.name || "프로젝트"),
          shoot_date: typeof project.shoot_date === "string" ? project.shoot_date : null,
          description: typeof project.description === "string" ? project.description : null,
          created_at: String(project.created_at || ""),
          share_enabled: project.share_enabled === true
        },
        grant: {
          projectId: String(project.id),
          projectName: String(project.name || "프로젝트"),
          role,
          joinedAt: String(membership?.created_at || project.created_at || "")
        }
      };
    }
  }

  const legacyGrant = account
    ? null
    : await getLegacyAccessGrantByToken(tokens.legacySessionToken ?? null, databaseProjectId);
  const rawInviteToken = tokens.guestInviteToken && STAFF_INVITE_TOKEN_PATTERN.test(tokens.guestInviteToken)
    ? tokens.guestInviteToken
    : null;
  if (rawInviteToken) {
    // projectStaffInvites.server가 이 module을 참조하므로 순환 초기화를 피하기 위해 늦게 읽습니다.
    const { inspectProjectStaffInvite } = await import("@/lib/projectStaffInvites.server");
    const invite = await inspectProjectStaffInvite(rawInviteToken);
    const guestRole = resolveEffectiveProjectRole({
      accountAuthenticated: false,
      accountEligible: false,
      isOwner: false,
      membershipRole: null,
      guestInviteActive: invite?.projectId === databaseProjectId,
      legacyGrantRole: null
    });
    if (invite?.projectId === databaseProjectId && guestRole) {
      return {
        mode: "guest",
        editorEligible: false,
        grant: {
          projectId: invite.projectId,
          projectName: invite.projectName,
          role: guestRole,
          joinedAt: legacyGrant?.joinedAt ?? ""
        }
      };
    }
  }

  if (!legacyGrant) return null;
  const role = resolveEffectiveProjectRole({
    accountAuthenticated: false,
    accountEligible: false,
    isOwner: false,
    membershipRole: null,
    guestInviteActive: false,
    legacyGrantRole: legacyGrant.role
  });
  return role
    ? { mode: "legacy", editorEligible: false, grant: { ...legacyGrant, role } }
    : null;
}

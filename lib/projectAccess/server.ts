import "server-only";

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { normalizeProjectId } from "@/lib/projectId";
import type { ProjectAccessGrant, SharedProjectRole } from "@/lib/projectAccess/core";

const scrypt = promisify(scryptCallback);
export const PROJECT_SESSION_COOKIE = "shotcl_project_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export class ProjectAccessUnavailableError extends Error {}

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

export function getJoinAttemptKey(request: NextRequest, normalizedProjectName: string) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(`${forwardedFor}:${normalizedProjectName}`).digest("hex");
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

export async function getAccessGrant(request: NextRequest, projectId: string): Promise<ProjectAccessGrant | null> {
  const token = getSessionToken(request);
  return getAccessGrantByToken(token, projectId);
}

export async function getAccessGrantByToken(token: string | null, projectId: string): Promise<ProjectAccessGrant | null> {
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
  return data ?? [];
}

/**
 * 공유 프로젝트는 passcode 세션을, 레거시 프로젝트는 Supabase Auth 소유권/멤버십을 확인합니다.
 * service-role 클라이언트를 쓰는 API가 `share_enabled=false`만으로 권한을 우회하지 않도록
 * 레거시 요청에도 실제 사용자 JWT를 요구합니다.
 */
export async function canAdministerProject(request: NextRequest, projectId: string) {
  return (await getProjectRequestRole(request, projectId)) === "admin";
}

/** passcode 공유 세션과 레거시 Supabase Auth를 하나의 서버 권한 판정으로 합칩니다. */
export async function getProjectRequestRole(
  request: NextRequest,
  projectId: string
): Promise<SharedProjectRole | null> {
  const supabase = requireProjectAccessDb();
  const databaseProjectId = normalizeProjectId(projectId);
  const grant = await getAccessGrant(request, databaseProjectId);
  if (grant) return grant.role;

  const { data, error } = await supabase
    .from("projects")
    .select("share_enabled,created_by")
    .eq("id", databaseProjectId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.share_enabled) return null;

  const bearerToken = getBearerToken(request);
  if (!bearerToken) return null;
  const { data: authData, error: authError } = await supabase.auth.getUser(bearerToken);
  if (authError || !authData.user) return null;
  if (String(data.created_by ?? "") === authData.user.id) return "admin";

  const { data: membership, error: membershipError } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", databaseProjectId)
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (membershipError) {
    // 초기 MVP DB에는 project_members가 없을 수 있습니다. 소유자 검증은 위에서 완료했습니다.
    if (membershipError.code === "42P01" || membershipError.code === "PGRST205") return null;
    throw membershipError;
  }
  if (membership?.role === "admin") return "admin";
  return membership ? "progress" : null;
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

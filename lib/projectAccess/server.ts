import "server-only";

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
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

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
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

export function ensureSessionToken(request: NextRequest, response: NextResponse) {
  const existing = getSessionToken(request);
  if (existing) return existing;
  const token = randomBytes(32).toString("base64url");
  response.cookies.set(PROJECT_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
  return token;
}

export async function saveAccessGrant(token: string, projectId: string, role: SharedProjectRole) {
  const supabase = requireProjectAccessDb();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const { error } = await supabase.from("project_access_sessions").upsert(
    {
      browser_token_hash: hashSessionToken(token),
      project_id: projectId,
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
  const { data, error } = await supabase
    .from("project_access_sessions")
    .select("project_id,role,joined_at,expires_at,projects!inner(name)")
    .eq("browser_token_hash", hashSessionToken(token))
    .eq("project_id", projectId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data || (data.role !== "admin" && data.role !== "progress")) return null;
  const projectRelation = data.projects as unknown as { name: string } | Array<{ name: string }>;
  const projectName = Array.isArray(projectRelation) ? projectRelation[0]?.name : projectRelation?.name;
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
    .select("project_id,role,joined_at,expires_at,projects!inner(id,name,shoot_date,description,created_at,share_enabled)")
    .eq("browser_token_hash", hashSessionToken(token))
    .gt("expires_at", new Date().toISOString())
    .order("joined_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** 레거시 프로젝트는 기존 Auth/RLS 흐름을 유지하고, 공유 프로젝트만 passcode admin 세션을 강제합니다. */
export async function canAdministerProject(request: NextRequest, projectId: string) {
  const supabase = requireProjectAccessDb();
  const { data, error } = await supabase.from("projects").select("share_enabled").eq("id", projectId).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  if (!data.share_enabled) return true;
  return (await getAccessGrant(request, projectId))?.role === "admin";
}

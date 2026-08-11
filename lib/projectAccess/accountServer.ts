import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import {
  isShotclEditorGoogleEmail,
  normalizeTrustedGoogleIdentity,
  parseShotclEditorGoogleEmails
} from "@/lib/projectAccess/accountCore";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const SHOTCL_ACCOUNT_COOKIE = "shotcl_account_session";
const ACCOUNT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const EDITOR_ELIGIBILITY_MAX_AGE_SECONDS = 60 * 75;

export type ShotclAuthenticatedAccount = {
  userId: string;
  email: string;
  provider: "google";
  isEditor: boolean;
  expiresAt?: string;
};

export class ShotclAccountUnavailableError extends Error {}

export function getShotclEditorGoogleEmails() {
  return parseShotclEditorGoogleEmails(process.env.SHOTCL_EDITOR_GOOGLE_EMAILS);
}

export function getShotclBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function createShotclAccountSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashShotclAccountSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function setShotclAccountSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SHOTCL_ACCOUNT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACCOUNT_SESSION_MAX_AGE_SECONDS
  });
}

export function clearShotclAccountSessionCookie(response: NextResponse) {
  response.cookies.set(SHOTCL_ACCOUNT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

/** Supabase가 검증한 Google identity를 읽고 editor eligibility는 별도로 표시합니다. */
export async function resolveAuthenticatedGoogleAccount(accessToken: string | null) {
  if (!accessToken) return null;
  const supabase = requireShotclAccountDb();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;

  const identity = normalizeTrustedGoogleIdentity({
    id: data.user.id,
    email: data.user.email,
    emailConfirmedAt: data.user.email_confirmed_at,
    provider: data.user.app_metadata?.provider,
    providers: data.user.app_metadata?.providers,
    identities: data.user.identities
  });
  const userId = String(data.user.id ?? "").trim();
  if (!identity) {
    if (userId) await removeSyncedEditorAccount(userId);
    return null;
  }

  const isEditor = isShotclEditorGoogleEmail(identity.email, getShotclEditorGoogleEmails());
  if (isEditor) await syncEditorAccount(identity.id, identity.email);
  else await removeSyncedEditorAccount(identity.id);
  return {
    userId: identity.id,
    email: identity.email,
    provider: identity.provider,
    isEditor
  } satisfies ShotclAuthenticatedAccount;
}

export async function resolveAuthenticatedGoogleEditor(accessToken: string | null) {
  const account = await resolveAuthenticatedGoogleAccount(accessToken);
  return account?.isEditor ? account : null;
}

/** 인증 완료 route가 opaque HttpOnly cookie를 만들 때 사용하는 원자 단위입니다. */
export async function createShotclAccountSession(
  accessToken: string,
  existingSessionToken?: string | null
) {
  const account = await resolveAuthenticatedGoogleAccount(accessToken);
  if (!account) return null;
  const supabase = requireShotclAccountDb();
  const token = createShotclAccountSessionToken();
  const previousTokenHash = /^[A-Za-z0-9_-]{43}$/.test(existingSessionToken ?? "")
    ? hashShotclAccountSessionToken(String(existingSessionToken))
    : null;
  const expiresAt = new Date(Date.now() + ACCOUNT_SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const { error } = await supabase.rpc("rotate_shotcl_account_session", {
    p_previous_token_hash: previousTokenHash,
    p_new_token_hash: hashShotclAccountSessionToken(token),
    p_user_id: account.userId,
    p_email: account.email,
    p_provider: account.provider,
    p_expires_at: expiresAt
  });
  if (error) throw error;
  return { token, account: { ...account, expiresAt } };
}

/** cookie가 없으면 bearer를 검증해 API 전환 기간에도 authenticated uid를 쓸 수 있습니다. */
export async function resolveShotclAuthenticatedAccount(request: NextRequest) {
  return resolveShotclAuthenticatedAccountFromCredentials({
    accountSessionToken: request.cookies.get(SHOTCL_ACCOUNT_COOKIE)?.value ?? null,
    bearerToken: getShotclBearerToken(request)
  });
}

export async function resolveShotclAuthenticatedAccountFromCredentials(input: {
  accountSessionToken?: string | null;
  bearerToken?: string | null;
}) {
  if (input.accountSessionToken) {
    const account = await resolveShotclAccountSessionToken(input.accountSessionToken);
    if (account) return account;
  }
  return resolveAuthenticatedGoogleAccount(input.bearerToken ?? null);
}

export async function deleteShotclAccountSession(request: NextRequest) {
  const token = request.cookies.get(SHOTCL_ACCOUNT_COOKIE)?.value ?? "";
  if (!token) return;
  const supabase = requireShotclAccountDb();
  const { error } = await supabase
    .from("shotcl_account_sessions")
    .delete()
    .eq("token_hash", hashShotclAccountSessionToken(token));
  if (error) throw error;
}

export async function linkShotclAccountProjectMembership(userId: string, projectId: string) {
  const supabase = requireShotclAccountDb();
  const { data, error } = await supabase.rpc("link_shotcl_account_project_membership", {
    p_project_id: projectId,
    p_user_id: userId
  });
  if (error) throw error;
  if (data !== "admin" && data !== "crew") {
    throw new Error("프로젝트 계정 연결 결과를 확인할 수 없습니다.");
  }
  return data;
}

async function resolveShotclAccountSessionToken(token: string) {
  const supabase = requireShotclAccountDb();
  const now = new Date().toISOString();
  const tokenHash = hashShotclAccountSessionToken(token);
  const { data, error } = await supabase
    .from("shotcl_account_sessions")
    .select("user_id,email,provider,expires_at")
    .eq("token_hash", tokenHash)
    .gt("expires_at", now)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.provider !== "google") {
    await supabase.from("shotcl_account_sessions").delete().eq("token_hash", tokenHash);
    return null;
  }
  // RLS용 editor row는 OAuth/session sync 때만 갱신합니다. 프로젝트 페이지를
  // 읽을 때마다 같은 upsert/delete를 반복하지 않되, 서버 API 권한은 현재 env를
  // 매 요청 다시 비교해 stale한 client 권한을 허용하지 않습니다.
  const isEditor = isShotclEditorGoogleEmail(data.email, getShotclEditorGoogleEmails());
  return {
    userId: String(data.user_id),
    email: String(data.email),
    provider: "google" as const,
    isEditor,
    expiresAt: String(data.expires_at)
  } satisfies ShotclAuthenticatedAccount;
}

async function syncEditorAccount(userId: string, email: string) {
  const supabase = requireShotclAccountDb();
  const now = new Date();
  const { error } = await supabase.from("shotcl_editor_accounts").upsert({
    user_id: userId,
    email,
    synced_at: now.toISOString(),
    expires_at: new Date(now.getTime() + EDITOR_ELIGIBILITY_MAX_AGE_SECONDS * 1000).toISOString()
  }, { onConflict: "user_id" });
  if (error) throw error;
}

async function removeSyncedEditorAccount(userId: string) {
  const supabase = requireShotclAccountDb();
  const { error } = await supabase
    .from("shotcl_editor_accounts")
    .delete()
    .eq("user_id", userId);
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
}

function requireShotclAccountDb() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new ShotclAccountUnavailableError("ShotCL 계정 세션을 확인할 수 없습니다.");
  }
  return supabase;
}

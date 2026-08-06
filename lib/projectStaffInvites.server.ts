import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import type { NextRequest } from "next/server";
import { requireProjectAccessDb } from "@/lib/projectAccess/server";

const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const INVITE_TOKEN_DOMAIN = "shotcl-project-staff-invite-token:v1";

type InviteRow = {
  id: string;
  project_id: string;
  token_hash: string;
  created_at: string;
  revoked_at?: string | null;
};

type InviteRpcPayload = {
  inviteId?: unknown;
  projectId?: unknown;
  tokenHash?: unknown;
  createdAt?: unknown;
  created?: unknown;
};

export type ProjectStaffInviteManagementState =
  | { status: "inactive" }
  | { status: "active"; inviteUrl: string; createdAt: string }
  | { status: "rotation_required" };

export type ProjectStaffInvitePublicInfo = {
  projectId: string;
  projectName: string;
};

export type ProjectStaffInviteRedemption = ProjectStaffInvitePublicInfo & {
  role: "admin" | "progress";
  alreadyMember: boolean;
};

export class ProjectStaffInviteMigrationRequiredError extends Error {
  constructor() {
    super("스탭 초대 migration을 먼저 적용해주세요.");
    this.name = "ProjectStaffInviteMigrationRequiredError";
  }
}

export class ProjectStaffInviteUnavailableError extends Error {
  constructor(message = "스탭 초대 기능을 사용할 수 없습니다.") {
    super(message);
    this.name = "ProjectStaffInviteUnavailableError";
  }
}

export function isProjectStaffInviteToken(value: string) {
  return INVITE_TOKEN_PATTERN.test(value);
}

/** URL token은 32-byte HMAC 결과이며 프로젝트 ID·비밀번호·role을 담지 않습니다. */
export function deriveProjectStaffInviteToken(inviteId: string, projectId: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new ProjectStaffInviteUnavailableError();
  const signingKey = createHash("sha256")
    .update(`${INVITE_TOKEN_DOMAIN}\0`, "utf8")
    .update(serviceRoleKey, "utf8")
    .digest();
  return createHmac("sha256", signingKey)
    .update(`${inviteId}:${projectId}`, "utf8")
    .digest("base64url");
}

export function hashProjectStaffInviteToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** production에서는 Vercel의 canonical production host를 우선하고 개발 환경만 request origin을 사용합니다. */
export function buildProjectStaffInviteUrl(request: NextRequest, token: string) {
  if (!isProjectStaffInviteToken(token)) throw new ProjectStaffInviteUnavailableError();
  const origin = resolveCanonicalOrigin(request);
  return new URL(`/invite/${encodeURIComponent(token)}`, origin).toString();
}

export async function getProjectStaffInviteManagementState(
  request: NextRequest,
  projectId: string
): Promise<ProjectStaffInviteManagementState> {
  try {
    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("project_staff_invites")
      .select("id,project_id,token_hash,created_at,revoked_at")
      .eq("project_id", projectId)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { status: "inactive" };
    return serializeActiveInvite(request, data as InviteRow);
  } catch (error) {
    throw normalizeInviteDatabaseError(error);
  }
}

export async function ensureProjectStaffInvite(
  request: NextRequest,
  projectId: string,
  creatorSessionHash: string,
  rotate: boolean
): Promise<ProjectStaffInviteManagementState> {
  try {
    const candidateInviteId = randomUUID();
    const candidateToken = deriveProjectStaffInviteToken(candidateInviteId, projectId);
    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase.rpc("ensure_project_staff_invite", {
      p_project_id: projectId,
      p_creator_session_hash: creatorSessionHash,
      p_candidate_invite_id: candidateInviteId,
      p_candidate_token_hash: hashProjectStaffInviteToken(candidateToken),
      p_rotate: rotate
    });
    if (error) throw error;
    const payload = asInviteRpcPayload(data);
    const inviteId = String(payload?.inviteId ?? "");
    const returnedProjectId = String(payload?.projectId ?? "");
    const tokenHash = String(payload?.tokenHash ?? "");
    const createdAt = String(payload?.createdAt ?? "");
    if (!inviteId || returnedProjectId !== projectId || !SHA256_HEX_PATTERN.test(tokenHash) || !createdAt) {
      throw new ProjectStaffInviteUnavailableError("초대 링크 응답 형식이 올바르지 않습니다.");
    }
    return serializeActiveInvite(request, {
      id: inviteId,
      project_id: returnedProjectId,
      token_hash: tokenHash,
      created_at: createdAt
    });
  } catch (error) {
    throw normalizeInviteDatabaseError(error);
  }
}

export async function revokeProjectStaffInvite(projectId: string, creatorSessionHash: string) {
  try {
    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase.rpc("revoke_project_staff_invite", {
      p_project_id: projectId,
      p_creator_session_hash: creatorSessionHash
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    throw normalizeInviteDatabaseError(error);
  }
}

/** 공개 화면에는 active token에 연결된 프로젝트 이름만 최소한으로 반환합니다. */
export async function inspectProjectStaffInvite(rawToken: string): Promise<ProjectStaffInvitePublicInfo | null> {
  if (!isProjectStaffInviteToken(rawToken)) return null;
  try {
    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase
      .from("project_staff_invites")
      .select("project_id,revoked_at,projects!inner(id,name,share_enabled)")
      .eq("token_hash", hashProjectStaffInviteToken(rawToken))
      .is("revoked_at", null)
      .eq("projects.share_enabled", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const project = firstRelation(data.projects);
    const projectId = String(data.project_id ?? "");
    const projectName = String(project?.name ?? "").trim();
    if (!projectId || !projectName || project?.share_enabled !== true) return null;
    return { projectId, projectName };
  } catch (error) {
    throw normalizeInviteDatabaseError(error);
  }
}

/** projectId와 role은 client가 보내지 않고 token hash가 가리키는 DB row에서만 결정됩니다. */
export async function redeemProjectStaffInvite(
  rawToken: string,
  browserSessionHash: string
): Promise<ProjectStaffInviteRedemption | null> {
  if (!isProjectStaffInviteToken(rawToken) || !SHA256_HEX_PATTERN.test(browserSessionHash)) return null;
  try {
    const supabase = requireProjectAccessDb();
    const { data, error } = await supabase.rpc("redeem_project_staff_invite", {
      p_token_hash: hashProjectStaffInviteToken(rawToken),
      p_browser_session_hash: browserSessionHash
    });
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const payload = data as Record<string, unknown>;
    const projectId = String(payload.projectId ?? "");
    const projectName = String(payload.projectName ?? "").trim();
    const role = payload.role === "admin" ? "admin" : payload.role === "progress" ? "progress" : null;
    if (!projectId || !projectName || !role) return null;
    return {
      projectId,
      projectName,
      role,
      alreadyMember: payload.alreadyMember === true
    };
  } catch (error) {
    throw normalizeInviteDatabaseError(error);
  }
}

function serializeActiveInvite(
  request: NextRequest,
  invite: InviteRow
): ProjectStaffInviteManagementState {
  const rawToken = deriveProjectStaffInviteToken(invite.id, invite.project_id);
  const reconstructedHash = hashProjectStaffInviteToken(rawToken);
  if (!safeHexEqual(reconstructedHash, invite.token_hash)) {
    return { status: "rotation_required" };
  }
  return {
    status: "active",
    inviteUrl: buildProjectStaffInviteUrl(request, rawToken),
    createdAt: invite.created_at
  };
}

function resolveCanonicalOrigin(request: NextRequest) {
  const explicitAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const production = process.env.NODE_ENV === "production";
  const candidates = production
    ? [productionHost ? `https://${productionHost}` : "", explicitAppUrl]
    : [explicitAppUrl, request.nextUrl.origin];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (production && url.protocol !== "https:") continue;
      if (url.username || url.password) continue;
      if (production && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) continue;
      return url.origin;
    } catch {
      continue;
    }
  }
  throw new ProjectStaffInviteUnavailableError(
    production
      ? "배포용 초대 링크 주소가 설정되지 않았습니다."
      : "초대 링크 주소를 만들 수 없습니다."
  );
}

function normalizeInviteDatabaseError(error: unknown) {
  if (
    error instanceof ProjectStaffInviteMigrationRequiredError
    || error instanceof ProjectStaffInviteUnavailableError
  ) return error;
  const databaseError = getDatabaseError(error);
  const searchable = `${databaseError.code} ${databaseError.message} ${databaseError.details} ${databaseError.hint}`;
  if (
    ["42P01", "42883", "PGRST202", "PGRST205"].includes(databaseError.code)
    && /(project_staff_invites|project_staff_invite)/i.test(searchable)
  ) {
    return new ProjectStaffInviteMigrationRequiredError();
  }
  return error instanceof Error ? error : new ProjectStaffInviteUnavailableError();
}

function getDatabaseError(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return { code: "", message: "", details: "", hint: "" };
  }
  const source = error as Record<string, unknown>;
  return {
    code: String(source.code ?? ""),
    message: String(source.message ?? ""),
    details: String(source.details ?? ""),
    hint: String(source.hint ?? "")
  };
}

function firstRelation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" && !Array.isArray(first)
      ? first as Record<string, unknown>
      : null;
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asInviteRpcPayload(value: unknown): InviteRpcPayload | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as InviteRpcPayload
    : null;
}

function safeHexEqual(first: string, second: string) {
  if (!SHA256_HEX_PATTERN.test(first) || !SHA256_HEX_PATTERN.test(second)) return false;
  const firstBuffer = Buffer.from(first, "hex");
  const secondBuffer = Buffer.from(second, "hex");
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isGuestProjectApiRequestAllowed } from "../lib/projectAccess/guestApiAccess.ts";

const inviteServerSource = readSource("../lib/projectStaffInvites.server.ts");
const managementRouteSource = readSource("../app/api/projects/[projectId]/staff-invite/route.ts");
const inviteLandingSource = readSource("../app/invite/[token]/route.ts");
const redemptionRouteSource = readSource("../app/api/project-invites/[token]/route.ts");
const projectDetailPageSource = readSource("../app/projects/[id]/page.tsx");
const legacyInviteSql = readSource("../supabase/migration_project_staff_invites.sql");
const accountAccessSql = readSource("../supabase/migration_shotcl_account_access.sql");

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function sqlFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} function is missing`);
  const end = source.indexOf("\n$$;", start);
  assert.ok(end > start, `${name} function terminator is missing`);
  return source.slice(start, end + 4);
}

function sourceFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} is missing`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `${endMarker} is missing after ${startMarker}`);
  return source.slice(start, end);
}

test("invite rows have no expiry while legacy project access sessions keep a separate 30-day expiry", () => {
  const tableStart = legacyInviteSql.indexOf("create table if not exists public.project_staff_invites");
  const tableEnd = legacyInviteSql.indexOf("comment on table public.project_staff_invites", tableStart);
  const tableDefinition = legacyInviteSql.slice(tableStart, tableEnd);
  const managementStateSource = sourceFunction(
    inviteServerSource,
    "export async function getProjectStaffInviteManagementState",
    "export async function ensureProjectStaffInvite"
  );
  const inspectSource = sourceFunction(
    inviteServerSource,
    "export async function inspectProjectStaffInvite",
    "export async function redeemProjectStaffInvite"
  );

  assert.match(tableDefinition, /revoked_at timestamptz/u);
  assert.doesNotMatch(tableDefinition, /expires_at/u);
  assert.match(managementStateSource, /\.eq\("project_id", projectId\)[\s\S]*\.is\("revoked_at", null\)/u);
  assert.match(inspectSource, /\.is\("revoked_at", null\)[\s\S]*\.eq\("projects\.share_enabled", true\)/u);
  assert.match(legacyInviteSql, /now\(\) \+ interval '30 days'/u);
});

test("management reads never mutate and key drift requires an explicit rotation", () => {
  const managementStateSource = sourceFunction(
    inviteServerSource,
    "export async function getProjectStaffInviteManagementState",
    "export async function ensureProjectStaffInvite"
  );
  const serializerSource = sourceFunction(
    inviteServerSource,
    "function serializeActiveInvite",
    "function resolveCanonicalOrigin"
  );
  const getRouteSource = sourceFunction(
    managementRouteSource,
    "export async function GET",
    "export async function POST"
  );

  assert.doesNotMatch(managementStateSource, /\.insert\(|\.update\(|\.rpc\(/u);
  assert.doesNotMatch(getRouteSource, /ensureProjectStaffInvite|revokeProjectStaffInvite/u);
  assert.match(serializerSource, /if \(!safeHexEqual\(reconstructedHash, invite\.token_hash\)\)[\s\S]*status: "rotation_required"/u);
  assert.match(serializerSource, /status: "active"[\s\S]*inviteUrl: buildProjectStaffInviteUrl/u);
});

test("legacy ensure reuses the active row with zero writes and serializes first creation", () => {
  const ensureSql = sqlFunction(legacyInviteSql, "ensure_project_staff_invite");
  const lockIndex = ensureSql.indexOf("pg_advisory_xact_lock");
  const selectIndex = ensureSql.indexOf("from public.project_staff_invites as invite");
  const reuseIndex = ensureSql.indexOf("if found and not p_rotate then");
  const rotateIndex = ensureSql.indexOf("if found then", reuseIndex + 1);
  const insertIndex = ensureSql.indexOf("insert into public.project_staff_invites");
  const reuseBranch = ensureSql.slice(reuseIndex, rotateIndex);

  assert.ok(lockIndex >= 0 && selectIndex > lockIndex);
  assert.ok(reuseIndex > selectIndex && rotateIndex > reuseIndex && insertIndex > rotateIndex);
  assert.match(reuseBranch, /'created', false/u);
  assert.doesNotMatch(reuseBranch, /update public\.project_staff_invites|insert into public\.project_staff_invites/u);
  assert.match(ensureSql.slice(insertIndex), /'created', true/u);
});

test("account ensure has the same reuse and serialization contract", () => {
  const ensureSql = sqlFunction(accountAccessSql, "ensure_project_staff_invite_for_account");
  const lockIndex = ensureSql.indexOf("pg_advisory_xact_lock");
  const selectIndex = ensureSql.indexOf("from public.project_staff_invites as invite");
  const reuseIndex = ensureSql.indexOf("if found and not p_rotate then");
  const rotateIndex = ensureSql.indexOf("if found then", reuseIndex + 1);
  const insertIndex = ensureSql.indexOf("insert into public.project_staff_invites");
  const reuseBranch = ensureSql.slice(reuseIndex, rotateIndex);

  assert.ok(lockIndex >= 0 && selectIndex > lockIndex);
  assert.ok(reuseIndex > selectIndex && rotateIndex > reuseIndex && insertIndex > rotateIndex);
  assert.match(reuseBranch, /'created', false/u);
  assert.doesNotMatch(reuseBranch, /update public\.project_staff_invites|insert into public\.project_staff_invites/u);
  assert.match(ensureSql.slice(insertIndex), /'created', true/u);
});

test("one active row and the shared advisory lock prevent duplicate first-tap creation", () => {
  const legacyEnsure = sqlFunction(legacyInviteSql, "ensure_project_staff_invite");
  const legacyRevoke = sqlFunction(legacyInviteSql, "revoke_project_staff_invite");
  const accountEnsure = sqlFunction(accountAccessSql, "ensure_project_staff_invite_for_account");
  const accountRevoke = sqlFunction(accountAccessSql, "revoke_project_staff_invite_for_account");
  const lockPattern = /shotcl-project-staff-invite:' \|\| p_project_id::text/u;

  assert.match(
    legacyInviteSql,
    /create unique index[\s\S]*on public\.project_staff_invites \(project_id\)[\s\S]*where revoked_at is null/u
  );
  [legacyEnsure, legacyRevoke, accountEnsure, accountRevoke].forEach((body) => {
    assert.match(body, /pg_advisory_xact_lock/u);
    assert.match(body, lockPattern);
  });
});

test("ensure, rotate, and revoke remain separate lifecycle actions", () => {
  const postRouteSource = sourceFunction(
    managementRouteSource,
    "export async function POST",
    "async function requireInviteAdmin"
  );
  const legacyEnsure = sqlFunction(legacyInviteSql, "ensure_project_staff_invite");
  const accountEnsure = sqlFunction(accountAccessSql, "ensure_project_staff_invite_for_account");
  const legacyRevoke = sqlFunction(legacyInviteSql, "revoke_project_staff_invite");
  const accountRevoke = sqlFunction(accountAccessSql, "revoke_project_staff_invite_for_account");

  assert.match(managementRouteSource, /type InviteAction = "ensure" \| "rotate" \| "revoke"/u);
  assert.match(postRouteSource, /if \(action === "revoke"\)[\s\S]*status: "inactive"/u);
  assert.match(postRouteSource, /action === "rotate"/u);
  [legacyEnsure, accountEnsure].forEach((body) => {
    const revokeIndex = body.indexOf("set revoked_at = now()");
    const insertIndex = body.indexOf("insert into public.project_staff_invites");
    assert.ok(revokeIndex >= 0 && insertIndex > revokeIndex);
  });
  [legacyRevoke, accountRevoke].forEach((body) => {
    assert.match(body, /where project_id = p_project_id[\s\S]*and revoked_at is null/u);
  });
});

test("invite management stays admin-only at both API and database boundaries", () => {
  const legacyEnsure = sqlFunction(legacyInviteSql, "ensure_project_staff_invite");
  const accountEnsure = sqlFunction(accountAccessSql, "ensure_project_staff_invite_for_account");
  const requireAdminSource = sourceFunction(
    managementRouteSource,
    "async function requireInviteAdmin",
    "async function readAction"
  );

  assert.match(requireAdminSource, /access\?\.grant\.role !== "admin"/u);
  assert.match(legacyEnsure, /session\.role::text = 'admin'[\s\S]*session\.expires_at > now\(\)/u);
  assert.match(accountEnsure, /editor\.expires_at > now\(\)[\s\S]*project\.created_by = p_user_id or member\.role::text = 'admin'/u);
});

test("reused project-capability links keep guest access read-only and enter the visit-time Progress resolver", () => {
  assert.match(inviteServerSource, /new URL\(`\/invite\/\$\{encodeURIComponent\(token\)\}`/u);
  assert.doesNotMatch(inviteServerSource, /dailyPlanId|roundId/u);
  assert.match(inviteLandingSource, /resolveInviteProgressTarget\(invite\.projectId\)/u);
  assert.match(inviteLandingSource, /buildProgressRoundHref\(invite\.projectId, target\.dailyPlanId\)/u);
  assert.match(inviteLandingSource, /NextResponse\.redirect\(new URL\(destination, request\.url\), 307\)/u);
  assert.match(inviteLandingSource, /setProjectGuestInviteCookie\(response, token\)/u);
  assert.match(redemptionRouteSource, /buildProgressRoundHref\(invite\.projectId, target\.dailyPlanId\)/u);
  assert.match(projectDetailPageSource, /const requestedDailyPlanId = searchParams\.get\("dailyPlanId"\) \?\? ""/u);

  const baseRequest = {
    pathname: "/api/projects/project-a/daily-plans",
    projectId: "project-a",
    searchParams: new URLSearchParams()
  };
  assert.equal(isGuestProjectApiRequestAllowed({ ...baseRequest, method: "GET" }), true);
  assert.equal(isGuestProjectApiRequestAllowed({ ...baseRequest, method: "POST" }), false);
  assert.equal(isGuestProjectApiRequestAllowed({ ...baseRequest, method: "PATCH" }), false);
  assert.equal(isGuestProjectApiRequestAllowed({
    method: "GET",
    pathname: "/api/projects/project-a/shot-diagrams",
    projectId: "project-a",
    searchParams: new URLSearchParams({ dailyPlanId: "__project_space_presets__" })
  }), false);
  assert.equal(isGuestProjectApiRequestAllowed({
    method: "GET",
    pathname: "/api/projects/project-a/shot-diagrams",
    projectId: "project-a",
    searchParams: new URLSearchParams({ archive: "1" })
  }), false);
  assert.equal(isGuestProjectApiRequestAllowed({
    method: "GET",
    pathname: "/api/projects/project-b/daily-plans",
    projectId: "project-a",
    searchParams: new URLSearchParams()
  }), false);
});

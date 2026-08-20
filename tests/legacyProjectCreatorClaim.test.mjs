import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (pathname) => readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");

test("legacy claim accepts only the unique creation-window admin receipt", () => {
  const projectCreatedAt = Date.parse("2026-08-20T01:12:21.814Z");
  const credentialCreatedAt = Date.parse("2026-08-20T01:12:22.169Z");
  const creationSessionAt = Date.parse("2026-08-20T01:12:22.278Z");
  const lateAdminSessionAt = Date.parse("2026-08-21T00:12:21.814Z");
  const maxWindowMs = 2_000;
  const inWindow = (timestamp) => (
    timestamp >= projectCreatedAt && timestamp <= projectCreatedAt + maxWindowMs
  );

  assert.equal(inWindow(credentialCreatedAt), true);
  assert.equal(inWindow(creationSessionAt), true);
  assert.equal(inWindow(lateAdminSessionAt), false);
  assert.equal([creationSessionAt, lateAdminSessionAt].filter(inWindow).length, 1);
});

test("migration proves the receipt atomically and keeps the creator trigger fail-closed", () => {
  const sql = readSource("supabase/migration_legacy_project_creator_claim.sql");

  assert.match(sql, /created_by is not null[\s\S]*already_creator[\s\S]*return 'ineligible'/u);
  assert.match(sql, /deletion_started_at is not null[\s\S]*share_enabled is not true/u);
  assert.match(sql, /shotcl_editor_accounts[\s\S]*editor\.user_id = p_creator_user_id[\s\S]*editor\.expires_at > now\(\)/u);
  assert.match(sql, /credential\.created_at < v_project\.created_at[\s\S]*credential\.created_at > v_project\.created_at \+ interval '2 seconds'/u);
  assert.match(sql, /session\.browser_token_hash = p_legacy_session_hash[\s\S]*session\.role = 'admin'[\s\S]*session\.expires_at > now\(\)/u);
  assert.match(sql, /v_session\.joined_at < v_project\.created_at[\s\S]*v_session\.joined_at > v_project\.created_at \+ interval '2 seconds'/u);
  assert.match(sql, /v_session\.joined_at < v_credential\.created_at/u);
  assert.match(sql, /count\(\*\)::integer[\s\S]*session\.role = 'admin'[\s\S]*session\.joined_at >= v_project\.created_at[\s\S]*session\.joined_at <= v_project\.created_at \+ interval '2 seconds'[\s\S]*v_window_admin_count <> 1/u);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*shotcl-project-permanent-deletion:/u);
  assert.match(sql, /legacy_project_creator_claims[\s\S]*creator_user_id = new\.created_by[\s\S]*claim_transaction_id = txid_current\(\)[\s\S]*project creator is immutable/u);
  assert.match(sql, /update public\.projects[\s\S]*set created_by = p_creator_user_id[\s\S]*created_by is null/u);
  assert.match(sql, /insert into public\.project_members[\s\S]*'admin'[\s\S]*on conflict[\s\S]*role = 'admin'/u);
  assert.match(sql, /revoke all on function public\.claim_legacy_project_creator\(uuid, uuid, text\)[\s\S]*from public, anon, authenticated/u);
  assert.match(sql, /grant execute on function public\.claim_legacy_project_creator\(uuid, uuid, text\)[\s\S]*to service_role/u);
  assert.match(sql, /revoke all on table public\.legacy_project_creator_claims[\s\S]*service_role/u);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete)[^;]*legacy_project_creator_claims/iu);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/u);
});

test("server sends only a hashed exact legacy capability to the service RPC", () => {
  const server = readSource("lib/projectAccess/server.ts");
  const helper = server.slice(
    server.indexOf("export async function claimLegacyProjectCreatorFromCreationSession"),
    server.indexOf("export async function getProjectRequestAccess", server.indexOf("export async function claimLegacyProjectCreatorFromCreationSession"))
  );

  assert.match(helper, /PROJECT_SESSION_TOKEN_PATTERN\.test\(input\.legacySessionToken\)/u);
  assert.match(helper, /isValidDatabaseProjectId\(projectId\)[\s\S]*isValidDatabaseProjectId\(creatorUserId\)/u);
  assert.match(helper, /supabase\.rpc\("claim_legacy_project_creator"/u);
  assert.match(helper, /p_legacy_session_hash: hashProjectSessionToken\(input\.legacySessionToken\)/u);
  assert.match(helper, /data === "claimed" \|\| data === "already_creator" \? projectId : null/u);
  assert.doesNotMatch(helper, /p_legacy_session_token|legacySessionToken:\s*input/u);
});

test("auth sync attempts a claim only for an allowlisted legacy admin and returns one exact ID", () => {
  const route = readSource("app/api/auth/session/route.ts");
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function DELETE"));
  const claimAt = post.indexOf("claimLegacyProjectCreatorFromCreationSession");
  const membershipAt = post.indexOf("linkShotclAccountProjectMembership");

  assert.ok(claimAt >= 0 && membershipAt > claimAt);
  assert.match(post, /if \(legacyGrant\.role === "admin" && created\.account\.isEditor\)/u);
  assert.match(post, /projectId: requestedProjectId[\s\S]*creatorUserId: created\.account\.userId[\s\S]*legacySessionToken: getSessionToken\(request\)/u);
  assert.match(post, /creatorClaimedProjectId,/u);
  assert.equal((post.match(/claimLegacyProjectCreatorFromCreationSession\(/gu) ?? []).length, 1);
  assert.ok(post.indexOf("if (legacyGrant)") < claimAt);
  assert.ok(claimAt < post.indexOf("} else {", claimAt));
});

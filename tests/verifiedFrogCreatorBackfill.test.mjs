import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migration_verified_frog_project_creator.sql", import.meta.url),
  "utf8"
);

const PROJECT_ID = "3f255cf2-0ef6-45d1-8802-dc405a1d91a7";
const CREATOR_ID = "6d6c435c-d485-4330-9cf2-7b03be146ec2";

test("verified Frog backfill is bound to one exact Project and Google UUID", () => {
  assert.match(migration, new RegExp(`v_project_id constant uuid := '${PROJECT_ID}'::uuid`, "u"));
  assert.match(migration, new RegExp(`v_creator_user_id constant uuid := '${CREATOR_ID}'::uuid`, "u"));
  assert.match(migration, /v_expected_project_name constant text := '하부장의 개구리'/u);
  assert.match(migration, /v_expected_creator_email constant text := 'stop7lukky@gmail\.com'/u);
  assert.match(migration, /where project\.id = v_project_id[\s\S]*for update/u);
  assert.match(migration, /where auth_user\.id = v_creator_user_id/u);
  assert.match(migration, /v_auth_email is distinct from v_expected_creator_email/u);
  assert.match(migration, /from auth\.identities as identity[\s\S]*identity\.user_id = v_creator_user_id[\s\S]*identity\.provider = 'google'/u);
  assert.match(migration, /member\.project_id = v_project_id[\s\S]*member\.user_id = v_creator_user_id[\s\S]*member\.role::text = 'admin'/u);
  assert.doesNotMatch(migration, /where\s+(?:lower\()?project\.name\)?\s*=/iu);
});

test("backfill updates only a NULL unlocked exact target and verifies one changed row", () => {
  const updateStart = migration.indexOf("update public.projects");
  const updateEnd = migration.indexOf("get diagnostics v_updated_count", updateStart);
  assert.ok(updateStart >= 0 && updateEnd > updateStart);
  const update = migration.slice(updateStart, updateEnd);

  assert.match(update, /set created_by = v_creator_user_id/u);
  assert.match(update, /where id = v_project_id/u);
  assert.match(update, /and name = v_expected_project_name/u);
  assert.match(update, /and created_by is null/u);
  assert.match(update, /and deletion_started_at is null/u);
  assert.equal((migration.match(/update public\.projects/gu) ?? []).length, 1);
  assert.match(migration, /if v_updated_count <> 1[\s\S]*raise exception 'verified creator backfill must update exactly one Project row'/u);
  assert.doesNotMatch(migration, /set\s+created_by\s*=\s*(?:member|auth\.uid|current_user)/iu);
});

test("a transaction-bound private audit receipt preserves creator immutability", () => {
  assert.match(migration, /from pg_catalog\.pg_trigger as creator_trigger[\s\S]*creator_trigger\.tgrelid = 'public\.projects'::regclass[\s\S]*creator_trigger\.tgname = 'projects_immutable_creator'[\s\S]*creator_trigger\.tgfoid = 'public\.enforce_immutable_project_creator\(\)'::regprocedure[\s\S]*creator_trigger\.tgenabled in \('O', 'A'\)/u);
  assert.match(migration, /create table if not exists public\.verified_frog_project_creator_backfill_audit/u);
  assert.match(migration, new RegExp(`check \\(project_id = '${PROJECT_ID}'::uuid\\)`, "u"));
  assert.match(migration, new RegExp(`check \\(creator_user_id = '${CREATOR_ID}'::uuid\\)`, "u"));
  assert.match(migration, /claim_transaction_id bigint not null default txid_current\(\)/u);
  assert.match(migration, /alter table public\.verified_frog_project_creator_backfill_audit[\s\S]*enable row level security/u);
  assert.match(migration, /revoke all on table public\.verified_frog_project_creator_backfill_audit[\s\S]*public, anon, authenticated, service_role/u);
  assert.match(migration, /legacy_project_creator_claims[\s\S]*claim_transaction_id = txid_current\(\)[\s\S]*or exists \([\s\S]*verified_frog_project_creator_backfill_audit[\s\S]*verified\.claim_transaction_id = txid_current\(\)/u);
  assert.doesNotMatch(migration, /disable trigger|session_replication_role|drop trigger/iu);
});

test("reruns are a no-op only for the exact audited owner and conflicts abort", () => {
  assert.match(migration, /v_receipt_found := found[\s\S]*if v_project\.created_by is not null[\s\S]*v_project\.created_by = v_creator_user_id[\s\S]*v_receipt_found[\s\S]*v_existing_receipt\.creator_user_id = v_creator_user_id[\s\S]*return;/u);
  assert.match(migration, /raise exception 'verified creator target already has a different or unaudited creator'/u);
  assert.match(migration, /raise exception 'verified creator receipt exists without its creator update'/u);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*shotcl-project-permanent-deletion:/u);
  assert.match(migration, /migration_project_permanent_deletion\.sql[\s\S]*migration_legacy_project_creator_claim\.sql/u);
});

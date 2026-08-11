import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migration_shotcl_account_access.sql", import.meta.url);

test("account tables are private service-role-only resources", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of ["shotcl_editor_accounts", "shotcl_account_sessions"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"));
  }
  assert.match(sql, /shotcl_editor_accounts[\s\S]*expires_at timestamptz/i);
  assert.match(sql, /public\.is_shotcl_editor\(\)[\s\S]*editor\.expires_at > now\(\)/i);
  assert.match(sql, /rotate_shotcl_account_session[\s\S]*delete from public\.shotcl_account_sessions[\s\S]*insert into public\.shotcl_account_sessions/i);
});

test("direct shot updates require both editor eligibility and project admin membership", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /drop policy if exists "shots_update_members" on public\.shots/i);
  assert.match(sql, /create policy "shots_update_editor_admins"[\s\S]*public\.is_shotcl_editor\(\)[\s\S]*public\.is_project_admin\(project_id\)/i);
});

test("guest linking RPC is service-role-only and preserves an existing admin", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /when public\.project_members\.role = 'admin' then 'admin'/i);
  assert.match(sql, /revoke all on function public\.link_shotcl_account_project_membership\(uuid, uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.link_shotcl_account_project_membership\(uuid, uuid\)[\s\S]*to service_role/i);
});

test("account admins manage invites through editor-gated service-only RPCs", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /ensure_project_staff_invite_for_account[\s\S]*editor\.expires_at > now\(\)[\s\S]*member\.role::text = 'admin'/i);
  assert.match(sql, /revoke_project_staff_invite_for_account[\s\S]*editor\.expires_at > now\(\)[\s\S]*member\.role::text = 'admin'/i);
  assert.match(sql, /revoke all on function public\.ensure_project_staff_invite_for_account[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.revoke_project_staff_invite_for_account[\s\S]*to service_role/i);
});

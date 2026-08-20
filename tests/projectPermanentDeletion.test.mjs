import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getProjectStoragePrefixes,
  parseProjectPermanentDeletionConfirmation,
  PROJECT_PERMANENT_DELETE_CONFIRMATION_PHRASE
} from "../lib/projectDeletion/core.ts";
import {
  inventoryStorageObjects,
  removeStorageObjects
} from "../lib/projectDeletion/storage.ts";

const readSource = (pathname) => readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
const projectId = "11111111-1111-4111-8111-111111111111";

test("permanent deletion accepts only the exact two-field confirmation", () => {
  assert.equal(PROJECT_PERMANENT_DELETE_CONFIRMATION_PHRASE, "영구 삭제");
  assert.deepEqual(parseProjectPermanentDeletionConfirmation({
    projectName: "  하부장의 개구리  ",
    confirmationPhrase: "영구 삭제"
  }), {
    projectName: "하부장의 개구리",
    confirmationPhrase: "영구 삭제"
  });
  assert.equal(parseProjectPermanentDeletionConfirmation({
    projectName: "하부장의 개구리",
    confirmationPhrase: "영구삭제"
  }), null);
  assert.equal(parseProjectPermanentDeletionConfirmation({
    projectName: "하부장의 개구리",
    confirmationPhrase: "영구 삭제",
    ownerId: projectId
  }), null);
  assert.equal(parseProjectPermanentDeletionConfirmation({
    projectName: " ",
    confirmationPhrase: "영구 삭제"
  }), null);

  // Deletion must remain possible for every legacy text value currently in DB.
  const longLegacyName = "가".repeat(2_001);
  assert.equal(parseProjectPermanentDeletionConfirmation({
    projectName: longLegacyName,
    confirmationPhrase: "영구 삭제"
  })?.projectName, longLegacyName);
});

test("storage namespaces are exact Project UUID prefixes, never project names", () => {
  assert.deepEqual(getProjectStoragePrefixes(projectId), [
    `projects/${projectId}`,
    `storyboard-files/${projectId}`
  ]);
});

test("storage inventory recursively paginates both namespaces", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: `object-${index}`,
    name: `file-${String(index).padStart(3, "0")}.png`
  }));
  const calls = [];
  const storage = {
    async list(path, options) {
      calls.push([path, options.offset]);
      if (path === `projects/${projectId}` && options.offset === 0) {
        return { data: firstPage, error: null };
      }
      if (path === `projects/${projectId}` && options.offset === 100) {
        return { data: [{ id: "object-100", name: "last.png" }], error: null };
      }
      if (path === `storyboard-files/${projectId}`) {
        return { data: [{ id: null, name: "nested" }], error: null };
      }
      if (path === `storyboard-files/${projectId}/nested`) {
        return { data: [{ id: "legacy-object", name: "legacy.jpg" }], error: null };
      }
      return { data: [], error: null };
    },
    async remove() {
      return { data: null, error: null };
    }
  };

  const paths = await inventoryStorageObjects(storage, getProjectStoragePrefixes(projectId));
  assert.equal(paths.length, 102);
  assert.ok(paths.includes(`projects/${projectId}/last.png`));
  assert.ok(paths.includes(`storyboard-files/${projectId}/nested/legacy.jpg`));
  assert.deepEqual(calls.slice(0, 2), [
    [`projects/${projectId}`, 0],
    [`projects/${projectId}`, 100]
  ]);
});

test("storage removal is bounded to 100 paths and retries a failed batch twice", async () => {
  const calls = [];
  let failuresRemaining = 2;
  const storage = {
    async list() {
      return { data: [], error: null };
    },
    async remove(paths) {
      calls.push([...paths]);
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        return { data: null, error: { message: "transient" } };
      }
      return { data: [], error: null };
    }
  };
  const paths = Array.from({ length: 205 }, (_, index) => `projects/${projectId}/${index}`);
  await removeStorageObjects(storage, paths);
  assert.deepEqual(calls.map((batch) => batch.length), [100, 100, 100, 100, 5]);
});

test("canonical DELETE authenticates Google first and never trusts a client owner", () => {
  const route = readSource("app/api/projects/[projectId]/route.ts");
  const handler = route.slice(route.indexOf("export async function DELETE"));
  const authenticateAt = handler.indexOf("resolveAuthenticatedGoogleAccount(");
  const parseAt = handler.indexOf("parseProjectPermanentDeletionConfirmation(");
  const destroyAt = handler.indexOf("permanentlyDeleteProject({");
  assert.ok(authenticateAt >= 0 && authenticateAt < parseAt && parseAt < destroyAt);
  assert.match(handler, /ownerUserId: account\.userId/u);
  assert.match(handler, /confirmedProjectName: confirmation\.projectName/u);
  assert.match(handler, /isSameOriginJsonRequest\(request\)/u);
  assert.match(handler, /if \(!account\.isEditor\)/u);
  assert.doesNotMatch(handler, /confirmation\.owner|body\.owner|email\s*===/u);
  assert.match(route, /export const runtime = "nodejs"/u);
  assert.match(route, /export const dynamic = "force-dynamic"/u);
  assert.match(route, /export const maxDuration = 60/u);
});

test("root GET distinguishes a deletion lock and success clears both scoped cookies", () => {
  const route = readSource("app/api/projects/[projectId]/route.ts");
  const getHandler = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function DELETE"));
  assert.match(getHandler, /deletion_started_at/u);
  assert.match(getHandler, /PROJECT_DELETING/u);
  assert.match(getHandler, /status: 410/u);
  assert.ok(getHandler.indexOf("PROJECT_DELETING") < getHandler.indexOf("getAccessGrant("));

  const deleteHandler = route.slice(route.indexOf("export async function DELETE"));
  assert.match(deleteHandler, /if \(clearGuestInvite\)[\s\S]*clearProjectGuestInviteCookie/u);
  assert.match(deleteHandler, /if \(progressTarget\?\.projectId === projectId\)[\s\S]*clearProjectGuestProgressTargetCookie/u);
  assert.doesNotMatch(deleteHandler, /else if \(progressTarget/u);
});

test("server workflow inventories before lock, verifies post-lock empty, then atomically purges", () => {
  const server = readSource("lib/projectDeletion/server.ts");
  const preflightAt = server.indexOf("let pendingStoragePaths = await inventoryProjectStorageObjects");
  const beginAt = server.indexOf('"begin_project_permanent_deletion"');
  const saveAt = server.indexOf("const inventorySaved = await saveDeletionInventory");
  const removeAt = server.indexOf("await deleteProjectStorageObjects");
  const finalSaveAt = server.indexOf("const finalInventorySaved = await saveDeletionInventory");
  const purgeAt = server.indexOf('"purge_project_permanently"');
  assert.ok(preflightAt >= 0 && preflightAt < beginAt && beginAt < saveAt);
  assert.ok(saveAt < removeAt && removeAt < finalSaveAt && finalSaveAt < purgeAt);
  assert.match(server, /pendingStoragePaths = await inventoryProjectStorageObjects[\s\S]*pendingStoragePaths\.length === 0/u);
  assert.match(server, /storage_verified_at: verifiedEmpty \? new Date\(\)\.toISOString\(\) : null/u);
  assert.match(server, /isProjectPermanentlyAbsent[\s\S]*from\("projects"\)[\s\S]*from\("project_deletion_jobs"\)/u);
  assert.doesNotMatch(server, /\.eq\("name"|normalized_name/u);
});

test("migration enforces immutable creator, lock serialization, verified storage, and exact purge", () => {
  const sql = readSource("supabase/migration_project_permanent_deletion.sql");
  assert.match(sql, /projects_immutable_creator[\s\S]*before update of created_by/u);
  assert.match(sql, /project creator is immutable/u);
  assert.match(sql, /projects_permanent_deletion_lock[\s\S]*before insert or update or delete/u);
  assert.match(sql, /new\.deletion_started_at is not null[\s\S]*project deletion lock is server-controlled/u);
  assert.match(sql, /purge_started_at is not null/u);
  assert.match(sql, /storage_verified_at is null[\s\S]*project storage was not verified after locking/u);
  assert.match(sql, /project_deletion_guard_writes before insert or update or delete/u);
  assert.ok((sql.match(/pg_advisory_xact_lock\(/gu) ?? []).length >= 5);
  assert.match(sql, /UPDATE checks both OLD and NEW scopes in deterministic UUID order/u);
  assert.match(sql, /cross-project rename locks both UUIDs in deterministic order/u);
  assert.match(sql, /before insert or update on storage\.objects/u);
  assert.match(sql, /jsonb_build_array\(to_jsonb\(old\)\)/u);
  assert.match(sql, /revoke delete on table public\.projects from public, anon, authenticated/u);
  assert.match(sql, /drop policy if exists "projects_select_own_authenticated"/u);
  assert.match(sql, /revoke all on function public\.begin_project_permanent_deletion[\s\S]*to service_role/u);
  assert.match(sql, /revoke all on function public\.purge_project_permanently[\s\S]*to service_role/u);
  assert.doesNotMatch(sql, /delete from auth\.users|delete from public\.profiles|delete from public\.shotcl_/iu);
});

test("migration covers every audited project table without disabling UUID indexes", () => {
  const sql = readSource("supabase/migration_project_permanent_deletion.sql");
  for (const table of [
    "project_members",
    "storyboard_files",
    "daily_plans",
    "daily_plan_shots",
    "daily_plan_staff_members",
    "analysis_runs",
    "analysis_run_items",
    "shots",
    "project_basic_info",
    "project_calendar_events",
    "project_reference_assets",
    "project_costume_scenes",
    "project_costumes",
    "project_archive_folders",
    "project_staff_members",
    "project_staff_departments",
    "project_scene_items",
    "project_scene_notes",
    "shot_diagrams",
    "project_access_credentials",
    "project_access_sessions",
    "project_access_attempts",
    "project_staff_invites"
  ]) {
    assert.match(sql, new RegExp(`'${table}'`, "u"), `${table} must be in the fixed audit list`);
  }
  assert.match(sql, /shot_status_logs[\s\S]*shots where project_id = \$1/u);
  assert.doesNotMatch(sql, /project_id::text = \$1/u);
  assert.match(sql, /project_scene_items'[\s\S]*project_scene_notes'[\s\S]*shot_diagrams'[\s\S]*using p_project_id::text/u);
  assert.match(sql, /delete from public\.projects[\s\S]*delete from public\.project_deletion_jobs/u);
});

test("Realtime deletion wakeups use one existing channel plus fail-closed probes", () => {
  const sql = readSource("supabase/migration_project_permanent_deletion.sql");
  const server = readSource("lib/projectDeletion/server.ts");
  const stream = readSource("app/api/projects/[projectId]/progress-events/route.ts");
  assert.match(sql, /project_deletion_events[\s\S]*primary key \(project_id, user_id\)/u);
  assert.match(sql, /user_id = auth\.uid\(\)/u);
  assert.match(sql, /realtime\.topic\(\) = 'progress-project:' \|\| member\.project_id::text[\s\S]*project\.deletion_started_at is null/u);
  assert.match(sql, /select p_owner_user_id as user_id[\s\S]*select member\.user_id/u);
  assert.match(sql, /alter publication supabase_realtime add table public\.project_deletion_events/u);
  assert.match(server, /channel\(`progress-project:\$\{projectId\}`, \{[\s\S]*private: true[\s\S]*event: "project-deleted"/u);
  assert.match(stream, /channel\(`progress-project:\$\{projectId\}`, \{[\s\S]*private: true/u);
  assert.match(stream, /"broadcast"[\s\S]*event: "project-deleted"[\s\S]*event: project-access-check/u);
  assert.match(stream, /event: "INSERT"[\s\S]*table: "project_deletion_events"[\s\S]*event: "UPDATE"/u);
  assert.equal((stream.match(/\.channel\(/gu) ?? []).length, 1);
});

test("same-name recreation cannot inherit old access attempts and creation is transactional", () => {
  const access = readSource("lib/projectAccess/server.ts");
  const join = readSource("app/api/projects/join/route.ts");
  const create = readSource("app/api/projects/create/route.ts");
  const sql = readSource("supabase/migration_project_permanent_deletion.sql");

  assert.match(access, /missing-project-name:\$\{normalizedProjectName\}/u);
  assert.match(access, /project-join:\$\{databaseProjectId\}/u);
  assert.ok(join.indexOf('.from("projects")') < join.indexOf("getProjectJoinAttemptKey("));
  assert.match(join, /project\s*\?[\s\S]*getProjectJoinAttemptKey\(request, project\.id\)[\s\S]*getJoinAttemptKey/u);
  assert.match(join, /recordJoinFailure\(attemptKey, project\.id\)/u);
  assert.match(sql, /project_access_attempts add column if not exists project_id uuid/u);
  assert.match(sql, /project_access_attempts_project_id_fkey[\s\S]*on delete cascade/u);
  assert.match(sql, /project_access_attempts_project_id_idx/u);

  assert.match(create, /rpc\([\s\S]*"create_project_with_access"/u);
  assert.doesNotMatch(create, /from\("projects"\)\.delete|from\("project_access_credentials"\)\.insert/u);
  assert.match(sql, /create or replace function public\.create_project_with_access[\s\S]*insert into public\.projects[\s\S]*insert into public\.project_access_credentials[\s\S]*insert into public\.project_members/u);
  assert.match(sql, /revoke all on function public\.create_project_with_access[\s\S]*grant execute[\s\S]*to service_role/u);
});

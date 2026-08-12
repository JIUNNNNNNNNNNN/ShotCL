import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  normalizeTrustedGoogleIdentity
} from "../lib/projectAccess/accountCore.ts";
import {
  resolveLiveProjectCapability
} from "../lib/projectAccess/clientCapability.ts";
import { isGuestProjectApiRequestAllowed } from "../lib/projectAccess/guestApiAccess.ts";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(repoRoot);

function readSource(pathname) {
  return readFileSync(join(projectRoot, pathname), "utf8");
}

function listSourceFiles(pathname) {
  const absoluteRoot = join(projectRoot, pathname);
  const files = [];
  const visit = (absolutePath) => {
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      const child = join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        visit(child);
      } else if (/\.(?:ts|tsx)$/u.test(entry.name)) {
        files.push(relative(projectRoot, child).split(sep).join("/"));
      }
    }
  };
  visit(absoluteRoot);
  return files.sort();
}

function countMatches(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

const appSources = listSourceFiles("app");
const componentSources = listSourceFiles("components");
const librarySources = listSourceFiles("lib");
const productSources = [...appSources, ...componentSources, ...librarySources];
const projectPageSources = appSources.filter((pathname) => (
  pathname.startsWith("app/projects/[id]/") && pathname.endsWith("/page.tsx")
));

test("root auth and project access each have one persistent layout owner", () => {
  const authProviderMounts = appSources
    .filter((pathname) => pathname.endsWith("layout.tsx"))
    .map((pathname) => [
      pathname,
      countMatches(readSource(pathname), /<AuthSessionProvider(?:\s|>)/gu)
    ])
    .filter(([, count]) => count > 0);
  assert.deepEqual(authProviderMounts, [["app/layout.tsx", 1]]);

  const projectLayout = readSource("app/projects/[id]/layout.tsx");
  assert.equal(countMatches(projectLayout, /<ProjectAccessGate(?:\s|>)/gu), 1);

  const projectGate = readSource("components/ProjectAccessGate.tsx");
  assert.equal(countMatches(projectGate, /<ProjectWorkspaceProvider(?:\s|>)/gu), 1);
  assert.equal(countMatches(projectLayout, /<ProjectWorkspaceProvider(?:\s|>)/gu), 0);
});

test("auth bootstrap keys only on Guest-project scope and project pages reuse the layout snapshot", () => {
  const authProvider = readSource("components/AuthSessionProvider.tsx");
  assert.match(authProvider, /const guestProjectRoute = \/\^\\\/projects/u);

  const authEffectStart = authProvider.indexOf("useEffect(() => {");
  const refreshAccountStart = authProvider.indexOf("const refreshAccount", authEffectStart);
  assert.ok(authEffectStart >= 0 && refreshAccountStart > authEffectStart);
  const authEffect = authProvider.slice(authEffectStart, refreshAccountStart);
  assert.doesNotMatch(authEffect, /\bpathname\b/u);
  assert.match(authEffect, /\}, \[applySession, guestProjectRoute\]\);/u);

  const directProjectReads = projectPageSources
    .map((pathname) => [
      pathname,
      countMatches(readSource(pathname), /\bgetProject\s*\(\s*projectId\s*\)/gu)
    ])
    .filter(([, count]) => count > 0);
  assert.deepEqual(directProjectReads, []);

  const workspace = readSource("components/ProjectWorkspaceContext.tsx");
  assert.equal(countMatches(workspace, /\bgetProject\s*\(/gu), 0);
  assert.match(workspace, /initialWorkspace\.project/u);

  const projectLayout = readSource("app/projects/[id]/layout.tsx");
  assert.equal(
    countMatches(projectLayout, /await loadInitialProjectWorkspace\s*\(\s*projectId\b/gu),
    1
  );
  const projectGate = readSource("components/ProjectAccessGate.tsx");
  assert.equal(countMatches(projectGate, /initialWorkspace=\{initialWorkspace\}/gu), 1);
});

test("session and canonical-user lookups stay inside their declared owners", () => {
  const allowedGetSessionOwners = new Set([
    "app/auth/callback/page.tsx",
    "components/AuthSessionProvider.tsx",
    "lib/supabase/client.ts"
  ]);
  const unexpectedGetSession = productSources
    .map((pathname) => [
      pathname,
      countMatches(readSource(pathname), /\.auth\.getSession\s*\(/gu)
    ])
    .filter(([pathname, count]) => count > 0 && !allowedGetSessionOwners.has(pathname));
  assert.deepEqual(unexpectedGetSession, []);

  const canonicalUserReads = productSources
    .map((pathname) => [
      pathname,
      countMatches(readSource(pathname), /\.auth\.getUser\s*\(/gu)
    ])
    .filter(([, count]) => count > 0);
  assert.deepEqual(canonicalUserReads, [["lib/projectAccess/accountServer.ts", 1]]);
});

test("same-project navigation never forces a refresh or hard document navigation", () => {
  const refreshOwners = productSources
    .map((pathname) => [
      pathname,
      countMatches(readSource(pathname), /\brouter\.refresh\s*\(/gu)
    ])
    .filter(([, count]) => count > 0);
  assert.deepEqual(refreshOwners, []);

  // The account invite bridge is not same-project navigation: it must apply the
  // same-origin POST response's linked-membership cookies before entering the
  // project document. Ordinary project UI navigation stays soft.
  const allowedHardNavigationOwners = new Set(["app/invite/[token]/route.ts"]);
  const hardNavigationOwners = productSources
    .map((pathname) => [
      pathname,
      countMatches(
        readSource(pathname),
        /(?:\bwindow\.)?\blocation\.(?:assign|replace)\s*\(|(?:\bwindow\.)?\blocation\.href\s*=/gu
      )
    ])
    .filter(([pathname, count]) => count > 0 && !allowedHardNavigationOwners.has(pathname));
  assert.deepEqual(hardNavigationOwners, []);
});

test("token refresh reuses the account snapshot but identity, eligibility, and logout changes invalidate it", async () => {
  const {
    shouldAdvanceAccountGeneration,
    shouldUseBackgroundAccountSync
  } = await import("../lib/auth/sessionTransition.ts");

  const backgroundInput = {
    authEvent: "TOKEN_REFRESHED",
    requestedProjectId: null,
    synchronizedProjectId: null,
    synchronizedUserId: "user-1",
    nextUserId: "user-1",
    previousEditorEligible: true
  };
  assert.equal(shouldUseBackgroundAccountSync(backgroundInput), true);
  assert.equal(shouldUseBackgroundAccountSync({
    ...backgroundInput,
    requestedProjectId: "project-1",
    synchronizedProjectId: "project-1"
  }), true);
  assert.equal(shouldUseBackgroundAccountSync({
    ...backgroundInput,
    requestedProjectId: "project-2"
  }), false);
  assert.equal(shouldUseBackgroundAccountSync({
    ...backgroundInput,
    nextUserId: "user-2"
  }), false);
  assert.equal(shouldUseBackgroundAccountSync({
    ...backgroundInput,
    previousEditorEligible: null
  }), false);

  assert.equal(shouldAdvanceAccountGeneration({
    background: true,
    previousUserId: "user-1",
    nextUserId: "user-1",
    previousEditorEligible: true,
    nextEditorEligible: true
  }), false);
  assert.equal(shouldAdvanceAccountGeneration({
    background: true,
    previousUserId: "user-1",
    nextUserId: "user-1",
    previousEditorEligible: true,
    nextEditorEligible: false
  }), true);
  assert.equal(shouldAdvanceAccountGeneration({
    background: true,
    previousUserId: "user-1",
    nextUserId: "user-2",
    previousEditorEligible: true,
    nextEditorEligible: true
  }), true);
  assert.equal(shouldAdvanceAccountGeneration({
    background: true,
    previousUserId: "user-1",
    nextUserId: "",
    previousEditorEligible: true,
    nextEditorEligible: false
  }), true);
  assert.equal(shouldAdvanceAccountGeneration({
    background: false,
    previousUserId: "user-1",
    nextUserId: "user-1",
    previousEditorEligible: true,
    nextEditorEligible: true
  }), true);
});

test("all project mutation routes retain an explicit server access guard", () => {
  const guardedMutationRoutes = new Map([
    ["app/api/projects/[projectId]/access/route.ts", /\bgetProjectRequestAccountAccess\s*\(/u],
    ["app/api/projects/[projectId]/archive-folders/route.ts", /\bgetMaterialRole\s*\(/u],
    ["app/api/projects/[projectId]/basic-info/route.ts", /\bcanAdministerProject\s*\(/u],
    ["app/api/projects/[projectId]/calendar-events/route.ts", /\brequireCalendarEditAccess\s*\(/u],
    ["app/api/projects/[projectId]/costume-scenes/route.ts", /\bgetMaterialRole\s*\(/u],
    ["app/api/projects/[projectId]/costumes/route.ts", /\bgetMaterialRole\s*\(/u],
    ["app/api/projects/[projectId]/daily-plans/[dailyPlanId]/gathering-photos/route.ts", /\bgetProjectRequestRole\s*\(/u],
    ["app/api/projects/[projectId]/daily-plans/[dailyPlanId]/route.ts", /\bgetAccessGrant\s*\(/u],
    ["app/api/projects/[projectId]/daily-plans/[dailyPlanId]/staff-list/route.ts", /\bredirectToProjectStaffRoute\s*\(/u],
    ["app/api/projects/[projectId]/daily-plans/route.ts", /\bgetAccessGrant\s*\(/u],
    ["app/api/projects/[projectId]/reference-assets/route.ts", /\bgetMaterialRole\s*\(/u],
    ["app/api/projects/[projectId]/schedule-images/route.ts", /\brequireAdminProject\s*\(/u],
    ["app/api/projects/[projectId]/scene-list/route.ts", /\brequireWriteScope\s*\(/u],
    ["app/api/projects/[projectId]/shot-diagrams/route.ts", /\bgetDiagramAccessRole\s*\(/u],
    ["app/api/projects/[projectId]/shots/[shotId]/move/route.ts", /\bgetAccessGrant\s*\(/u],
    ["app/api/projects/[projectId]/shots/[shotId]/route.ts", /\bgetAccessGrant\s*\(/u],
    ["app/api/projects/[projectId]/shots/[shotId]/status/route.ts", /\bgetProjectRequestAccess\s*\(/u],
    ["app/api/projects/[projectId]/shots/reorder/route.ts", /\bgetAccessGrant\s*\(/u],
    ["app/api/projects/[projectId]/shots/route.ts", /\bgetAccessGrant\s*\(/u],
    ["app/api/projects/[projectId]/staff-invite/route.ts", /\brequireInviteAdmin\s*\(/u],
    ["app/api/projects/[projectId]/staff-list/route.ts", /\brequireAdminScope\s*\(/u],
    ["app/api/projects/[projectId]/storyboard-files/route.ts", /\brequireAdmin\s*\(/u]
  ]);
  const mutationRoutes = appSources.filter((pathname) => (
    pathname.startsWith("app/api/projects/[projectId]/")
      && pathname.endsWith("/route.ts")
      && /export async function (?:POST|PUT|PATCH|DELETE)\b/u.test(readSource(pathname))
  ));
  assert.deepEqual(mutationRoutes, [...guardedMutationRoutes.keys()].sort());

  for (const [pathname, guardPattern] of guardedMutationRoutes) {
    const source = readSource(pathname);
    const handlerStarts = [...source.matchAll(/export async function (POST|PUT|PATCH|DELETE)\b/gu)];
    for (let index = 0; index < handlerStarts.length; index += 1) {
      const start = handlerStarts[index].index;
      const end = handlerStarts[index + 1]?.index ?? source.length;
      assert.match(
        source.slice(start, end),
        guardPattern,
        `${pathname} ${handlerStarts[index][1]} must call its server access guard`
      );
    }
  }
});

test("server access envelopes reuse one canonical account lookup and its authorized project snapshot", () => {
  const accessRoute = readSource("app/api/projects/[projectId]/access/route.ts");
  const postStart = accessRoute.indexOf("export async function POST");
  const postEnd = accessRoute.indexOf("function upgradeJson", postStart);
  assert.ok(postStart >= 0 && postEnd > postStart);
  const postHandler = accessRoute.slice(postStart, postEnd);
  assert.equal(countMatches(postHandler, /\bgetProjectRequestAccountAccess\s*\(/gu), 1);
  assert.doesNotMatch(postHandler, /\bresolveShotclAuthenticatedAccount\s*\(/u);
  assert.doesNotMatch(postHandler, /\bgetAccessGrant\s*\(/u);

  const calendarRoute = readSource("app/api/projects/[projectId]/calendar-events/route.ts");
  assert.doesNotMatch(calendarRoute, /\.auth\.getUser\s*\(/u);
  assert.match(calendarRoute, /created_by:\s*access\.accountUserId/u);
  assert.match(
    calendarRoute,
    /access\.mode !== "member"[\s\S]*!access\.editorEligible[\s\S]*!access\.accountUserId/u
  );

  const accessServer = readSource("lib/projectAccess/server.ts");
  assert.match(
    accessServer,
    /export type ProjectRequestAccess = \{[\s\S]*project\?: ProjectRequestProjectSnapshot;[\s\S]*\};/u
  );
  assert.match(
    accessServer,
    /\.select\("id,name,shoot_date,description,created_at,share_enabled,created_by"\)/u
  );
  const memberAccessStart = accessServer.indexOf("if (project && role)");
  const projectSnapshotStart = accessServer.indexOf("project: {", memberAccessStart);
  const projectSnapshotEnd = accessServer.indexOf("grant: {", projectSnapshotStart);
  assert.ok(
    memberAccessStart >= 0
      && projectSnapshotStart > memberAccessStart
      && projectSnapshotEnd > projectSnapshotStart
  );
  const projectSnapshot = accessServer.slice(projectSnapshotStart, projectSnapshotEnd);
  for (const field of ["id", "name", "shoot_date", "description", "created_at", "share_enabled"]) {
    assert.match(
      projectSnapshot,
      new RegExp(`\\b${field}:`, "u"),
      `member project snapshot must include ${field}`
    );
  }

  const projectLayout = readSource("app/projects/[id]/layout.tsx");
  assert.match(
    projectLayout,
    /loadInitialProjectWorkspace\([\s\S]*access\.project[\s\S]*\);/u
  );
  assert.match(
    projectLayout,
    /accessProject\s*\?\s*Promise\.resolve\(\{ data: accessProject, error: null \}\)\s*:\s*supabase/u
  );
});

test("guest reads remain narrowly scoped and all guest mutations are denied", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const request = (method, pathname, query = "") => isGuestProjectApiRequestAllowed({
    method,
    pathname,
    projectId,
    searchParams: new URLSearchParams(query)
  });

  assert.equal(request("GET", `/api/projects/${projectId}`), true);
  assert.equal(request("GET", `/api/projects/${projectId}/daily-plans`), true);
  assert.equal(request("GET", `/api/projects/${projectId}/shots`, "dailyPlanId=day-1"), true);
  assert.equal(request("GET", `/api/projects/${projectId}/shots`), false);
  assert.equal(request("GET", `/api/projects/${projectId}/staff-list`), false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(request(method, `/api/projects/${projectId}`), false);
    assert.equal(request(method, `/api/projects/${projectId}/shots`, "dailyPlanId=day-1"), false);
  }
});

test("client capability is fail-closed and linked Google proof cannot use the primary provider alone", () => {
  const linkedIdentity = {
    id: "user-1",
    email: "editor@example.com",
    emailConfirmedAt: "2026-08-12T00:00:00.000Z",
    provider: "email",
    identities: [{
      provider: "google",
      identity_data: { email: "editor@example.com", email_verified: true }
    }]
  };
  assert.ok(normalizeTrustedGoogleIdentity(linkedIdentity));
  assert.equal(normalizeTrustedGoogleIdentity({
    ...linkedIdentity,
    provider: "google",
    identities: undefined
  }), null);

  const memberInput = {
    accessMode: "member",
    scopedRole: "admin",
    serverAccountUserId: "user-1",
    liveAccountUserId: "user-1",
    isGoogle: true,
    liveAccountEditorEligible: true
  };
  assert.deepEqual(resolveLiveProjectCapability({
    ...memberInput,
    accountStatus: "authenticated"
  }), { role: "admin", editorEligible: true });
  for (const accountStatus of ["loading", "syncing", "error", "unavailable"]) {
    assert.deepEqual(resolveLiveProjectCapability({
      ...memberInput,
      accountStatus
    }), { role: "progress", editorEligible: false });
  }
  assert.deepEqual(resolveLiveProjectCapability({
    ...memberInput,
    accountStatus: "anonymous"
  }), { role: null, editorEligible: false });
  assert.deepEqual(resolveLiveProjectCapability({
    ...memberInput,
    accountStatus: "authenticated",
    liveAccountUserId: "user-2"
  }), { role: null, editorEligible: false });
});

test("account tables and project mutations remain protected by RLS contracts", () => {
  const sql = readSource("supabase/migration_shotcl_account_access.sql");
  for (const table of ["shotcl_editor_accounts", "shotcl_account_sessions"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "iu"));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "iu"));
    assert.match(sql, new RegExp(`grant select, insert, update, delete on public\\.${table} to service_role`, "iu"));
  }
  for (const policy of [
    "projects_insert_authenticated",
    "projects_update_admins",
    "projects_delete_admins",
    "project_members_manage_admins",
    "shots_update_editor_admins"
  ]) {
    const policyStart = sql.indexOf(`create policy "${policy}"`);
    assert.ok(policyStart >= 0, `${policy} policy must remain declared`);
    const nextPolicy = sql.indexOf("create policy ", policyStart + 1);
    const policySql = sql.slice(policyStart, nextPolicy >= 0 ? nextPolicy : sql.length);
    assert.match(policySql, /public\.is_shotcl_editor\(\)/iu);
    if (policy !== "projects_insert_authenticated") {
      assert.match(policySql, /public\.is_project_admin\(/iu);
    }
  }
});

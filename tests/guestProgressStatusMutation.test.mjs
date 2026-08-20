import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isGuestProgressStatusTransitionAllowed,
  isGuestProjectApiRequestAllowed,
  parseProgressStatusMutationPayload
} from "../lib/projectAccess/guestApiAccess.ts";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const SHOT_A = "33333333-3333-4333-8333-333333333333";

const readSource = (pathname) => readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
const statusRouteSource = readSource("app/api/projects/[projectId]/shots/[shotId]/status/route.ts");
const shotsClientSource = readSource("lib/data/shots.ts");
const accessServerSource = readSource("lib/projectAccess/server.ts");
const inviteServerSource = readSource("lib/projectStaffInvites.server.ts");

function guestRequest(method, pathname, projectId = PROJECT_A, query = "") {
  return isGuestProjectApiRequestAllowed({
    method,
    pathname,
    projectId,
    searchParams: new URLSearchParams(query)
  });
}

test("Guest capability permits only the exact scoped PATCH status route", () => {
  const statusPath = `/api/projects/${PROJECT_A}/shots/${SHOT_A}/status`;
  assert.equal(guestRequest("PATCH", statusPath), true);
  assert.equal(guestRequest("PATCH", `${statusPath}/`), true);
  assert.equal(guestRequest("PATCH", statusPath, PROJECT_A, "extra=1"), false);
  assert.equal(guestRequest("PATCH", `/api/projects/${PROJECT_A}/shots/not-a-uuid/status`), false);
  assert.equal(guestRequest("PATCH", `/api/projects/${PROJECT_B}/shots/${SHOT_A}/status`), false);
  assert.equal(guestRequest("PATCH", `/api/projects/${PROJECT_A}/shots/${SHOT_A}`), false);
  assert.equal(guestRequest("POST", statusPath), false);
  assert.equal(guestRequest("PUT", statusPath), false);
  assert.equal(guestRequest("DELETE", statusPath), false);
  assert.equal(guestRequest("POST", `/api/projects/${PROJECT_A}/shots/reorder`), false);
});

test("status payload is an exact one-field allowlist", () => {
  assert.equal(parseProgressStatusMutationPayload({ status: "ok" }), "ok");
  assert.equal(parseProgressStatusMutationPayload({ status: "omit" }), "omit");
  assert.equal(parseProgressStatusMutationPayload({ status: "pending" }), "pending");
  assert.equal(parseProgressStatusMutationPayload({ status: "shooting" }), null);
  assert.equal(parseProgressStatusMutationPayload({ status: "ok", description: "attack" }), null);
  assert.equal(parseProgressStatusMutationPayload({ status: "omit", orderIndex: 1 }), null);
  assert.equal(parseProgressStatusMutationPayload({ status: "ok", media: [] }), null);
  assert.equal(parseProgressStatusMutationPayload({}), null);
  assert.equal(parseProgressStatusMutationPayload(null), null);
  assert.equal(parseProgressStatusMutationPayload(["ok"]), null);
});

test("Guest supports OK, OMIT, and only canonical terminal-status reset", () => {
  assert.equal(isGuestProgressStatusTransitionAllowed("pending", "ok"), true);
  assert.equal(isGuestProgressStatusTransitionAllowed("pending", "omit"), true);
  assert.equal(isGuestProgressStatusTransitionAllowed("ok", "omit"), true);
  assert.equal(isGuestProgressStatusTransitionAllowed("omit", "ok"), true);
  assert.equal(isGuestProgressStatusTransitionAllowed("ok", "pending"), true);
  assert.equal(isGuestProgressStatusTransitionAllowed("omit", "pending"), true);
  assert.equal(isGuestProgressStatusTransitionAllowed("pending", "pending"), false);
  assert.equal(isGuestProgressStatusTransitionAllowed("shooting", "pending"), false);
});

test("status route revalidates invite access and scopes both ownership reads and writes", () => {
  const accessIndex = statusRouteSource.indexOf("await getProjectRequestAccess(request, projectId)");
  const databaseIndex = statusRouteSource.indexOf("requireProjectAccessDb()");
  assert.ok(accessIndex >= 0 && databaseIndex > accessIndex);
  assert.match(statusRouteSource, /isValidDatabaseProjectId\(shotId\)/u);
  assert.match(statusRouteSource, /access\?\.mode === "guest"/u);
  assert.match(
    statusRouteSource,
    /from\("shots"\)\.select\("id,status"\)\.eq\("id", shotId\)\.eq\("project_id", projectId\)/u
  );
  assert.match(
    statusRouteSource,
    /from\("shots"\)\.update\(\{ status \}\)\.eq\("id", shotId\)\.eq\("project_id", projectId\)/u
  );
  assert.doesNotMatch(statusRouteSource, /update\(body\)|update\(\{\s*\.\.\.|upsert\(/u);

  assert.match(
    accessServerSource,
    /access\?\.mode === "guest" && !isGuestProjectApiRequestAllowed\([\s\S]*access = null/u
  );
  assert.match(
    accessServerSource,
    /const invite = await inspectProjectStaffInvite\(rawInviteToken\)[\s\S]*invite\?\.projectId === databaseProjectId/u
  );
  const inspectStart = inviteServerSource.indexOf("export async function inspectProjectStaffInvite");
  const inspectEnd = inviteServerSource.indexOf("export async function redeemProjectStaffInvite", inspectStart);
  const inspectSource = inviteServerSource.slice(inspectStart, inspectEnd);
  assert.match(inspectSource, /\.is\("revoked_at", null\)/u);
  assert.match(inspectSource, /\.eq\("projects\.share_enabled", true\)/u);
});

test("Guest client status persistence is API-only and cannot fall back to browser writes", () => {
  const start = shotsClientSource.indexOf("export async function updateShotStatus");
  const end = shotsClientSource.indexOf("export async function deleteAllShots", start);
  assert.ok(start >= 0 && end > start);
  const updateStatusSource = shotsClientSource.slice(start, end);
  assert.match(updateStatusSource, /options: \{ apiOnly\?: boolean \} = \{\}/u);
  assert.match(updateStatusSource, /if \(options\.apiOnly\) \{[\s\S]*throw new Error/u);
  assert.match(updateStatusSource, /catch \(error\) \{[\s\S]*if \(options\.apiOnly\)[\s\S]*throw error/u);
  const apiOnlyGuard = updateStatusSource.lastIndexOf("if (options.apiOnly)");
  const fallbackClient = updateStatusSource.indexOf("loadFallbackSupabaseClient()", apiOnlyGuard);
  assert.ok(apiOnlyGuard >= 0 && fallbackClient > apiOnlyGuard);
  assert.doesNotMatch(updateStatusSource.slice(0, apiOnlyGuard), /router\.refresh|listShots\(/u);
});

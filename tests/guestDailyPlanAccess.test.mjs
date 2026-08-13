import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isGuestProjectApiRequestAllowed } from "../lib/projectAccess/guestApiAccess.ts";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const DAILY_PLAN_A = "33333333-3333-4333-8333-333333333333";

const readSource = (pathname) => readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
const navigationSource = readSource("components/ProjectNavigation.tsx");
const navigationCoreSource = readSource("lib/projectNavigation.ts");
const gateSource = readSource("components/ProjectAccessGate.tsx");
const accessServerSource = readSource("lib/projectAccess/server.ts");
const inviteServerSource = readSource("lib/projectStaffInvites.server.ts");
const detailRouteSource = readSource("app/api/projects/[projectId]/daily-plans/[dailyPlanId]/route.ts");
const inviteLandingSource = readSource("app/invite/[token]/route.ts");

function request(method, pathname, projectId = PROJECT_A, query = "") {
  return isGuestProjectApiRequestAllowed({
    method,
    pathname,
    projectId,
    searchParams: new URLSearchParams(query)
  });
}

test("Guest Daily Plan pages allow only the collection and one UUID detail", () => {
  assert.match(navigationCoreSource, /export function isGuestDailyPlanReadPath/u);
  assert.match(navigationCoreSource, /normalizedPathname === dailyPlansPath/u);
  assert.match(navigationCoreSource, /!normalizedPathname\.startsWith\(`\$\{dailyPlansPath\}\/`\)/u);
  assert.match(navigationCoreSource, /encodedDailyPlanId\.includes\("\/"\)/u);
  assert.match(navigationCoreSource, /isValidDatabaseProjectId\(decodeURIComponent\(encodedDailyPlanId\)\)/u);
  assert.match(gateSource, /guestProgressRoute[\s\S]*isGuestDailyPlanReadPath\(pathname, projectId\)[\s\S]*\/scenario/u);
});

test("Guest Daily Plan API grants bounded GET and denies every mutation method", () => {
  const collection = `/api/projects/${PROJECT_A}/daily-plans`;
  const detail = `${collection}/${DAILY_PLAN_A}`;
  assert.equal(request("GET", collection), true);
  assert.equal(request("GET", detail), true);
  assert.equal(request("GET", collection, PROJECT_A, "expand=all"), false);
  assert.equal(request("GET", detail, PROJECT_A, "expand=all"), false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(request(method, collection), false);
    assert.equal(request(method, detail), false);
  }
  assert.match(
    accessServerSource,
    /access\?\.mode === "guest" && !isGuestProjectApiRequestAllowed\([\s\S]*access = null/u
  );
});

test("Project A capability cannot read a Project B route or an unscoped Daily Plan", () => {
  const foreignDetail = `/api/projects/${PROJECT_B}/daily-plans/${DAILY_PLAN_A}`;
  assert.equal(request("GET", foreignDetail, PROJECT_A), false);
  assert.match(detailRouteSource, /await getAccessGrant\(request, projectId\)/u);
  assert.match(
    detailRouteSource,
    /from\("daily_plans"\)[\s\S]*\.eq\("project_id", projectId\)\.eq\("id", dailyPlanId\)/u
  );
  assert.match(
    detailRouteSource,
    /from\("daily_plan_shots"\)[\s\S]*\.eq\("project_id", projectId\)\.eq\("daily_plan_id", dailyPlanId\)/u
  );
});

test("revoking an invite invalidates Guest Daily Plan access on the next request", () => {
  assert.match(
    accessServerSource,
    /const invite = await inspectProjectStaffInvite\(rawInviteToken\)[\s\S]*invite\?\.projectId === databaseProjectId/u
  );
  const inspectStart = inviteServerSource.indexOf("export async function inspectProjectStaffInvite");
  const inspectEnd = inviteServerSource.indexOf("export async function redeemProjectStaffInvite", inspectStart);
  assert.ok(inspectStart >= 0 && inspectEnd > inspectStart);
  const inspectSource = inviteServerSource.slice(inspectStart, inspectEnd);
  assert.match(inspectSource, /\.is\("revoked_at", null\)/u);
  assert.match(inspectSource, /\.eq\("projects\.share_enabled", true\)/u);
});

test("Guest menu is Progress, Daily Plan, Scenario and preserves a verified round", () => {
  const guestStart = navigationSource.indexOf("function GuestProjectNavigation");
  const guestEnd = navigationSource.indexOf("function GuestNavigationLink", guestStart);
  assert.ok(guestStart >= 0 && guestEnd > guestStart);
  const guestNavigation = navigationSource.slice(guestStart, guestEnd);
  const progressIndex = guestNavigation.indexOf('label="진행도"');
  const dailyPlanIndex = guestNavigation.indexOf('label="일촬표"');
  const scenarioIndex = guestNavigation.indexOf('label="시나리오"');
  assert.ok(progressIndex >= 0 && dailyPlanIndex > progressIndex && scenarioIndex > dailyPlanIndex);
  assert.match(guestNavigation, /plans\.some\(\(plan\) => plan\.id === requestedProgressPlanId\)/u);
  assert.match(guestNavigation, /lastGuestRoundIdRef\.current = explicitDailyPlanId/u);
  assert.match(guestNavigation, /plans\.some\(\(plan\) => plan\.id === initialProgressDailyPlanId\)/u);
  assert.match(guestNavigation, /resolveRelevantProgressRound/u);
  assert.match(guestNavigation, /buildDailyPlanRoundHref\(projectId, selectedDailyPlanId\)/u);
  assert.match(guestNavigation, /<RoundNavigationList[\s\S]*kind="dailyPlans"[\s\S]*canManage=\{false\}/u);
  assert.match(guestNavigation, /prefetch=\{false\}/u);
  assert.doesNotMatch(guestNavigation, /buildNewDailyPlanHref|onOpenContextMenu=\{openContextMenu\}/u);
});

test("Kakao invite still lands directly on Progress without a Home or Daily Plan redirect", () => {
  assert.match(inviteLandingSource, /buildProgressRoundHref\(invite\.projectId, target\.dailyPlanId\)/u);
  assert.match(inviteLandingSource, /buildProjectNavigationHref\(invite\.projectId, "progress"\)/u);
  assert.doesNotMatch(inviteLandingSource, /buildDailyPlanRoundHref|"dailyPlans"|\/basic-info/u);
});

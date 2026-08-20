import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hasLinkedGoogleIdentity,
  isShotclEditorGoogleEmail,
  normalizeTrustedGoogleIdentity,
  parseShotclEditorGoogleEmails,
  resolveEffectiveProjectRole
} from "../lib/projectAccess/accountCore.ts";
import { isGuestProjectApiRequestAllowed } from "../lib/projectAccess/guestApiAccess.ts";

const authSessionRouteSource = readFileSync(
  new URL("../app/api/auth/session/route.ts", import.meta.url),
  "utf8"
);
const accountServerSource = readFileSync(
  new URL("../lib/projectAccess/accountServer.ts", import.meta.url),
  "utf8"
);
const authProviderSource = readFileSync(
  new URL("../components/AuthSessionProvider.tsx", import.meta.url),
  "utf8"
);
const authCallbackSource = readFileSync(
  new URL("../app/auth/callback/page.tsx", import.meta.url),
  "utf8"
);
const projectJoinRouteSource = readFileSync(
  new URL("../app/api/projects/join/route.ts", import.meta.url),
  "utf8"
);
const projectCreateRouteSource = readFileSync(
  new URL("../app/api/projects/create/route.ts", import.meta.url),
  "utf8"
);
const projectAccessRouteSource = readFileSync(
  new URL("../app/api/projects/[projectId]/access/route.ts", import.meta.url),
  "utf8"
);
const dailyPlanDetailRouteSource = readFileSync(
  new URL("../app/api/projects/[projectId]/daily-plans/[dailyPlanId]/route.ts", import.meta.url),
  "utf8"
);
const mainPageSource = readFileSync(
  new URL("../app/page.tsx", import.meta.url),
  "utf8"
);
const projectNavigationSource = readFileSync(
  new URL("../components/ProjectNavigation.tsx", import.meta.url),
  "utf8"
);

test("server editor allowlist is normalized, deduplicated, and empty means nobody", () => {
  assert.deepEqual(parseShotclEditorGoogleEmails(undefined), []);
  assert.deepEqual(parseShotclEditorGoogleEmails("  \n  "), []);
  assert.deepEqual(
    parseShotclEditorGoogleEmails(" Editor@Example.com,staff@example.com\neditor@example.com "),
    ["editor@example.com", "staff@example.com"]
  );
  assert.equal(isShotclEditorGoogleEmail("EDITOR@example.com", ["editor@example.com"]), true);
  assert.equal(isShotclEditorGoogleEmail("editor@example.com", []), false);
});

test("a confirmed linked Google identity is trusted even when email is the primary provider", () => {
  const input = {
    id: "user-1",
    email: " Editor@Example.com ",
    emailConfirmedAt: "2026-08-11T00:00:00.000Z",
    provider: "email",
    providers: ["email", "google"],
    identities: [
      { provider: "email" },
      {
        provider: "google",
        identity_data: { email: "Editor@example.com", email_verified: true }
      }
    ]
  };
  assert.equal(hasLinkedGoogleIdentity(input), true);
  assert.deepEqual(normalizeTrustedGoogleIdentity(input), {
    id: "user-1",
    email: "editor@example.com",
    provider: "google",
    emailConfirmedAt: "2026-08-11T00:00:00.000Z"
  });
});

test("a confirmed Google-only user is trusted", () => {
  const confirmed = {
    id: "user-2",
    email: "google@example.com",
    emailConfirmedAt: "2026-08-11T00:00:00.000Z"
  };
  assert.ok(normalizeTrustedGoogleIdentity({
    ...confirmed,
    provider: "google",
    providers: ["google"],
    identities: [{
      provider: "google",
      identity_data: { email: "google@example.com", email_verified: true }
    }]
  }));
});

test("Google provider metadata remains a safe fallback when identities are omitted", () => {
  const confirmed = {
    id: "user-2-fallback",
    email: "fallback@example.com",
    emailConfirmedAt: "2026-08-11T00:00:00.000Z"
  };
  assert.ok(normalizeTrustedGoogleIdentity({
    ...confirmed,
    provider: "email",
    providers: ["email", " GOOGLE "]
  }));
});

test("the primary provider alone does not prove a linked Google identity", () => {
  const providerOnly = {
    id: "user-provider-only",
    email: "provider-only@example.com",
    emailConfirmedAt: "2026-08-11T00:00:00.000Z",
    provider: "google"
  };
  assert.equal(hasLinkedGoogleIdentity(providerOnly), false);
  assert.equal(normalizeTrustedGoogleIdentity(providerOnly), null);
});

test("email-only or unconfirmed users are not accepted as Google identities", () => {
  const confirmedEmailOnly = {
    id: "user-3",
    email: "email@example.com",
    emailConfirmedAt: "2026-08-11T00:00:00.000Z",
    provider: "email",
    providers: ["email"],
    identities: [{ provider: "email" }]
  };
  assert.equal(hasLinkedGoogleIdentity(confirmedEmailOnly), false);
  assert.equal(normalizeTrustedGoogleIdentity(confirmedEmailOnly), null);
  assert.equal(normalizeTrustedGoogleIdentity({
    ...confirmedEmailOnly,
    providers: ["email", "google"],
    emailConfirmedAt: ""
  }), null);
});

test("a mismatched or explicitly unverified Google identity is rejected", () => {
  const confirmed = {
    id: "user-5",
    email: "owner@example.com",
    emailConfirmedAt: "2026-08-11T00:00:00.000Z",
    provider: "email",
    providers: ["email", "google"]
  };
  assert.equal(normalizeTrustedGoogleIdentity({
    ...confirmed,
    identities: [{
      provider: "google",
      identity_data: { email: "other@example.com", email_verified: true }
    }]
  }), null);
  assert.equal(normalizeTrustedGoogleIdentity({
    ...confirmed,
    identities: [{
      provider: "google",
      identity_data: { email: "owner@example.com", email_verified: false }
    }]
  }), null);
  assert.equal(normalizeTrustedGoogleIdentity({
    ...confirmed,
    identities: [{ provider: "email" }]
  }), null);
});

test("Google login eligibility remains separate from the editor allowlist", () => {
  const linkedGoogle = normalizeTrustedGoogleIdentity({
    id: "user-4",
    email: "reader@example.com",
    emailConfirmedAt: "2026-08-11T00:00:00.000Z",
    provider: "email",
    identities: [{ provider: "google" }]
  });
  assert.ok(linkedGoogle);
  assert.equal(isShotclEditorGoogleEmail(linkedGoogle.email, ["editor@example.com"]), false);
  assert.equal(isShotclEditorGoogleEmail(linkedGoogle.email, ["reader@example.com"]), true);
});

test("a valid non-allowlisted Google account remains a successful session", () => {
  assert.doesNotMatch(authSessionRouteSource, /if\s*\(\s*!created\.account\.isEditor/u);
  assert.match(
    authSessionRouteSource,
    /editorEligible:\s*created\.account\.isEditor,\s*editorAllowed:\s*created\.account\.isEditor/u
  );
});

test("New and Key staff upgrade expose stable auth and editor permission errors", () => {
  assert.match(projectCreateRouteSource, /code:\s*"GOOGLE_ACCOUNT_REQUIRED"/u);
  assert.match(projectCreateRouteSource, /이 계정에는 프로젝트 생성 권한이 없습니다\./u);
  assert.match(projectCreateRouteSource, /code:\s*"EDITOR_ACCOUNT_REQUIRED"/u);
  assert.match(projectAccessRouteSource, /Google 계정으로 로그인해야 합니다[\s\S]*code:\s*"GOOGLE_ACCOUNT_REQUIRED"/u);
  assert.match(projectAccessRouteSource, /이 계정에는 수정 권한이 없습니다\.[\s\S]*code:\s*"EDITOR_ACCOUNT_REQUIRED"/u);
});

test("a rejected Google session clears only the app cookie and never deletes the Auth user", () => {
  const rejectionStart = authSessionRouteSource.indexOf("if (!created)");
  const successStart = authSessionRouteSource.indexOf("let destination", rejectionStart);
  assert.notEqual(rejectionStart, -1);
  assert.notEqual(successStart, -1);
  assert.match(
    authSessionRouteSource.slice(rejectionStart, successStart),
    /clearShotclAccountSessionCookie\(response\)/
  );
  assert.doesNotMatch(
    `${authSessionRouteSource}\n${accountServerSource}`,
    /(?:admin\.)?deleteUser\s*\(/
  );
});

test("an unexpected account sync failure also clears the stale app cookie", () => {
  const postCatch = authSessionRouteSource.indexOf('console.error("[shotcl-auth-session:post]"');
  const deleteHandler = authSessionRouteSource.indexOf("export async function DELETE", postCatch);
  assert.ok(postCatch >= 0 && deleteHandler > postCatch);
  assert.match(
    authSessionRouteSource.slice(postCatch, deleteHandler),
    /clearShotclAccountSessionCookie\(response\)/u
  );
});

test("a successful password Join retires any previous guest capability", () => {
  const successResponse = projectJoinRouteSource.indexOf("const response = NextResponse.json");
  const successReturn = projectJoinRouteSource.indexOf("return response;", successResponse);
  assert.ok(successResponse >= 0 && successReturn > successResponse);
  assert.match(
    projectJoinRouteSource.slice(successResponse, successReturn),
    /clearProjectGuestInviteCookie\(response\)/u
  );
});

test("Main blocks account-backed Join and Go while account synchronization is in error", () => {
  const actionHandler = mainPageSource.slice(
    mainPageSource.indexOf("function handleActionClick"),
    mainPageSource.indexOf("function handleGuideReplay")
  );
  const joinHandler = mainPageSource.slice(
    mainPageSource.indexOf("async function handleJoinProject"),
    mainPageSource.indexOf("function renderNewProjectForm")
  );
  const goHandler = mainPageSource.slice(
    mainPageSource.indexOf("async function resolveGoProject"),
    mainPageSource.indexOf("function handleActionClick")
  );
  assert.match(actionHandler, /accountStatus === "error"/u);
  assert.match(joinHandler, /accountStatus === "error"/u);
  assert.match(goHandler, /accountStatus === "error"/u);
  assert.doesNotMatch(actionHandler, /accountStatus === "unavailable"/u);
});

test("current-project legacy access wins over a stale guest invite during account linking", () => {
  const legacyCheck = authSessionRouteSource.indexOf("const legacyGrant =");
  const legacyBranch = authSessionRouteSource.indexOf("if (legacyGrant)", legacyCheck);
  const guestInspection = authSessionRouteSource.indexOf("inspectProjectStaffInvite", legacyBranch);
  assert.ok(legacyCheck >= 0 && legacyBranch > legacyCheck && guestInspection > legacyBranch);
});

test("guest Google linking preserves the exact current Progress round without trusting external paths", () => {
  const guestNavigation = projectNavigationSource.slice(
    projectNavigationSource.indexOf("function GuestProjectNavigation"),
    projectNavigationSource.indexOf("function GuestNavigationLink")
  );
  assert.match(guestNavigation, /const accountReturnTo = `\$\{pathname\}\$\{currentSearch \? `\?\$\{currentSearch\}` : ""\}`/u);
  assert.match(guestNavigation, /<GuestAccountSaveCta nextPath=\{accountReturnTo\}/u);

  const sessionReturn = authSessionRouteSource.slice(
    authSessionRouteSource.indexOf("function resolveProgressReturnTo"),
    authSessionRouteSource.length
  );
  assert.match(sessionReturn, /getSafeInternalPath\(value, "\/"\)/u);
  assert.match(sessionReturn, /parsed\.pathname !== `\/projects\/\$\{projectId\}`/u);
  assert.match(sessionReturn, /isValidDatabaseProjectId\(dailyPlanId\)/u);
  assert.match(sessionReturn, /buildProgressRoundHref\(projectId, dailyPlanId\)/u);
  assert.doesNotMatch(sessionReturn, /https?:\/\/\$\{|window\.location/u);

  assert.match(authProviderSource, /returnTo:\s*nextPath/u);
  assert.match(authProviderSource, /returnTo:\s*getCurrentCallbackReturnTo\(\)/u);
});

test("OAuth callback avoids an extra refresh and logout marks the first server clear as complete", () => {
  assert.doesNotMatch(authCallbackSource, /router\.refresh\s*\(/u);
  const signOutStart = authProviderSource.indexOf("const signOut =");
  const signOutEnd = authProviderSource.indexOf("const email =", signOutStart);
  const signOutSource = authProviderSource.slice(signOutStart, signOutEnd);
  const operationInvalidation = signOutSource.indexOf("operationRef.current += 1");
  const serverClear = signOutSource.indexOf("enqueueAccountMutation(clearAccountSession)");
  assert.ok(operationInvalidation >= 0 && serverClear > operationInvalidation);
  assert.equal((signOutSource.match(/enqueueAccountMutation\(clearAccountSession\)/gu) ?? []).length, 1);
  assert.match(signOutSource, /lastSynchronizedTokenRef\.current = "";/u);
  const afterSupabaseSignOut = signOutSource.slice(signOutSource.indexOf("auth.signOut"));
  assert.doesNotMatch(afterSupabaseSignOut, /applySession\(null, \{ force: true \}\)/u);
});

test("admin requires an allowlisted Google owner or admin membership", () => {
  assert.equal(resolveEffectiveProjectRole({
    accountAuthenticated: true,
    accountEligible: true,
    isOwner: false,
    membershipRole: "admin",
    guestInviteActive: false,
    legacyGrantRole: null
  }), "admin");
  assert.equal(resolveEffectiveProjectRole({
    accountAuthenticated: true,
    accountEligible: true,
    isOwner: true,
    membershipRole: null,
    guestInviteActive: false,
    legacyGrantRole: null
  }), "admin");
});

test("non-allowlisted Google members retain read access but no mutation role", () => {
  for (const membershipRole of ["admin", "crew"]) {
    assert.equal(resolveEffectiveProjectRole({
      accountAuthenticated: true,
      accountEligible: false,
      isOwner: false,
      membershipRole,
      guestInviteActive: false,
      legacyGrantRole: null
    }), "progress");
  }
  assert.equal(resolveEffectiveProjectRole({
    accountAuthenticated: true,
    accountEligible: false,
    isOwner: true,
    membershipRole: null,
    guestInviteActive: false,
    legacyGrantRole: null
  }), "progress");
});

test("active invite and legacy password grants are always read-only", () => {
  assert.equal(resolveEffectiveProjectRole({
    accountAuthenticated: false,
    accountEligible: false,
    isOwner: false,
    membershipRole: null,
    guestInviteActive: true,
    legacyGrantRole: null
  }), "progress");
  assert.equal(resolveEffectiveProjectRole({
    accountAuthenticated: false,
    accountEligible: false,
    isOwner: false,
    membershipRole: null,
    guestInviteActive: false,
    legacyGrantRole: "admin"
  }), "progress");
});

test("an authenticated account without project membership cannot inherit a legacy cookie", () => {
  assert.equal(resolveEffectiveProjectRole({
    accountAuthenticated: true,
    accountEligible: true,
    isOwner: false,
    membershipRole: null,
    guestInviteActive: false,
    legacyGrantRole: "admin"
  }), null);
});

function guestRequest(pathname, query = "", method = "GET") {
  return {
    method,
    pathname,
    projectId: "project_11111111-1111-4111-8111-111111111111",
    searchParams: new URLSearchParams(query)
  };
}

test("guest API access is limited to the project shell and bounded read collections", () => {
  const root = "/api/projects/11111111-1111-4111-8111-111111111111";
  const dailyPlanId = "22222222-2222-4222-8222-222222222222";
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(root)), true);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/daily-plans`)), true);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/daily-plans/${dailyPlanId}`)), true);
  assert.equal(isGuestProjectApiRequestAllowed(
    guestRequest(`${root}/daily-plans/${dailyPlanId}`, "progress=1")
  ), true);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/shots`, "dailyPlanId=plan-1")), true);
  assert.equal(isGuestProjectApiRequestAllowed(
    guestRequest(`${root}/reference-assets`, "media=1&dailyPlanId=plan-1")
  ), true);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/reference-assets`, "type=scenario")), true);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/shot-diagrams`, "dailyPlanId=plan-1")), true);
});

test("guest API access denies non-status mutations, private collections, and unbounded reads", () => {
  const root = "/api/projects/11111111-1111-4111-8111-111111111111";
  const dailyPlanId = "22222222-2222-4222-8222-222222222222";
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(root, "", "POST")), false);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/daily-plans/plan-1`)), false);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/daily-plans/${dailyPlanId}`, "expand=all")), false);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/daily-plans/${dailyPlanId}/shots`)), false);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/daily-plans/${dailyPlanId}`, "", "PATCH")), false);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/shots`)), false);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/reference-assets`)), false);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/reference-assets`, "media=1")), false);
  assert.equal(isGuestProjectApiRequestAllowed(
    guestRequest(`${root}/reference-assets`, "type=scenario&types=storyboard,overhead")
  ), false);
  assert.equal(isGuestProjectApiRequestAllowed(
    guestRequest(`${root}/reference-assets`, "media=1&dailyPlanId=plan-1&types=scenario")
  ), true);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/shot-diagrams`, "dailyPlanId=plan-1&archive=1")), false);
  assert.equal(isGuestProjectApiRequestAllowed(
    guestRequest(`${root}/shot-diagrams`, "dailyPlanId=__project_archive__")
  ), false);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/staff-list`)), false);
  assert.equal(isGuestProjectApiRequestAllowed({
    ...guestRequest(`${root}/daily-plans`),
    projectId: "project_22222222-2222-4222-8222-222222222222"
  }), false);
});

test("Guest daily-plan detail keeps server access and project-plus-round scope guards", () => {
  const accessIndex = dailyPlanDetailRouteSource.indexOf("await getAccessGrant(request, projectId)");
  const planReadIndex = dailyPlanDetailRouteSource.indexOf('supabase.from("daily_plans")');
  assert.ok(accessIndex >= 0 && accessIndex < planReadIndex);
  assert.match(dailyPlanDetailRouteSource, /isValidDatabaseProjectId\(dailyPlanId\)/u);
  assert.match(
    dailyPlanDetailRouteSource,
    /from\("daily_plans"\)[\s\S]*\.eq\("project_id", projectId\)\.eq\("id", dailyPlanId\)/u
  );
  assert.match(
    dailyPlanDetailRouteSource,
    /from\("daily_plan_shots"\)[\s\S]*\.eq\("project_id", projectId\)\.eq\("daily_plan_id", dailyPlanId\)/u
  );
  const progressBranch = dailyPlanDetailRouteSource.slice(
    dailyPlanDetailRouteSource.indexOf('if (request.nextUrl.searchParams.get("progress") === "1")'),
    dailyPlanDetailRouteSource.indexOf("const [{ data: plan")
  );
  assert.match(progressBranch, /select\(PROGRESS_DAILY_PLAN_COLUMNS\)/u);
  assert.doesNotMatch(progressBranch, /daily_plan_shots/u);
});

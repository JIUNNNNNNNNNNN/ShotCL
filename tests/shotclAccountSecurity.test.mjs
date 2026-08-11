import assert from "node:assert/strict";
import test from "node:test";

import {
  isShotclEditorGoogleEmail,
  normalizeTrustedGoogleIdentity,
  parseShotclEditorGoogleEmails,
  resolveEffectiveProjectRole
} from "../lib/projectAccess/accountCore.ts";
import { isGuestProjectApiRequestAllowed } from "../lib/projectAccess/guestApiAccess.ts";

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

test("only a confirmed primary Google identity is trusted", () => {
  const input = {
    id: "user-1",
    email: " Editor@Example.com ",
    emailConfirmedAt: "2026-08-11T00:00:00.000Z"
  };
  assert.deepEqual(normalizeTrustedGoogleIdentity({ ...input, provider: "google" }), {
    id: "user-1",
    email: "editor@example.com",
    provider: "google",
    emailConfirmedAt: "2026-08-11T00:00:00.000Z"
  });
  assert.equal(normalizeTrustedGoogleIdentity({ ...input, provider: "email" }), null);
  assert.equal(normalizeTrustedGoogleIdentity({ ...input, provider: "google", emailConfirmedAt: "" }), null);
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
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(root)), true);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/daily-plans`)), true);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/shots`, "dailyPlanId=plan-1")), true);
  assert.equal(isGuestProjectApiRequestAllowed(
    guestRequest(`${root}/reference-assets`, "media=1&dailyPlanId=plan-1")
  ), true);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/reference-assets`, "type=scenario")), true);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/shot-diagrams`, "dailyPlanId=plan-1")), true);
});

test("guest API access denies mutations, private collections, and unbounded reads", () => {
  const root = "/api/projects/11111111-1111-4111-8111-111111111111";
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(root, "", "POST")), false);
  assert.equal(isGuestProjectApiRequestAllowed(guestRequest(`${root}/daily-plans/plan-1`)), false);
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

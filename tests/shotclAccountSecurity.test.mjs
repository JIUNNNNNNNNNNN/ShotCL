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

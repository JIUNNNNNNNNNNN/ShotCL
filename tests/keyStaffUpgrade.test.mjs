import assert from "node:assert/strict";
import test from "node:test";

import {
  getJoinAccessReason,
  getKeyStaffUpgradeDecision,
  isKeyStaffProjectRole,
  isStaffProjectRole,
  resolveProjectScopedRole,
  sanitizePasscode
} from "../lib/projectAccess/core.ts";
import {
  consumePendingProjectJoinNotice,
  peekPendingProjectJoinNotice,
  reconcileProjectJoinNotice,
  setPendingProjectJoinNotice
} from "../lib/projectAccess/joinNotice.client.ts";
import {
  isMemberReadOnlyFallback,
  resolveLiveProjectCapability
} from "../lib/projectAccess/clientCapability.ts";

test("canonical shared roles identify Staff and Key staff", () => {
  assert.equal(isStaffProjectRole("progress"), true);
  assert.equal(isStaffProjectRole("admin"), false);
  assert.equal(isKeyStaffProjectRole("admin"), true);
  assert.equal(isKeyStaffProjectRole("progress"), false);
});

test("only a valid Key staff password upgrades a Staff role", () => {
  assert.equal(getKeyStaffUpgradeDecision("progress", false), "invalid-password");
  assert.equal(getKeyStaffUpgradeDecision("progress", true), "upgrade");
});

test("an unauthenticated Key staff password falls back to Staff with a Google-required reason", () => {
  assert.equal(getJoinAccessReason("admin", false), "key_staff_google_required");
  assert.equal(getJoinAccessReason("progress", false), null);
});

test("authenticated Join does not emit the unauthenticated Key staff reason", () => {
  assert.equal(getJoinAccessReason("admin", true), null);
  assert.equal(getJoinAccessReason("progress", true), null);
});

test("the Key staff fallback notice is in-memory, project-scoped, and consumed once", () => {
  setPendingProjectJoinNotice({
    projectId: "project-a",
    reason: "key_staff_google_required"
  });
  assert.deepEqual(peekPendingProjectJoinNotice("project-a"), {
    projectId: "project-a",
    reason: "key_staff_google_required"
  });
  assert.equal(consumePendingProjectJoinNotice("project-b"), null);
  assert.deepEqual(consumePendingProjectJoinNotice("project-a"), {
    projectId: "project-a",
    reason: "key_staff_google_required"
  });
  assert.equal(consumePendingProjectJoinNotice("project-a"), null);
});

test("Strict Effects preserve one consumed notice only for the current project", () => {
  const projectANotice = {
    projectId: "project-a",
    reason: "key_staff_google_required"
  };
  assert.deepEqual(
    reconcileProjectJoinNotice(null, projectANotice, "project-a"),
    projectANotice
  );
  assert.deepEqual(
    reconcileProjectJoinNotice(projectANotice, null, "project-a"),
    projectANotice
  );
  assert.equal(reconcileProjectJoinNotice(projectANotice, null, "project-b"), null);
});

test("a live logout immediately removes member write capability without changing DB membership", () => {
  assert.deepEqual(resolveLiveProjectCapability({
    accessMode: "member",
    scopedRole: "admin",
    accountStatus: "anonymous",
    serverAccountUserId: "user-a",
    liveAccountUserId: null,
    isGoogle: false,
    liveAccountEditorEligible: false
  }), { role: null, editorEligible: false });
});

test("member writes require the same authenticated Google account as the server layout", () => {
  const input = {
    accessMode: "member",
    scopedRole: "admin",
    serverAccountUserId: "user-a"
  };
  assert.deepEqual(resolveLiveProjectCapability({
    ...input,
    accountStatus: "loading",
    liveAccountUserId: null,
    isGoogle: false,
    liveAccountEditorEligible: false
  }), { role: "progress", editorEligible: false });
  assert.deepEqual(resolveLiveProjectCapability({
    ...input,
    accountStatus: "authenticated",
    liveAccountUserId: "user-a",
    isGoogle: true,
    liveAccountEditorEligible: true
  }), { role: "admin", editorEligible: true });
  assert.deepEqual(resolveLiveProjectCapability({
    ...input,
    accountStatus: "authenticated",
    liveAccountUserId: "user-b",
    isGoogle: true,
    liveAccountEditorEligible: true
  }), { role: null, editorEligible: false });
});

test("member session restoration and account errors keep the shell read-only", () => {
  const input = {
    accessMode: "member",
    scopedRole: "admin",
    serverAccountUserId: "user-a",
    liveAccountUserId: null,
    isGoogle: false,
    liveAccountEditorEligible: false
  };
  for (const accountStatus of ["loading", "syncing", "error", "unavailable"]) {
    assert.deepEqual(resolveLiveProjectCapability({
      ...input,
      accountStatus
    }), { role: "progress", editorEligible: false });
  }
});

test("only a provisional server admin bypasses Staff route redirects", () => {
  assert.equal(isMemberReadOnlyFallback({
    accessMode: "member",
    serverRole: "admin",
    resolvedRole: "progress",
    accountStatus: "loading"
  }), true);
  assert.equal(isMemberReadOnlyFallback({
    accessMode: "member",
    serverRole: "progress",
    resolvedRole: "progress",
    accountStatus: "loading"
  }), false);
  assert.equal(isMemberReadOnlyFallback({
    accessMode: "member",
    serverRole: "admin",
    resolvedRole: null,
    accountStatus: "syncing"
  }), false);
  assert.equal(isMemberReadOnlyFallback({
    accessMode: "member",
    serverRole: "admin",
    resolvedRole: "admin",
    accountStatus: "authenticated"
  }), false);
});

test("anonymous and mismatched member sessions remain denied", () => {
  const input = {
    accessMode: "member",
    scopedRole: "admin",
    serverAccountUserId: "user-a",
    isGoogle: true,
    liveAccountEditorEligible: true
  };
  assert.deepEqual(resolveLiveProjectCapability({
    ...input,
    accountStatus: "anonymous",
    liveAccountUserId: null
  }), { role: null, editorEligible: false });
  assert.deepEqual(resolveLiveProjectCapability({
    ...input,
    accountStatus: "authenticated",
    liveAccountUserId: "user-b"
  }), { role: null, editorEligible: false });
  assert.deepEqual(resolveLiveProjectCapability({
    ...input,
    accountStatus: "syncing",
    liveAccountUserId: "user-b"
  }), { role: null, editorEligible: false });
  assert.deepEqual(resolveLiveProjectCapability({
    ...input,
    accountStatus: "error",
    liveAccountUserId: "user-b"
  }), { role: null, editorEligible: false });
  assert.deepEqual(resolveLiveProjectCapability({
    ...input,
    accountStatus: "loading",
    serverAccountUserId: null,
    liveAccountUserId: null
  }), { role: null, editorEligible: false });
});

test("existing Key staff remains Key staff without a downgrade or duplicate transition", () => {
  assert.equal(getKeyStaffUpgradeDecision("admin", false), "already-key-staff");
  assert.equal(getKeyStaffUpgradeDecision("admin", true), "already-key-staff");
});

test("missing and unsupported roles cannot request an upgrade", () => {
  assert.equal(getKeyStaffUpgradeDecision(null, true), "forbidden");
  assert.equal(getKeyStaffUpgradeDecision("owner", true), "forbidden");
});

test("a verified role override is isolated to its own project", () => {
  const projectAOverride = { projectId: "project-a", role: "admin" };
  assert.equal(resolveProjectScopedRole("project-a", "progress", projectAOverride), "admin");
  assert.equal(resolveProjectScopedRole("project-b", "progress", projectAOverride), "progress");
  assert.equal(resolveProjectScopedRole("project-b", "admin", projectAOverride), "admin");
});

test("canonical server confirmation or grant removal retires a local override", () => {
  const override = { projectId: "project-a", role: "admin" };
  assert.equal(resolveProjectScopedRole("project-a", "admin", override), "admin");
  assert.equal(resolveProjectScopedRole("project-a", null, override), null);
});

test("passcode input keeps only the first four digits", () => {
  assert.equal(sanitizePasscode("12a3-45"), "1234");
  assert.equal(sanitizePasscode("Key staff"), "");
});

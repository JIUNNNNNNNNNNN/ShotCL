import assert from "node:assert/strict";
import test from "node:test";

import {
  getKeyStaffUpgradeDecision,
  isKeyStaffProjectRole,
  isStaffProjectRole,
  resolveProjectScopedRole,
  sanitizePasscode
} from "../lib/projectAccess/core.ts";

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

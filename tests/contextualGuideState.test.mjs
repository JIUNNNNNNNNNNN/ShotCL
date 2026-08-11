import assert from "node:assert/strict";
import test from "node:test";
import {
  getPendingGuideIds,
  mergeCompletedGuideTokens,
  parseCompletedGuideTokens,
  serializeCompletedGuideTokens,
  shouldLearnGuideOnExit
} from "../lib/contextualGuideState.ts";
import {
  CONTEXTUAL_GUIDES,
  getGuideIdsForPage,
  getGuideStorageToken,
  MAIN_INTRO_GUIDE_IDS
} from "../lib/contextualGuides.ts";

test("automatic and feature exits learn while replay exits stay runtime-only", () => {
  assert.equal(shouldLearnGuideOnExit("auto"), true);
  assert.equal(shouldLearnGuideOnExit("feature"), true);
  assert.equal(shouldLearnGuideOnExit("replay"), false);
});

test("completion storage keeps the existing sorted string-array format", () => {
  const parsed = parseCompletedGuideTokens('["main.intro-go@1",3,"","main.intro-new@1"]');
  assert.deepEqual([...parsed], ["main.intro-go@1", "main.intro-new@1"]);
  assert.equal(
    serializeCompletedGuideTokens(parsed),
    '["main.intro-go@1","main.intro-new@1"]'
  );
  assert.deepEqual([...parseCompletedGuideTokens("not-json")], []);
});

test("cross-tab completion merge is monotonic and deduplicated", () => {
  const merged = mergeCompletedGuideTokens(
    new Set(["home.intro@1", "home.calendar-create@1"]),
    new Set(["home.calendar-create@1", "home.calendar-range@1"])
  );
  assert.deepEqual([...merged], [
    "home.intro@1",
    "home.calendar-create@1",
    "home.calendar-range@1"
  ]);
});

test("partial Main sequence resumes with only unique incomplete guides", () => {
  const completed = new Set(["main.intro-new", "main.intro-join"]);
  const pending = getPendingGuideIds(
    ["main.intro-new", "main.intro-join", "main.intro-go", "main.intro-go"],
    (id) => completed.has(id)
  );
  assert.deepEqual(pending, ["main.intro-go"]);
});

test("Main intro and Help replay expose one canonical Go guide", () => {
  assert.deepEqual(
    [...MAIN_INTRO_GUIDE_IDS],
    ["main.intro-new", "main.intro-join", "main.intro-go"]
  );
  assert.equal(MAIN_INTRO_GUIDE_IDS.filter((id) => id.includes("go")).length, 1);
  assert.equal(getGuideIdsForPage("main").includes("main.go-first-use"), false);
});

test("project Home keeps generic and Key staff Google guidance as separate one-time features", () => {
  const homeGuides = getGuideIdsForPage("home");
  const accountGuides = homeGuides.filter((id) => id === "home.google-account-connect");
  const definition = CONTEXTUAL_GUIDES["home.google-account-connect"];
  const keyStaffDefinition = CONTEXTUAL_GUIDES["home.key-staff-google-required"];

  assert.deepEqual(accountGuides, ["home.google-account-connect"]);
  assert.equal(definition.trigger, "feature");
  assert.equal(definition.type, "anchor");
  assert.equal(definition.persistentAnchor, "shell.google-account");
  assert.equal(definition.compactAnchor, "shell.navigation-toggle");
  assert.equal(definition.replayHidden, true);
  assert.equal(getGuideStorageToken(definition.id), "home.google-account-connect@1");
  assert.deepEqual(
    homeGuides.filter((id) => id.includes("key-staff-google")),
    ["home.key-staff-google-required"]
  );
  assert.equal(keyStaffDefinition.trigger, "feature");
  assert.equal(keyStaffDefinition.type, "anchor");
  assert.equal(keyStaffDefinition.persistentAnchor, "shell.google-account");
  assert.equal(keyStaffDefinition.compactAnchor, "shell.navigation-toggle");
  assert.equal(keyStaffDefinition.replayHidden, true);
  assert.equal(getGuideStorageToken(keyStaffDefinition.id), "home.key-staff-google-required@1");
});

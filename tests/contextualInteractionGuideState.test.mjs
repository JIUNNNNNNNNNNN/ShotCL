import assert from "node:assert/strict";
import test from "node:test";
import {
  moveInteractionGuideSession,
  skipUnavailableInteractionGuideSteps,
  startInteractionGuideSession
} from "../lib/contextualInteractionGuideState.ts";

test("manual interaction tour starts at step one and can be replayed from step one", () => {
  const first = startInteractionGuideSession(["one", "two", "three"]);
  assert.deepEqual(first, { steps: ["one", "two", "three"], index: 0 });
  const moved = moveInteractionGuideSession(first, 1);
  assert.equal(moved.index, 1);

  const replay = startInteractionGuideSession(first.steps);
  assert.equal(replay.index, 0);
  assert.equal(first.index, 0);
});

test("previous and next stay inside the manual tour bounds", () => {
  const started = startInteractionGuideSession(["one", "two"]);
  assert.equal(moveInteractionGuideSession(started, -1).index, 0);
  const last = moveInteractionGuideSession(started, 1);
  assert.equal(last.index, 1);
  assert.equal(moveInteractionGuideSession(last, 1).index, 1);
  assert.equal(moveInteractionGuideSession(last, -1).index, 0);
});

test("a missing dynamic target skips forward or ends without persisting progress", () => {
  const started = startInteractionGuideSession(["gone", "also-gone", "visible"]);
  const skipped = skipUnavailableInteractionGuideSteps(
    started,
    (step) => step === "visible"
  );
  assert.equal(skipped.index, 2);
  assert.equal(skipUnavailableInteractionGuideSteps(skipped, () => false), null);
  assert.deepEqual(started, { steps: ["gone", "also-gone", "visible"], index: 0 });
});

test("a page with no visible hidden interaction has no manual session", () => {
  assert.equal(startInteractionGuideSession([]), null);
});

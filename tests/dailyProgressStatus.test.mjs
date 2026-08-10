import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDailyProgress,
  isDailyProgressComplete
} from "../lib/progress/dailyProgress.ts";

test("OK and OMIT keep their existing processed-cut progress semantics", () => {
  const partial = calculateDailyProgress([
    { id: "cut-1", status: "ok" },
    { id: "cut-2", status: "omit" },
    { id: "cut-3", status: "pending" }
  ]);

  assert.deepEqual(partial, {
    totalCutCount: 3,
    okCutCount: 1,
    omitCutCount: 1,
    processedCutCount: 2,
    remainingCutCount: 1,
    progressPercent: 67
  });
  assert.equal(isDailyProgressComplete(partial), false);

  const complete = calculateDailyProgress([
    { id: "cut-1", status: "ok" },
    { id: "cut-2", status: "omit" }
  ]);
  assert.equal(complete.progressPercent, 100);
  assert.equal(isDailyProgressComplete(complete), true);
});

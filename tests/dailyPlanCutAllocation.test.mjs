import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCutAllocationLabel,
  formatCutRanges,
  getRemainingCutNumbers,
  normalizeAllocatedCutNumbers,
  resolveAllocatedCutNumbers
} from "../lib/dailyPlan/cutAllocation.ts";

const firstRound = [1, 2, 3, 5, 6, 7, 8, 11, 12, 23];
const secondRound = [4, 9, 10, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

test("formats naturally sorted cut ranges", () => {
  assert.equal(formatCutRanges(firstRound), "1-3, 5-8, 11-12, 23");
  assert.equal(formatCutAllocationLabel(secondRound), "C4, 9-10, 13-22 · 13컷");
  assert.equal(formatCutAllocationLabel([3, 1, 3, 2]), "C1-3 · 3컷");
});

test("remaining cut selection matches the split-round example", () => {
  assert.deepEqual(getRemainingCutNumbers(23, firstRound), secondRound);
  assert.equal(firstRound.length, 10);
  assert.equal(secondRound.length, 13);
  assert.equal(getRemainingCutNumbers(23, [...firstRound, ...secondRound]).length, 0);
});

test("normalization removes duplicates and out-of-range values", () => {
  assert.deepEqual(normalizeAllocatedCutNumbers([3, 1, 3, 0, 24, "2"], 23), [1, 2, 3]);
});

test("legacy null selection means every cut while explicit empty stays empty", () => {
  assert.deepEqual(resolveAllocatedCutNumbers(null, 4), [1, 2, 3, 4]);
  assert.deepEqual(resolveAllocatedCutNumbers([], 4), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  SPLIT_SHOOTING_ORDER_ERROR,
  appendRemainingShootingOrderCuts,
  formatShootingOrderForOutput,
  getShootingOrderCutsMissingFromSelection,
  getShootingOrderValidation,
  getSplitShotAllocationSaveError,
  getSplitShootingOrderSaveError,
  isShootingOrderDraftAllowed,
  sanitizeShootingOrderInput
} from "../lib/dailyPlan/shootingOrder.ts";

test("normal shooting rows keep the existing total-cut validation", () => {
  assert.deepEqual(getShootingOrderValidation("1 2 3 4", 4, null), {
    numbers: [1, 2, 3, 4],
    error: ""
  });
  assert.deepEqual(getShootingOrderValidation("1,2/3-4", 4, null).numbers, [1, 2, 3, 4]);
  assert.deepEqual(getShootingOrderValidation("1234", 4, null).numbers, [1, 2, 3, 4]);
  assert.deepEqual(getShootingOrderValidation("1215", 15, null).numbers, [12, 15]);
  assert.match(getShootingOrderValidation("1 1", 4, null).error, /중복/u);
  assert.notEqual(getShootingOrderValidation("5", 4, null).error, "");
});

test("split shooting accepts only the selected cut membership", () => {
  assert.equal(getShootingOrderValidation("1", 4, [1, 3]).error, "");
  assert.equal(getShootingOrderValidation("3", 4, [1, 3]).error, "");
  assert.equal(getShootingOrderValidation("2", 4, [1, 3]).error, SPLIT_SHOOTING_ORDER_ERROR);
  assert.equal(getShootingOrderValidation("4", 4, [1, 3]).error, SPLIT_SHOOTING_ORDER_ERROR);
  assert.deepEqual(getShootingOrderValidation("3 1", 4, [1, 3]).numbers, [3, 1]);
});

test("multi-digit cut drafts can continue from a transient prefix", () => {
  assert.equal(isShootingOrderDraftAllowed("1", 15, [12, 15]), true);
  assert.equal(isShootingOrderDraftAllowed("2", 15, [12, 15]), false);
  assert.equal(isShootingOrderDraftAllowed("1215", 15, [12, 15]), true);
  assert.equal(isShootingOrderDraftAllowed("121", 15, [12, 15]), true);
  assert.equal(isShootingOrderDraftAllowed("12", 15, [1, 2]), false);
  assert.equal(isShootingOrderDraftAllowed("1215", 15, [1, 2, 15]), false);
  assert.equal(getShootingOrderValidation("1", 15, [12, 15]).error, SPLIT_SHOOTING_ORDER_ERROR);
  assert.deepEqual(getShootingOrderValidation("12", 15, [12, 15]), {
    numbers: [12],
    error: ""
  });
  assert.deepEqual(getShootingOrderValidation("15", 15, [12, 15]), {
    numbers: [15],
    error: ""
  });
  assert.equal(getShootingOrderValidation("11", 15, [12, 15]).error, SPLIT_SHOOTING_ORDER_ERROR);
});

test("paste-style separated input is accepted or rejected as a whole", () => {
  assert.deepEqual(getShootingOrderValidation(sanitizeShootingOrderInput("1,3"), 4, [1, 3]), {
    numbers: [1, 3],
    error: ""
  });
  assert.equal(
    getShootingOrderValidation(sanitizeShootingOrderInput("1,2,3"), 4, [1, 3]).error,
    SPLIT_SHOOTING_ORDER_ERROR
  );
  assert.equal(formatShootingOrderForOutput("1,2,3", 4, [1, 3]), "");
});

test("append remaining keeps the existing order and adds only allocated cuts", () => {
  assert.deepEqual(appendRemainingShootingOrderCuts("3", 4, [1, 3]), {
    numbers: [3, 1],
    error: ""
  });
  assert.deepEqual(appendRemainingShootingOrderCuts("4 2", 5, null), {
    numbers: [4, 2, 1, 3, 5],
    error: ""
  });
});

test("a cut used by shooting order cannot be removed from the split selection", () => {
  assert.deepEqual(getShootingOrderCutsMissingFromSelection("1 3", 4, [1, 3]), []);
  assert.deepEqual(getShootingOrderCutsMissingFromSelection("1 3", 4, [1]), [3]);
  assert.deepEqual(getShootingOrderCutsMissingFromSelection("", 4, []), []);
});

test("save boundary rejects inconsistent split metadata without affecting legacy rows", () => {
  const splitScene = {
    selectedCutNumbers: [1, 3],
    rowSnapshot: { sceneNumber: "12", totalCuts: 4, shootingOrder: "1-2-3" }
  };
  assert.match(getSplitShootingOrderSaveError([splitScene]), /분할 촬영에 선택되지 않은 컷/u);

  splitScene.rowSnapshot.shootingOrder = "3-1";
  assert.equal(getSplitShootingOrderSaveError([splitScene]), "");
  assert.equal(getSplitShootingOrderSaveError([
    { rowSnapshot: { sceneNumber: "12", totalCuts: 4, shootingOrder: "1-2-3-4" } }
  ]), "");
});

test("save boundary prevents submitted shots from expanding a split allocation", () => {
  const scenes = [{
    selectedCutNumbers: [1, 3],
    rowSnapshot: { sceneNumber: "12", totalCuts: 4, shootingOrder: "3-1" }
  }];
  assert.equal(getSplitShotAllocationSaveError(scenes, [
    { sceneNumber: "12", cutNumber: "1" },
    { sceneNumber: "12", cutNumber: "3" }
  ]), "");
  assert.match(getSplitShotAllocationSaveError(scenes, [
    { sceneNumber: "12", cutNumber: "2" }
  ]), /분할 촬영에 배정되지 않은 컷/u);
  assert.equal(getSplitShotAllocationSaveError([
    ...scenes,
    { rowSnapshot: { sceneNumber: "12", totalCuts: 4, shootingOrder: "1-2-3-4" } }
  ], [{ sceneNumber: "12", cutNumber: "2" }]), "");
});

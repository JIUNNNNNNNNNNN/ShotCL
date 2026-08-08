import assert from "node:assert/strict";
import test from "node:test";

import {
  finderSelectionUpdate,
  inclusiveVisibleSelectionRange,
  retainVisibleSelection,
  visibleSelectionOrder
} from "../lib/archiveSelection.ts";

test("visible order follows expanded groups and appends trailing assets once", () => {
  const order = visibleSelectionOrder(
    [
      { key: "scene-1", itemKeys: ["asset:a", "asset:b"] },
      { key: "scene-2", itemKeys: ["asset:c", "asset:d", "asset:e"] },
      { key: "scene-3", itemKeys: ["asset:f", "asset:g"] }
    ],
    new Set(["scene-2"]),
    ["asset:g", "asset:source"]
  );

  assert.deepEqual(order, ["asset:a", "asset:b", "asset:f", "asset:g", "asset:source"]);
});

test("inclusive range works forward, backward, and for a single target", () => {
  const order = ["asset:a", "asset:b", "asset:f", "asset:g"];

  assert.deepEqual(
    inclusiveVisibleSelectionRange(order, "asset:b", "asset:g"),
    ["asset:b", "asset:f", "asset:g"]
  );
  assert.deepEqual(
    inclusiveVisibleSelectionRange(order, "asset:g", "asset:b"),
    ["asset:b", "asset:f", "asset:g"]
  );
  assert.deepEqual(
    inclusiveVisibleSelectionRange(order, "asset:f", "asset:f"),
    ["asset:f"]
  );
});

test("missing or hidden anchor falls back safely to the visible target", () => {
  const order = ["asset:a", "asset:b", "asset:f", "asset:g"];

  assert.deepEqual(
    inclusiveVisibleSelectionRange(order, null, "asset:f"),
    ["asset:f"]
  );
  assert.deepEqual(
    inclusiveVisibleSelectionRange(order, "asset:hidden", "asset:f"),
    ["asset:f"]
  );
  assert.deepEqual(
    inclusiveVisibleSelectionRange(order, "asset:a", "asset:hidden"),
    []
  );
});

test("range helpers do not mutate their inputs", () => {
  const groups = [{ key: "scene-1", itemKeys: ["asset:a", "asset:b"] }];
  const collapsed = new Set();
  const order = ["asset:a", "asset:b"];

  visibleSelectionOrder(groups, collapsed);
  inclusiveVisibleSelectionRange(order, "asset:a", "asset:b");

  assert.deepEqual(groups, [{ key: "scene-1", itemKeys: ["asset:a", "asset:b"] }]);
  assert.equal(collapsed.size, 0);
  assert.deepEqual(order, ["asset:a", "asset:b"]);
});

test("plain, additive, and range clicks follow Finder selection semantics", () => {
  const visibleKeys = ["asset:a", "asset:b", "asset:c", "asset:d", "asset:e"];
  const initial = new Set(["asset:a", "asset:e"]);

  const plain = finderSelectionUpdate({
    currentSelection: initial,
    visibleKeys,
    anchorKey: "asset:a",
    targetKey: "asset:c",
    shiftKey: false,
    additive: false
  });
  assert.deepEqual([...plain.selection], ["asset:c"]);
  assert.equal(plain.anchorKey, "asset:c");

  const toggled = finderSelectionUpdate({
    currentSelection: initial,
    visibleKeys,
    anchorKey: "asset:a",
    targetKey: "asset:e",
    shiftKey: false,
    additive: true
  });
  assert.deepEqual([...toggled.selection], ["asset:a"]);
  assert.equal(toggled.anchorKey, "asset:e");

  const replacedRange = finderSelectionUpdate({
    currentSelection: initial,
    visibleKeys,
    anchorKey: "asset:b",
    targetKey: "asset:d",
    shiftKey: true,
    additive: false
  });
  assert.deepEqual([...replacedRange.selection], ["asset:b", "asset:c", "asset:d"]);
  assert.equal(replacedRange.anchorKey, "asset:b");

  const addedRange = finderSelectionUpdate({
    currentSelection: initial,
    visibleKeys,
    anchorKey: "asset:b",
    targetKey: "asset:d",
    shiftKey: true,
    additive: true
  });
  assert.deepEqual(
    [...addedRange.selection],
    ["asset:a", "asset:e", "asset:b", "asset:c", "asset:d"]
  );
  assert.equal(addedRange.anchorKey, "asset:b");
  assert.deepEqual([...initial], ["asset:a", "asset:e"]);
});

test("a hidden target is never added to selection", () => {
  const result = finderSelectionUpdate({
    currentSelection: new Set(["asset:a"]),
    visibleKeys: ["asset:a", "asset:b"],
    anchorKey: "asset:a",
    targetKey: "asset:hidden",
    shiftKey: true,
    additive: true
  });

  assert.equal(result, null);
});

test("hidden selections are pruned before bulk actions", () => {
  const current = new Set(["asset:a", "asset:hidden", "asset:d"]);
  const visible = new Set(["asset:a", "asset:b", "asset:c", "asset:d"]);

  assert.deepEqual(
    [...retainVisibleSelection(current, visible)],
    ["asset:a", "asset:d"]
  );
  assert.deepEqual([...current], ["asset:a", "asset:hidden", "asset:d"]);
});

test("a Finder-style click sequence supports replace, toggle, and additive range", () => {
  const visibleKeys = ["asset:a", "asset:b", "asset:c", "asset:d", "asset:e"];
  let selection = new Set();
  let anchorKey = null;

  ({ selection, anchorKey } = finderSelectionUpdate({
    currentSelection: selection,
    visibleKeys,
    anchorKey,
    targetKey: "asset:a",
    shiftKey: false,
    additive: false
  }));
  ({ selection, anchorKey } = finderSelectionUpdate({
    currentSelection: selection,
    visibleKeys,
    anchorKey,
    targetKey: "asset:c",
    shiftKey: false,
    additive: true
  }));
  ({ selection, anchorKey } = finderSelectionUpdate({
    currentSelection: selection,
    visibleKeys,
    anchorKey,
    targetKey: "asset:e",
    shiftKey: false,
    additive: true
  }));
  assert.deepEqual([...selection], ["asset:a", "asset:c", "asset:e"]);
  assert.equal(anchorKey, "asset:e");

  ({ selection, anchorKey } = finderSelectionUpdate({
    currentSelection: selection,
    visibleKeys,
    anchorKey: "asset:b",
    targetKey: "asset:d",
    shiftKey: true,
    additive: true
  }));
  assert.deepEqual(
    [...selection],
    ["asset:a", "asset:c", "asset:e", "asset:b", "asset:d"]
  );
  assert.equal(anchorKey, "asset:b");
});

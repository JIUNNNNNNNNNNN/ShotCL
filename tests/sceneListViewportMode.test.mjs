import assert from "node:assert/strict";
import test from "node:test";

const {
  resolveSceneListViewportModeForSize,
  SCENE_LIST_EDITOR_MEDIA_QUERY
} = await import("../hooks/useSceneListViewportMode.ts");

test("iPad-sized portrait and landscape workspaces use the editable Scene List", () => {
  for (const [width, height] of [
    [744, 1133],
    [768, 1024],
    [820, 1180],
    [1024, 768],
    [1194, 834],
    [1366, 1024]
  ]) {
    assert.equal(resolveSceneListViewportModeForSize(width, height), "editor", `${width}x${height}`);
  }
});

test("phone portrait and landscape sizes retain the read-only Scene List", () => {
  for (const [width, height] of [
    [390, 844],
    [430, 932],
    [844, 390],
    [932, 430]
  ]) {
    assert.equal(resolveSceneListViewportModeForSize(width, height), "portrait", `${width}x${height}`);
  }
});

test("the media query mirrors the tablet-height and wide-desktop invariant", () => {
  assert.match(SCENE_LIST_EDITOR_MEDIA_QUERY, /min-width: 700px/u);
  assert.match(SCENE_LIST_EDITOR_MEDIA_QUERY, /min-height: 600px/u);
  assert.match(SCENE_LIST_EDITOR_MEDIA_QUERY, /min-width: 1100px/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reorderSource = readFileSync(
  new URL("../components/SceneReorderList.tsx", import.meta.url),
  "utf8"
);
const tableSource = readFileSync(
  new URL("../components/SceneListNativeTable.tsx", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(
  new URL("../app/projects/[id]/scene-list/page.tsx", import.meta.url),
  "utf8"
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("scene reorder pointer activation belongs only to the dedicated handle", () => {
  const rowProps = sourceBetween(
    reorderSource,
    "const trProps: SceneReorderRowProps",
    "const dragHandleProps: SceneReorderHandleProps"
  );
  const handleProps = sourceBetween(
    reorderSource,
    "const dragHandleProps: SceneReorderHandleProps",
    "return ("
  );

  assert.doesNotMatch(rowProps, /onPointerDown/u);
  assert.match(handleProps, /onPointerDown:\s*\(event\)\s*=>\s*handlePointerDown\(event, item\.id\)/u);
  assert.match(handleProps, /disabled,\s*\n/u);
  assert.doesNotMatch(handleProps, /disabled:\s*disabled \|\| committingRef/u);
  assert.match(handleProps, /"data-scene-reorder-handle":\s*""/u);
  assert.match(tableSource, /<tr\s+\{\.\.\.trProps\}/u);
  assert.match(tableSource, /<button\s+\{\.\.\.dragHandleProps\}/u);
});

test("pointer capture begins after drag activation, not on handle pointerdown", () => {
  const beginDrag = sourceBetween(reorderSource, "function beginDrag", "function updateDrag");
  const pointerDown = sourceBetween(reorderSource, "function handlePointerDown", "return (\n    <tbody");

  assert.match(beginDrag, /setPointerCapture\(pending\.pointerId\)/u);
  assert.doesNotMatch(pointerDown, /setPointerCapture/u);
  assert.match(pointerDown, /if \(distance > 4\) beginDrag\(pending\)/u);
  assert.match(pointerDown, /mobileLongPressMs/u);
  assert.match(pointerDown, /if \(distance > 10\)/u);
});

test("scene number is a one-click text editor and never a reorder handle", () => {
  const handleCell = sourceBetween(
    tableSource,
    "{showReorderHandle ? (\n        <td className=\"relative h-10",
    "ref={sceneNumberGuideAnchorRef}"
  );
  const sceneNumberCell = sourceBetween(
    tableSource,
    "ref={sceneNumberGuideAnchorRef}",
    "{mergeCell(\"location\""
  );

  assert.match(handleCell, /w-10/u);
  assert.match(handleCell, /tabIndex=\{-1\}/u);
  assert.match(handleCell, /cursor-grab/u);
  assert.match(handleCell, /active:cursor-grabbing/u);
  assert.match(handleCell, /aria-label=\{`\$\{item\.sceneNo \|\| index \+ 1\} 씬 순서 변경`\}/u);
  assert.match(sceneNumberCell, /cursor-text/u);
  assert.match(sceneNumberCell, /select-text/u);
  assert.match(sceneNumberCell, /onEdit\("sceneNo"\)/u);
  assert.match(sceneNumberCell, /autoFocus/u);
  assert.doesNotMatch(sceneNumberCell, /dragHandleProps|data-scene-reorder-handle|cursor-grab/u);
});

test("handle is a compact conditional column and phone stays on the read-only renderer", () => {
  assert.match(tableSource, /const sceneReorderHandleWidth = 40/u);
  assert.match(tableSource, /\(showReorderHandle \? sceneReorderHandleWidth : 0\)/u);
  assert.match(tableSource, /showReorderHandle \? <col className="w-\[40px\]" \/> : null/u);
  assert.match(tableSource, /<col className="w-\[70px\]" \/>/u);
  assert.match(pageSource, /canEdit=\{canEdit && !isSaving\}[\s\S]*?showReorderHandle=\{canEdit\}/u);
  assert.match(pageSource, /viewportMode === "portrait"[\s\S]*?<SceneListPortraitReadOnly/u);
  assert.match(pageSource, /:\s*\([\s\S]*?<SceneListNativeTable/u);
});

test("reorder keeps the existing latest autosave flush and one drop commit", () => {
  const commitReorder = sourceBetween(pageSource, "const commitReorder", "const save = useCallback");
  const pointerDown = sourceBetween(reorderSource, "function handlePointerDown", "return (\n    <tbody");
  const finishDrag = sourceBetween(reorderSource, "function finishDrag", "function releasePointerCapture");

  assert.match(commitReorder, /sceneAutosave\.flushKeys\(persistedIds\.map\(sceneItemAutosaveKey\)\)/u);
  assert.match(commitReorder, /reorderProjectSceneItems\(/u);
  assert.doesNotMatch(pointerDown, /onCommitRef|onReorderRef|fetch\(|router\.refresh/u);
  assert.match(finishDrag, /onReorderRef\.current\(nextItems\)/u);
  assert.match(finishDrag, /commit\(nextItems, previousItems\)/u);
});

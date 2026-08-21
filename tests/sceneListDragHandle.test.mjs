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

test("Scene List has no reorder header, grip, handle, or empty 40px column", () => {
  for (const source of [tableSource, reorderSource, pageSource]) {
    assert.doesNotMatch(source, /GripVertical|showReorderHandle|SceneReorderHandleProps/u);
    assert.doesNotMatch(source, /data-scene-reorder-handle|sceneReorderHandleWidth/u);
  }
  assert.doesNotMatch(tableSource, /w-\[40px\]|씬 순서 변경/u);
  assert.match(tableSource, /const sceneTableBaseWidth = 1087/u);
  assert.match(tableSource, /<colgroup>\s*<col className="w-\[70px\]"/u);
});

test("the row owns one stationary 700ms hold for mouse, pen, and touch", () => {
  const pointerDown = sourceBetween(
    reorderSource,
    "function handlePointerDown",
    "return (\n    <tbody"
  );
  const rowProps = sourceBetween(
    reorderSource,
    "const trProps: SceneReorderRowProps",
    "return (\n          <Fragment"
  );

  assert.match(reorderSource, /const sceneReorderHoldMs = 700/u);
  assert.match(pointerDown, /pending\.timer = window\.setTimeout\(\(\) => armDrag\(pending\), sceneReorderHoldMs\)/u);
  assert.doesNotMatch(pointerDown, /pointerType\s*===\s*["']touch["']/u);
  assert.match(pointerDown, /!event\.isPrimary/u);
  assert.match(rowProps, /onPointerDown:\s*\(event\) => handlePointerDown\(event, item\.id\)/u);
  assert.match(tableSource, /<tr\s+\{\.\.\.trProps\}\s+ref=\{combinedRowRef\}/u);
});

test("pre-hold movement cancels without capture or preventing native edit and scroll", () => {
  const pointerDown = sourceBetween(
    reorderSource,
    "function handlePointerDown",
    "const handleMove"
  );
  const pointerMove = sourceBetween(
    reorderSource,
    "const handleMove",
    "const handlePointerUp"
  );
  const armDrag = sourceBetween(reorderSource, "function armDrag", "function updateDrag");

  assert.match(reorderSource, /const preHoldMovementTolerancePx = 8/u);
  assert.match(pointerMove, /distance > preHoldMovementTolerancePx/u);
  assert.match(pointerMove, /completePointerInteraction\(true\)/u);
  assert.doesNotMatch(pointerDown, /preventDefault|setPointerCapture/u);
  assert.doesNotMatch(pointerMove.slice(0, pointerMove.indexOf("if (dragRef.current)")), /preventDefault/u);
  assert.match(armDrag, /setPointerCapture\(pending\.pointerId\)/u);
});

test("hold arms first, movement starts drag, and hold-only release never commits", () => {
  const armDrag = sourceBetween(reorderSource, "function armDrag", "function updateDrag");
  const updateDrag = sourceBetween(reorderSource, "function updateDrag", "function clearPending");
  const finishDrag = sourceBetween(reorderSource, "function finishDrag", "function releasePointerCapture");

  assert.match(armDrag, /phase:\s*"armed"/u);
  assert.match(updateDrag, /phase:\s*"dragging"/u);
  assert.match(reorderSource, /const activeDragMovementThresholdPx = 3/u);
  assert.match(finishDrag, /current\.phase !== "dragging"/u);
  assert.match(finishDrag, /onReorderRef\.current\(nextItems\)/u);
  assert.match(finishDrag, /commit\(nextItems, previousItems\)/u);
});

test("short clicks edit immediately while active editors keep native text interaction", () => {
  const sceneNumberCell = sourceBetween(
    tableSource,
    "ref={sceneNumberGuideAnchorRef}",
    "{mergeCell(\"location\""
  );

  assert.match(sceneNumberCell, /onClick=\{\(\) => \{[\s\S]*?onEdit\("sceneNo"\)/u);
  assert.match(sceneNumberCell, /<SceneListTextEditor[\s\S]*?autoFocus/u);
  assert.match(sceneNumberCell, /cursor-text/u);
  assert.doesNotMatch(sceneNumberCell, /type="number"|doubleClick|onDoubleClick/u);
  assert.match(reorderSource, /"input"[\s\S]*?"textarea"[\s\S]*?"select"[\s\S]*?"\[contenteditable='true'\]"/u);
  assert.doesNotMatch(reorderSource, /pointer-events-none|pointerEvents:\s*"none"/u);
});

test("Safari context menus are suppressed only during the same row's pending or armed hold", () => {
  const rowProps = sourceBetween(
    reorderSource,
    "const trProps: SceneReorderRowProps",
    "return (\n          <Fragment"
  );
  const contextMenuCapture = sourceBetween(
    rowProps,
    "onContextMenuCapture: (event) => {",
    "onPointerDown: (event)"
  );

  assert.match(contextMenuCapture, /pending\?\.itemId === item\.id && !active/u);
  assert.match(contextMenuCapture, /active\?\.itemId === item\.id[\s\S]*?active\.phase === "armed"/u);
  assert.match(contextMenuCapture, /if \(!isThisRowsPendingHold && !isThisRowsArmedHold\) return/u);
  assert.match(contextMenuCapture, /event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)/u);
  assert.match(tableSource, /<tr\s+\{\.\.\.trProps\}\s+ref=\{combinedRowRef\}/u);
  assert.match(tableSource, /onContextMenu=\{onSceneContextMenu\}/u);
});

test("merge selection and actor long-press cannot race the row hold", () => {
  const mergeCell = sourceBetween(
    tableSource,
    "data-scene-merge-scene-id={item.id}",
    "onContextMenu={(event) => onMergeContextMenu"
  );
  const actorPointer = sourceBetween(
    tableSource,
    "onPointerDown={(event) => {\n                          // Actor long-press",
    "title={state.mode === \"text\""
  );
  const sceneNumber = sourceBetween(
    tableSource,
    "ref={sceneNumberGuideAnchorRef}",
    "{mergeCell(\"location\""
  );
  const ordinaryTextCell = sourceBetween(
    tableSource,
    "function EditableTextCell",
    "function SceneListTextEditor"
  );

  assert.match(mergeCell, /event\.stopPropagation\(\)[\s\S]*?onBeginSelection/u);
  assert.match(actorPointer, /event\.stopPropagation\(\)/u);
  assert.doesNotMatch(sceneNumber, /onPointerDown|stopPropagation/u);
  assert.doesNotMatch(ordinaryTextCell, /onPointerDown|stopPropagation/u);
});

test("only an armed or dragging row shows grabbing feedback", () => {
  assert.doesNotMatch(tableSource, /cursor-grab(?:\s|"|')/u);
  assert.doesNotMatch(reorderSource, /cursor:\s*["']grab["']/u);
  assert.match(reorderSource, /isActive[\s\S]*?\[&_\*\]:!cursor-grabbing/u);
  assert.match(reorderSource, /"data-scene-reorder-state": isArmed[\s\S]*?"armed"[\s\S]*?"dragging"/u);
  assert.match(reorderSource, /"aria-grabbed": Boolean\(isActive\)/u);
});

test("reorder preserves latest drafts, scene numbers, and one drop commit", () => {
  const reorderLocal = sourceBetween(pageSource, "const reorderLocal", "const commitReorder");
  const commitReorder = sourceBetween(pageSource, "const commitReorder", "const save = useCallback");
  const pointerMove = sourceBetween(reorderSource, "const handleMove", "const handlePointerUp");

  assert.match(reorderLocal, /\{ \.\.\.item, sortOrder: index \+ 1 \}/u);
  assert.doesNotMatch(reorderLocal, /sceneNo\s*:/u);
  assert.match(commitReorder, /sceneAutosave\.flushKeys\(persistedIds\.map\(sceneItemAutosaveKey\)\)/u);
  assert.match(commitReorder, /reorderProjectSceneItems\(/u);
  assert.doesNotMatch(pointerMove, /onCommitRef|onReorderRef|fetch\(|router\.refresh/u);
  assert.doesNotMatch(commitReorder, /router\.refresh/u);
});

test("phone remains read-only while editor-sized viewports mount the native table", () => {
  assert.match(pageSource, /viewportMode === "portrait"[\s\S]*?<SceneListPortraitReadOnly/u);
  assert.match(pageSource, /:\s*\([\s\S]*?<SceneListNativeTable/u);
  assert.doesNotMatch(pageSource, /showReorderHandle/u);
});

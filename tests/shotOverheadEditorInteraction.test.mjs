import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editorSource = readFileSync(
  new URL("../components/ShotOverheadEditor.tsx", import.meta.url),
  "utf8"
);

function sourceBetween(startMarker, endMarker) {
  const start = editorSource.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = editorSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return editorSource.slice(start, end);
}

test("selected controls use a final overlay and capture-phase nearest resolution", () => {
  const cameraRender = editorSource.indexOf("{diagram.cameras.map((camera) => {");
  const controlLayer = editorSource.indexOf("data-shot-overhead-control-layer");
  assert.ok(cameraRender >= 0);
  assert.ok(controlLayer > cameraRender);
  assert.match(editorSource, /onPointerDownCapture=\{handleControlHandlePointerDownCapture\}/u);
  assert.match(editorSource, /resolveNearestShotOverheadHandle/u);
  assert.match(editorSource, /getShotOverheadInteractionTargetMetrics\(pointerType/u);
  assert.match(editorSource, /data-shot-overhead-control-layer pointerEvents="none"/u);
});

test("all geometry pointer movement stays local until one release commit", () => {
  const pointerMove = sourceBetween(
    "function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {",
    "function beginRotate("
  );
  assert.match(pointerMove, /replaceDiagram/u);
  assert.doesNotMatch(pointerMove, /\bonSave\b|\bfetch\b|commitDiagram|pushShotOverheadHistory/u);

  const pointerEnd = sourceBetween(
    "function handlePointerEnd(event: React.PointerEvent<SVGSVGElement>) {",
    "function handlePointerCancel("
  );
  assert.match(pointerEnd, /pushShotOverheadHistory/u);
  assert.match(editorSource, /enabled: persistenceEnabled && !isSaving && !isFinalizing && !gestureActive/u);
});

test("the footer keeps document actions but no duplicate object property editor", () => {
  const footer = sourceBetween(
    "{!readOnly ? (\n          <footer",
    "{contextMenu && contextMenuPosition ? ("
  );
  assert.match(footer, /자동 저장|초기화|저장/u);
  assert.doesNotMatch(footer, /이름|색상|화각|패닝|회전|labelDraft/u);
  assert.match(editorSource, /<MetadataInput label="제목"/u);
  assert.match(editorSource, /<MetadataInput label="씬"/u);
  assert.match(editorSource, /<MetadataInput label="컷"/u);
  assert.match(editorSource, /<MetadataInput label="메모"/u);
});

test("editor coordinates never mix offset or device-pixel-ratio math", () => {
  assert.doesNotMatch(editorSource, /\boffset[XY]\b|devicePixelRatio/u);
  assert.match(editorSource, /getScreenCTM\(\)\?\.inverse\(\)/u);
  assert.match(editorSource, /clientPointToShotOverheadWorld/u);
  assert.match(editorSource, /screenDeltaToShotOverheadWorld/u);
});

test("current, PAN, and Ghost camera FOV rays own rotation without moving bodies", () => {
  assert.match(editorSource, /data-shot-overhead-fov-hit="camera"/u);
  assert.match(editorSource, /data-shot-overhead-fov-hit="pan"/u);
  assert.match(editorSource, /data-shot-overhead-fov-hit="ghost"/u);
  assert.match(editorSource, /strokeWidth=\{interactionTargetMetrics\.fovHitWidthPx\}/u);
  assert.match(editorSource, /getShotOverheadRotationFromPointerDrag/u);
  assert.doesNotMatch(editorSource, /id: `camera:\$\{camera\.id\}:rotate`/u);

  const rotateBranch = sourceBetween(
    'if (gesture.kind === "rotate") {',
    'if (gesture.kind === "person-scale") {'
  );
  assert.match(rotateBranch, /gesture\.selection\.kind === "ghost-camera"/u);
  assert.match(rotateBranch, /finalRotation: rotation/u);
  assert.doesNotMatch(rotateBranch, /cameraPans.*finalRotation|points:/u);

  const movementRelease = sourceBetween(
    'if (gesture?.kind === "movement-create"',
    'if (gesture?.kind === "camera-pan"'
  );
  assert.match(movementRelease, /gesture\.sourceType === "camera"/u);
  assert.match(movementRelease, /path\.finalRotation = source\.rotation/u);
});

test("open walls finish on right click and room interiors stay pointer-transparent", () => {
  const roomFinish = sourceBetween(
    "function handleRoomContextMenuCapture(",
    "function handlePointerMove("
  );
  assert.match(roomFinish, /event\.preventDefault\(\)/u);
  assert.match(roomFinish, /event\.stopPropagation\(\)/u);
  assert.match(roomFinish, /finishRoom\(false\)/u);
  assert.match(editorSource, /onContextMenuCapture=\{handleRoomContextMenuCapture\}/u);
  assert.match(editorSource, />\s*열린 벽 완료\s*</u);
  assert.match(editorSource, /strokeWidth=\{interactionTargetMetrics\.roomStrokeHitWidthPx\}/u);
  assert.match(editorSource, /fill="none" stroke="transparent"[^>]*pointerEvents="stroke"[^>]*className="cursor-move"/u);
  assert.doesNotMatch(editorSource, /pointerEvents=\{shape\.closed \? "all" : "stroke"\}/u);
});

test("Ghost Camera is an endpoint selection and not a cloned camera entity", () => {
  assert.match(editorSource, /\{ kind: "ghost-camera"; pathId: string \}/u);
  assert.match(editorSource, /getShotOverheadCameraMovementGhost\(diagram, path\)/u);
  assert.match(editorSource, /setSelected\(\{ kind: "ghost-camera", pathId \}\)/u);
  assert.match(editorSource, /고스트 카메라 최종 방향 선택/u);
  assert.doesNotMatch(editorSource, /cameras:\s*\[\.\.\..*ghost/u);
});

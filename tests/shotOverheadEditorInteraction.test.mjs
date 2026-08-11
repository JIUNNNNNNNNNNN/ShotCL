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

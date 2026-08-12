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

test("the active diagram modal declares ownership of local undo shortcuts", () => {
  assert.match(editorSource, /data-local-undo-scope="active"/u);
  assert.match(editorSource, /command && event\.key\.toLowerCase\(\) === "z"[\s\S]*event\.preventDefault\(\)[\s\S]*undo\(\)/u);
});

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
  assert.match(editorSource, /<MetadataSceneSelect/u);
  assert.doesNotMatch(editorSource, /<MetadataInput label="씬"/u);
  assert.match(editorSource, /<MetadataInput label="컷"/u);
  assert.match(editorSource, /<MetadataInput label="메모"/u);
});

test("scene metadata uses stable scene ids and updates the display scene number together", () => {
  assert.match(editorSource, /export type ShotOverheadEditorMetadata = \{[\s\S]*sceneId: string;[\s\S]*sceneNo: string;/u);
  const metadataBar = sourceBetween(
    '<div className="grid shrink-0 grid-cols-2',
    "{!readOnly ? (\n          <div"
  );
  assert.match(metadataBar, /value=\{selectedScene\?\.id \?\? ""\}/u);
  assert.match(metadataBar, /sceneId: scene\.id,[\s\S]*sceneNo: scene\.sceneNo/u);
  assert.doesNotMatch(metadataBar, /label="장소"|label="소장소"/u);

  const sceneSelect = sourceBetween(
    "function MetadataSceneSelect({",
    "function MetadataInput("
  );
  assert.match(sceneSelect, /<option key=\{scene\.id\} value=\{scene\.id\}>/u);
  assert.match(sceneSelect, /기존 S#\$\{legacySceneNo\} · 씬 선택/u);
  assert.match(sceneSelect, /scene\.subLocation\.trim\(\)/u);
});

test("the compact preset utility derives scene to location to preset and exposes exact actions", () => {
  assert.match(editorSource, /const selectedScene = scenes\.find\(\(scene\) => scene\.id === metadata\.sceneId\) \?\? null/u);
  assert.match(editorSource, /resolveShotOverheadSpaceLocation\(selectedScene\)/u);
  assert.match(editorSource, /spacePresets\.find\(\(preset\) => preset\.location\.key === currentSpaceLocation\.key\)/u);

  const presetTools = sourceBetween(
    "data-shot-overhead-space-preset-tools",
    "</div>\n          </div>\n        ) : null}"
  );
  assert.match(presetTools, /공간 · \{currentSpaceLocation\.displayName\}/u);
  assert.match(presetTools, /프리셋 있음/u);
  assert.match(presetTools, />\s*프리셋 적용\s*</u);
  assert.match(presetTools, /"업데이트 중" : "현재 공간으로 업데이트"/u);
  assert.match(presetTools, /"삭제 중" : "프리셋 삭제"/u);
  assert.match(presetTools, /"저장 중" : "공간 프리셋 저장"/u);
  assert.match(presetTools, /씬리스트에 소장소가 없습니다\./u);
  assert.match(presetTools, /!hasShotOverheadSpace\(diagram\)/u);
  assert.equal(editorSource.match(/data-shot-overhead-space-preset-tools/gu)?.length, 1);
});

test("manual preset apply confirms replacement and records exactly one diagram commit", () => {
  const applyPreset = sourceBetween(
    "function applyCurrentSpacePreset() {",
    "async function saveCurrentSpacePreset() {"
  );
  assert.match(applyPreset, /hasShotOverheadSpace\(diagram\)[\s\S]*window\.confirm/u);
  assert.match(applyPreset, /인물, 카메라, 선과 무빙은 유지됩니다\./u);
  assert.equal(applyPreset.match(/commitDiagram\(/gu)?.length, 1);
  assert.match(applyPreset, /applyShotOverheadSpaceSnapshot\([\s\S]*\{ replace: true \}/u);
  assert.doesNotMatch(applyPreset, /onSave|setPan|people:|cameras:|lines:|movementPaths:|cameraPans:/u);
  assert.equal(editorSource.match(/applyShotOverheadSpaceSnapshot\(/gu)?.length, 1);
});

test("preset persistence is explicit, versioned, immediately deleted, and absent from read-only UI", () => {
  const savePreset = sourceBetween(
    "async function saveCurrentSpacePreset() {",
    "async function deleteCurrentSpacePreset() {"
  );
  assert.match(savePreset, /readOnly/u);
  assert.match(savePreset, /!hasShotOverheadSpace\(diagram\)/u);
  assert.match(savePreset, /onSaveSpacePreset\([\s\S]*selectedScene\.id,[\s\S]*cloneShotOverheadDiagram\(diagram\),[\s\S]*presetAtRequest\?\.updatedAt \?\? null/u);

  const deletePreset = sourceBetween(
    "async function deleteCurrentSpacePreset() {",
    "async function persistAndClose() {"
  );
  assert.match(deletePreset, /readOnly/u);
  assert.doesNotMatch(deletePreset, /window\.confirm/u);
  assert.match(deletePreset, /onDeleteSpacePreset\(presetAtRequest\)/u);

  const editableToolbarStart = editorSource.indexOf("{!readOnly ? (\n          <div");
  const presetTools = editorSource.indexOf("data-shot-overhead-space-preset-tools");
  const readOnlyFooter = editorSource.indexOf(") : <footer");
  assert.ok(editableToolbarStart >= 0 && editableToolbarStart < presetTools);
  assert.ok(presetTools < readOnlyFooter);
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

test("camera and actor body hits cover their exact transformed visual footprint", () => {
  const bodyHitTarget = sourceBetween(
    "function PointerBodyHitTarget({",
    "export function ShotOverheadEditor("
  );
  assert.match(bodyHitTarget, /<PointerHitCircle[\s\S]*className="cursor-move"/u);
  assert.match(bodyHitTarget, /data-shot-overhead-body-hit=\{kind\}/u);
  assert.match(bodyHitTarget, /fill="transparent"/u);
  assert.match(bodyHitTarget, /stroke="transparent"/u);
  assert.match(bodyHitTarget, /strokeWidth="8"/u);
  assert.match(bodyHitTarget, /vectorEffect="non-scaling-stroke"/u);
  assert.match(bodyHitTarget, /pointerEvents="all"/u);
  assert.match(bodyHitTarget, /style=\{\{ touchAction: "none" \}\}/u);
  assert.equal(bodyHitTarget.match(/onPointerDown=\{onPointerDown\}/gu)?.length, 2);

  const actorRender = sourceBetween(
    "{diagram.people.map((person) => {",
    "{diagram.cameras.map((camera) => {"
  );
  assert.match(actorRender, /<PointerBodyHitTarget[\s\S]*kind="person"[\s\S]*x=\{-14\}[\s\S]*y=\{-14\}[\s\S]*width=\{35\}[\s\S]*height=\{28\}/u);
  assert.match(actorRender, /transform=\{`translate\(\$\{person\.x\} \$\{person\.y\}\) rotate\(\$\{person\.rotation\}\) scale\(\$\{person\.scale\}\)`\}/u);
  assert.match(actorRender, /beginPendingMove\(event, \{ kind: "person", id: person\.id \}\)/u);
  assert.match(actorRender, /pointerEvents="none"/u);

  const cameraRender = sourceBetween(
    "{diagram.cameras.map((camera) => {",
    "{lineStart ?"
  );
  assert.match(cameraRender, /<PointerBodyHitTarget[\s\S]*kind="camera"[\s\S]*x=\{-15\}[\s\S]*y=\{-14\}[\s\S]*width=\{41\}[\s\S]*height=\{28\}/u);
  assert.match(cameraRender, /transform=\{`translate\(\$\{camera\.x\} \$\{camera\.y\}\) rotate\(\$\{camera\.rotation\}\)`\}/u);
  assert.match(cameraRender, /beginPendingMove\(event, \{ kind: "camera", id: camera\.id \}\)/u);
  assert.match(cameraRender, /pointerEvents="none"/u);
});

test("body hits remain above FOV, paths, and rooms while controls stay highest", () => {
  const roomLayer = editorSource.indexOf("{diagram.shapes.map((shape) => {");
  const pathLayer = editorSource.indexOf("{diagram.movementPaths.map((path) => {");
  const fovLayer = editorSource.indexOf("{diagram.cameras.filter((camera) => camera.showFov).map((camera) => {");
  const actorBody = editorSource.indexOf('kind="person"', editorSource.indexOf("{diagram.people.map((person) => {"));
  const cameraBody = editorSource.indexOf('kind="camera"', editorSource.indexOf("{diagram.cameras.map((camera) => {"));
  const controls = editorSource.indexOf("data-shot-overhead-control-layer");

  assert.ok(roomLayer >= 0 && roomLayer < actorBody);
  assert.ok(pathLayer >= 0 && pathLayer < actorBody);
  assert.ok(fovLayer >= 0 && fovLayer < actorBody);
  assert.ok(actorBody < cameraBody);
  assert.ok(cameraBody < controls);
  assert.match(editorSource, /onPointerDownCapture=\{handleControlHandlePointerDownCapture\}/u);
  assert.match(editorSource, /fill="none" stroke="transparent"[^>]*pointerEvents="stroke"[^>]*className="cursor-move"/u);
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../app/projects/[id]/storyboard-overhead/page.tsx", import.meta.url),
  "utf8"
);

function sourceBetween(startMarker, endMarker) {
  const start = pageSource.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = pageSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return pageSource.slice(start, end);
}

test("archive load batches diagrams and presets while reusing the existing scene-list request", () => {
  const loadArchive = sourceBetween(
    "const loadArchive = useCallback(async () => {",
    "useEffect(() => {\n    void loadArchive();"
  );

  assert.match(loadArchive, /Promise\.all\(/u);
  assert.equal(loadArchive.match(/loadOverheadArchiveWorkspace\(/gu)?.length, 1);
  assert.equal(loadArchive.match(/getProjectSceneList\(/gu)?.length, 1);
  assert.match(loadArchive, /setDiagramArchives\(workspace\.archives\)/u);
  assert.match(loadArchive, /setSpacePresets\(workspace\.spacePresets\)/u);
  assert.doesNotMatch(pageSource, /listOverheadDiagramArchive/u);
});

test("new diagram setup applies one exact-location preset before editor mount", () => {
  const createFlow = sourceBetween(
    "function openNewDiagram() {",
    "function openDiagram("
  );
  const openExisting = sourceBetween(
    "function openDiagram(",
    "async function saveDiagram("
  );

  assert.match(createFlow, /sceneItems\.length > 0[\s\S]*setNewDiagramSetup\(\{ sceneId: "", cutNo: "" \}\)/u);
  assert.match(createFlow, /createNewDiagramDraft\(null, ""\)/u);
  assert.match(createFlow, /resolveShotOverheadSpaceLocation\(scene\)/u);
  assert.match(createFlow, /item\.location\.key === location\.key/u);
  assert.match(createFlow, /applyShotOverheadSpaceSnapshot\(emptyDiagram, preset\.snapshot, \{ replace: true \}\)/u);
  assert.match(createFlow, /createArchiveShot\([\s\S]*\{ diagram: initialDiagram, sceneNo, cutNo \}/u);
  assert.equal(pageSource.match(/applyShotOverheadSpaceSnapshot\(/gu)?.length, 1);

  assert.match(openExisting, /sceneId: item\.sceneId \?\? ""/u);
  assert.match(openExisting, /shot: createArchiveShot\(projectId, item\)/u);
  assert.doesNotMatch(openExisting, /applyShotOverheadSpaceSnapshot|resolveShotOverheadSpaceLocation/u);
});

test("compact setup is keyboard-modal and derives cuts from loaded scene rows", () => {
  const setupDialog = sourceBetween(
    "function NewDiagramSetupDialog({",
    "function MetadataPopover({"
  );

  assert.match(setupDialog, /role="dialog"/u);
  assert.match(setupDialog, /aria-modal="true"/u);
  assert.match(setupDialog, /autoFocus/u);
  assert.match(setupDialog, /event\.key === "Escape"/u);
  assert.match(setupDialog, /event\.key !== "Tab"/u);
  assert.match(setupDialog, /<option value="">미지정<\/option>/u);
  assert.match(setupDialog, /scene\.id\} value=\{scene\.id\}/u);
  assert.match(setupDialog, /const maxCut = selectedScene\?\.cutCount \?\? 0/u);
  assert.match(setupDialog, /Array\.from\(\{ length: maxCut \}/u);
  assert.match(setupDialog, /씬리스트에 소장소가 없어 빈 부감도로 시작합니다/u);
  assert.doesNotMatch(setupDialog, /\bfetch\b|getProjectSceneList|loadOverheadArchiveWorkspace/u);
});

test("stable scene ids and preset mutations stay wired through save, editor, and grouping", () => {
  const saveDiagram = sourceBetween(
    "async function saveDiagram(",
    "async function saveDiagramSpacePreset("
  );
  const presetMutations = sourceBetween(
    "async function saveDiagramSpacePreset(",
    "function cancelArchivePointerSession("
  );
  const editorRender = sourceBetween(
    "{diagramDraft ? (",
    "{editingAsset ? ("
  );
  const grouping = sourceBetween(
    "function groupArchiveItemsByScene(",
    "function groupArchiveItemsByCut("
  );

  assert.match(saveDiagram, /sceneId: metadata\.sceneId \|\| null/u);
  assert.match(presetMutations, /saveShotOverheadSpacePreset\([\s\S]*sceneId,[\s\S]*diagram,[\s\S]*expectedUpdatedAt/u);
  assert.match(presetMutations, /item\.id !== saved\.id && item\.location\.key !== saved\.location\.key/u);
  assert.match(presetMutations, /deleteShotOverheadSpacePreset\([\s\S]*presetId: preset\.id,[\s\S]*expectedUpdatedAt: preset\.updatedAt/u);
  assert.match(presetMutations, /deleteWithUndo\(\{/u);
  assert.match(presetMutations, /restoreDeletedShotOverheadSpacePreset/u);
  assert.match(presetMutations, /finalizeDeletedShotOverheadSpacePreset/u);
  assert.doesNotMatch(presetMutations, /window\.confirm|\bconfirm\(/u);

  assert.match(editorRender, /sceneId: diagramDraft\.sceneId/u);
  assert.match(editorRender, /scenes=\{sceneItems\}/u);
  assert.match(editorRender, /spacePresets=\{spacePresets\}/u);
  assert.match(editorRender, /onSaveSpacePreset=\{saveDiagramSpacePreset\}/u);
  assert.match(editorRender, /onDeleteSpacePreset=\{deleteDiagramSpacePreset\}/u);

  assert.match(grouping, /const rawSceneId = diagram\.sceneId\?\.trim\(\) \|\| null/u);
  assert.match(grouping, /const scene = rawSceneId \? sceneById\.get\(rawSceneId\) \?\? null : null/u);
  assert.doesNotMatch(grouping, /sceneNo.*sceneById|find\([^\n]*sceneNo/u);
});

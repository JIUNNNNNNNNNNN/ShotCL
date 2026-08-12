import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../app/projects/[id]/scenario/page.tsx", import.meta.url);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("scenario scene deletion is immediate and uses targeted receipt persistence", async () => {
  const source = await readFile(pagePath, "utf8");
  const deleteScene = sourceBetween(
    source,
    "function requestRemoveScene(id: string)",
    "function moveScene("
  );

  assert.match(deleteScene, /deleteWithUndo\(\{/u);
  assert.match(deleteScene, /deleteProjectScenarioScene/u);
  assert.match(deleteScene, /restoreDeletedProjectScenarioScene/u);
  assert.match(deleteScene, /finalizeDeletedProjectScenarioScene/u);
  assert.match(deleteScene, /insertScenarioSceneByAnchors/u);
  assert.doesNotMatch(deleteScene, /updateProjectScenarioScenes|setPendingConfirmation|alertdialog/u);
  assert.doesNotMatch(source, /kind: "scene-delete"/u);
});

test("scenario PDF deletion uses the shared receipt Undo without a confirm or refetch", async () => {
  const source = await readFile(pagePath, "utf8");
  const deleteAsset = sourceBetween(
    source,
    "function deleteAsset(asset: ProjectReferenceAsset)",
    "async function handleSaveScenes("
  );

  assert.match(deleteAsset, /deleteWithUndo\(\{/u);
  assert.match(deleteAsset, /deleteProjectReferenceAsset/u);
  assert.match(deleteAsset, /restoreDeletedProjectReferenceAssets/u);
  assert.match(deleteAsset, /finalizeDeletedProjectReferenceAssets/u);
  assert.match(deleteAsset, /insertScenarioAssetByAnchors/u);
  assert.doesNotMatch(deleteAsset, /load\(|setPendingConfirmation|setIsDeleting|alertdialog/u);
  assert.doesNotMatch(source, /ScenarioConfirmationDialog|pendingConfirmation|삭제한 파일은 복구할 수 없습니다/u);
});

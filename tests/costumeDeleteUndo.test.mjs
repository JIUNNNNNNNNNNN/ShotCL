import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../app/projects/[id]/costumes/page.tsx", import.meta.url);
const itemRoutePath = new URL("../app/api/projects/[projectId]/costumes/route.ts", import.meta.url);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("costume scene and item deletes are immediate reversible server operations", async () => {
  const source = await readFile(pagePath, "utf8");
  const deleteScene = sourceBetween(
    source,
    "function handleSceneDelete(scene: ProjectCostumeScene)",
    "function handleFiles("
  );
  const deleteItem = sourceBetween(
    source,
    "function handleItemDelete(scene: ProjectCostumeScene, item: ProjectCostume)",
    "async function handleSaveAll("
  );

  for (const deleteSource of [deleteScene, deleteItem]) {
    assert.match(deleteSource, /deleteWithUndo\(\{/u);
    assert.match(deleteSource, /removeLocal:/u);
    assert.match(deleteSource, /restoreLocal:/u);
    assert.match(deleteSource, /costumeAutosave\.flushKeys/u);
    assert.ok(
      deleteSource.indexOf("costumeAutosave.flushKeys") < deleteSource.indexOf("deleteWithUndo({"),
      "pre-delete metadata must flush before local removal"
    );
    assert.match(deleteSource, /pendingCostumeDeleteKeysRef/u);
    assert.doesNotMatch(deleteSource, /window\.confirm|setDeletedSceneIds|setDeletedItemIds/u);
  }
  assert.match(deleteScene, /deleteProjectCostumeScene/u);
  assert.match(deleteScene, /restoreDeletedProjectCostumeScene/u);
  assert.match(deleteScene, /finalizeDeletedProjectCostumeScene/u);
  assert.match(deleteItem, /deleteProjectCostume\(projectId, item\.id\)/u);
  assert.match(deleteItem, /restoreDeletedProjectCostume/u);
  assert.match(deleteItem, /finalizeDeletedProjectCostume/u);
});

test("saved costume image delete bypasses ordinary removed-image cleanup until finalize", async () => {
  const [source, routeSource] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(itemRoutePath, "utf8")
  ]);
  const deleteImage = sourceBetween(
    source,
    "function handleSavedImageDelete(item: ProjectCostume, image: CostumeImage)",
    "async function handleSaveAll()"
  );
  const deleteImageRoute = sourceBetween(
    routeSource,
    "async function deleteCostumeImage(projectId: string, body: Record<string, unknown>)",
    "async function restoreDeletedCostumeImage("
  );

  assert.ok(
    deleteImage.indexOf("const preDeleteFlush = costumeAutosave.flushKeys")
      < deleteImage.indexOf("deleteWithUndo({"),
    "the old item autosave must start before optimistic removal"
  );
  assert.match(deleteImage, /if \(!await preDeleteFlush\)[\s\S]*?deleteProjectCostumeImage/u);
  assert.match(deleteImage, /currentEntity[\s\S]*?costumeAutosave\.markSaved\(\[currentEntity\]\)/u);
  const deleteRemote = sourceBetween(deleteImage, "deleteRemote: async () => {", "restoreRemote: async () => {");
  const deleteRemoteSuccess = deleteRemote.slice(0, deleteRemote.indexOf("} catch (error)"));
  assert.doesNotMatch(deleteRemoteSuccess, /releasePending\(\)/u);
  assert.match(deleteImage, /restoreRemote:[\s\S]*?finally \{[\s\S]*?releasePending\(\)/u);
  assert.match(deleteImage, /finalize:[\s\S]*?finally \{[\s\S]*?releasePending\(\)/u);
  assert.match(source, /pendingCostumeDeleteKeysRef\.current\.size > 0[\s\S]*?return;/u);
  assert.match(source, /disabled=\{!isDirty \|\| isSaving \|\| pendingCostumeDeleteCount > 0\}/u);
  assert.match(source, /const canAutosaveMetadata =[\s\S]*?pendingCostumeDeleteCount === 0/u);
  assert.match(source, /validate:[\s\S]*?hasPendingCostumeImageDelete/u);
  assert.doesNotMatch(deleteImageRoute, /storage[\s\S]*?\.remove\(/u);
  assert.match(routeSource, /finalize_deleted_image[\s\S]*?finalizeDeletedCostumeImages/u);
});

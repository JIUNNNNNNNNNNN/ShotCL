import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

test("schedule image delete preserves bytes until global Undo eviction finalizes it", () => {
  const route = readSource("app/api/projects/[projectId]/schedule-images/route.ts");
  const deleteStart = route.indexOf("export async function DELETE");
  const restoreStart = route.indexOf("export async function PUT");
  const finalizeStart = route.indexOf("export async function POST");
  const helperStart = route.indexOf("async function requireAdminProject");
  const stageSource = route.slice(deleteStart, restoreStart);
  const restoreSource = route.slice(restoreStart, finalizeStart);
  const finalizeSource = route.slice(finalizeStart, helperStart);

  assert.ok(deleteStart >= 0 && restoreStart > deleteStart && finalizeStart > restoreStart);
  assert.ok(stageSource.indexOf("createProjectDeleteReceipt") < stageSource.indexOf("saveMealTimes"));
  assert.doesNotMatch(stageSource, /\.storage[\s\S]*\.remove\(/u);
  assert.match(restoreSource, /item\.imageUrl === snapshot\.imageUrl/u);
  assert.match(restoreSource, /if \(item\.imageUrl\)/u);
  assert.match(restoreSource, /candidate\.id === snapshot\.itemId[\s\S]*imageUrl: snapshot\.imageUrl/u);
  assert.ok(finalizeSource.indexOf("stillReferenced") < finalizeSource.indexOf(".remove([snapshot.storagePath])"));
  assert.match(route, /verifyProjectDeleteReceipt/u);
  assert.match(route, /grant\.role !== "admin"/u);
});

test("Progress schedule image deletion joins the one project Undo manager", () => {
  const page = readSource("app/projects/[id]/page.tsx");
  const modal = readSource("components/ProgressScheduleEditorModal.tsx");
  const client = readSource("lib/data/storyboardFiles.ts");

  const handlerStart = page.indexOf("function handleDeleteScheduleImage");
  const handlerEnd = page.indexOf("async function handleAutosaveScheduleMemo", handlerStart);
  const handler = page.slice(handlerStart, handlerEnd);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handler, /deleteWithUndo\(\{/u);
  assert.match(handler, /key: `schedule-image:/u);
  assert.match(handler, /removeLocal:[\s\S]*patchLocalImage\(null\)/u);
  assert.match(handler, /restoreLocal:[\s\S]*patchLocalImage\(originalImageUrl, true\)/u);
  assert.match(handler, /deleteScheduleImageWithReceipt/u);
  assert.match(handler, /restoreScheduleImageDelete/u);
  assert.match(handler, /finalizeScheduleImageDelete/u);
  assert.doesNotMatch(handler, /router\.refresh|location\.reload|window\.confirm|\bconfirm\(/u);

  assert.match(modal, /onDeleteImage\?\.\(imageUrl\)/u);
  assert.match(modal, /onClick=\{deleteImage\}/u);
  assert.doesNotMatch(modal, /window\.confirm|\bconfirm\(/u);
  assert.match(client, /method: "DELETE"/u);
  assert.match(client, /method: "PUT"/u);
  assert.match(client, /method: "POST"/u);
});

test("gathering photo client exposes receipt restore and deferred finalize contracts", () => {
  const client = readSource("lib/data/dailyPlanGatheringPhotos.ts");
  const component = readSource("components/DailyPlanGatheringLocations.tsx");

  assert.match(client, /Promise<GatheringPhotoDeleteResult>/u);
  assert.match(client, /action: "restore-delete"/u);
  assert.match(client, /action: "finalize-delete"/u);
  assert.match(component, /key: `gathering-photo:/u);
  assert.match(component, /restoreDailyPlanGatheringPhoto/u);
  assert.match(component, /finalizeDailyPlanGatheringPhotoDelete/u);
  assert.doesNotMatch(component, /window\.confirm|\bconfirm\(/u);
});

test("reference archive delete signs exact rows, uses revision guards, and defers Storage cleanup", () => {
  const route = readSource("app/api/projects/[projectId]/reference-assets/route.ts");
  const deleteStart = route.indexOf("export async function DELETE");
  const receiptReaderStart = route.indexOf("function readReferenceAssetDeleteReceipt", deleteStart);
  const deleteSource = route.slice(deleteStart, receiptReaderStart);
  const finalizeStart = route.indexOf("async function finalizeDeletedReferenceAssets");
  const finalizeEnd = route.indexOf("async function getProjectId", finalizeStart);
  const finalizeSource = route.slice(finalizeStart, finalizeEnd);

  assert.ok(deleteStart >= 0 && receiptReaderStart > deleteStart);
  assert.ok(deleteSource.indexOf("createProjectDeleteReceipt") < deleteSource.indexOf('from("project_reference_assets")\n          .delete()'));
  assert.match(deleteSource, /\.eq\("updated_at", asset\.updated_at\)/u);
  assert.match(deleteSource, /linkUpdatedAt[\s\S]*\.eq\("updated_at", linkUpdatedAt\)/u);
  assert.match(deleteSource, /sourceDependents[\s\S]*sourceAssetId: null/u);
  assert.match(deleteSource, /restoreReferenceAssetRows[\s\S]*restoreReferenceAssetSourceRelations[\s\S]*restoreReferenceMediaLinks/u);
  assert.doesNotMatch(deleteSource, /\.storage[\s\S]*\.remove\(/u);
  assert.ok(finalizeSource.indexOf("referencedPaths") < finalizeSource.indexOf(".remove(pathBatch)"));
  assert.match(route, /verifyProjectDeleteReceipt/u);
  assert.match(route, /sourceDependentsToRestore[\s\S]*sourceAssetId: relation\.sourceAssetId/u);
});

test("Archive image and diagram deletion is immediate, batched as one global Undo, and has no confirm UI", () => {
  const page = readSource("app/projects/[id]/storyboard-overhead/page.tsx");
  const client = readSource("lib/data/projectReferenceAssets.ts");
  const start = page.indexOf("function executeArchiveDelete(");
  const end = page.indexOf("function requestDraggedAssetDelete", start);
  const flow = page.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(flow, /deleteWithUndo\(\{/u);
  assert.match(flow, /removeLocal:[\s\S]*removeAssetsFromLocalState\(assetIds\)[\s\S]*removeDiagramsFromLocalState\(diagramIds\)/u);
  assert.match(flow, /restoreLocal:[\s\S]*insertSnapshotsAtIndices/u);
  assert.match(flow, /deleteProjectReferenceAssets/u);
  assert.match(flow, /restoreDeletedProjectReferenceAssets/u);
  assert.match(flow, /finalizeDeletedProjectReferenceAssets/u);
  assert.match(flow, /deleteOverheadDiagramArchives/u);
  assert.match(flow, /restoreDeletedOverheadDiagramArchives/u);
  assert.match(flow, /finalizeDeletedOverheadDiagramArchives/u);
  assert.doesNotMatch(page, /CompactConfirm|inspectProjectReferenceAssets|role="alertdialog"|삭제한 이미지는 복구할 수 없습니다/u);
  assert.match(client, /keepalive: receipt\.length <= 48_000/u);
});

test("scenario scene receipts restore by stable id and live neighbor anchors", () => {
  const route = readSource("app/api/projects/[projectId]/reference-assets/route.ts");
  const client = readSource("lib/data/projectReferenceAssets.ts");
  const start = route.indexOf("async function deleteProjectScenarioScene(");
  const end = route.indexOf("async function updateReferenceAssetSceneCut", start);
  const source = route.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(source, /previousSceneId:[\s\S]*nextSceneId:/u);
  assert.match(source, /createProjectDeleteReceipt/u);
  assert.match(source, /readScenarioSceneDeleteReceipt/u);
  assert.match(source, /sameIdScenes/u);
  assert.match(source, /previousIndex[\s\S]*nextIndex[\s\S]*mergedScenes\.splice\(insertIndex, 0, snapshot\.scene\)/u);
  assert.match(source, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/u);
  assert.match(source, /\.eq\("updated_at", current\.updated_at\)/u);
  assert.doesNotMatch(source, /scenario_scenes: snapshot\./u);
  assert.match(client, /export async function deleteProjectScenarioScene/u);
  assert.match(client, /export async function restoreDeletedProjectScenarioScene/u);
  assert.match(client, /export async function finalizeDeletedProjectScenarioScene/u);
});

test("dormant archive-folder deletion is not exposed as a hard-delete escape hatch", () => {
  const route = readSource("app/api/projects/[projectId]/archive-folders/route.ts");
  const client = readSource("lib/data/projectReferenceAssets.ts");

  assert.doesNotMatch(route, /export async function DELETE|deleteFolderTrees|inspect_delete|confirmed|\.storage[\s\S]*\.remove\(/u);
  assert.doesNotMatch(client, /deleteProjectArchiveFolder|deleteProjectArchiveFolders|inspectProjectArchiveFolders/u);
});

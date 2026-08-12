import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readSource("../app/api/projects/[projectId]/shot-diagrams/route.ts");
const clientSource = readSource("../lib/data/shotMediaArchive.ts");

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} is missing`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `${endMarker} is missing after ${startMarker}`);
  return source.slice(start, end);
}

test("archive workspace batches diagrams and presets in the existing single DB select", () => {
  const archiveBranch = sourceBetween(
    routeSource,
    'if (request.nextUrl.searchParams.get("archive") === "1")',
    "const dailyPlanId ="
  );
  assert.equal((archiveBranch.match(/\.from\("shot_diagrams"\)/gu) ?? []).length, 1);
  assert.match(archiveBranch, /archives: \(data \?\? \[\]\)\.flatMap\(mapArchiveRow\)/u);
  assert.match(archiveBranch, /spacePresets: \(data \?\? \[\]\)\.flatMap\(mapSpacePresetRow\)/u);

  const loader = sourceBetween(
    clientSource,
    "export async function loadOverheadArchiveWorkspace",
    "/** Backwards-compatible archive-only wrapper. */"
  );
  assert.equal((loader.match(/await fetch\(/gu) ?? []).length, 1);
  assert.match(loader, /return \{ archives, spacePresets \}/u);
});

test("archive saves validate scene ownership and canonicalize scene numbers server-side", () => {
  const putRoute = sourceBetween(routeSource, "export async function PUT", "export async function DELETE");
  const archiveSave = sourceBetween(
    putRoute,
    'if (operation === "save_archive")',
    'if (operation === "save_link")'
  );
  const sceneLoader = sourceBetween(
    routeSource,
    "async function loadProjectSceneRow",
    "async function loadSpacePresetRow"
  );

  assert.match(archiveSave, /normalizeOptionalUuid\(body\.sceneId\)/u);
  assert.match(archiveSave, /await loadProjectSceneRow\(supabase, projectId, sceneId\)/u);
  assert.match(archiveSave, /sceneNo = normalizeShortText\(scene\.scene_no, 100\)/u);
  assert.match(sceneLoader, /\.select\("scene_no,main_location,sub_location"\)/u);
  assert.match(sceneLoader, /\.eq\("project_id", projectId\)[\s\S]*\.eq\("id", sceneId\)/u);
});

test("preset writes derive the composite location from the project scene and use CAS", () => {
  const save = sourceBetween(
    routeSource,
    "async function saveSpacePreset",
    "async function deleteSpacePreset"
  );
  const sceneResolver = sourceBetween(
    routeSource,
    "async function resolveProjectSceneSpaceLocation",
    "async function loadSpacePresetRow"
  );
  const refBuilder = sourceBetween(
    routeSource,
    "function toSpacePresetRef",
    "function normalizeExpectedUpdatedAt"
  );

  assert.match(sceneResolver, /\.from\("project_scene_items"\)/u);
  assert.match(sceneResolver, /\.eq\("project_id", projectId\)[\s\S]*\.eq\("id", sceneId\)/u);
  assert.match(sceneResolver, /resolveShotOverheadSpaceLocation/u);
  assert.match(save, /extractShotOverheadSpaceSnapshot\(diagram\)/u);
  assert.match(save, /SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID/u);
  assert.match(save, /SHOT_OVERHEAD_SPACE_PRESET_DATA_KIND/u);
  assert.match(save, /\.insert\([\s\S]*\.update\([\s\S]*\.eq\("updated_at", expected\.value\)/u);
  assert.match(save, /areShotOverheadSpaceSnapshotsEqual/u);
  assert.match(refBuilder, /createHash\("sha256"\)\.update\(locationKey/u);
});

test("preset rows cannot leak into legacy archives or generic daily-plan reads", () => {
  const archiveMapper = sourceBetween(routeSource, "function mapArchiveRow", "function mapSpacePresetRow");
  const getRoute = sourceBetween(routeSource, "export async function GET", "export async function PUT");
  const accessCheckIndex = getRoute.indexOf("await getDiagramAccessRole(request, projectId)");
  const archiveIndex = getRoute.indexOf('request.nextUrl.searchParams.get("archive") === "1"');
  assert.match(archiveMapper, /source\.kind === SHOT_OVERHEAD_SPACE_PRESET_DATA_KIND/u);
  assert.match(archiveMapper, /sceneId: archive \? normalizeOptionalUuid\(source\.sceneId\) : null/u);
  assert.ok(accessCheckIndex >= 0 && archiveIndex > accessCheckIndex);
  assert.match(
    getRoute,
    /dailyPlanId === SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID[\s\S]*회차 식별값이 올바르지 않습니다/u
  );
});

test("preset create, update, and delete stay behind the existing admin gate", () => {
  const putRoute = sourceBetween(routeSource, "export async function PUT", "export async function DELETE");
  const deleteRoute = sourceBetween(routeSource, "export async function DELETE", "async function saveSpacePreset");
  const deletePreset = sourceBetween(
    routeSource,
    "async function deleteSpacePreset",
    "async function resolveProjectSceneSpaceLocation"
  );
  assert.match(putRoute, /role !== "admin"[\s\S]*operation === "save_space_preset"/u);
  assert.match(deleteRoute, /role !== "admin"[\s\S]*operation\) === "delete_space_preset"/u);
  assert.match(deletePreset, /\.eq\("project_id", projectId\)/u);
  assert.match(deletePreset, /\.eq\("daily_plan_id", SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID\)/u);
  assert.match(deletePreset, /\.contains\("data", \{ kind: SHOT_OVERHEAD_SPACE_PRESET_DATA_KIND \}\)/u);
  assert.match(deletePreset, /expected\.value === null[\s\S]*\.eq\("updated_at", expected\.value\)/u);
  assert.match(deletePreset, /select\("\*"\)[\s\S]*payload: \{ preset: presetRow \}[\s\S]*\.eq\("updated_at", expected\.value\)/u);
  assert.match(deletePreset, /return spacePresetConflictResponse\(\)/u);
});

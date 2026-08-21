import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { normalizeSceneNumber } from "../lib/sceneNumber.ts";
import { setActorCellState } from "../lib/sceneListDisplay.ts";
import { isValidDatabaseProjectId } from "../lib/projectId.ts";
import { createDeterministicSceneListId } from "../lib/server/deterministicSceneListId.ts";
import {
  containsExactActorName,
  createStableScenarioSceneSourceId,
  hasClassifiableScenarioText,
  planSceneListAutoClassification
} from "../lib/sceneListAutoClassification.ts";

const projectRoot = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, projectRoot).href, context);
    }
    return nextResolve(specifier, context);
  }
});

const { normalizeProjectBasicInfo } = await import("../lib/projectBasicInfo.ts");

const projectId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";

const actors = [
  { id: "project_actor_yuri", role: "유리", name: "김배우" },
  { id: "project_actor_sword", role: "검", name: "박배우" },
  { id: "project_actor_min", role: "민", name: "최배우" }
];

test("automatic rows use stable UUIDv5 IDs accepted by existing database boundaries", () => {
  const first = createDeterministicSceneListId(projectId, "1-1");
  assert.equal(first, createDeterministicSceneListId(projectId, "1-1"));
  assert.equal(first, createDeterministicSceneListId(projectId.toUpperCase(), "1-1"));
  assert.notEqual(first, createDeterministicSceneListId(projectId, "1-01"));
  assert.notEqual(first, createDeterministicSceneListId(
    "33333333-3333-4333-8333-333333333333",
    "1-1"
  ));
  assert.equal(first[14], "5");
  assert.equal(isValidDatabaseProjectId(first), true);
});

test("legacy parsed scenes receive the same stable source ID on every classification rerun", () => {
  const canonicalSceneNo = normalizeSceneNumber(" S#1-1 ");
  const first = createStableScenarioSceneSourceId(assetId, canonicalSceneNo, "");
  const rerun = createStableScenarioSceneSourceId(assetId, canonicalSceneNo, undefined);

  assert.equal(first, `shotcl:${assetId}:scene:1-1`);
  assert.equal(rerun, first);
  assert.equal(
    createStableScenarioSceneSourceId(assetId, canonicalSceneNo, "persisted-scene-id"),
    "persisted-scene-id"
  );
});

test("actor matching accepts Korean particles but rejects substring and performer-name matches", () => {
  assert.equal(containsExactActorName("유리가 들어온다.", "유리"), true);
  assert.equal(containsExactActorName("유리에게도 연락한다.", "유리"), true);
  assert.equal(containsExactActorName("유리와는 다른 선택이다.", "유리"), true);
  assert.equal(containsExactActorName("검은 창가에 선다.", "검"), true);
  assert.equal(containsExactActorName("민수는 밖으로 나간다.", "민"), false);
  assert.equal(containsExactActorName("유리에게도움이 된다.", "유리"), false);

  const plan = planSceneListAutoClassification({
    projectId,
    scenarioScenes: [{ sceneNo: "S#1", text: "김배우가 들어오지만 유리는 없다." }],
    existingRows: [],
    actors,
    normalizeSceneNumber,
    createSceneId: () => assetId
  });
  assert.deepEqual(Object.keys(plan.newRows[0].actor_cells), ["유리"]);

  const performerOnly = planSceneListAutoClassification({
    projectId,
    scenarioScenes: [{ sceneNo: "S#1", text: "김배우가 들어온다." }],
    existingRows: [],
    actors,
    normalizeSceneNumber,
    createSceneId: () => assetId
  });
  assert.deepEqual(performerOnly.newRows[0].actor_cells, {});
});

test("longest overlapping role wins while a separate exact role occurrence still links by stable actor id", () => {
  const collisionActors = [
    { id: "project_actor_yuri", role: "유리", name: "김배우" },
    { id: "project_actor_yuri-mother", role: "유리 엄마", name: "이배우" }
  ];
  const longerOnly = planSceneListAutoClassification({
    projectId,
    scenarioScenes: [{ sceneNo: "S#1", text: "유리 엄마가 현관으로 들어온다." }],
    existingRows: [],
    actors: collisionActors,
    normalizeSceneNumber,
    createSceneId: () => assetId
  });
  assert.deepEqual(Object.keys(longerOnly.newRows[0].actor_cells), ["유리 엄마"]);
  assert.equal(
    longerOnly.newRows[0].actor_cells["유리 엄마"].actorId,
    "project_actor_yuri-mother"
  );

  const separateOccurrence = planSceneListAutoClassification({
    projectId,
    scenarioScenes: [{
      sceneNo: "S#1",
      text: "유리 엄마가 현관으로 들어오고, 유리는 거실에서 기다린다."
    }],
    existingRows: [],
    actors: collisionActors,
    normalizeSceneNumber,
    createSceneId: () => assetId
  });
  assert.deepEqual(Object.keys(separateOccurrence.newRows[0].actor_cells), ["유리", "유리 엄마"]);
});

test("legacy Basic Info actors reuse the canonical synthesized stable id", () => {
  const [legacyActor] = normalizeProjectBasicInfo({
    actors: [{ role: "유리", name: "김배우" }]
  }).actors;
  assert.match(legacyActor.id, /^project_actor_[0-9a-z-]+$/u);

  const plan = planSceneListAutoClassification({
    projectId,
    scenarioScenes: [{ sceneNo: "S#1", text: "유리가 방으로 들어온다." }],
    existingRows: [],
    actors: [legacyActor],
    normalizeSceneNumber,
    createSceneId: () => assetId
  });
  assert.equal(plan.newRows[0].actor_cells.유리.actorId, legacyActor.id);
});

test("classification preserves source order and canonical hyphen identity while skipping duplicates", () => {
  const plan = planSceneListAutoClassification({
    projectId,
    scenarioScenes: [
      { sceneNo: "S#1-1", text: "유리가 들어온다. 검은 창가에 선다. 민수는 나간다." },
      { sceneNo: "1-1", text: "중복" },
      { sceneNo: "S#2", text: "미등록 인물" },
      { sceneNo: "S#1-01", text: "유리가 앉는다." }
    ],
    existingRows: [],
    actors,
    normalizeSceneNumber,
    createSceneId: (sceneNo) => ({
      "1-1": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "2": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "1-01": "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    })[sceneNo]
  });

  assert.equal(plan.totalProcessedCount, 3);
  assert.equal(plan.skippedDuplicateCount, 1);
  assert.deepEqual(plan.newRows.map((row) => row.scene_no), ["1-1", "2", "1-01"]);
  assert.deepEqual(plan.newRows.map((row) => row.sort_order), [1, 2, 3]);
  assert.deepEqual(Object.keys(plan.newRows[0].actor_cells), ["유리", "검"]);
  assert.equal(plan.newRows[0].actor_cells.유리.actorId, "project_actor_yuri");
  assert.equal(plan.newRows[0].actor_cells.검.actorId, "project_actor_sword");
  assert.equal(plan.newRows[0].actor_cells.민, undefined);
  assert.equal(plan.newRows[0].scene_content, "", "raw body must not masquerade as a summary");
});

test("existing manual fields and actors are unioned, separators dedupe, and rerun is idempotent", () => {
  const existing = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    sceneNo: "1",
    characters: "유리/수동역|검",
    actorCells: {
      유리: { mode: "text", text: "수동 메모" },
      수동역: { mode: "color" },
      검: { mode: "color", actorId: "project_actor_sword" }
    },
    sortOrder: 7,
    updatedAt: "2026-08-21T00:00:00.000Z"
  };
  const first = planSceneListAutoClassification({
    projectId,
    scenarioScenes: [{ sceneNo: "S#1", text: "유리가 온다. 검은 기다린다." }],
    existingRows: [existing],
    actors,
    normalizeSceneNumber,
    createSceneId: () => assetId
  });

  assert.equal(first.newRows.length, 0);
  assert.equal(first.existingUpdates.length, 1);
  assert.equal(first.existingUpdates[0].characters, "유리/수동역|검");
  assert.deepEqual(first.existingUpdates[0].actorCells.수동역, { mode: "color" });
  assert.deepEqual(first.existingUpdates[0].actorCells.유리, {
    mode: "text",
    text: "수동 메모",
    actorId: "project_actor_yuri"
  });

  const rerun = planSceneListAutoClassification({
    projectId,
    scenarioScenes: [{ sceneNo: "S#1", text: "유리가 온다. 검은 기다린다." }],
    existingRows: [{
      ...existing,
      characters: first.existingUpdates[0].characters,
      actorCells: first.existingUpdates[0].actorCells,
      sortOrder: first.existingUpdates[0].sortOrder
    }],
    actors,
    normalizeSceneNumber,
    createSceneId: () => assetId
  });
  assert.equal(rerun.newRows.length, 0);
  assert.equal(rerun.existingUpdates.length, 0);
});

test("missing canonical scenes are inserted in parser order without deleting manual rows", () => {
  const sceneOne = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sceneNo: "1",
    characters: "수동역",
    actorCells: { 수동역: { mode: "text", text: "수동 메모" } },
    sortOrder: 1,
    updatedAt: "2026-08-21T00:00:00.000Z"
  };
  const sceneThree = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sceneNo: "3",
    characters: "",
    actorCells: {},
    sortOrder: 2,
    updatedAt: "2026-08-21T00:00:00.000Z"
  };
  const manualScene = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    sceneNo: "A",
    characters: "직접 입력",
    actorCells: { "직접 입력": { mode: "color" } },
    sortOrder: 3,
    updatedAt: "2026-08-21T00:00:00.000Z"
  };
  const plan = planSceneListAutoClassification({
    projectId,
    scenarioScenes: [
      { sceneNo: "S#1", text: "첫 장면" },
      { sceneNo: "S#2", text: "둘째 장면" },
      { sceneNo: "S#3", text: "셋째 장면" }
    ],
    existingRows: [{ ...sceneOne, sortOrder: 1 }, { ...manualScene, sortOrder: 2 }, {
      ...sceneThree,
      sortOrder: 3
    }],
    actors: [],
    normalizeSceneNumber,
    createSceneId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  });

  assert.deepEqual(plan.newRows.map((row) => [row.scene_no, row.sort_order]), [["2", 3]]);
  assert.deepEqual(
    plan.existingUpdates.map((update) => [update.id, update.sortOrder]),
    [[sceneThree.id, 4]]
  );
  assert.equal(plan.existingUpdates.some((update) => update.id === manualScene.id), false);
});

test("classification distinguishes missing scene bodies from valid canonical text", () => {
  assert.equal(hasClassifiableScenarioText([
    { sceneNo: "1", text: "" },
    { sceneNo: "2", text: "  \n\t" }
  ]), false);
  assert.equal(hasClassifiableScenarioText([
    { sceneNo: "1", text: "" },
    { sceneNo: "2", text: "인물이 방으로 들어온다." }
  ]), true);
});

test("ordinary actor-cell mode edits preserve an imported stable actor id", () => {
  const item = {
    id: assetId,
    projectId,
    sceneNo: "1",
    mainLocation: "",
    subLocation: "",
    dayLabel: "",
    dayNight: "",
    interiorExterior: "",
    sceneContent: "",
    characters: "유리",
    characterNotes: "",
    actorCells: {
      유리: { mode: "color", actorId: "project_actor_yuri" }
    },
    props: "",
    cutCount: null,
    sortOrder: 1,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z"
  };
  const text = setActorCellState(item, "유리", { mode: "text", text: "특이사항" });
  assert.equal(text.actorCells.유리.actorId, "project_actor_yuri");
  assert.equal(text.actorCells.유리.text, "특이사항");
  const color = setActorCellState(text, "유리", { mode: "color", text: "" });
  assert.equal(color.actorCells.유리.actorId, "project_actor_yuri");
});

test("server route is project-scoped, capability-strict, batch-loaded, and CAS-safe", async () => {
  const route = await readFile(
    new URL("../app/api/projects/[projectId]/scene-list/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /body\.action === "classify-scenario-scenes"/);
  assert.match(route, /scope\.access\?\.mode !== "member"/);
  assert.match(route, /scope\.access\.editorEligible !== true/);
  assert.match(route, /scope\.access\.grant\.role !== "admin"/);
  assert.match(route, /const access = await getProjectRequestAccess\(request, projectId\)/);
  assert.match(route, /const expectedKeys = \["action", "scenarioAssetId"\]/);
  assert.match(route, /export const runtime = "nodejs"/u);
  assert.match(route, /export const dynamic = "force-dynamic"/u);
  assert.match(route, /export const maxDuration = 60/u);
  assert.match(route, /\.from\("project_reference_assets"\)[\s\S]*?\.eq\("project_id", projectId\)[\s\S]*?\.eq\("id", scenarioAssetId\)[\s\S]*?\.eq\("asset_type", "scenario"\)/);
  assert.match(route, /Promise\.all\(\[/);
  assert.match(route, /normalizeProjectBasicInfo\(\{ actors: basicInfoResult\.data\?\.actors \}\)\.actors/);
  assert.doesNotMatch(route, /extractRegisteredActors/);
  assert.match(route, /if \(!hasClassifiableScenarioText\(scenarioScenes\)\)/);
  assert.match(route, /\.upsert\(plan\.newRows, \{ onConflict: "id", ignoreDuplicates: true \}\)/);
  assert.match(route, /\.eq\("project_id", projectId\)[\s\S]*?\.eq\("id", update\.id\)[\s\S]*?\.eq\("updated_at", update\.expectedUpdatedAt\)/);
  assert.match(route, /plan\.existingUpdates\.length - successfulUpdates\.length/);
  assert.match(route, /\.select\("id,storage_path,scenario_scenes,updated_at"\)/u);
  assert.match(route, /\.download\(storagePath\)/u);
  assert.match(route, /reconcileRecoveredScenarioSceneText\(storedScenes, extraction\.scenes\)/u);
  assert.match(route, /\.eq\("asset_type", "scenario"\)[\s\S]*?\.eq\("updated_at", expectedUpdatedAt\)/u);
  assert.match(route, /\.select\("id,scene_no,scene_content,characters,actor_cells,sort_order,updated_at"\)/u);
  assert.match(route, /summarizeScenarioScenesWithOpenAi/u);
  assert.match(route, /\.eq\("updated_at", candidate\.expectedUpdatedAt\)[\s\S]*?\.eq\("scene_content", ""\)/u);
  assert.ok(
    route.indexOf("const recovery = await recoverScenarioSceneTextBeforeClassification")
      < route.indexOf("const plan = planSceneListAutoClassification"),
    "server text recovery must finish before Scene List writes"
  );
  assert.ok(
    route.indexOf("const updateResults") < route.indexOf("const summaryCounts"),
    "deterministic Scene/Actor writes must finish before AI summaries"
  );
});

test("reference asset normalization retains bounded multiline parser text", async () => {
  const route = await readFile(
    new URL("../app/api/projects/[projectId]/reference-assets/route.ts", import.meta.url),
    "utf8"
  );
  const recovery = await readFile(
    new URL("../lib/server/scenarioSceneTextRecovery.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /normalizeStoredProjectScenarioScenes/u);
  assert.match(recovery, /MAX_SCENARIO_SCENE_TEXT_LENGTH/u);
  assert.match(recovery, /normalizeScenarioSceneBodyText\(source\.text\)/u);
  assert.doesNotMatch(route, /sceneNo:[\s\S]{0,500}?text: ""/);
});

test("client mutation is API-only and rejects malformed count payloads", async () => {
  const dataHelper = await readFile(
    new URL("../lib/data/sceneList.ts", import.meta.url),
    "utf8"
  );
  assert.match(dataHelper, /export async function classifyProjectScenarioScenes/);
  assert.match(dataHelper, /action: "classify-scenario-scenes"/);
  assert.match(dataHelper, /typeof value === "number" && Number\.isInteger\(value\) && value >= 0/);
  assert.match(dataHelper, /summarySavedCount/u);
  assert.match(dataHelper, /summaryFailedCount/u);
  assert.match(dataHelper, /summaryConflictCount/u);
  assert.match(dataHelper, /summarySkippedContentCount/u);
  assert.match(dataHelper, /configuration_error/u);
  assert.match(dataHelper, /씬리스트 자동 분류 응답이 올바르지 않습니다/);
  const helperStart = dataHelper.indexOf("export async function classifyProjectScenarioScenes");
  const helperEnd = dataHelper.indexOf("\n}\n", helperStart) + 3;
  const helperSource = dataHelper.slice(helperStart, helperEnd);
  assert.doesNotMatch(helperSource, /localStorage|readLocalSceneList|writeLocalSceneList/);
});

test("Desktop and Phone read the same canonical actor and content fields", async () => {
  const [desktop, phone, dataHelper] = await Promise.all([
    readFile(new URL("../components/SceneListNativeTable.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/SceneListPortraitReadOnly.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/data/sceneList.ts", import.meta.url), "utf8")
  ]);
  assert.match(dataHelper, /sceneContent: String\(row\.scene_content \?\? ""\)/u);
  assert.match(dataHelper, /actorCells: normalizeActorCells\(row\.actor_cells\)/u);
  assert.match(desktop, /value=\{item\.sceneContent\}/u);
  assert.match(desktop, /getActorCellState\(item, role\)/u);
  assert.match(phone, /\{item\.sceneContent\}/u);
  assert.match(phone, /Object\.keys\(item\.actorCells \?\? \{\}\)/u);
});

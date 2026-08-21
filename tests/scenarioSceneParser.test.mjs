import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, projectRoot).href, context);
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../"))
      && !/\.[cm]?[jt]sx?$/.test(specifier)
    ) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
    }
    return nextResolve(specifier, context);
  }
});

const { normalizeSceneNumber } = await import("../lib/sceneNumber.ts");
const {
  inspectScenarioSceneMarker,
  MAX_SCENARIO_SCENE_TEXT_LENGTH,
  parseScenarioSceneMarker
} = await import("../lib/scenarioSceneMarker.ts");
const { splitScenarioScenesByNumber } = await import("../lib/server/scenarioSceneParser.ts");

test("scene numbers preserve one optional hyphen segment as string identity", () => {
  assert.equal(normalizeSceneNumber("1"), "1");
  assert.equal(normalizeSceneNumber("S#0002"), "2");
  assert.equal(normalizeSceneNumber("1-1"), "1-1");
  assert.equal(normalizeSceneNumber("1-2"), "1-2");
  assert.equal(normalizeSceneNumber("10-3"), "10-3");
  assert.equal(normalizeSceneNumber("Scene 001 - 01"), "1-01");
  assert.equal(normalizeSceneNumber("1-01"), "1-01");
  assert.notEqual(normalizeSceneNumber("1-1"), normalizeSceneNumber("1-01"));
});

test("scenario markers accept numeric and numeric-hyphen tokens only in explicit heading context", () => {
  assert.equal(parseScenarioSceneMarker("S#1. 안방 / 낮")?.sceneNo, "1");
  assert.equal(parseScenarioSceneMarker("S#1-1. 안방 / 낮")?.sceneNo, "1-1");
  assert.equal(parseScenarioSceneMarker("Scene 10 - 03 : 골목 / 밤")?.sceneNo, "10-03");
  assert.equal(parseScenarioSceneMarker("씬2-1 옥상")?.sceneNo, "2-1");
  assert.equal(parseScenarioSceneMarker("#3-2")?.sceneNo, "3-2");

  const bare = inspectScenarioSceneMarker("1-1");
  assert.equal(bare.marker, null);
  assert.equal(bare.isCandidate, true);
  assert.equal(bare.rejectReason, "bare_number");
});

test("dates, numeric ranges, phones, and a third numeric segment do not become scene markers", () => {
  for (const line of [
    "2026-08-15",
    "10:20",
    "12",
    "Page 12",
    "10-20분 뒤",
    "010-1234-5678",
    "대사 속 1-1 숫자",
    "S#2026-08-15",
    "S#10-20분 뒤",
    "Scene 1-2-3"
  ]) {
    assert.equal(parseScenarioSceneMarker(line), null, line);
  }
  assert.equal(normalizeSceneNumber("2026-08-15"), "");
  assert.equal(normalizeSceneNumber("10-20분 뒤"), "");
  assert.equal(normalizeSceneNumber("1-2-3"), "");
});

test("scenario splitting preserves document order, distinct suffixes, and body source order", () => {
  const scenes = splitScenarioScenesByNumber([{
    page: 1,
    text: [
      "S#1-1. 안방 / 낮",
      "유리가 들어온다.",
      "검은 창가에 선다.",
      "S#1. 주방 / 낮",
      "식탁을 바라본다.",
      "S#2. 복도 / 밤",
      "두 사람이 마주친다.",
      "S#1-01. 마당 / 낮",
      "바람이 분다.",
      "S#1-3. 현관 / 낮",
      "문이 열린다."
    ].join("\n")
  }]);

  assert.deepEqual(scenes.map((scene) => scene.sceneNo), ["1-1", "1", "2", "1-01", "1-3"]);
  assert.equal(scenes[0]?.text, "유리가 들어온다.\n검은 창가에 선다.");
  assert.equal(scenes[1]?.text, "식탁을 바라본다.");
  assert.equal(scenes[2]?.text, "두 사람이 마주친다.");
  assert.equal(scenes[3]?.text, "바람이 분다.");
  assert.equal(scenes[4]?.text, "문이 열린다.");
});

test("scenario splitting keeps the first duplicate marker and bounds stored body text", () => {
  const body = "가".repeat(MAX_SCENARIO_SCENE_TEXT_LENGTH + 50);
  const scenes = splitScenarioScenesByNumber([
    { page: 1, text: `S#1-1\n${body}` },
    { page: 2, text: "S#1-1\n중복 marker 내용" },
    { page: 3, text: "S#2\n마지막 씬" }
  ]);

  assert.deepEqual(scenes.map((scene) => scene.sceneNo), ["1-1", "2"]);
  assert.equal(scenes[0]?.pageStart, 1);
  assert.equal(scenes[0]?.pageEnd, 2);
  assert.equal(scenes[0]?.text.length, MAX_SCENARIO_SCENE_TEXT_LENGTH);
  assert.equal(scenes[1]?.text, "마지막 씬");
});

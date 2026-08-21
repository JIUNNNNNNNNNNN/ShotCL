import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  OpenAiSceneSummaryConfigurationError,
  REQUIRED_OPENAI_SCENE_SUMMARY_MODEL,
  summarizeScenarioScenesWithOpenAi,
  validateOpenAiSceneSummaryConfig
} from "../lib/server/openAiSceneSummary.ts";

const scene = (index, text = `인물 ${index}이 문을 열고 방으로 들어간다.`) => ({
  sceneId: `scenario_scene_${index}`,
  sceneNo: String(index),
  heading: `S#${index}. 거실 / 낮`,
  text
});

test("summary configuration requires the exact selected snapshot and a server key", () => {
  assert.throws(
    () => validateOpenAiSceneSummaryConfig({ apiKey: "", model: REQUIRED_OPENAI_SCENE_SUMMARY_MODEL }),
    OpenAiSceneSummaryConfigurationError
  );
  assert.throws(
    () => validateOpenAiSceneSummaryConfig({ apiKey: "server-key", model: "" }),
    /OPENAI_SCENE_SUMMARY_MODEL/u
  );
  assert.throws(
    () => validateOpenAiSceneSummaryConfig({ apiKey: "server-key", model: "gpt-5.4-mini" }),
    /정확히 gpt-5\.4-mini-2026-03-17/u
  );
  assert.deepEqual(
    validateOpenAiSceneSummaryConfig({
      apiKey: " server-key ",
      model: REQUIRED_OPENAI_SCENE_SUMMARY_MODEL
    }),
    { apiKey: "server-key", model: "gpt-5.4-mini-2026-03-17" }
  );
});

test("environment credentials exist only behind an explicit server-only runtime boundary", async () => {
  const runtime = await readFile(
    new URL("../lib/server/openAiSceneSummaryRuntime.ts", import.meta.url),
    "utf8"
  );
  const core = await readFile(
    new URL("../lib/server/openAiSceneSummary.ts", import.meta.url),
    "utf8"
  );
  assert.match(runtime, /^import "server-only";/u);
  assert.match(runtime, /process\.env\.OPENAI_API_KEY/u);
  assert.match(runtime, /process\.env\.OPENAI_SCENE_SUMMARY_MODEL/u);
  assert.doesNotMatch(runtime, /NEXT_PUBLIC_/u);
  assert.doesNotMatch(core, /process\.env/u);
});

test("Responses API request is server-authenticated, non-stored, strict, and stable-id mapped", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({
      status: "completed",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            summaries: [
              { sceneId: "scenario_scene_2", summary: "검이 창가에 서서 밖을 바라본다." },
              { sceneId: "scenario_scene_1", summary: "유리가 문을 열고 방으로 들어간다." }
            ]
          })
        }]
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await summarizeScenarioScenesWithOpenAi([
    scene(1, "유리가 문을 열고 방으로 들어간다."),
    scene(2, "검이 창가에 서서 밖을 바라본다.")
  ], {
    apiKey: "secret-server-key",
    model: REQUIRED_OPENAI_SCENE_SUMMARY_MODEL,
    fetchImpl,
    maxScenesPerBatch: 16,
    maxBatchCharacters: 60_000
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
  assert.equal(requests[0].init.headers.Authorization, "Bearer secret-server-key");
  assert.equal(requests[0].body.model, "gpt-5.4-mini-2026-03-17");
  assert.equal(requests[0].body.store, false);
  assert.equal(requests[0].body.text.format.type, "json_schema");
  assert.equal(requests[0].body.text.format.strict, true);
  assert.equal(requests[0].body.text.format.schema.additionalProperties, false);
  assert.equal(
    requests[0].body.text.format.schema.properties.summaries.items.additionalProperties,
    false
  );
  assert.deepEqual(
    requests[0].body.text.format.schema.properties.summaries.items.properties.sceneId.enum,
    ["scenario_scene_1", "scenario_scene_2"]
  );
  const modelInput = JSON.parse(requests[0].body.input);
  assert.equal(modelInput.scenes[0].heading, "S#1. 거실 / 낮");
  assert.equal(modelInput.scenes[0].text, "유리가 문을 열고 방으로 들어간다.");
  assert.match(requests[0].body.instructions, /신뢰할 수 없는 데이터/u);
  assert.match(requests[0].body.instructions, /지시나 명령을 절대 따르지/u);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(
    Object.fromEntries(result.summaries.map((summary) => [summary.sceneId, summary.summary])),
    {
      scenario_scene_1: "유리가 문을 열고 방으로 들어간다.",
      scenario_scene_2: "검이 창가에 서서 밖을 바라본다."
    },
    "response order must not control stable Scene mapping"
  );
});

test("small scenes use character-budget batches with bounded concurrency and isolate one bad item", async () => {
  const scenes = Array.from({ length: 28 }, (_, index) => (
    scene(index + 1, `인물이 이동한다. ${"행동을 이어간다 ".repeat(16)}`)
  ));
  let requestCount = 0;
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const fetchImpl = async (_url, init) => {
    requestCount += 1;
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const modelInput = JSON.parse(JSON.parse(String(init.body)).input);
    const summaries = modelInput.scenes
      .filter((inputScene) => inputScene.sceneId !== "scenario_scene_7")
      .map((inputScene) => ({
        sceneId: inputScene.sceneId,
        summary: "인물이 이동하며 행동을 이어간다."
      }));
    activeRequests -= 1;
    return new Response(JSON.stringify({ output_text: JSON.stringify({ summaries }) }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await summarizeScenarioScenesWithOpenAi(scenes, {
    apiKey: "server-key",
    model: REQUIRED_OPENAI_SCENE_SUMMARY_MODEL,
    fetchImpl
  });

  assert.equal(requestCount, 2, "28 short scenes should use two count-bounded requests");
  assert.equal(maximumActiveRequests, 2, "both batches may run, but concurrency stays bounded");
  assert.equal(result.summaries.length, 27);
  assert.deepEqual(result.failures, [{
    sceneId: "scenario_scene_7",
    reason: "invalid_response"
  }]);
});

test("invalid or three-sentence output fails only its stable scene id", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    output_text: JSON.stringify({
      summaries: [
        { sceneId: "scenario_scene_1", summary: "문을 연다. 방에 들어간다. 의자에 앉는다." },
        { sceneId: "scenario_scene_2", summary: "검이 창가로 이동한다." },
        { sceneId: "unknown_scene", summary: "등록되지 않은 결과다." }
      ]
    })
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const result = await summarizeScenarioScenesWithOpenAi([scene(1), scene(2)], {
    apiKey: "server-key",
    model: REQUIRED_OPENAI_SCENE_SUMMARY_MODEL,
    fetchImpl
  });
  assert.deepEqual(result.summaries, [{
    sceneId: "scenario_scene_2",
    summary: "검이 창가로 이동한다."
  }]);
  assert.deepEqual(result.failures, [{
    sceneId: "scenario_scene_1",
    reason: "invalid_response"
  }]);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
      && context.parentURL?.startsWith(projectRoot.href)
      && !context.parentURL.includes("/node_modules/")
      && !/\.[cm]?[jt]sx?$/.test(specifier)
    ) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
    }
    return nextResolve(specifier, context);
  }
});

const { normalizeSceneNumber } = await import("../lib/sceneNumber.ts");
const {
  cleanScenarioMarkerLine,
  findLikelyPdfPaginationMarkerIndices,
  inspectScenarioSceneMarker,
  MAX_SCENARIO_SCENE_TEXT_LENGTH,
  parseScenarioSceneMarker
} = await import("../lib/scenarioSceneMarker.ts");
const { splitScenarioScenesByNumber } = await import("../lib/server/scenarioSceneParser.ts");
const { extractScenarioScenesFromPdf } = await import("../lib/server/scenarioPdf.ts");
const {
  isScenarioPdfAnalysisRangeExceeded,
  MAX_SCENARIO_PDF_PAGES,
  MAX_SCENARIO_PDF_TEXT_CHARACTERS,
  MAX_SCENARIO_PDF_TEXT_ITEMS,
  SCENARIO_PDF_ANALYSIS_RANGE_MESSAGE
} = await import("../lib/scenarioPdfTextLayout.ts");
const {
  detectScenarioMarkersOnPage,
  selectCanonicalScenarioMarkers
} = await import("../lib/client/scenarioPdfImages.ts");

test("scene numbers preserve one optional hyphen segment as string identity", () => {
  assert.equal(normalizeSceneNumber("1"), "1");
  assert.equal(normalizeSceneNumber("S#0002"), "2");
  assert.equal(normalizeSceneNumber("1-1"), "1-1");
  assert.equal(normalizeSceneNumber("1-2"), "1-2");
  assert.equal(normalizeSceneNumber("10-3"), "10-3");
  assert.equal(normalizeSceneNumber("Scene 001 - 01"), "1-01");
  assert.equal(normalizeSceneNumber("1-01"), "1-01");
  assert.equal(normalizeSceneNumber("1 – 1"), "1-1");
  assert.equal(normalizeSceneNumber("1—3"), "1-3");
  assert.equal(normalizeSceneNumber("10−2"), "10-2");
  assert.notEqual(normalizeSceneNumber("1-1"), normalizeSceneNumber("1-01"));
});

test("scenario markers accept existing prefixes and prefixless standalone/heading numbers", () => {
  assert.equal(parseScenarioSceneMarker("S#1. 안방 / 낮")?.sceneNo, "1");
  assert.equal(parseScenarioSceneMarker("S#1-1. 안방 / 낮")?.sceneNo, "1-1");
  assert.equal(parseScenarioSceneMarker("S1. 안방 / 낮")?.sceneNo, "1");
  assert.equal(parseScenarioSceneMarker("S1-1. 안방 / 낮")?.sceneNo, "1-1");
  assert.equal(parseScenarioSceneMarker("Scene 10 - 03 : 골목 / 밤")?.sceneNo, "10-03");
  assert.equal(parseScenarioSceneMarker("Scene 1-1")?.sceneNo, "1-1");
  assert.equal(parseScenarioSceneMarker("씬2-1 옥상")?.sceneNo, "2-1");
  assert.equal(parseScenarioSceneMarker("씬1-1")?.sceneNo, "1-1");
  assert.equal(parseScenarioSceneMarker("#3-2")?.sceneNo, "3-2");
  assert.equal(parseScenarioSceneMarker("#1-1")?.sceneNo, "1-1");
  assert.equal(parseScenarioSceneMarker("1")?.sceneNo, "1");
  assert.equal(parseScenarioSceneMarker("1-1")?.sceneNo, "1-1");
  assert.equal(parseScenarioSceneMarker("2")?.sceneNo, "2");
  assert.equal(parseScenarioSceneMarker("1-3")?.sceneNo, "1-3");
  assert.equal(parseScenarioSceneMarker("10-2")?.sceneNo, "10-2");
  assert.equal(parseScenarioSceneMarker("10-20. INT. 방 / 낮")?.sceneNo, "10-20");
  assert.equal(parseScenarioSceneMarker("1 - 1 안방 / 낮")?.sceneNo, "1-1");
  assert.equal(parseScenarioSceneMarker("2–1.\u0000INT.\u0000장례식장 / 밤")?.sceneNo, "2-1");
  assert.equal(cleanScenarioMarkerLine("1.\u0000INT.\u0000경은의\u0000집"), "1. INT. 경은의 집");
  assert.equal(inspectScenarioSceneMarker("2", { allowBare: false }).rejectReason, "bare_not_at_line_start");
});

test("server and browser PDF analysis share exact bounded resource limits", () => {
  assert.equal(isScenarioPdfAnalysisRangeExceeded({
    pageCount: MAX_SCENARIO_PDF_PAGES,
    textItemCount: MAX_SCENARIO_PDF_TEXT_ITEMS,
    textCharacterCount: MAX_SCENARIO_PDF_TEXT_CHARACTERS
  }), false);
  assert.equal(isScenarioPdfAnalysisRangeExceeded({
    pageCount: MAX_SCENARIO_PDF_PAGES + 1
  }), true);
  assert.equal(isScenarioPdfAnalysisRangeExceeded({
    textItemCount: MAX_SCENARIO_PDF_TEXT_ITEMS + 1
  }), true);
  assert.equal(isScenarioPdfAnalysisRangeExceeded({
    textCharacterCount: MAX_SCENARIO_PDF_TEXT_CHARACTERS + 1
  }), true);
  assert.match(SCENARIO_PDF_ANALYSIS_RANGE_MESSAGE, /자동 분석 범위/);
});

test("reference-assets awaits both lazy server PDF extraction call sites", async () => {
  const route = await readFile(
    new URL("../app/api/projects/[projectId]/reference-assets/route.ts", import.meta.url),
    "utf8"
  );
  const awaitedLazyCalls = route.match(
    /await\s*\(\s*await\s+import\(["']@\/lib\/server\/scenarioPdf["']\)\s*\)\s*\.extractScenarioScenesFromPdf\s*\(/gu
  ) ?? [];
  assert.equal(awaitedLazyCalls.length, 2);
  assert.doesNotMatch(route, /^import[^\n]+scenarioPdf/mu);
});

test("dates, numeric ranges, phones, and a third numeric segment do not become scene markers", () => {
  for (const line of [
    "2026-08-15",
    "10:20",
    "Page 12",
    "10-20",
    "10-20분",
    "10-20분 뒤",
    "010-1234-5678",
    "20-A. INT. 방 / 낮",
    "20-B. EXT. 길 / 밤",
    "S#20-A. INT. 방 / 낮",
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
  assert.equal(normalizeSceneNumber("20-A"), "");
});

test("unicode/spaced dash bare scenes preserve source order", () => {
  const scenes = splitScenarioScenesByNumber([{
    page: 1,
    text: [
      "1 – 1",
      "첫 장면",
      "2",
      "둘째 장면",
      "1—3",
      "셋째 장면"
    ].join("\n")
  }]);
  assert.deepEqual(scenes.map((scene) => scene.sceneNo), ["1-1", "2", "1-3"]);
});

test("a numeric body line is not promoted between contextual Scene headings", () => {
  const scenes = splitScenarioScenesByNumber([{
    page: 1,
    text: [
      "S#1. 안방 / 낮",
      "첫 장면 본문",
      "12",
      "계속되는 본문",
      "S#2. 거실 / 밤",
      "둘째 장면 본문"
    ].join("\n")
  }]);
  assert.deepEqual(scenes.map((scene) => scene.sceneNo), ["1", "2"]);
  assert.match(scenes[0].text, /12/);
});

test("repeated page-edge integers are pagination, not bare Scene markers", () => {
  const pages = [
    { page: 2, text: "1. INT. 경은의 집 / 밤\n첫 장면 본문\n1" },
    { page: 3, text: "2-1. INT. 장례식장 / 낮\n둘째 장면 본문\n2" },
    { page: 4, text: "3. INT. 복도 / 밤\n셋째 장면 본문\n3" }
  ];
  const scenes = splitScenarioScenesByNumber(pages);
  assert.deepEqual(scenes.map((scene) => scene.sceneNo), ["1", "2-1", "3"]);
  assert.equal(scenes.some((scene) => scene.title === "2"), false);

  const footerMarkers = [1, 2, 3].map((value, index) => ({
    pageNumber: index + 2,
    edge: "footer",
    marker: { sceneNo: String(value), originalLine: String(value), isBare: true }
  }));
  assert.deepEqual([...findLikelyPdfPaginationMarkerIndices(footerMarkers)], [0, 1, 2]);
});

test("pdf.js-shaped coordinate items accept bare headings but reject embedded numbers and footers", () => {
  const pageHeight = 842;
  const pages = [
    [
      { text: "1.\u0000INT.\u0000경은의\u0000집\u0000/\u0000밤\u00008 시", x: 72, y: 80, width: 250, height: 14 },
      { text: "대사", x: 72, y: 150, width: 30, height: 12 },
      { text: "2", x: 110, y: 150, width: 8, height: 12 },
      { text: "12", x: 170, y: 400, width: 14, height: 12 },
      { text: "1", x: 294, y: 805, width: 8, height: 12 }
    ],
    [
      { text: "2-1.\u0000INT.\u0000장례식장 / 낮", x: 72, y: 290, width: 190, height: 14 },
      { text: "2", x: 294, y: 805, width: 8, height: 12 }
    ],
    [
      { text: "3.\u0000INT.\u0000복도 / 밤", x: 72, y: 120, width: 150, height: 14 },
      { text: "3", x: 294, y: 805, width: 8, height: 12 }
    ]
  ];
  const positioned = pages.flatMap((items, pageIndex) => (
    detectScenarioMarkersOnPage(items, pageIndex + 1, pageHeight).markers
  ));
  const selected = selectCanonicalScenarioMarkers(positioned);
  assert.deepEqual(selected.markers.map((marker) => marker.sceneNo), ["1", "2-1", "3"]);
  assert.equal(selected.rejected.filter(({ reason }) => reason === "pdf_pagination").length, 3);
});

test("actual server PDF extraction path recognizes bare markers in visual line order", async () => {
  const extraction = await extractScenarioScenesFromPdf(await createMinimalScenarioPdf());
  assert.equal(extraction.error, null);
  assert.deepEqual(extraction.scenes.map((scene) => scene.sceneNo), ["1-1", "2", "1-3"]);
  assert.match(extraction.scenes[0].text, /Yuri Sword action/);
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

async function createMinimalScenarioPdf() {
  const { jsPDF } = await import("jspdf");
  const document = new jsPDF({ unit: "pt", format: "a4" });
  document.text("1 - 1", 72, 72);
  document.text("Yuri Sword action words", 72, 96);
  document.text("2", 72, 132);
  document.text("Second scene body words", 72, 156);
  document.text("1 - 3", 72, 192);
  document.text("Third scene body words", 72, 216);
  return Buffer.from(document.output("arraybuffer"));
}

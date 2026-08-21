import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const readSource = (pathname) => readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");

const pageSource = readSource("app/projects/[id]/scenario/page.tsx");
const actionsSource = readSource("components/ProjectPageActions.tsx");
const menuSource = readSource("components/ProjectPageActionsMenu.tsx");
const globalCss = readSource("app/globals.css");
const referenceAssetDataSource = readSource("lib/data/projectReferenceAssets.ts");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

async function loadMergeScenarioSceneImages() {
  const source = sourceBetween(
    pageSource,
    "function mergeScenarioSceneImages(",
    "function formatScenarioClassificationResult("
  );
  const transpiled = ts.transpileModule(`${source}\nexport { mergeScenarioSceneImages };`, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return (await import(moduleUrl)).mergeScenarioSceneImages;
}

async function loadSafeScenarioAnalysisWarning() {
  const source = sourceBetween(
    pageSource,
    "function getSafeScenarioAnalysisWarning(",
    "function getSafeScenarioUploadError("
  );
  const transpiled = ts.transpileModule(`
    const SCENARIO_MARKER_NOT_FOUND_MESSAGE = "marker-not-found";
    ${source}
    export { getSafeScenarioAnalysisWarning };
  `, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return (await import(moduleUrl)).getSafeScenarioAnalysisWarning;
}

test("Scenario registers auto classification in the existing viewport-safe page action menu", () => {
  assert.match(actionsSource, /scenarioClassifySceneList:\s*\{[\s\S]*label: "씬리스트 자동 분류"[\s\S]*group: "document"/u);
  assert.match(actionsSource, /scenario:[\s\S]*actionIds: \[[\s\S]*"scenarioClassifySceneList"/u);
  assert.match(pageSource, /<ProjectPageActionsMenu registration=\{isGuest \? null : scenarioActionMenu\} \/>/u);
  assert.match(menuSource, /const viewportWidth = window\.innerWidth[\s\S]*const viewportHeight = window\.innerHeight/u);
  assert.doesNotMatch(pageSource, /RightPanel|RightDrawer/u);
  assert.doesNotMatch(
    sourceBetween(pageSource, "async function handleClassifySceneList()", "async function handleShare()"),
    /router\.refresh\(\)|window\.location/u
  );
});

test("only write-capable admin Scenario viewers receive the classification action", () => {
  assert.match(pageSource, /const canEdit = role === "admin" && !isGuest;/u);
  assert.match(
    pageSource,
    /const canClassifySceneList = canEdit && accessMode === "member" && editorEligible;/u
  );
  assert.match(pageSource, /scenarioClassifySceneList:\s*\{[\s\S]*hidden: !canClassifySceneList/u);
  assert.doesNotMatch(pageSource, /selectedAsset\.scenarioScenes\.length === 0/u);
  assert.match(pageSource, /hasStructuralChanges[\s\S]*isClassifyingSceneList/u);
  assert.doesNotMatch(
    sourceBetween(pageSource, "scenarioClassifySceneList: {", "scenarioShare: {"),
    /href|progress|canEditProgressStatus/u
  );
});

test("the one overflow trigger remains reachable on desktop, iPad, and phone", () => {
  const header = sourceBetween(
    pageSource,
    '<div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b',
    "<ScenarioUploadProgress"
  );
  const trigger = sourceBetween(menuSource, "<button", "</button>");

  assert.match(header, /flex-wrap/u);
  assert.match(header, /<div className="ml-auto flex shrink-0 items-center gap-1">/u);
  assert.match(header, /<ProjectPageActionsMenu registration=\{isGuest \? null : scenarioActionMenu\} \/>/u);
  assert.doesNotMatch(
    trigger,
    /className="[^"]*(?:^|\s)(?:hidden|sm:hidden|md:hidden|lg:hidden)(?:\s|$)|matchMedia|innerWidth/u
  );
  assert.match(globalCss, /--ui-control-height:\s*44px/u);
  assert.match(globalCss, /\.project-page-actions__trigger \{[\s\S]*width:\s*var\(--ui-control-height\)[\s\S]*height:\s*var\(--ui-control-height\)/u);
  assert.match(pageSource, /<p role="status" className="[^"]*min-w-0[^"]*break-words[^"]*\[overflow-wrap:anywhere\]"/u);
});

test("classification safely recovers legacy empty bodies and rejects duplicate clicks", () => {
  const handler = sourceBetween(
    pageSource,
    "async function handleClassifySceneList()",
    "async function handleShare()"
  );

  assert.match(handler, /sceneListClassificationInFlightRef\.current/u);
  assert.match(handler, /sceneListClassificationInFlightRef\.current = true[\s\S]*await import\("@\/lib\/data\/sceneList"\)[\s\S]*classifyProjectScenarioScenes\(projectId, selectedAsset\.id\)/u);
  assert.match(handler, /scenarioAutosave\.flush\(\)/u);
  assert.match(handler, /if \(!hasScenarioSceneBodyText\(classificationAsset\.scenarioScenes\)\)/u);
  assert.match(handler, /recoverProjectScenarioSceneText\([\s\S]*scenarioUpdatedAtRef\.current \|\| classificationAsset\.updatedAt/u);
  assert.match(handler, /recoverProjectScenarioSceneText[\s\S]*classifyProjectScenarioScenes/u);
  assert.match(handler, /finally[\s\S]*sceneListClassificationInFlightRef\.current = false/u);
  assert.doesNotMatch(handler, /fetch\(|router\.refresh|push\(/u);
  const recoveryHelper = sourceBetween(
    referenceAssetDataSource,
    "export async function recoverProjectScenarioSceneText(",
    "export type ProjectScenarioScenesUpdate"
  );
  assert.match(recoveryHelper, /reanalyzeScenario: true/u);
  assert.match(recoveryHelper, /expectedUpdatedAt/u);
  assert.doesNotMatch(recoveryHelper, /scenarioScenes|scene\.text|body:/u);
});

test("classification exposes compact pending, factual result, and inline error feedback", () => {
  const handler = sourceBetween(
    pageSource,
    "async function handleClassifySceneList()",
    "async function handleShare()"
  );
  const formatter = sourceBetween(
    pageSource,
    "function formatScenarioClassificationResult(",
    "function insertScenarioSceneByAnchors("
  );

  assert.match(handler, /setStatusMessage\("씬·등장인물 분류와 AI 내용 생성 중…"\)/u);
  assert.match(handler, /setErrorMessage\(error instanceof Error/u);
  assert.match(pageSource, /pending: isClassifyingSceneList/u);
  assert.match(pageSource, /<p role="alert"/u);
  assert.match(pageSource, /<p role="status"/u);
  assert.match(formatter, /totalProcessedCount/u);
  assert.match(formatter, /createdCount/u);
  assert.match(formatter, /enrichedCount/u);
  assert.match(formatter, /actorLinkedSceneCount/u);
  assert.match(formatter, /actorLinkCount/u);
  assert.match(formatter, /conflictCount/u);
  assert.match(formatter, /skippedDuplicateCount/u);
  assert.match(formatter, /summarySavedCount/u);
  assert.match(formatter, /summaryFailedCount/u);
  assert.match(formatter, /summaryConflictCount/u);
  assert.match(formatter, /summarySkippedContentCount/u);
  assert.match(formatter, /summaryWarning/u);
  assert.match(formatter, /AI 내용/u);
  assert.doesNotMatch(formatter, /%/u);
});

test("upload keeps browser split order and enriches matches without losing client-only scenes", () => {
  const upload = sourceBetween(pageSource, "async function handleUpload", "function deleteAsset");
  const merge = sourceBetween(
    pageSource,
    "function mergeScenarioSceneImages(",
    "function formatScenarioClassificationResult("
  );

  assert.match(upload, /const imageScenes = await analyzeScenarioPdfImages\(uploadedAsset\.publicUrl\)/u);
  assert.match(upload, /mergeScenarioSceneImages\(serverScenes, imageScenes\)/u);
  assert.match(upload, /scenarioScenes: mergedScenes/u);
  assert.match(upload, /expectedUpdatedAt: uploadedAsset\.updatedAt/u);
  assert.match(upload, /const serverScenes = uploadedAsset\.scenarioScenes \?\? \[\]/u);
  assert.match(upload, /scenarioParseError = serverScenes\.length > 0[\s\S]*uploadedAsset\.scenarioParseError/u);
  assert.match(upload, /if \(serverScenes\.length > 0\) \{[\s\S]*imageSegmentWarnings\.push[\s\S]*scenarioParseError = null/u);
  assert.match(upload, /getSafeScenarioAnalysisWarning\([\s\S]*uploadedAsset\.scenarioParseError[\s\S]*scenarioParseError = analysisWarning/u);
  assert.match(upload, /scenarioParseError,[\s\S]*expectedUpdatedAt: uploadedAsset\.updatedAt[\s\S]*\}\);/u);
  assert.match(merge, /if \(imageScenes\.length === 0\) return canonicalScenes\.map\(cloneScenarioScene\)/u);
  assert.match(merge, /return imageScenes\.map\(\(imageScene\) =>/u);
  assert.match(merge, /if \(!canonicalScene\) return cloneScenarioScene\(imageScene\)/u);
  assert.match(merge, /\.\.\.imageScene,[\s\S]*\.\.\.canonicalScene,[\s\S]*pageStart: imageScene\.pageStart/u);
  assert.doesNotMatch(merge, /canonicalScenes\.filter|sort\(|Number\(|parseInt/u);
});

test("upload warnings use one coherent persistent feedback channel", () => {
  const upload = sourceBetween(pageSource, "async function handleUpload", "function deleteAsset");
  const warningHelper = sourceBetween(
    pageSource,
    "function getSafeScenarioAnalysisWarning(",
    "function getSafeScenarioUploadError("
  );

  assert.match(upload, /sceneDetectionWarnings\.length > 0[\s\S]*setStatusMessage\(""\)[\s\S]*setErrorMessage\([\s\S]*PDF 업로드는 완료되었지만 씬 자동 분리를 완료하지 못했습니다/u);
  assert.match(upload, /imageSegmentWarnings\.length > 0[\s\S]*setErrorMessage\(""\)[\s\S]*setStatusMessage\([\s\S]*PDF 업로드와 씬 자동 분리는 완료되었습니다/u);
  assert.doesNotMatch(upload, /PDF 업로드는 완료되었습니다\. 씬 구성을 확인해주세요/u);
  assert.match(warningHelper, /const canonicalError = serverParseError\?\.trim\(\)[\s\S]*if \(canonicalError\) return canonicalError/u);
  assert.match(upload, /setStatusMessage\(""\);[\s\S]*const uploadError = getSafeScenarioUploadError\(error\)[\s\S]*setErrorMessage/u);
});

test("upload warning keeps the canonical server cause before browser image-analysis errors", async () => {
  const getSafeScenarioAnalysisWarning = await loadSafeScenarioAnalysisWarning();
  const noText = "PDF에서 텍스트를 읽지 못했습니다.";

  assert.equal(
    getSafeScenarioAnalysisWarning(new Error("marker-not-found"), noText),
    noText
  );
  assert.equal(
    getSafeScenarioAnalysisWarning(new Error("marker-not-found"), null),
    "marker-not-found"
  );
  assert.equal(
    getSafeScenarioAnalysisWarning(new Error("pdf.js worker failed"), null),
    "씬 분석을 완료하지 못했습니다. 파일을 확인한 뒤 다시 시도해 주세요."
  );
});

test("upload merge behavior retains client-only markers, server text, and the current image order", async () => {
  const mergeScenarioSceneImages = await loadMergeScenarioSceneImages();
  const canonicalScenes = [
    {
      id: "server-1",
      sceneNo: "1-1",
      title: "S#1-1 서버 제목",
      pageStart: 1,
      pageEnd: 1,
      text: "서버가 추출한 씬 본문",
      imageSegments: []
    },
    {
      id: "server-only",
      sceneNo: "9",
      title: "S#9",
      pageStart: 9,
      pageEnd: 9,
      text: "서버에서만 검출",
      imageSegments: []
    }
  ];
  const imageScenes = [
    {
      id: "client-only",
      sceneNo: "0",
      title: "S#0",
      pageStart: 1,
      pageEnd: 1,
      text: "",
      imageSegments: [{ pageIndex: 0, startYRatio: 0, endYRatio: 0.2 }]
    },
    {
      id: "client-1",
      sceneNo: "1-1",
      title: "S#1-1 브라우저 제목",
      pageStart: 2,
      pageEnd: 3,
      text: "",
      imageSegments: [{ pageIndex: 1, startYRatio: 0.1, endYRatio: 0.9 }]
    }
  ];

  const result = mergeScenarioSceneImages(canonicalScenes, imageScenes);
  assert.deepEqual(result.map((scene) => scene.sceneNo), ["0", "1-1"]);
  assert.equal(result[0].id, "client-only");
  assert.equal(result[1].id, "server-1");
  assert.equal(result[1].title, "S#1-1 서버 제목");
  assert.equal(result[1].text, "서버가 추출한 씬 본문");
  assert.equal(result[1].pageStart, 2);
  assert.deepEqual(result[1].imageSegments, imageScenes[1].imageSegments);
  assert.equal(result.some((scene) => scene.id === "server-only"), false);

  const fallback = mergeScenarioSceneImages(canonicalScenes, []);
  assert.deepEqual(fallback.map((scene) => scene.id), ["server-1", "server-only"]);
});

test("Scenario keeps heavy PDF analysis click/upload-lazy and adds no AI client dependency", () => {
  assert.match(pageSource, /await import\("@\/lib\/client\/scenarioPdfImages"\)/u);
  assert.match(pageSource, /await import\("@\/lib\/data\/sceneList"\)/u);
  assert.doesNotMatch(pageSource, /^import .*scenarioPdfImages/mu);
  assert.doesNotMatch(pageSource, /^import \{[^\n]*classifyProjectScenarioScenes/mu);
  assert.doesNotMatch(pageSource, /openai|anthropic|gemini|api[_-]?key/iu);
});

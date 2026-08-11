import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveDailyPlanPreviewFit } from "../lib/dailyPlan/documentLayout.ts";
import {
  DAILY_PLAN_TIMETABLE_COLUMN_COUNT,
  DAILY_PLAN_TIMETABLE_COLUMN_WEIGHTS
} from "../lib/dailyPlan/previewTimetable.ts";

const editorPath = new URL("../components/DailyPlanEditor.tsx", import.meta.url);
const documentPath = new URL("../components/DailyPlanDocument.tsx", import.meta.url);

const columnGroups = {
  start: [0],
  end: [1],
  runtime: [2],
  location: [3, 4],
  dayNight: [5],
  scene: [6],
  totalCut: [7],
  description: [8, 9, 10],
  actor: [11],
  shootingOrder: [12, 13],
  notes: [14, 15]
};

function sumGroup(indices) {
  return indices.reduce((sum, index) => sum + DAILY_PLAN_TIMETABLE_COLUMN_WEIGHTS[index], 0);
}

test("landscape timetable keeps 16 canonical leaves and gives Description the dominant width", () => {
  assert.equal(DAILY_PLAN_TIMETABLE_COLUMN_WEIGHTS.length, DAILY_PLAN_TIMETABLE_COLUMN_COUNT);
  assert.equal(DAILY_PLAN_TIMETABLE_COLUMN_WEIGHTS.reduce((sum, weight) => sum + weight, 0), 800);
  assert.ok(DAILY_PLAN_TIMETABLE_COLUMN_WEIGHTS.every((weight) => weight > 0));

  const groupWeights = Object.fromEntries(
    Object.entries(columnGroups).map(([key, indices]) => [key, sumGroup(indices)])
  );
  assert.deepEqual(groupWeights, {
    start: 42,
    end: 42,
    runtime: 48,
    location: 72,
    dayNight: 30,
    scene: 38,
    totalCut: 38,
    description: 228,
    actor: 64,
    shootingOrder: 96,
    notes: 102
  });
  assert.equal(groupWeights.start, groupWeights.end);
  assert.equal(
    groupWeights.description,
    Math.max(...Object.values(groupWeights))
  );
});

test("preview fit uses one scale for width and height and never enlarges A4", () => {
  const logicalWidth = 297 * 96 / 25.4;
  const logicalHeight = 210 * 96 / 25.4;
  const halfFit = resolveDailyPlanPreviewFit({
    availableWidth: logicalWidth / 2,
    logicalWidth,
    logicalHeight
  });
  assert.equal(halfFit.scale, 0.5);
  assert.equal(halfFit.scaledWidth, logicalWidth / 2);
  assert.equal(halfFit.scaledHeight, logicalHeight / 2);
  assert.equal(halfFit.scaledWidth / halfFit.scaledHeight, logicalWidth / logicalHeight);

  assert.deepEqual(resolveDailyPlanPreviewFit({
    availableWidth: logicalWidth * 2,
    logicalWidth,
    logicalHeight
  }), {
    scale: 1,
    scaledWidth: logicalWidth,
    scaledHeight: logicalHeight
  });
});

test("preview fit rejects invalid geometry instead of producing clipping measurements", () => {
  for (const invalidValue of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => resolveDailyPlanPreviewFit({
      availableWidth: invalidValue,
      logicalWidth: 1122,
      logicalHeight: 794
    }), RangeError);
  }
});

test("screen fitting stays isolated from print while landscape and portrait keep their column systems", async () => {
  const [editorSource, documentSource] = await Promise.all([
    readFile(editorPath, "utf8"),
    readFile(documentPath, "utf8")
  ]);
  const scaledPreviewSource = editorSource.slice(
    editorSource.indexOf("const ScaledDailyPlanPreview"),
    editorSource.indexOf("function PrintDailyPlanView")
  );
  const printSource = editorSource.slice(
    editorSource.indexOf("function PrintDailyPlanView"),
    editorSource.indexOf("function resolveDailyPlanPreviewPageLayout")
  );

  assert.match(scaledPreviewSource, /resolveDailyPlanPreviewFit\(\{/u);
  assert.match(scaledPreviewSource, /transform: `scale\(\$\{measurement\.scale\}\)`/u);
  assert.match(scaledPreviewSource, /width: measurement\.scaledWidth, height: measurement\.scaledHeight/u);
  assert.match(scaledPreviewSource, /overflow-x-clip/u);
  assert.doesNotMatch(scaledPreviewSource, /scaleX|scaleY|overflow-x-(?:auto|scroll)/u);
  assert.doesNotMatch(printSource, /measurement\.scale|resolveDailyPlanPreviewFit|transform: `scale/u);

  const landscapeSource = documentSource.slice(
    documentSource.indexOf("export function DailyPlanLandscapeDocument"),
    documentSource.indexOf("export function DailyPlanPortraitDocument")
  );
  const portraitSource = documentSource.slice(
    documentSource.indexOf("export function DailyPlanPortraitDocument"),
    documentSource.indexOf("function DailyPlanWeatherTable")
  );
  assert.match(landscapeSource, /<TimetableColumns \/>/u);
  assert.match(portraitSource, /<EqualColumns count=\{portraitColumnCount\} \/>/u);
});

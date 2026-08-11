import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN,
  DAILY_PLAN_TIMETABLE_COLUMN_COUNT,
  DAILY_PLAN_TIMETABLE_LOCATION_COLUMN_SPAN,
  DAILY_PLAN_TIMETABLE_TIME_COLUMN_SPAN,
  getDailyPlanAdditionalScheduleCellLayout
} from "../lib/dailyPlan/previewTimetable.ts";

const documentPath = new URL("../components/DailyPlanDocument.tsx", import.meta.url);

test("additional schedules without a location merge every column after RT", () => {
  for (const location of [null, undefined, "", "   ", "\u00a0\u200b"]) {
    assert.deepEqual(getDailyPlanAdditionalScheduleCellLayout(location), {
      hasLocation: false,
      locationSpan: 0,
      contentSpan: DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN
    });
  }
  assert.equal(
    DAILY_PLAN_TIMETABLE_TIME_COLUMN_SPAN + DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN,
    DAILY_PLAN_TIMETABLE_COLUMN_COUNT
  );
});

test("additional schedules with a location reuse the canonical location span", () => {
  const landscape = getDailyPlanAdditionalScheduleCellLayout("부엌");
  assert.deepEqual(landscape, {
    hasLocation: true,
    locationSpan: DAILY_PLAN_TIMETABLE_LOCATION_COLUMN_SPAN,
    contentSpan: DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN - DAILY_PLAN_TIMETABLE_LOCATION_COLUMN_SPAN
  });
  const portrait = getDailyPlanAdditionalScheduleCellLayout("안방", 7);
  assert.deepEqual(portrait, {
    hasLocation: true,
    locationSpan: DAILY_PLAN_TIMETABLE_LOCATION_COLUMN_SPAN,
    contentSpan: 5
  });
  assert.equal(DAILY_PLAN_TIMETABLE_TIME_COLUMN_SPAN + landscape.locationSpan + landscape.contentSpan, 16);
  assert.equal(DAILY_PLAN_TIMETABLE_TIME_COLUMN_SPAN + portrait.locationSpan + portrait.contentSpan, 10);
});

test("adding and removing a location changes only the semantic cell spans", () => {
  const withoutLocation = getDailyPlanAdditionalScheduleCellLayout("");
  const withLocation = getDailyPlanAdditionalScheduleCellLayout("몽타주 세트");
  const removedAgain = getDailyPlanAdditionalScheduleCellLayout("  ");

  assert.equal(withoutLocation.contentSpan, 13);
  assert.equal(withLocation.locationSpan, 2);
  assert.equal(withLocation.contentSpan, 11);
  assert.deepEqual(removedAgain, withoutLocation);
});

test("document rows use real table cells instead of the old equal-width inner grid", async () => {
  const source = await readFile(documentPath, "utf8");
  const landscapeSource = source.slice(
    source.indexOf("function AdditionalScheduleCells("),
    source.indexOf("function PortraitAdditionalScheduleSummaryCells(")
  );
  assert.match(landscapeSource, /layout\.hasLocation \? \(/u);
  assert.match(landscapeSource, /colSpan=\{layout\.locationSpan\}/u);
  assert.match(landscapeSource, /colSpan=\{layout\.contentSpan\}/u);
  assert.doesNotMatch(landscapeSource, /grid-cols-2|border-r/u);
  assert.equal(source.match(/span: DAILY_PLAN_TIMETABLE_LOCATION_COLUMN_SPAN/g)?.length, 2);
  assert.doesNotMatch(source, /joinPreviewValues\(row\.location, row\.memo\)|aria-label=\{label\}/u);
  assert.match(source, /<td colSpan=\{portraitColumnCount\}[\s\S]*getPreviewCellText\(row\.memo\)/u);

  const sceneRendererSource = source.slice(
    source.indexOf("function TimetableCells("),
    source.indexOf("function TimetableHeaderLabel(")
  );
  assert.match(sceneRendererSource, /colSpan=\{field\.span\}/u);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DAILY_PLAN_RUNTIME_MINUTES,
  parseDailyPlanRuntimeMinutesInput
} from "../lib/dailyPlan/runtimeMinutes.ts";

test("accepts three-digit timetable durations", () => {
  assert.equal(parseDailyPlanRuntimeMinutesInput("120"), 120);
  assert.equal(parseDailyPlanRuntimeMinutesInput("150"), 150);
  assert.equal(parseDailyPlanRuntimeMinutesInput("180"), 180);
});

test("keeps the existing 0 to 1440 minute boundary", () => {
  assert.equal(parseDailyPlanRuntimeMinutesInput("0"), 0);
  assert.equal(parseDailyPlanRuntimeMinutesInput(String(MAX_DAILY_PLAN_RUNTIME_MINUTES)), 1440);
  assert.equal(parseDailyPlanRuntimeMinutesInput("1441"), null);
  assert.equal(parseDailyPlanRuntimeMinutesInput("12a"), null);
});

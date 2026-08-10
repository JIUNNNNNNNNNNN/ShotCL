import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDailyPlanDayNight,
  resolveTimetableDayNightFromScene
} from "../lib/dailyPlan/dayNight.ts";

test("maps canonical scene D/N values into timetable rows", () => {
  assert.equal(resolveTimetableDayNightFromScene({ dayNight: "D" }), "D");
  assert.equal(resolveTimetableDayNightFromScene({ dayNight: "N" }), "N");
});

test("clears D/N when the newly selected scene has no canonical value", () => {
  assert.equal(resolveTimetableDayNightFromScene({ dayNight: "" }), "");
  assert.equal(resolveTimetableDayNightFromScene({ dayNight: null }), "");
});

test("a rapid scene change resolves to the latest scene value", () => {
  const selections = ["D", "N", "D"].map((dayNight) => (
    resolveTimetableDayNightFromScene({ dayNight })
  ));
  assert.equal(selections.at(-1), "D");
});

test("the same canonical scene supplies D/N independently to split timetable rows", () => {
  const source = { dayNight: "D" };
  assert.deepEqual(
    [source, source].map(resolveTimetableDayNightFromScene),
    ["D", "D"]
  );
});

test("keeps the existing aliases while rejecting unsupported values", () => {
  assert.equal(normalizeDailyPlanDayNight("day"), "D");
  assert.equal(normalizeDailyPlanDayNight("night"), "N");
  assert.equal(normalizeDailyPlanDayNight("unknown"), "");
});

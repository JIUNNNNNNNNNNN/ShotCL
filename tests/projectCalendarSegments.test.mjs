import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarEventSegments } from "../lib/projectCalendar.ts";

const visibleAugustRange = {
  startDate: "2026-07-26",
  endDate: "2026-09-05"
};

test("single-day event has one segment with both visual ends", () => {
  const segments = buildCalendarEventSegments({
    id: "single",
    startDate: "2026-08-10",
    endDate: "2026-08-10"
  }, visibleAugustRange);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].isEventStart, true);
  assert.equal(segments[0].isEventEnd, true);
});

test("multi-day event stays one connected segment inside a week", () => {
  const segments = buildCalendarEventSegments({
    id: "same-week",
    startDate: "2026-08-10",
    endDate: "2026-08-13"
  }, visibleAugustRange);
  assert.deepEqual(segments.map((segment) => ({
    startDate: segment.startDate,
    endDate: segment.endDate,
    isEventStart: segment.isEventStart,
    isEventEnd: segment.isEventEnd
  })), [{
    startDate: "2026-08-10",
    endDate: "2026-08-13",
    isEventStart: true,
    isEventEnd: true
  }]);
});

test("week-crossing event exposes the correct week boundary ends", () => {
  const segments = buildCalendarEventSegments({
    id: "week-crossing",
    startDate: "2026-08-14",
    endDate: "2026-08-18"
  }, visibleAugustRange);
  assert.deepEqual(segments.map((segment) => ({
    startDate: segment.startDate,
    endDate: segment.endDate,
    isEventStart: segment.isEventStart,
    isEventEnd: segment.isEventEnd,
    startsAtWeekBoundary: segment.startsAtWeekBoundary,
    endsAtWeekBoundary: segment.endsAtWeekBoundary
  })), [
    {
      startDate: "2026-08-14",
      endDate: "2026-08-15",
      isEventStart: true,
      isEventEnd: false,
      startsAtWeekBoundary: false,
      endsAtWeekBoundary: true
    },
    {
      startDate: "2026-08-16",
      endDate: "2026-08-18",
      isEventStart: false,
      isEventEnd: true,
      startsAtWeekBoundary: true,
      endsAtWeekBoundary: false
    }
  ]);
});

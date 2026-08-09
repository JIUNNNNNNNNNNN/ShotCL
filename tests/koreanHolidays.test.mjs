import assert from "node:assert/strict";
import test from "node:test";
import { getKoreaDateOnly } from "../lib/koreaDate.ts";
import {
  buildKoreanHolidayIndex,
  getKoreanCalendarDayTone,
  getKoreanHolidayNames
} from "../lib/koreanHolidays.ts";

test("official presets include lunar, substitute, temporary, and election holidays", () => {
  assert.deepEqual(getKoreanHolidayNames("2026-02-17"), ["설날"]);
  assert.deepEqual(getKoreanHolidayNames("2026-05-25"), ["대체공휴일(부처님 오신 날)"]);
  assert.deepEqual(getKoreanHolidayNames("2024-10-01"), ["임시공휴일"]);
  assert.deepEqual(getKoreanHolidayNames("2026-06-03"), ["전국동시지방선거"]);
  assert.deepEqual(getKoreanHolidayNames("2026-06-08"), []);
});

test("holiday red takes priority over Saturday blue", () => {
  assert.equal(getKoreanCalendarDayTone("2026-08-15", 6), "holiday");
  assert.equal(getKoreanCalendarDayTone("2026-08-08", 6), "saturday");
  assert.equal(getKoreanCalendarDayTone("2026-08-09", 0), "holiday");
  assert.equal(getKoreanCalendarDayTone("2026-08-10", 1), "weekday");
});

test("visible date index includes only holiday date-only keys", () => {
  const holidays = buildKoreanHolidayIndex([
    "2026-08-14",
    "2026-08-15",
    "2026-08-16",
    "2026-08-17"
  ]);
  assert.equal(holidays.has("2026-08-14"), false);
  assert.deepEqual(holidays.get("2026-08-15"), ["광복절"]);
  assert.deepEqual(holidays.get("2026-08-17"), ["대체공휴일(광복절)"]);
});

test("KST date-only conversion does not shift at the UTC boundary", () => {
  assert.equal(getKoreaDateOnly(new Date("2026-08-14T15:00:00.000Z")), "2026-08-15");
  assert.equal(getKoreaDateOnly(new Date("2026-08-15T14:59:59.999Z")), "2026-08-15");
  assert.equal(getKoreaDateOnly(new Date("2026-08-15T15:00:00.000Z")), "2026-08-16");
  assert.equal(getKoreaDateOnly(new Date("invalid")), null);
});

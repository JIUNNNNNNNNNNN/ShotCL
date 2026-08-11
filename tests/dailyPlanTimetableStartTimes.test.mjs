import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveTimetableTimeChain,
  getExpectedTimetableStartTime,
  getTimetableStartTimeStates,
  normalizeTimetableTime
} from "../lib/dailyPlan/timetableStartTimes.ts";

function row(rowKey, startTime, runtimeMinutes = null, extra = {}) {
  return { rowKey, startTime, endTime: "", runtime: "", runtimeMinutes, ...extra };
}

test("marks an exact next start as normal and a one-minute difference as mismatch", () => {
  const exact = getTimetableStartTimeStates([
    row("scene:1", "12:00", 60),
    row("scene:2", "13:00")
  ]);
  assert.equal(exact.get("scene:1")?.expectedStartTime, null);
  assert.equal(exact.get("scene:1")?.isMismatch, false);
  assert.deepEqual(exact.get("scene:2"), {
    actualStartTime: "13:00",
    expectedStartTime: "13:00",
    isMismatch: false
  });

  const mismatch = getTimetableStartTimeStates([
    row("scene:1", "12:00", 60),
    row("scene:2", "13:01")
  ]);
  assert.equal(mismatch.get("scene:2")?.isMismatch, true);
});

test("previous duration and start edits immediately change the derived expectation", () => {
  const durationEdit = getTimetableStartTimeStates([
    row("scene:1", "12:00", 70),
    row("scene:2", "13:10")
  ]);
  assert.equal(durationEdit.get("scene:2")?.expectedStartTime, "13:10");
  assert.equal(durationEdit.get("scene:2")?.isMismatch, false);

  const startEdit = getTimetableStartTimeStates([
    row("scene:1", "12:10", 60),
    row("scene:2", "13:00")
  ]);
  assert.equal(startEdit.get("scene:2")?.expectedStartTime, "13:10");
  assert.equal(startEdit.get("scene:2")?.isMismatch, true);
});

test("a mismatched row resumes the chain from its actual start", () => {
  const states = getTimetableStartTimeStates([
    row("scene:1", "12:00", 60),
    row("scene:2", "13:10", 30),
    row("scene:3", "13:40", 20)
  ]);
  assert.equal(states.get("scene:2")?.isMismatch, true);
  assert.equal(states.get("scene:3")?.expectedStartTime, "13:40");
  assert.equal(states.get("scene:3")?.isMismatch, false);
});

test("supports midnight rollover and three-digit durations", () => {
  assert.equal(getExpectedTimetableStartTime("23:30", 60), "00:30");
  assert.equal(getExpectedTimetableStartTime("09:00", 120), "11:00");

  const midnightMatch = getTimetableStartTimeStates([
    row("scene:1", "23:30", 60),
    row("scene:2", "00:30")
  ]);
  assert.equal(midnightMatch.get("scene:2")?.isMismatch, false);

  const midnightMismatch = getTimetableStartTimeStates([
    row("scene:1", "23:30", 60),
    row("scene:2", "00:40")
  ]);
  assert.equal(midnightMismatch.get("scene:2")?.expectedStartTime, "00:30");
  assert.equal(midnightMismatch.get("scene:2")?.isMismatch, true);

  const longRuntime = getTimetableStartTimeStates([
    row("scene:3", "09:00", 120),
    row("scene:4", "11:00")
  ]);
  assert.equal(longRuntime.get("scene:4")?.isMismatch, false);
  const longRuntimeMismatch = getTimetableStartTimeStates([
    row("scene:5", "09:00", 120),
    row("scene:6", "11:10")
  ]);
  assert.equal(longRuntimeMismatch.get("scene:6")?.expectedStartTime, "11:00");
  assert.equal(longRuntimeMismatch.get("scene:6")?.isMismatch, true);
});

test("blank or invalid anchors and blank or invalid actual values do not warn", () => {
  const states = getTimetableStartTimeStates([
    row("scene:blank", "", 60),
    row("scene:after-blank", "13:00"),
    row("scene:invalid", "99:99", 30),
    row("scene:after-invalid", "14:00"),
    row("scene:no-duration", "15:00"),
    row("scene:after-no-duration", "16:00"),
    row("scene:valid", "17:00", 60),
    row("scene:blank-actual", ""),
    row("scene:valid-2", "19:00", 60),
    row("scene:invalid-actual", "13:")
  ]);
  for (const state of states.values()) assert.equal(state.isMismatch, false);

  const invalidRuntime = getTimetableStartTimeStates([
    row("scene:runtime-invalid", "12:00", null, { runtime: "not-a-duration" }),
    row("scene:after-runtime-invalid", "13:00")
  ]);
  assert.equal(invalidRuntime.get("scene:after-runtime-invalid")?.expectedStartTime, null);
  assert.equal(invalidRuntime.get("scene:after-runtime-invalid")?.isMismatch, false);

  for (const invalidMinutes of [1.5, 1441]) {
    const invalidNumericRuntime = getTimetableStartTimeStates([
      row("scene:numeric-runtime-invalid", "12:00", invalidMinutes),
      row("scene:after-numeric-runtime-invalid", "13:00")
    ]);
    assert.equal(invalidNumericRuntime.get("scene:after-numeric-runtime-invalid")?.expectedStartTime, null);
    assert.equal(invalidNumericRuntime.get("scene:after-numeric-runtime-invalid")?.isMismatch, false);
  }
});

test("normalizes equivalent HH:mm values before comparison", () => {
  assert.equal(normalizeTimetableTime("9:00"), "09:00");
  assert.equal(normalizeTimetableTime("0900"), "09:00");
  const states = getTimetableStartTimeStates([
    row("event:1", "8:00", 60),
    row("scene:2", "09:00")
  ]);
  assert.equal(states.get("scene:2")?.isMismatch, false);
});

test("other-schedule rows participate in the same ordered chain", () => {
  const states = getTimetableStartTimeStates([
    row("scene:1", "10:00", 60),
    row("event:meal", "11:00", 30),
    row("scene:2", "11:30")
  ]);
  assert.equal(states.get("event:meal")?.isMismatch, false);
  assert.equal(states.get("scene:2")?.isMismatch, false);
});

test("one-shot auto-fill consumes only pending blank rows and shares the expected value", () => {
  const rows = [
    row("scene:1", "12:00", 60),
    row("scene:new", "", 30, { canReceiveAutomaticTime: true }),
    row("scene:manual", "13:40")
  ];
  const result = deriveTimetableTimeChain(rows, new Set(["scene:new", "scene:manual"]));
  assert.equal(result.states.get("scene:new")?.expectedStartTime, "13:00");
  assert.equal(result.automaticUpdates.get("scene:new"), "13:00");
  assert.equal(result.automaticUpdates.has("scene:manual"), false);
  assert.deepEqual([...result.consumedAutomaticRowKeys], ["scene:new", "scene:manual"]);
  assert.equal(result.states.get("scene:manual")?.expectedStartTime, "13:30");
  assert.equal(result.states.get("scene:manual")?.isMismatch, true);
  assert.equal(rows[1].startTime, "");
  assert.equal(rows[2].startTime, "13:40");
});

test("a newly added blank other-schedule receives the same one-shot auto-fill", () => {
  const result = deriveTimetableTimeChain([
    row("scene:1", "10:00", 60),
    row("event:new", "", 30, { canReceiveAutomaticTime: true }),
    row("scene:2", "11:30")
  ], new Set(["event:new"]));
  assert.equal(result.automaticUpdates.get("event:new"), "11:00");
  assert.equal(result.states.get("scene:2")?.expectedStartTime, "11:30");
  assert.equal(result.states.get("scene:2")?.isMismatch, false);
});

test("a stored blank row breaks the canonical chain without being auto-filled", () => {
  const result = deriveTimetableTimeChain([
    row("scene:1", "10:00", 60),
    row("event:blank", "", null, { canReceiveAutomaticTime: true }),
    row("scene:2", "12:00")
  ]);
  assert.equal(result.automaticUpdates.size, 0);
  assert.equal(result.states.get("scene:2")?.expectedStartTime, null);
  assert.equal(result.states.get("scene:2")?.isMismatch, false);
});

test("reordering recalculates states without mutating row values", () => {
  const source = [
    row("scene:1", "10:00", 60),
    row("scene:2", "11:00", 30),
    row("scene:3", "11:30")
  ];
  const before = structuredClone(source);
  const reordered = [source[1], source[0], source[2]];
  const states = getTimetableStartTimeStates(reordered);
  assert.equal(states.get("scene:1")?.isMismatch, true);
  assert.equal(states.get("scene:3")?.expectedStartTime, "11:00");
  assert.equal(states.get("scene:3")?.isMismatch, true);
  assert.deepEqual(source, before);
});

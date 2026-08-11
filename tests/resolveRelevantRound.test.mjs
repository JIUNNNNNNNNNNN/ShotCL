import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(
        new URL(`${specifier.slice(2)}.ts`, projectRoot).href,
        context
      );
    }
    return nextResolve(specifier, context);
  }
});

const { calculateDailyProgress } = await import("../lib/progress/dailyProgress.ts");
const { getKoreaDateOnly } = await import("../lib/koreaDate.ts");
const { resolveRelevantProgressRound } = await import(
  "../lib/progress/resolveRelevantRound.ts"
);

function round(id, shootingDate, episode, statuses = []) {
  return {
    id,
    shootingDate,
    episode,
    progress: calculateDailyProgress(statuses.map((status, index) => ({
      id: `${id}:cut-${index + 1}`,
      status
    })))
  };
}

test("returns empty or invalid-today without guessing a round", () => {
  assert.deepEqual(resolveRelevantProgressRound([], "2026-08-12"), { status: "empty" });
  assert.deepEqual(
    resolveRelevantProgressRound([round("round-1", "2026-08-15", "1")], "not-a-date"),
    { status: "invalid-today" }
  );
});

test("selects the closest future round before the first shooting date", () => {
  const result = resolveRelevantProgressRound([
    round("round-2", "2026-08-20", "2", ["pending"]),
    round("round-1", "2026-08-15", "1", ["pending"])
  ], "2026-08-12");

  assert.equal(result.status, "resolved");
  assert.equal(result.status === "resolved" ? result.round.id : null, "round-1");
  assert.equal(result.status === "resolved" ? result.reason : null, "before-first");
});

test("prior incomplete rounds take priority over today in oldest canonical order", () => {
  const result = resolveRelevantProgressRound([
    round("today", "2026-08-18", "3", ["pending"]),
    round("older-2", "2026-08-16", "2", ["ok", "pending"]),
    round("older-1", "2026-08-15", "1", ["ok", "pending"])
  ], "2026-08-18");

  assert.equal(result.status === "resolved" ? result.round.id : null, "older-1");
  assert.equal(result.status === "resolved" ? result.reason : null, "overdue-incomplete");
});

test("OK and OMIT completion advances across a rest day to the nearest future round", () => {
  const result = resolveRelevantProgressRound([
    round("round-1", "2026-08-15", "1", ["ok", "omit"]),
    round("round-2", "2026-08-17", "2", ["pending"])
  ], "2026-08-16");

  assert.equal(result.status === "resolved" ? result.round.id : null, "round-2");
  assert.equal(result.status === "resolved" ? result.reason : null, "next");
});

test("an exact-today round is selected after all earlier rounds are complete", () => {
  const result = resolveRelevantProgressRound([
    round("round-1", "2026-08-15", "1", ["ok"]),
    round("round-2", "2026-08-16", "2", ["pending"])
  ], "2026-08-16");

  assert.equal(result.status === "resolved" ? result.round.id : null, "round-2");
  assert.equal(result.status === "resolved" ? result.reason : null, "today");
});

test("today selects the first canonical incomplete round before a completed sibling", () => {
  const result = resolveRelevantProgressRound([
    round("round-10", "2026-08-16", "10", ["pending"]),
    round("round-2", "2026-08-16", "2", ["ok"]),
    round("round-3", "2026-08-16", "3", ["pending"])
  ], "2026-08-16");

  assert.equal(result.status === "resolved" ? result.round.id : null, "round-3");
  assert.equal(result.status === "resolved" ? result.reason : null, "today");
});

test("after shooting ends, complete rounds fall back to the last dated round", () => {
  const result = resolveRelevantProgressRound([
    round("round-1", "2026-08-15", "1", ["ok"]),
    round("round-2", "2026-08-17", "2", ["omit"])
  ], "2026-08-20");

  assert.equal(result.status === "resolved" ? result.round.id : null, "round-2");
  assert.equal(result.status === "resolved" ? result.reason : null, "after-last");
});

test("after shooting ends, the final incomplete round remains actionable", () => {
  const result = resolveRelevantProgressRound([
    round("round-1", "2026-08-15", "1", ["ok"]),
    round("round-2", "2026-08-17", "2", ["pending"])
  ], "2026-08-20");

  assert.equal(result.status === "resolved" ? result.round.id : null, "round-2");
  assert.equal(result.status === "resolved" ? result.reason : null, "overdue-incomplete");
});

test("KST date conversion crosses midnight at 15:00 UTC", () => {
  assert.equal(getKoreaDateOnly(new Date("2026-08-14T14:59:59Z")), "2026-08-14");
  assert.equal(getKoreaDateOnly(new Date("2026-08-14T15:00:00Z")), "2026-08-15");
});

test("zero-cut rounds retain canonical incomplete semantics", () => {
  const result = resolveRelevantProgressRound([
    round("zero-cuts", "2026-08-15", "1", []),
    round("today", "2026-08-16", "2", ["pending"])
  ], "2026-08-16");

  assert.equal(result.status === "resolved" ? result.round.id : null, "zero-cuts");
  assert.equal(result.status === "resolved" ? result.reason : null, "overdue-incomplete");
});

test("invalid dates are ignored when at least one valid dated round exists", () => {
  const result = resolveRelevantProgressRound([
    round("invalid-incomplete", "2026-02-30", "1", ["pending"]),
    round("valid", "2026-08-17", "2", ["pending"])
  ], "2026-08-16");

  assert.equal(result.status === "resolved" ? result.round.id : null, "valid");
  assert.equal(result.status === "resolved" ? result.reason : null, "before-first");
});

test("all-undated rounds use natural episode order and stable id fallback", () => {
  const source = [
    round("round-10", "", "10회차", ["pending"]),
    round("round-2-b", "invalid", "2회차", ["pending"]),
    round("round-2-a", "", "2회차", ["pending"])
  ];
  const snapshot = source.map((item) => item.id);
  const result = resolveRelevantProgressRound(source, "2026-08-16");

  assert.equal(result.status === "resolved" ? result.round.id : null, "round-2-a");
  assert.equal(result.status === "resolved" ? result.reason : null, "undated-fallback");
  assert.deepEqual(source.map((item) => item.id), snapshot);
});

test("same-date rounds use natural episode order instead of lexical order", () => {
  const result = resolveRelevantProgressRound([
    round("round-10", "2026-08-15", "10회차", ["pending"]),
    round("round-2", "2026-08-15", "2회차", ["pending"]),
    round("round-1", "2026-08-15", "1회차", ["pending"])
  ], "2026-08-15");

  assert.equal(result.status === "resolved" ? result.round.id : null, "round-1");
});

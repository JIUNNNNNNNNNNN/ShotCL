import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

test("canonical Progress reorder is admin-scoped, exact-set validated, and CAS persisted", () => {
  const route = readSource("app/api/projects/[projectId]/daily-plans/[dailyPlanId]/route.ts");
  const actionStart = route.indexOf("if (body.shootingOrder)");
  const actionEnd = route.indexOf("if (body.scheduleItem)", actionStart);
  assert.notEqual(actionStart, -1);
  assert.notEqual(actionEnd, -1);
  const action = route.slice(actionStart, actionEnd);

  assert.match(route, /if \(!grant \|\| grant\.role !== "admin"\)/u);
  assert.match(route, /if \(!isValidDatabaseProjectId\(dailyPlanId\)\)/u);
  assert.match(action, /normalizeShotIdOrder\(body\.shootingOrder\.shotIds\)/u);
  assert.match(action, /\.from\("shots"\)[\s\S]*?\.eq\("project_id", projectId\)[\s\S]*?\.eq\("daily_plan_id", dailyPlanId\)/u);
  assert.match(action, /shotIds\.length !== rows\.length \|\| shotIds\.some\(\(id\) => !rowById\.has\(id\)\)/u);
  assert.match(action, /applyProgressOrderToTimetableScenes/u);
  assert.match(action, /saveDailyPlanPatchWithCas\([\s\S]*?expectedUpdatedAt/u);
  assert.doesNotMatch(action, /insert\(|upsert\(|delete\(/u);
});

test("long-press drop makes one canonical persistence call and rolls back locally on failure", () => {
  const page = readSource("app/projects/[id]/page.tsx");
  const handlerStart = page.indexOf("async function handleReorderShots");
  const handlerEnd = page.indexOf("function handleResetCurrentProjectShots", handlerStart);
  assert.notEqual(handlerStart, -1);
  assert.notEqual(handlerEnd, -1);
  const handler = page.slice(handlerStart, handlerEnd);

  assert.equal((handler.match(/updateDailyPlanProgressOrder\(/gu) ?? []).length, 1);
  assert.match(handler, /shotsRef\.current = nextShots;\s*setShots\(nextShots\)/u);
  assert.match(handler, /commitDailyPlanPatch\(dailyPlanId, previousPlan\)/u);
  assert.match(handler, /const restoredShots = mergeShotOrder\(shotsRef\.current, previousShots\)/u);
  assert.doesNotMatch(handler, /router\.refresh|listShots\(|fetch\(/u);
});

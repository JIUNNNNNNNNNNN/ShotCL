import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

test("Progress derives one current-round ordered view before every visible bucket", () => {
  const source = readSource("app/projects/[id]/page.tsx");
  const derivationStart = source.indexOf("const selectedPrintMeta = useMemo");
  const derivationEnd = source.indexOf("const selectedPlanRef", derivationStart);

  assert.notEqual(derivationStart, -1);
  assert.notEqual(derivationEnd, -1);
  const derivation = source.slice(derivationStart, derivationEnd);
  assert.match(derivation, /decodeDailyPlanMemo\(selectedPlan\?\.memo \?\? ""\)/u);
  assert.match(
    derivation,
    /orderProgressShotsByShootingOrder\(shots, selectedPrintMeta\.timetableScenes\)/u
  );
  assert.doesNotMatch(derivation, /useEffect|fetch\(|router\.refresh/u);

  assert.match(source, /orderedShots\.filter\(\(shot\) => getPersistedStatusBucket\(shot\.status\) === "active"\)/u);
  assert.match(source, /orderedShots\.filter\(\(shot\) => getPersistedStatusBucket\(shot\.status\) === "ok"\)/u);
  assert.match(source, /orderedShots\.filter\(\(shot\) => getPersistedStatusBucket\(shot\.status\) === "omit"\)/u);
  assert.match(source, /const processedShots = useMemo\([\s\S]*?getPersistedStatusBucket\(shot\.status\) !== "active"/u);
  assert.equal((source.match(/<ProgressStatusSection/gu) ?? []).length, 1);
  assert.match(source, /<ProgressStatusSection[\s\S]*?visibleShots=\{processedShots\}/u);
  assert.doesNotMatch(source, /visibleShots=\{okShots\}|visibleShots=\{omitShots\}/u);
  assert.match(
    source,
    /placeScheduleRows\(orderedShots, selectedPlan\.mealTimes, selectedPrintMeta\.timetableRowOrder\)/u
  );
  assert.match(
    source,
    /remapScheduleRowsForVisibleShots\(orderedShots, activeShots, scheduleRowsByIndex\)/u
  );
  assert.equal((source.match(/allShots=\{orderedShots\}/gu) ?? []).length, 2);
  assert.match(source, /calculateDailyProgress\(shots\)/u);
  assert.doesNotMatch(source, /calculateDailyProgress\(orderedShots\)/u);
});

test("long-press reorder updates the canonical Daily Plan shooting order", () => {
  const source = readSource("app/projects/[id]/page.tsx");

  assert.match(source, /hasCanonicalProgressOrder/u);
  assert.match(source, /applyProgressOrderToTimetableScenes\([\s\S]*?nextShots/u);
  assert.match(source, /updateDailyPlanProgressOrder\([\s\S]*?nextShots/u);
  assert.doesNotMatch(source, /isProgressOrderLocked/u);
  assert.equal((source.match(/disabled=\{role !== "admin" \|\| isReordering\}/gu) ?? []).length, 2);
});

test("Progress order stays derived and is never copied into the shot persistence transform", () => {
  const transform = readSource("lib/dailyPlan/progressShots.ts");

  assert.doesNotMatch(transform, /orderProgressShotsByShootingOrder|decodeDailyPlanMemo/u);
  assert.match(transform, /orderIndex \+= 1/u);
});

test("Member and Guest initial and Realtime paths already carry the selected plan memo", () => {
  const page = readSource("app/projects/[id]/page.tsx");
  const layout = readSource("app/projects/[id]/layout.tsx");
  const stream = readSource("app/api/projects/[projectId]/progress-events/route.ts");
  const listColumns = layout.match(/const DAILY_PLAN_LIST_COLUMNS = "([^"]+)"/u)?.[1]?.split(",") ?? [];
  const streamColumns = stream.match(/const DAILY_PLAN_COLUMNS = "([^"]+)"/u)?.[1]?.split(",") ?? [];

  assert.equal(listColumns.includes("memo"), true);
  assert.equal(streamColumns.includes("memo"), true);
  assert.match(
    layout,
    /hasGuestProgressSeed[\s\S]*?\.from\("daily_plans"\)[\s\S]*?\.select\(DAILY_PLAN_LIST_COLUMNS\)[\s\S]*?\.eq\("id", guestProgressDailyPlanId!\)/u
  );
  assert.match(
    stream,
    /const \[shotsResult, planResult\] = await Promise\.all\(\[[\s\S]*?\.select\(SHOT_COLUMNS\)[\s\S]*?\.select\(DAILY_PLAN_COLUMNS\)/u
  );

  const realtimeHandlerStart = page.indexOf("const handleRealtimeDailyPlanUpdate");
  const realtimeHandlerEnd = page.indexOf("const startProgressMediaLoad", realtimeHandlerStart);
  assert.notEqual(realtimeHandlerStart, -1);
  assert.notEqual(realtimeHandlerEnd, -1);
  const realtimeHandler = page.slice(realtimeHandlerStart, realtimeHandlerEnd);
  assert.match(realtimeHandler, /commitDailyPlanPatch\(remotePlan\.id, remotePlan\)/u);
  assert.doesNotMatch(realtimeHandler, /fetch\(|listShots\(|router\.refresh/u);
});

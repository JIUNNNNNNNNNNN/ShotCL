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

  for (const bucket of ["active", "ok", "omit"]) {
    assert.match(
      source,
      new RegExp(`orderedShots\\.filter\\(\\(shot\\) => sessionBucketByShotId\\.get\\(shot\\.id\\) === "${bucket}"`, "u")
    );
  }
  assert.match(
    source,
    /placeScheduleRows\(orderedShots, selectedPlan\.mealTimes, selectedPrintMeta\.timetableRowOrder\)/u
  );
  assert.match(
    source,
    /remapScheduleRowsForVisibleShots\(orderedShots, activeShots, scheduleRowsByIndex\)/u
  );
  assert.equal((source.match(/allShots=\{orderedShots\}/gu) ?? []).length, 3);
  assert.match(source, /calculateDailyProgress\(shots\)/u);
  assert.doesNotMatch(source, /calculateDailyProgress\(orderedShots\)/u);
});

test("Daily Plan order remains authoritative over the legacy Progress drag path", () => {
  const source = readSource("app/projects/[id]/page.tsx");

  assert.match(
    source,
    /const isProgressOrderLocked = useMemo\([\s\S]*?shots\.some\(\(shot\) => \/\^\\d\+\$\/\.test/u
  );
  assert.match(
    source,
    /if \(!projectId \|\| !dailyPlanId \|\| role !== "admin" \|\| isReordering \|\| isProgressOrderLocked\) return;/u
  );
  assert.equal(
    (source.match(/disabled=\{role !== "admin" \|\| isReordering \|\| isProgressOrderLocked\}/gu) ?? []).length,
    3
  );
  assert.match(
    source,
    /if \(role !== "admin" \|\| isReordering \|\| isProgressOrderLocked\) return null;/u
  );
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

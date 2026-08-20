import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const subscriptionSource = readFileSync(
  new URL("../lib/realtime/subscribeToProgressChanges.ts", import.meta.url),
  "utf8"
);
const progressPageSource = readFileSync(
  new URL("../app/projects/[id]/page.tsx", import.meta.url),
  "utf8"
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("one selected-round subscriber owns shot and daily-plan events", () => {
  assert.equal((subscriptionSource.match(/\.channel\(/gu) ?? []).length, 1);
  assert.match(subscriptionSource, /event: "UPDATE"/u);
  assert.match(subscriptionSource, /table: "daily_plans"/u);
  assert.match(subscriptionSource, /filter: `id=eq\.\$\{dailyPlanId\}`/u);
  assert.match(subscriptionSource, /newRow\.project_id[\s\S]*!== projectId/u);
  assert.match(subscriptionSource, /table: "shots"/u);
  assert.match(subscriptionSource, /filter: `daily_plan_id=eq\.\$\{dailyPlanId\}`/u);
  assert.match(subscriptionSource, /queueMicrotask\(flushShotChanges\)/u);
  assert.doesNotMatch(subscriptionSource, /\bfetch\b|router\.refresh|refreshDailyPlans|setTimeout/u);
});

test("Progress normalizes delivered selected-round UPDATEs and reuses the guarded local patch", () => {
  const guardedPatchSource = sourceBetween(
    progressPageSource,
    "const commitDailyPlanPatch = useCallback(",
    "const selectedDailyPlanId = selectedPlan?.id ?? \"\";"
  );
  const realtimeSource = sourceBetween(
    progressPageSource,
    "const handleRealtimeDailyPlanUpdate = useCallback(",
    "const refresh = useCallback(async () => {"
  );

  assert.match(realtimeSource, /dailyPlanFromRow\(newRow\)/u);
  assert.match(realtimeSource, /const currentSelectedPlan = selectedPlanRef\.current/u);
  assert.match(realtimeSource, /remotePlan\.projectId !== currentSelectedPlan\.projectId/u);
  assert.match(realtimeSource, /remotePlan\.id !== currentSelectedPlan\.id/u);
  assert.match(realtimeSource, /!remotePlan\.updatedAt/u);
  assert.match(realtimeSource, /commitDailyPlanPatch\(remotePlan\.id, remotePlan\)/u);
  assert.match(guardedPatchSource, /compareUpdatedAt\(patch\.updatedAt, current\.updatedAt\) < 0/u);
  assert.match(progressPageSource, /if \(accessMode !== "member" \|\| !isProgressView \|\| !projectId \|\| !selectedDailyPlanId\)[\s\S]*import\("@\/lib\/realtime\/subscribeToProgressChanges"\)/u);
  assert.doesNotMatch(realtimeSource, /\bfetch\b|router\.refresh|refreshDailyPlans/u);
});

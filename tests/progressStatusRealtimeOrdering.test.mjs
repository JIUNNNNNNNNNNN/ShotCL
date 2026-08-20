import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../app/projects/[id]/page.tsx", import.meta.url),
  "utf8"
);

test("Shot Realtime merge ignores rows that are not newer than the stable-ID row", () => {
  const start = pageSource.indexOf("const handleRealtimeShotChanges");
  const end = pageSource.indexOf("const applyGuestRealtimeSnapshot", start);
  const handler = pageSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(handler, /const previous = nextById\.get\(remote\.id\)/u);
  assert.match(
    handler,
    /if \(previous && compareUpdatedAt\(remote\.updatedAt, previous\.updatedAt\) <= 0\) continue;/u
  );
  assert.ok(
    handler.indexOf("compareUpdatedAt(remote.updatedAt, previous.updatedAt) <= 0")
      < handler.indexOf("persistedStatusByShotIdRef.current.set(remote.id, remote.status)")
  );
  assert.match(handler, /nextById\.set\(remote\.id, pendingStatus \? \{ \.\.\.enriched, status: pendingStatus\.status \} : enriched\)/u);
});

test("a stale PATCH response clears only its optimistic status overlay", () => {
  const start = pageSource.indexOf("const handleStatusChange");
  const end = pageSource.indexOf("async function handleSaveNewShot", start);
  const handler = pageSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(
    handler,
    /const savedResponseIsStale = Boolean\([\s\S]*compareUpdatedAt\(savedShot\.updatedAt, currentAfterMutation\.updatedAt\) < 0[\s\S]*\);/u
  );
  assert.match(
    handler,
    /if \(!savedResponseIsStale\) \{\s*persistedStatusByShotIdRef\.current\.set\(targetShot\.id, savedShot\.status\);\s*\}/u
  );
  assert.match(
    handler,
    /pendingStatus\?\.version !== mutationVersion[\s\S]*pendingStatusByShotIdRef\.current\.delete\(targetShot\.id\)/u
  );
  assert.match(
    handler,
    /const latestPersistedStatus = persistedStatusByShotIdRef\.current\.get\(targetShot\.id\)[\s\S]*\? \{ \.\.\.shot, status: latestPersistedStatus \}[\s\S]*: \{ \.\.\.shot, status: savedShot\.status, updatedAt: savedShot\.updatedAt \}/u
  );

  const staleBranchStart = handler.indexOf("? { ...shot, status: latestPersistedStatus }");
  const freshBranchStart = handler.indexOf(": { ...shot, status: savedShot.status, updatedAt: savedShot.updatedAt }");
  assert.ok(staleBranchStart >= 0 && freshBranchStart > staleBranchStart);
  assert.doesNotMatch(
    handler.slice(staleBranchStart, freshBranchStart),
    /updatedAt|orderIndex|storyboardImageUrl|overheadImageUrl|overheadDiagram/u
  );
  assert.doesNotMatch(handler, /router\.refresh|refreshSelectedShots\(/u);
});

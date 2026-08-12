import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("../components/DailyPlanGatheringLocations.tsx", import.meta.url);
const helperPath = new URL("../lib/dailyPlan/locationReferences.ts", import.meta.url);

test("effective gathering preserves a valid explicit stable ID and otherwise derives current location 1", async () => {
  const source = await readFile(helperPath, "utf8");
  const resolver = source.slice(
    source.indexOf("export function resolveEffectiveGatheringLocation("),
    source.indexOf("export function isMeaningfulDailyPlanCanonicalLocation(")
  );

  assert.match(source, /label: `장소\$\{index \+ 1\}`/u);
  assert.match(source, /value: String\(location\.id/u);
  assert.match(resolver, /const options = buildDailyPlanLocationOptions\(locations\)/u);
  assert.match(
    resolver,
    /options\.find\(\(option\) => option\.location\.isPrimary\) \?\? options\[0\] \?\? null/u
  );
  assert.doesNotMatch(resolver, /isPrimary\s*=|isPrimary:/u);
});

test("progress gathering uses only the effective location's point and keeps legacy fallback behind modern locations", async () => {
  const source = await readFile(componentPath, "utf8");
  const selector = source.slice(
    source.indexOf("function selectProgressGatheringPlace("),
    source.indexOf("function validateGatheringPhotoSource(")
  );
  const effectiveBranch = selector.slice(
    selector.indexOf("if (effectiveLocation)"),
    selector.indexOf("const canonicalPoint = canonicalPoints[0]")
  );

  assert.match(selector, /resolveEffectiveGatheringLocation\(plan\.shootingLocations\)/u);
  assert.match(effectiveBranch, /point\.locationId === effectiveLocation\.id/u);
  assert.match(effectiveBranch, /address: effectiveLocation\.address/u);
  assert.match(effectiveBranch, /persistedId: null/u);
  assert.match(effectiveBranch, /photos: \[\]/u);
  assert.ok(
    selector.indexOf("if (effectiveLocation)")
      < selector.indexOf("const canonicalPoint = canonicalPoints[0]")
  );
  assert.doesNotMatch(selector, /shootingLocations\.find\(\(location\) => location\.isPrimary\)/u);
  assert.doesNotMatch(effectiveBranch, /canonicalPoints\[0\]/u);
});

test("modern location shell stays read-only until a photo or address mutation creates its stable point", async () => {
  const source = await readFile(componentPath, "utf8");
  const selector = source.slice(
    source.indexOf("function selectProgressGatheringPlace("),
    source.indexOf("function validateGatheringPhotoSource(")
  );
  const modernBranch = selector.slice(
    selector.indexOf("if (effectiveLocation)"),
    selector.indexOf("const canonicalPoint = canonicalPoints[0]")
  );

  assert.match(modernBranch, /id: `location:\$\{effectiveLocation\.id\}`/u);
  assert.match(modernBranch, /locationId: effectiveLocation\.id/u);
  assert.match(modernBranch, /locationName: effectiveLocation\.label/u);
  assert.match(modernBranch, /departmentIds: \[\]/u);
  assert.doesNotMatch(modernBranch, /setLocations|updateDailyPlan|saveDailyPlan/u);
});

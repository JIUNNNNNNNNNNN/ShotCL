import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

test("Progress preserves the server seed and releases critical UI before media", () => {
  const source = readSource("app/projects/[id]/page.tsx");

  assert.match(source, /initialProgress\?\.dailyPlanId === dailyPlanId/u);
  assert.match(source, /useState<Shot\[\]>\(\(\) => initialShots\)/u);
  assert.match(
    source,
    /criticalLoadedEntriesRef = useRef\(new Set\(seededProgress \? \[progressEntryKey\] : \[\]\)\)/u
  );
  assert.match(source, /resetProgressEntryRef = useRef\(progressEntryKey\)/u);

  const resetEffectStart = source.indexOf(
    "useEffect(() => {\n    if (resetProgressEntryRef.current === progressEntryKey) return;"
  );
  assert.notEqual(resetEffectStart, -1);
  const resetEffectEnd = source.indexOf("\n  }, [commitSessionBuckets", resetEffectStart);
  assert.notEqual(resetEffectEnd, -1);
  const resetEffect = source.slice(resetEffectStart, resetEffectEnd);
  assert.ok(
    resetEffect.indexOf("if (resetProgressEntryRef.current === progressEntryKey) return;")
      < resetEffect.indexOf("setShots([])")
  );

  assert.match(
    source,
    /if \(!criticalLoadedEntriesRef\.current\.has\(requestedEntryKey\)\)[\s\S]*?listShots\(projectId, selectedDailyPlanId\)/u
  );
  assert.match(
    source,
    /setErrorMessage\(""\);\s*setIsLoading\(false\);\s*startProgressMediaLoad\(selectedShots, requestedEntryKey, selectedDailyPlanId\);/u
  );
  assert.match(
    source,
    /useState\(\s*\(\) => Boolean\(isProgressView && dailyPlanId && !seededProgress\)\s*\)/u
  );
  assert.match(source, /if \(!isProgressView\) \{\s*setIsLoading\(false\);\s*return;/u);
  assert.doesNotMatch(source, /\buseRouter\b|router\.replace/u);
  assert.match(
    source,
    /const \[loadedShots, selectedPlanDetail\] = await Promise\.all\(\[[\s\S]*?listShots\(projectId, selectedDailyPlanId\)[\s\S]*?isGuest[\s\S]*?getProgressDailyPlan\(projectId, selectedDailyPlanId\)/u
  );
  assert.match(source, /selectedPlanRef\.current = selectedPlanDetail;\s*commitDailyPlanPatch/u);
});

test("Progress summary media is round-scoped and gallery media loads only on demand", () => {
  const source = readSource("app/projects/[id]/page.tsx");
  const shotCard = readSource("components/ShotCard.tsx");

  assert.match(
    source,
    /loadProgressArchiveMediaAssets\(projectId, requestedDailyPlanId, "summary"\)/u
  );
  const summaryLoader = source.slice(
    source.indexOf("const startProgressMediaLoad = useCallback"),
    source.indexOf("const refresh = useCallback")
  );
  assert.doesNotMatch(summaryLoader, /loadShotOverheadDiagram|loadShotMediaLinks|applyShotMediaLinks/u);
  assert.match(
    source,
    /const loadShotGalleryMedia = useCallback[\s\S]*?loadProgressArchiveMediaAssets\(projectId, selectedDailyPlanId, "gallery"\)/u
  );
  assert.match(
    source,
    /const \[archiveAssets, diagram, linksByRef\] = await Promise\.all\(\[[\s\S]*?archiveRequest\.promise[\s\S]*?loadShotOverheadDiagram\(shot\)[\s\S]*?loadShotMediaLinks\(\[shot\]\)/u
  );
  assert.doesNotMatch(source, /loadProgressArchiveMediaAssets\(\s*projectId,\s*isGuest\s*\?/u);
  assert.match(
    source,
    /const nextShots = shotsRef\.current\.map\(\(currentShot\) => \([\s\S]*?storyboardImageUrl: enrichedShot\.storyboardImageUrl,[\s\S]*?overheadDiagram: enrichedShot\.overheadDiagram/u
  );
  assert.match(source, /progressMediaLoadVersionRef\.current \+= 1;\s*selectedShotsRefreshVersionRef/u);
  assert.match(source, /onLoadGalleryMedia=\{loadShotGalleryMedia\}/u);
  assert.match(shotCard, /const hasAnyMedia = hasStoryboard \|\| hasOverhead;/u);
  assert.doesNotMatch(shotCard, /hasAnyMedia\s*=.*onLoadGalleryMedia/u);
  assert.match(
    shotCard,
    /\{hasAnyMedia \? \([\s\S]*?hasStoryboard && hasOverhead \? "grid-cols-2" : "grid-cols-1"[\s\S]*?\{hasStoryboard \? \([\s\S]*?label="콘티"[\s\S]*?\{hasOverhead \? \([\s\S]*?label="부감도"/u
  );
  assert.doesNotMatch(shotCard, /canLoad=|눌러서 보기/u);
  assert.equal((shotCard.match(/await onLoadGalleryMedia\(shot, category\)/gu) ?? []).length, 1);

  assert.match(source, /if \(!readOnly\) \{\s*return \(\s*<ShotReorderList/u);
  assert.equal((source.match(/readOnly=\{isGuest\}/gu) ?? []).length, 3);
  assert.doesNotMatch(
    source,
    /Promise\.all\(\[\s*import\("@\/components\/DailyPlanGatheringLocations"\)/u
  );
  assert.match(source, /DailyPlanGatheringLocationsReadOnly = dynamic/u);
  assert.match(
    source,
    /\{isGuest \? \(\s*<DailyPlanGatheringLocationsReadOnly plan=\{selectedPlan\} \/>/u
  );
  const readOnlyGathering = readSource("components/DailyPlanGatheringLocationsReadOnly.tsx");
  assert.doesNotMatch(
    readOnlyGathering,
    /GatheringPhotoSourceChooser|uploadDailyPlanGatheringPhoto|useAutosave|updateDailyPlanGatheringAddress/u
  );
});

test("Progress archive responses omit editor-only columns and scenario parsing stays lazy", () => {
  const route = readSource("app/api/projects/[projectId]/reference-assets/route.ts");
  const shotRoute = readSource("app/api/projects/[projectId]/shots/route.ts");
  const dailyPlanRoute = readSource("app/api/projects/[projectId]/daily-plans/[dailyPlanId]/route.ts");
  const dailyPlanData = readSource("lib/data/dailyPlans.ts");
  const scheduleCard = readSource("components/ProgressScheduleCard.tsx");
  const projectLayout = readSource("app/projects/[id]/layout.tsx");
  const columns = route.match(/const PROGRESS_MEDIA_SELECT_COLUMNS = "([^"]+)"/u)?.[1]?.split(",") ?? [];

  assert.deepEqual(columns, [
    "id",
    "asset_type",
    "filename",
    "public_url",
    "mime_type",
    "daily_plan_id",
    "scene_no",
    "cut_no",
    "group_id",
    "crop_data",
    "sort_order",
    "created_at"
  ]);
  for (const editorOnlyColumn of [
    "storage_path",
    "size_bytes",
    "shot_ref",
    "scenario_scenes",
    "scenario_parse_error",
    "updated_at"
  ]) {
    assert.equal(columns.includes(editorOnlyColumn), false, editorOnlyColumn);
  }

  assert.doesNotMatch(route, /import \{ extractScenarioScenesFromPdf \} from/u);
  assert.equal(
    (route.match(/import\("@\/lib\/server\/scenarioPdf"\)/gu) ?? []).length,
    2
  );
  assert.match(route, /if \(progressMedia\) \{[\s\S]*?select\(PROGRESS_MEDIA_SELECT_COLUMNS\)/u);
  assert.match(route, /selectProgressMediaRepresentatives\(progressAssets\)\.map\(toProgressMediaSummary\)/u);
  assert.match(route, /const key = `\$\{asset\.assetType\}\\u0000\$\{sceneKey\}\\u0000\$\{cutNumber\}`/u);
  assert.match(
    route,
    /function toProgressMediaSummary[\s\S]*?publicUrl: ""[\s\S]*?thumbnailUrl: thumbnailUrl && thumbnailUrl !== originalUrl \? thumbnailUrl : ""/u
  );
  assert.match(route, /progressMediaMode === "gallery"\s*\? progressAssets/u);
  const guestShotColumns = shotRoute.match(/const guestShotListColumns = "([^"]+)"/u)?.[1] ?? "";
  assert.doesNotMatch(guestShotColumns, /storyboard_image_url/u);
  assert.match(shotRoute, /if \(access\.mode === "guest"\) \{[\s\S]*?select\(guestShotListColumns\)/u);
  assert.match(dailyPlanData, /getProgressDailyPlan[\s\S]*?\?progress=1/u);
  const progressPlanBranch = dailyPlanRoute.slice(
    dailyPlanRoute.indexOf('if (request.nextUrl.searchParams.get("progress") === "1")'),
    dailyPlanRoute.indexOf("const [{ data: plan", dailyPlanRoute.indexOf('if (request.nextUrl.searchParams.get("progress") === "1")'))
  );
  assert.match(progressPlanBranch, /select\(PROGRESS_DAILY_PLAN_COLUMNS\)/u);
  assert.doesNotMatch(progressPlanBranch, /daily_plan_shots/u);
  assert.match(scheduleCard, /loading="lazy"\s*decoding="async"/u);
  const summaryColumns = projectLayout.match(/const DAILY_PLAN_SUMMARY_COLUMNS = "([^"]+)"/u)?.[1] ?? "";
  assert.doesNotMatch(summaryColumns, /meal_times|shooting_locations|memo/u);
  const readOnlyGathering = readSource("components/DailyPlanGatheringLocationsReadOnly.tsx");
  assert.match(readOnlyGathering, /activePhoto\.thumbnailUrl\.trim\(\) !== activePhoto\.url\.trim\(\)/u);
  assert.doesNotMatch(readOnlyGathering, /src=\{activePhoto\.thumbnailUrl \|\| activePhoto\.url\}/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

test("Progress restores linked media and diagrams with bounded background batches", () => {
  const source = readSource("app/projects/[id]/page.tsx");
  const mediaLoader = source.slice(
    source.indexOf("const startProgressMediaLoad = useCallback"),
    source.indexOf("const refresh = useCallback")
  );

  assert.match(mediaLoader, /const \[archiveAssets, diagrams, linksByRef\] = await Promise\.all/u);
  assert.equal((mediaLoader.match(/loadProgressArchiveMediaAssets\(/gu) ?? []).length, 1);
  assert.equal((mediaLoader.match(/loadShotOverheadDiagrams\(/gu) ?? []).length, 1);
  assert.equal((mediaLoader.match(/loadShotMediaLinks\(/gu) ?? []).length, 1);
  assert.match(mediaLoader, /const currentShots = shotsRef\.current;/u);
  assert.match(mediaLoader, /applyShotMediaLinks\(currentShots, linksByRef, diagrams\)/u);
  assert.match(mediaLoader, /storyboardImageUrl: resolved\.storyboardImageUrl/u);
  assert.match(mediaLoader, /overheadImageUrl: resolved\.overheadImageUrl/u);
  assert.match(mediaLoader, /overheadDiagram: resolved\.overheadDiagram/u);
  assert.match(mediaLoader, /linksByRef\.get\(getShotDiagramKey\(shot\)\.shotRef\) \?\? \[\]/u);
  assert.doesNotMatch(mediaLoader, /router\.refresh|listShots\(/u);
});

test("Progress media merge and shooting-order rendering retain stable Shot linkage", () => {
  const source = readSource("app/projects/[id]/page.tsx");

  assert.match(
    source,
    /orderProgressShotsByShootingOrder\(shots, selectedPrintMeta\.timetableScenes\)/u
  );
  assert.match(
    source,
    /function preserveShotMedia[\s\S]*?storyboardImageUrl: previous\.storyboardImageUrl[\s\S]*?overheadImageUrl: previous\.overheadImageUrl[\s\S]*?overheadDiagram: previous\.overheadDiagram/u
  );
  assert.match(
    source,
    /const currentById = new Map\(shotsRef\.current\.map\(\(shot\) => \[shot\.id, shot\]\)\)[\s\S]*?preserveShotMedia\(remote, previous\)/u
  );
  assert.match(
    source,
    /archiveMedia=\{archiveMediaByShotId\.get\(shot\.id\) \?\? EMPTY_PROGRESS_ARCHIVE_MEDIA\}/u
  );

  const realtimeStart = source.indexOf("const handleRealtimeShotChanges");
  const realtimeEnd = source.indexOf("const applyGuestRealtimeSnapshot", realtimeStart);
  const realtimeHandler = source.slice(realtimeStart, realtimeEnd);
  assert.notEqual(realtimeStart, -1);
  assert.notEqual(realtimeEnd, -1);
  assert.match(realtimeHandler, /const previous = nextById\.get\(remote\.id\)/u);
  assert.match(realtimeHandler, /const enriched = preserveShotMedia\(remote, previous\)/u);
  assert.match(realtimeHandler, /nextById\.set\(remote\.id, pendingStatus \? \{ \.\.\.enriched, status: pendingStatus\.status \} : enriched\)/u);
  assert.match(realtimeHandler, /current\.get\(shot\.id\) \?\? \[\]/u);
});

test("ShotCard renders category-specific representatives and legacy URL fallback", () => {
  const source = readSource("components/ShotCard.tsx");

  assert.match(source, /buildProgressMediaGalleryItems\(\s*effectiveArchiveMedia,\s*"storyboard"/u);
  assert.match(source, /buildProgressMediaGalleryItems\(\s*effectiveArchiveMedia,\s*"overhead"/u);
  assert.match(source, /thumbnailUrl: shot\.storyboardImageUrl/u);
  assert.match(source, /thumbnailUrl: shot\.overheadImageUrl/u);
  assert.match(source, /const previewUrl = firstItem\?\.thumbnailUrl \|\| firstItem\?\.url \|\| "";/u);
  assert.match(source, /src=\{previewUrl\}[\s\S]*?loading="lazy"[\s\S]*?decoding="async"/u);
  assert.match(source, /activeGallery === "storyboard"[\s\S]*?storyboardGalleryImages[\s\S]*?activeGallery === "overhead"[\s\S]*?overheadGalleryImages/u);
});

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

  assert.match(mediaLoader, /for \(let attempt = 0; attempt < PROGRESS_MEDIA_LOAD_MAX_ATTEMPTS; attempt \+= 1\)/u);
  assert.match(mediaLoader, /const \[archiveResult, diagramResult, linksResult\][\s\S]*?= await Promise\.all/u);
  assert.equal((mediaLoader.match(/loadProgressArchiveMediaAssets\(/gu) ?? []).length, 1);
  assert.equal((mediaLoader.match(/loadShotOverheadDiagrams\(/gu) ?? []).length, 1);
  assert.equal((mediaLoader.match(/loadShotMediaLinks\(/gu) ?? []).length, 1);
  assert.match(mediaLoader, /const currentShots = shotsRef\.current;/u);
  assert.match(mediaLoader, /applyShotMediaLinks\(currentShots, effectiveLinksByRef, effectiveLegacyDiagrams\)/u);
  assert.match(mediaLoader, /catch\(\(\) => null as ProgressArchiveMediaAsset\[\] \| null\)/u);
  assert.match(mediaLoader, /archiveAssets = archiveResult \?\? archiveAssets/u);
  assert.match(mediaLoader, /diagrams = diagramResult \?\? diagrams/u);
  assert.match(mediaLoader, /linksByRef = linksResult \?\? linksByRef/u);
  assert.match(mediaLoader, /PROGRESS_MEDIA_RETRY_DELAY_MS \* \(attempt \+ 1\)/u);
  assert.match(mediaLoader, /if \(archiveAssets\) archiveAssetsRef\.current = archiveAssets/u);
  assert.match(mediaLoader, /if \(linksByRef\) \{[\s\S]*?setMediaLinksByShotId/u);
  assert.match(mediaLoader, /if \(archiveAssets && diagrams && linksByRef\) \{\s*progressMediaLoadedEntriesRef\.current\.add/u);
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

test("ShotCard has no physical media edit controls or empty action slots", () => {
  const source = readSource("components/ShotCard.tsx");
  const header = source.slice(
    source.indexOf('<div className="min-w-0 px-0.5">'),
    source.indexOf('{hasAnyMedia ? (')
  );

  assert.doesNotMatch(source, /onOpenMedia|showMediaActions|isOverheadLoading/u);
  assert.doesNotMatch(source, /콘티 추가|부감도 추가/u);
  assert.doesNotMatch(source, /콘티 아카이브|부감도 아카이브|아카이브에서 선택/u);
  assert.doesNotMatch(source, /<Images\b|<Map\b/u);
  assert.doesNotMatch(header, /sm:grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]|sm:col-start-3/u);
  assert.match(header, /className="flex min-w-0 flex-wrap items-center justify-center gap-1\.5"/u);
  assert.match(source, /const hasAnyMedia = hasStoryboard \|\| hasOverhead;/u);
  assert.match(source, /\{hasAnyMedia \? \([\s\S]*?hasStoryboard && hasOverhead \? "grid-cols-2" : "grid-cols-1"/u);
  assert.doesNotMatch(source, /if \(!hasContent\)[\s\S]*?이미지 없음/u);
});

test("representative media clicks remain category Gallery-only interactions", () => {
  const source = readSource("components/ShotCard.tsx");
  const galleryHandler = source.slice(
    source.indexOf("async function openGallery"),
    source.indexOf("return (", source.indexOf("async function openGallery"))
  );
  const mediaTiles = source.slice(
    source.indexOf("{hasAnyMedia ? ("),
    source.indexOf("{activeGallery && activeGalleryItem")
  );

  assert.match(galleryHandler, /event\.stopPropagation\(\)/u);
  assert.match(galleryHandler, /setActiveGallery\(category\)/u);
  assert.doesNotMatch(galleryHandler, /onStatusChange|onOpen|onEdit/u);
  assert.match(mediaTiles, /label="콘티"[\s\S]*?openGallery\(event, "storyboard"\)/u);
  assert.match(mediaTiles, /label="부감도"[\s\S]*?openGallery\(event, "overhead"\)/u);
  assert.match(source, /type="button"[\s\S]*?data-no-drag="true"[\s\S]*?onClick=\{onOpen\}/u);
  const previewTile = source.slice(source.indexOf("function ProgressMediaPreviewTile"));
  assert.doesNotMatch(previewTile, /\{label\}\s*·|countOverride|count\?: number/u);
  assert.doesNotMatch(previewTile, /\btitle=/u);
  assert.match(previewTile, /aria-label=\{loading \? `\$\{label\} 불러오는 중` : `\$\{label\} 보기`\}/u);
  assert.match(previewTile, /className="relative flex h-28[^"]*sm:h-32"/u);
});

test("Cut editor media mutations patch one stable Cut and invalidate stale Gallery reads", () => {
  const source = readSource("app/projects/[id]/page.tsx");
  const handler = source.slice(
    source.indexOf("const handleShotMediaMutation = useCallback"),
    source.indexOf("const dailyProgress", source.indexOf("const handleShotMediaMutation = useCallback"))
  );

  assert.match(handler, /role !== "admin"/u);
  assert.match(handler, /currentShots\.find\(\(shot\) => shot\.id === mutation\.shotId\)/u);
  assert.match(handler, /const expectedShotRef = getShotDiagramKey\(target\)\.shotRef/u);
  assert.match(handler, /mutation\.shotRef !== expectedShotRef/u);
  assert.match(handler, /mutation\.link\.mediaType !== mutation\.mediaType/u);
  assert.match(handler, /previousLinks\.filter\(\(link\) => link\.mediaType !== mutation\.mediaType\)/u);
  assert.match(handler, /currentShots\.map\(\(shot\) => \{\s*if \(shot\.id !== target\.id\) return shot;/u);
  assert.match(handler, /storyboardImageUrl: mutation\.link\?\.publicUrl \|\| legacyMedia\.storyboardImageUrl/u);
  assert.match(handler, /overheadImageUrl: mutation\.link\?\.publicUrl \|\| legacyMedia\.overheadImageUrl/u);
  assert.match(handler, /overheadDiagram: mutation\.link\?\.diagram \|\| legacyMedia\.overheadDiagram/u);
  assert.match(handler, /progressMediaLoadVersionRef\.current \+= 1/u);
  assert.match(handler, /mediaMutationVersionByShotIdRef\.current\.set\([\s\S]*?target\.id/u);
  assert.match(handler, /galleryArchiveGenerationRef\.current \+= 1/u);
  assert.match(handler, /galleryArchiveRequestRef\.current = null/u);
  assert.match(handler, /setMediaRevisionByShotId/u);
  assert.match(handler, /const shouldRestartInitialMediaLoad = !progressMediaLoadedEntriesRef\.current\.has\(progressEntryKey\)/u);
  assert.match(handler, /if \(shouldRestartInitialMediaLoad\) \{\s*startProgressMediaLoad\(nextShots, progressEntryKey, dailyPlanId\);/u);
  assert.doesNotMatch(handler, /loadShotMediaLinks|loadShotOverheadDiagram|listShots|router\.refresh/u);
  assert.match(source, /onMediaMutation=\{role === "admin" \? handleShotMediaMutation : undefined\}/u);
  assert.doesNotMatch(source, /refreshSelectedShotMedia|onMediaSaved/u);

  const galleryLoader = source.slice(
    source.indexOf("const loadShotGalleryMedia = useCallback"),
    source.indexOf("const refreshSelectedShots", source.indexOf("const loadShotGalleryMedia = useCallback"))
  );
  assert.match(galleryLoader, /mediaMutationVersionByShotIdRef\.current\.get\(shot\.id\)/u);
  assert.match(source, /galleryArchiveRequestRef = useRef<\{\s*entryKey: string;\s*generation: number;/u);
  assert.match(galleryLoader, /galleryArchiveGenerationRef\.current !== archiveRequest\.generation/u);
  assert.match(galleryLoader, /galleryArchiveRequestRef\.current !== archiveRequest/u);
  assert.match(galleryLoader, /throw new Error\("Cut 자료가 변경되어 Gallery를 다시 불러와야 합니다\."\)/u);
  assert.match(galleryLoader, /if \(galleryArchiveRequestRef\.current === archiveRequest\) \{\s*galleryArchiveRequestRef\.current = null;/u);
  assert.match(galleryLoader, /diagramResult\.ok \? diagramResult\.value : preservedLegacyDiagram/u);
  assert.match(galleryLoader, /if \(diagramResult\.ok\) \{[\s\S]*?overheadDiagram: diagramResult\.value/u);
  assert.match(galleryLoader, /if \(linksResult\.ok\) \{[\s\S]*?setMediaLinksByShotId/u);
  assert.doesNotMatch(galleryLoader, /catch\(\(\) => new Map<string, ShotMediaLink\[\]>\(\)\)/u);
});

test("explicit links own the representative and a media revision rejects stale card caches", () => {
  const source = readSource("components/ShotCard.tsx");

  assert.match(source, /selectedMediaLinks\?: readonly ShotMediaLink\[\]/u);
  assert.match(source, /mediaRevision\?: number/u);
  assert.match(source, /prioritizeProgressMediaGalleryItem\([\s\S]*?selectedStoryboardLink\?\.publicUrl/u);
  assert.match(source, /prioritizeProgressMediaGalleryItem\([\s\S]*?selectedOverheadLink\?\.publicUrl/u);
  assert.match(source, /const prefersLinkedOverheadImage = Boolean\(selectedOverheadLink\?\.publicUrl\?\.trim\(\)\)/u);
  assert.match(source, /prefersLinkedOverheadImage\s*\? \[\.\.\.imageItems, overheadDiagramGalleryItem\]\s*: \[overheadDiagramGalleryItem, \.\.\.imageItems\]/u);
  assert.match(source, /loadedGalleryMedia\.revision === mediaRevision/u);
  assert.match(source, /mediaRevisionRef\.current !== requestedRevision/u);
  assert.match(source, /setLoadedGalleryMedia\(\{ shotId: shot\.id, revision: requestedRevision, assets \}\)/u);
});

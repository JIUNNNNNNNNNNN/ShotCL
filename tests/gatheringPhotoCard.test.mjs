import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const componentSource = readFileSync(
  new URL("../components/DailyPlanGatheringLocations.tsx", import.meta.url),
  "utf8"
);
const componentCss = readFileSync(
  new URL("../components/DailyPlanGatheringLocations.module.css", import.meta.url),
  "utf8"
);
const gatheringPlaceSource = readFileSync(
  new URL("../lib/progress/gatheringPlace.ts", import.meta.url),
  "utf8"
);

const {
  didGatheringPhotoPointerMove,
  GATHERING_PHOTO_LONG_PRESS_MOVE_PX,
  GATHERING_PHOTO_LONG_PRESS_MS,
  selectActiveGatheringPhoto,
  shouldHideActiveGatheringPhoto
} = await import("../lib/client/gatheringPhotoCard.ts");

test("legacy meeting-place arrays expose only their canonical first photo", () => {
  const photos = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(selectActiveGatheringPhoto(photos), photos[0]);
  assert.equal(selectActiveGatheringPhoto([]), null);
  assert.equal(shouldHideActiveGatheringPhoto("a", "a"), true);
  assert.equal(shouldHideActiveGatheringPhoto("b", "a"), false);
});

test("long press uses 500ms and cancels only after moving beyond 10px", () => {
  assert.equal(GATHERING_PHOTO_LONG_PRESS_MS, 500);
  assert.equal(GATHERING_PHOTO_LONG_PRESS_MOVE_PX, 10);
  assert.equal(didGatheringPhotoPointerMove({ x: 10, y: 10 }, { x: 16, y: 18 }), false);
  assert.equal(didGatheringPhotoPointerMove({ x: 10, y: 10 }, { x: 17, y: 18 }), true);
});

test("card enforces a shared one-photo add/replace/delete pipeline", () => {
  assert.equal((componentSource.match(/type="file"/gu) ?? []).length, 1);
  assert.match(componentSource, /accept="image\/\*"/u);
  assert.doesNotMatch(componentSource, /\bcapture=|\bmultiple=/u);
  assert.match(componentSource, /const file = files\[0\]/u);
  assert.match(componentSource, /replaceDailyPlanGatheringPhoto/u);
  assert.match(componentSource, /uploadDailyPlanGatheringPhoto/u);
  assert.match(componentSource, /deleteDailyPlanGatheringPhoto/u);
  assert.match(componentSource, /setOptimisticallyDeletedPhotoId\(photoId\)/u);
  assert.doesNotMatch(componentSource, /router\.refresh|location\.reload/u);
});

test("optimistic delete uses global Undo without a blocking delete spinner", () => {
  assert.match(componentSource, /deleteWithUndo\(\{/u);
  assert.match(componentSource, /key: `gathering-photo:/u);
  assert.match(componentSource, /restoreLocal:[\s\S]*setOptimisticallyRestoredPhoto\(photo\)/u);
  assert.match(componentSource, /finalizeDailyPlanGatheringPhotoDelete/u);
  assert.doesNotMatch(componentSource, /isDeletingPhoto|삭제 중/u);
  assert.match(componentSource, /deleteManagedPhoto\(\)[\s\S]*requestAnimationFrame[\s\S]*photoMediaRef\.current\?\.focus/u);
});

test("editable plans without a gathering record keep the upload skeleton", () => {
  assert.match(componentSource, /!place && !canEdit/u);
  assert.match(componentSource, /집합장소 정보가 없습니다\./u);
  assert.match(componentSource, />시간 미입력<\/span>/u);
  assert.match(componentSource, />주소 미입력<\/span>/u);
  assert.doesNotMatch(componentSource, /일촬표에 집합장소가 없습니다\./u);
  assert.match(componentSource, /const canMutatePhotos = Boolean\(canEdit && hasPersistentProject\)/u);
  assert.match(componentSource, /gatheringPointId:\s*place\?\.persistedId \?\? null/u);
  assert.match(componentSource, /locationName:\s*place\?\.locationName \|\| "집합장소"/u);
  assert.match(gatheringPlaceSource, /meta\.gatheringPoints\.find\(\(item\) => item\.photos\.length > 0\)/u);
  assert.match(gatheringPlaceSource, /resolveEffectiveGatheringLocation\(plan\.shootingLocations\)/u);
  assert.match(gatheringPlaceSource, /id: `location:\$\{effectiveLocation\.id\}`/u);
  assert.match(gatheringPlaceSource, /if \(!locationName && !point\) return null/u);
});

test("meeting photo scope blocks the native iOS image callout and drag path", () => {
  assert.ok(componentSource.match(/styles\.photoSurface/gu)?.length >= 2);
  assert.ok(componentSource.match(/styles\.photoImage/gu)?.length >= 2);
  assert.match(componentSource, /draggable=\{false\}/u);
  assert.match(componentSource, /onDragStart=\{\(event\) => event\.preventDefault\(\)\}/u);
  assert.match(componentSource, /onContextMenu=\{\(event\) => \{\s*event\.preventDefault\(\);\s*if \(canManagePhoto\)/su);
  assert.match(componentCss, /\.photoSurface\s*\{[^}]*-webkit-touch-callout:\s*none/su);
  assert.match(componentCss, /\.photoImage\s*\{[^}]*-webkit-user-drag:\s*none[^}]*-webkit-touch-callout:\s*none/su);
});

test("meeting card removes preview and filename UI while keeping copy fallback", () => {
  const rowStart = componentSource.indexOf("function GatheringPlaceRow");
  const stripStart = componentSource.indexOf("export function GatheringPhotoStrip");
  const cardSource = componentSource.slice(rowStart, stripStart);
  assert.ok(rowStart > 0 && stripStart > rowStart);
  assert.doesNotMatch(cardSource, /onPreview|originalFilename|크게 보기|사진 [0-9]*장/u);
  assert.match(componentSource, /copyText\(address\)/u);
  assert.match(componentSource, /role=\{canManagePhoto \? "button" : "img"\}/u);
});

test("phone and low-height landscape keep the vertical 16:9 card contract", () => {
  assert.match(componentCss, /\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/su);
  assert.match(componentCss, /width:\s*min\(100%, 34rem, 74\.6667dvh\)/u);
  assert.match(componentCss, /aspect-ratio:\s*16 \/ 9/u);
  assert.match(componentCss, /@media \(max-height: 699px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/u);
});

test("meeting photo frame centers only in the persistent project shell", () => {
  assert.match(componentCss, /\.media\s*\{[^}]*justify-self:\s*start/su);
  assert.match(
    componentCss,
    /:global\(\.project-shell\[data-project-shell-mode="persistent"\]\) \.media\s*\{[^}]*justify-self:\s*center/su
  );
});

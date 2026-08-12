import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gatheringLocationsSource = readFileSync(
  new URL("../components/DailyPlanGatheringLocations.tsx", import.meta.url),
  "utf8"
);
const managementSheetSource = readFileSync(
  new URL("../components/GatheringPhotoManagementSheet.tsx", import.meta.url),
  "utf8"
);

function nativeInputSource() {
  const start = gatheringLocationsSource.indexOf("<input\n        ref={photoInputRef}");
  const end = gatheringLocationsSource.indexOf("\n      />", start);
  assert.ok(start > 0 && end > start);
  return gatheringLocationsSource.slice(start, end);
}

test("meeting-place card owns one stable generic native image input", () => {
  const input = nativeInputSource();
  assert.equal((gatheringLocationsSource.match(/type="file"/gu) ?? []).length, 1);
  assert.match(input, /id=\{photoInputId\}/u);
  assert.match(input, /type="file"/u);
  assert.match(input, /accept="image\/\*"/u);
  assert.match(input, /data-gathering-photo-input="native"/u);
  assert.doesNotMatch(input, /\bcapture=|\bmultiple=|aria-hidden|tabIndex/u);

  const inputIndex = gatheringLocationsSource.indexOf("ref={photoInputRef}");
  assert.ok(inputIndex < gatheringLocationsSource.indexOf("!place && !canEdit"));
  assert.ok(inputIndex < gatheringLocationsSource.indexOf("<GatheringPhotoManagementSheet"));
});

test("custom camera and album source chooser is gone", () => {
  assert.doesNotMatch(gatheringLocationsSource, /GatheringPhotoSourceChooser/u);
  assert.doesNotMatch(gatheringLocationsSource, /사진 촬영|앨범에서 선택/u);
  assert.doesNotMatch(managementSheetSource, /사진 촬영|앨범에서 선택/u);
});

test("empty photo slot is a trusted label activation target", () => {
  const emptyStart = gatheringLocationsSource.indexOf("if (canAddPhoto)");
  const emptyEnd = gatheringLocationsSource.indexOf("\n  return (", emptyStart);
  const emptySlot = gatheringLocationsSource.slice(emptyStart, emptyEnd);
  assert.match(emptySlot, /<label/u);
  assert.match(emptySlot, /htmlFor=\{photoInputId\}/u);
  assert.match(emptySlot, /role="button"/u);
  assert.match(emptySlot, /tabIndex=\{0\}/u);
  assert.match(emptySlot, /onPrepareAddPhoto\(\)/u);
  const pointerActivation = emptySlot.slice(
    emptySlot.indexOf("onClick="),
    emptySlot.indexOf("onKeyDown=")
  );
  assert.doesNotMatch(pointerActivation, /\.click\(\)|setTimeout|requestAnimationFrame|\bawait\b/u);
});

test("long-press change action labels the same stable input before closing", () => {
  assert.match(managementSheetSource, /<label[\s\S]*?htmlFor=\{photoInputId\}/u);
  assert.match(managementSheetSource, />사진 변경<\/span>/u);
  assert.match(managementSheetSource, />사진 삭제<\/span>/u);
  assert.match(managementSheetSource, />\s*취소\s*<\/button>/u);
  assert.doesNotMatch(managementSheetSource, /inputRef|input\.click\(\)|setTimeout\([^,]+,\s*[^)]*picker/u);

  const activationStart = managementSheetSource.indexOf("function activateChangeInput");
  const activationEnd = managementSheetSource.indexOf("\n  if (!mounted", activationStart);
  const activation = managementSheetSource.slice(activationStart, activationEnd);
  assert.match(activation, /onChangePhoto\(\)/u);
  assert.doesNotMatch(activation, /setPhase|onCancel/u);
  assert.doesNotMatch(activation, /\basync\b|\bawait\b|setTimeout|requestAnimationFrame/u);

  const input = nativeInputSource();
  assert.match(
    input,
    /photoIntentRef\.current\.mode === "replace"[\s\S]*?setIsPhotoManagementOpen\(false\)[\s\S]*?setManagedPhotoId\(null\)/u
  );
});

test("desktop action uses the same input synchronously without a deferred handoff", () => {
  const openStart = gatheringLocationsSource.indexOf("const openAddPhotoPicker");
  const openEnd = gatheringLocationsSource.indexOf("\n\n  const actionControls", openStart);
  const open = gatheringLocationsSource.slice(openStart, openEnd);
  assert.match(open, /photoInputRef\.current\?\.click\(\)/u);
  assert.doesNotMatch(open, /\basync\b|\bawait\b|setTimeout|requestAnimationFrame|Promise/u);
  assert.equal((gatheringLocationsSource.match(/photoInputRef\.current\?\.click\(\)/gu) ?? []).length, 1);
});

test("picker cancel is inert and same-file selection resets before and after use", () => {
  const input = nativeInputSource();
  assert.match(input, /onClick=\{\(event\) => \{[\s\S]*?event\.currentTarget\.value = ""/u);
  assert.match(input, /const files = Array\.from\(input\.files \?\? \[\]\);\s*input\.value = ""/u);
  assert.match(input, /files\.length === 0[\s\S]*?\) return;/u);
  assert.match(input, /pickerPlanIdRef\.current !== activePlanIdRef\.current/u);
});

test("single-file selection converges on the existing safe replacement pipeline", () => {
  assert.match(gatheringLocationsSource, /void handlePhotoFiles\(files\)/u);
  assert.match(gatheringLocationsSource, /const file = files\[0\]/u);
  assert.match(gatheringLocationsSource, /replaceDailyPlanGatheringPhoto/u);
  assert.match(gatheringLocationsSource, /uploadDailyPlanGatheringPhoto/u);
  assert.match(gatheringLocationsSource, /deleteDailyPlanGatheringPhoto/u);
  assert.doesNotMatch(gatheringLocationsSource, /router\.refresh|location\.reload/u);
});

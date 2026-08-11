import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chooserSource = readFileSync(
  new URL("../components/GatheringPhotoSourceChooser.tsx", import.meta.url),
  "utf8"
);
const gatheringLocationsSource = readFileSync(
  new URL("../components/DailyPlanGatheringLocations.tsx", import.meta.url),
  "utf8"
);

const {
  consumeAndResetGatheringPhotoInput,
  GATHERING_PHOTO_SOURCE_SHEET_DRAWER_DELAY_MS,
  getGatheringPhotoInputPolicy,
  requiresGatheringPhotoDrawerHandoff,
  resetGatheringPhotoInput,
  resolveGatheringPhotoPickerPresentation,
  resolveGatheringPhotoSourceSheetDelay
} = await import("../lib/client/gatheringPhotoSource.ts");

test("compact phone and landscape drawer viewports use the source sheet", () => {
  assert.equal(resolveGatheringPhotoPickerPresentation({
    persistentProjectShell: false,
    finePointer: false
  }), "source-sheet");
  assert.equal(resolveGatheringPhotoPickerPresentation({
    persistentProjectShell: false,
    finePointer: true
  }), "source-sheet");
});

test("persistent touch tablet uses the source sheet while fine desktop opens album directly", () => {
  assert.equal(resolveGatheringPhotoPickerPresentation({
    persistentProjectShell: true,
    finePointer: false
  }), "source-sheet");
  assert.equal(resolveGatheringPhotoPickerPresentation({
    persistentProjectShell: true,
    finePointer: true
  }), "album-direct");
  assert.equal(resolveGatheringPhotoPickerPresentation({
    persistentProjectShell: true,
    finePointer: true,
    touchCapable: true
  }), "source-sheet");
});

test("only a moving action drawer delays the source sheet", () => {
  assert.equal(requiresGatheringPhotoDrawerHandoff({
    persistentProjectShell: false,
    triggerInsideActionDrawer: false
  }), true);
  assert.equal(requiresGatheringPhotoDrawerHandoff({
    persistentProjectShell: true,
    triggerInsideActionDrawer: false
  }), false);
  assert.equal(requiresGatheringPhotoDrawerHandoff({
    persistentProjectShell: true,
    triggerInsideActionDrawer: true
  }), true);
  assert.equal(resolveGatheringPhotoSourceSheetDelay({
    triggeredFromActionDrawer: true,
    reducedMotion: false
  }), GATHERING_PHOTO_SOURCE_SHEET_DRAWER_DELAY_MS);
  assert.equal(resolveGatheringPhotoSourceSheetDelay({
    triggeredFromActionDrawer: true,
    reducedMotion: true
  }), 0);
  assert.equal(resolveGatheringPhotoSourceSheetDelay({
    triggeredFromActionDrawer: false,
    reducedMotion: false
  }), 0);
  assert.match(chooserSource, /options\?\.origin === "card"/u);
});

test("camera is single rear capture and album preserves multiple selection without capture", () => {
  assert.deepEqual(getGatheringPhotoInputPolicy("camera", true), {
    accept: "image/*",
    capture: "environment",
    multiple: false
  });
  assert.deepEqual(getGatheringPhotoInputPolicy("album", true), {
    accept: "image/*",
    multiple: true
  });
  assert.deepEqual(getGatheringPhotoInputPolicy("album", false), {
    accept: "image/*",
    multiple: false
  });
  assert.equal("capture" in getGatheringPhotoInputPolicy("album", true), false);
});

test("selection is normalized once and input resets immediately", () => {
  const first = { name: "first.jpg" };
  const second = { name: "second.png" };
  const input = {
    files: { 0: first, 1: second, length: 2 },
    value: "C:\\fakepath\\second.png"
  };
  assert.deepEqual(consumeAndResetGatheringPhotoInput(input), [first, second]);
  assert.equal(input.value, "");
});

test("picker cancel is an empty no-op and pre-open reset permits same-file reselection", () => {
  const cancelledInput = { files: null, value: "stale" };
  assert.deepEqual(consumeAndResetGatheringPhotoInput(cancelledInput), []);
  assert.equal(cancelledInput.value, "");

  const sameFileInput = { value: "C:\\fakepath\\same.jpg" };
  resetGatheringPhotoInput(sameFileInput);
  assert.equal(sameFileInput.value, "");
});

test("camera and album inputs converge on the existing canonical upload handler", () => {
  assert.match(chooserSource, /cameraInputRef/u);
  assert.match(chooserSource, /albumInputRef/u);
  assert.match(chooserSource, /onFilesSelectedRef\.current\(files\)/u);
  assert.doesNotMatch(chooserSource, /getUserMedia|mediaDevices/u);

  assert.match(gatheringLocationsSource, /onFilesSelected=\{handlePhotoFiles\}/u);
  assert.match(gatheringLocationsSource, /!canAddPhotos/u);
  assert.doesNotMatch(gatheringLocationsSource, /photoInputRef/u);
  assert.doesNotMatch(gatheringLocationsSource, /router\.refresh|location\.reload/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveGatheringPhotoReplacement } from "../lib/dailyPlan/gatheringPhotoMutation.ts";

const routeSource = readFileSync(
  new URL("../app/api/projects/[projectId]/daily-plans/[dailyPlanId]/gathering-photos/route.ts", import.meta.url),
  "utf8"
);
const clientSource = readFileSync(
  new URL("../lib/data/dailyPlanGatheringPhotos.ts", import.meta.url),
  "utf8"
);

function photo(id, sortOrder) {
  return { id, sortOrder, url: `/${id}.jpg` };
}

test("replacement keeps the old index, legacy siblings, and source objects", () => {
  const source = [photo("legacy-a", 0), photo("active", 1), photo("legacy-c", 2)];
  const replacement = photo("new-photo", 99);
  const result = resolveGatheringPhotoReplacement(source, "active", replacement);

  assert.equal(result.status, "apply");
  if (result.status !== "apply") return;
  assert.equal(result.replacedPhoto, source[1]);
  assert.deepEqual(result.photos.map(({ id, sortOrder }) => ({ id, sortOrder })), [
    { id: "legacy-a", sortOrder: 0 },
    { id: "new-photo", sortOrder: 1 },
    { id: "legacy-c", sortOrder: 2 }
  ]);
  assert.deepEqual(source.map(({ id, sortOrder }) => ({ id, sortOrder })), [
    { id: "legacy-a", sortOrder: 0 },
    { id: "active", sortOrder: 1 },
    { id: "legacy-c", sortOrder: 2 }
  ]);
});

test("replacement retry is idempotent only after the old photo is gone", () => {
  const applied = resolveGatheringPhotoReplacement(
    [photo("new-photo", 0), photo("legacy", 1)],
    "old-photo",
    photo("new-photo", 0)
  );
  assert.equal(applied.status, "idempotent");

  const collision = resolveGatheringPhotoReplacement(
    [photo("old-photo", 0), photo("new-photo", 1)],
    "old-photo",
    photo("new-photo", 1)
  );
  assert.equal(collision.status, "conflict");

  const missing = resolveGatheringPhotoReplacement(
    [photo("other", 0)],
    "old-photo",
    photo("new-photo", 0)
  );
  assert.equal(missing.status, "missing");
});

test("single-photo POST uploads, switches metadata, then cleans old storage", () => {
  const postStart = routeSource.indexOf("export async function POST");
  const deleteStart = routeSource.indexOf("export async function DELETE");
  const postSource = routeSource.slice(postStart, deleteStart);
  const uploadIndex = postSource.indexOf("await uploadFile");
  const metadataSwitchIndex = postSource.indexOf("resolveGatheringPhotoReplacement");
  const saveIndex = postSource.indexOf("const saved = await saveMemo");
  const cleanupIndex = postSource.indexOf("[gathering-photos:replace-cleanup]");

  assert.ok(uploadIndex >= 0);
  assert.ok(metadataSwitchIndex > uploadIndex);
  assert.ok(saveIndex > metadataSwitchIndex);
  assert.ok(cleanupIndex > saveIndex);
  assert.match(postSource, /if \(!replacedPhotoId && point\.photos\.length > 0\)/u);
  assert.match(postSource, /uploadedPaths\.length = 0;[\s\S]*replace-cleanup/u);
});

test("POST reports a metadata CAS conflict before stale replacement preconditions", () => {
  const postStart = routeSource.indexOf("export async function POST");
  const deleteStart = routeSource.indexOf("export async function DELETE");
  const postSource = routeSource.slice(postStart, deleteStart);
  const idempotentIndex = postSource.indexOf("if (existingPhoto && (!replacedPhotoId || !replacedPhoto))");
  const casIndex = postSource.indexOf("if (expectedUpdatedAt && String(planRow.updated_at ?? \"\") !== expectedUpdatedAt)");
  const missingReplacementIndex = postSource.indexOf("if (replacedPhotoId && !replacedPhoto)");
  const nonemptyAddIndex = postSource.indexOf("if (!replacedPhotoId && point.photos.length > 0)");

  assert.ok(idempotentIndex >= 0 && casIndex > idempotentIndex);
  assert.ok(missingReplacementIndex > casIndex);
  assert.ok(nonemptyAddIndex > casIndex);
});

test("DELETE commits metadata before best-effort storage cleanup and supports stale retries", () => {
  const deleteStart = routeSource.indexOf("export async function DELETE");
  const patchStart = routeSource.indexOf("export async function PATCH");
  const deleteSource = routeSource.slice(deleteStart, patchStart);

  assert.ok(deleteSource.indexOf("const saved = await saveMemo") < deleteSource.indexOf("[gathering-photos:delete-cleanup]"));
  assert.match(deleteSource, /if \(!photo\) \{[\s\S]*idempotent: true/u);
});

test("client replacement reuses the canonical upload form and sends only replacement intent", () => {
  assert.match(clientSource, /replaceDailyPlanGatheringPhoto/u);
  assert.match(clientSource, /createGatheringPhotoUploadFormData\(input\)/u);
  assert.match(clientSource, /formData\.set\("replacedPhotoId", input\.replacedPhotoId\)/u);
  assert.doesNotMatch(clientSource, /deleteDailyPlanGatheringPhoto\([\s\S]*replaceDailyPlanGatheringPhoto/u);
});

test("only an application CAS conflict may expose its safe conflict message", () => {
  assert.match(routeSource, /const isMetadataConflict = source\.status === 409 && Boolean\(source\.latestUpdatedAt\)/u);
  assert.match(routeSource, /error: isMetadataConflict[\s\S]*\? source\.message[\s\S]*: fallbackMessage/u);
});

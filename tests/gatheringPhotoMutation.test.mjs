import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_GATHERING_PHOTO_PARENT_NAME,
  ensureGatheringPhotoParent,
  findGatheringPhotoParentId,
  resolveGatheringPhotoReplacement
} from "../lib/dailyPlan/gatheringPhotoMutation.ts";

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

function gatheringMeta({ teams = [], gatheringPoints = [] } = {}) {
  return { teams, gatheringPoints, memoText: "legacy memo" };
}

test("explicit upload seeds a neutral server parent without mutating the source", () => {
  const source = gatheringMeta();
  const result = ensureGatheringPhotoParent(source, {
    pointId: "gathering_server_seed",
    locationId: "",
    locationName: "  ",
    address: "",
    departmentIds: []
  });

  assert.equal(result.created, true);
  assert.equal(result.point.id, "gathering_server_seed");
  assert.equal(result.point.locationName, DEFAULT_GATHERING_PHOTO_PARENT_NAME);
  assert.deepEqual(result.point.departmentIds, []);
  assert.deepEqual(result.point.photos, []);
  assert.deepEqual(source.gatheringPoints, []);
  assert.equal(result.meta.memoText, "legacy memo");
});

test("parent ensure preserves legacy points, filters departments, and is idempotent", () => {
  const legacyPhoto = photo("legacy-photo", 0);
  const legacyPoint = {
    id: "gathering_legacy",
    locationName: "기존 장소",
    departmentIds: ["team-b"],
    departmentTimes: [{ departmentId: "team-b", time: "08:00" }],
    photos: [legacyPhoto]
  };
  const source = gatheringMeta({
    teams: [
      { id: "team-a", callTime: "07:00" },
      { id: "team-b", callTime: "08:00", gatheringPointId: legacyPoint.id }
    ],
    gatheringPoints: [legacyPoint]
  });
  const input = {
    pointId: "gathering_server_seed",
    locationId: "location-a",
    locationName: "새 장소",
    address: "서울",
    departmentIds: ["team-a", "unknown-team"]
  };
  const result = ensureGatheringPhotoParent(source, input);

  assert.equal(result.meta.gatheringPoints[0], legacyPoint);
  assert.equal(result.meta.gatheringPoints[0].photos[0], legacyPhoto);
  assert.deepEqual(result.point.departmentIds, ["team-a"]);
  assert.deepEqual(result.point.departmentTimes, [{ departmentId: "team-a", time: "07:00" }]);
  assert.equal(result.meta.teams[0].gatheringPointId, result.point.id);
  assert.equal(result.meta.teams[1].gatheringPointId, legacyPoint.id);

  const retry = ensureGatheringPhotoParent(result.meta, input);
  assert.equal(retry.created, false);
  assert.equal(retry.meta, result.meta);
  assert.equal(retry.point, result.point);
});

test("same-photo retry resolves its committed parent and rejects ambiguous legacy IDs", () => {
  const committed = gatheringMeta({
    gatheringPoints: [{
      id: "gathering_server_seed",
      locationName: DEFAULT_GATHERING_PHOTO_PARENT_NAME,
      departmentIds: [],
      departmentTimes: [],
      photos: [photo("stable-photo-id", 0)]
    }]
  });
  assert.equal(findGatheringPhotoParentId(committed, "stable-photo-id"), "gathering_server_seed");

  const ambiguous = gatheringMeta({
    gatheringPoints: [
      ...committed.gatheringPoints,
      {
        id: "gathering_legacy_duplicate",
        locationName: "과거 장소",
        departmentIds: [],
        departmentTimes: [],
        photos: [photo("stable-photo-id", 0)]
      }
    ]
  });
  assert.equal(findGatheringPhotoParentId(ambiguous, "stable-photo-id"), "");
});

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
  const uploadIndex = postSource.indexOf("await uploadFile");

  assert.ok(idempotentIndex >= 0 && casIndex > idempotentIndex);
  assert.ok(missingReplacementIndex > casIndex);
  assert.ok(nonemptyAddIndex > casIndex);
  assert.ok(uploadIndex > nonemptyAddIndex);
});

test("missing-parent creation is explicit POST-only and retry lookup precedes server ID creation", () => {
  const putStart = routeSource.indexOf("export async function PUT");
  const postStart = routeSource.indexOf("export async function POST");
  const deleteStart = routeSource.indexOf("export async function DELETE");
  const resolverStart = routeSource.indexOf("function resolveOrCreateGatheringPoint");
  const storageStart = routeSource.indexOf("function storageBasePath");
  const putSource = routeSource.slice(putStart, postStart);
  const postSource = routeSource.slice(postStart, deleteStart);
  const resolverSource = routeSource.slice(resolverStart, storageStart);

  assert.doesNotMatch(putSource, /allowCreate|persistedOnly|requestedPhotoId/u);
  assert.match(postSource, /const ensureGatheringPoint = ensureGatheringPointValue === "true"/u);
  assert.match(postSource, /ensureGatheringPoint && \(requestedPointId \|\| replacedPhotoId\)/u);
  assert.match(
    postSource,
    /allowCreate: ensureGatheringPoint && !requestedPointId && !replacedPhotoId/u
  );
  assert.match(postSource, /persistedOnly: true/u);
  assert.ok(postSource.indexOf("getProjectRequestRole") < postSource.indexOf("validateOptimizedPhotoFiles"));
  assert.ok(postSource.indexOf("validateOptimizedPhotoFiles") < postSource.indexOf("resolveOrCreateGatheringPoint"));
  assert.ok(resolverSource.indexOf("findGatheringPhotoParentId") < resolverSource.indexOf("createGatheringPointId()"));
  assert.match(resolverSource, /if \(sourceContainsRetryPhoto && !retryPointId\) return null/u);
  assert.match(resolverSource, /if \(input\.allowCreate === false\) return null/u);
  assert.match(resolverSource, /const pointId = createGatheringPointId\(\)/u);
  assert.doesNotMatch(clientSource, /createGatheringPointId/u);
});

test("client sends ensure intent only for add with a missing persisted parent", () => {
  const uploadStart = clientSource.indexOf("export async function uploadDailyPlanGatheringPhoto");
  const replaceStart = clientSource.indexOf("export async function replaceDailyPlanGatheringPhoto");
  const deleteStart = clientSource.indexOf("export async function deleteDailyPlanGatheringPhoto");
  const builderStart = clientSource.indexOf("function createGatheringPhotoUploadFormData");
  const responseStart = clientSource.indexOf("async function readMutationResponse");
  const uploadSource = clientSource.slice(uploadStart, replaceStart);
  const replaceSource = clientSource.slice(replaceStart, deleteStart);
  const builderSource = clientSource.slice(builderStart, responseStart);

  assert.match(uploadSource, /ensureMissingParent: true/u);
  assert.doesNotMatch(replaceSource, /ensureMissingParent/u);
  assert.match(
    builderSource,
    /if \(options\.ensureMissingParent && !input\.gatheringPointId\)[\s\S]*formData\.set\("ensureGatheringPoint", "true"\)/u
  );
});

test("DELETE stages reversible metadata removal and defers storage cleanup to finalize", () => {
  const deleteStart = routeSource.indexOf("export async function DELETE");
  const patchStart = routeSource.indexOf("export async function PATCH");
  const deleteSource = routeSource.slice(deleteStart, patchStart);

  assert.ok(deleteSource.indexOf("createProjectDeleteReceipt") < deleteSource.indexOf("const saved = await saveMemo"));
  assert.doesNotMatch(deleteSource, /storage\.from\(STORAGE_BUCKET\)\.remove|delete-cleanup/u);
  assert.match(routeSource, /async function finalizeDeletedGatheringPhoto/u);
  assert.match(routeSource, /photoStillReferenced[\s\S]*finalized: false, restored: true/u);
  assert.match(routeSource, /finalizeDeletedGatheringPhoto[\s\S]*storage\.from\(STORAGE_BUCKET\)\.remove\(paths\)/u);
  assert.match(routeSource, /async function restoreDeletedGatheringPhoto/u);
  assert.match(routeSource, /restoredPhotos\.splice\([\s\S]*snapshot\.originalIndex/u);
  assert.match(deleteSource, /if \(!photo\) \{[\s\S]*idempotent: true/u);
  assert.match(
    deleteSource,
    /if \(!point && sourcePoint && !sourcePoint\.photos\.some\([\s\S]*idempotent: true/u
  );
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

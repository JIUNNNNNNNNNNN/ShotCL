import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createProjectDeleteReceipt,
  ProjectDeleteReceiptError,
  verifyProjectDeleteReceipt
} from "../lib/projectDeleteReceipt.server.ts";

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

test("delete receipts are HMAC scoped to project and entity kind", () => {
  const previousSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  try {
    const payload = { shots: [{ id: "shot-1", order_index: 7 }] };
    const receipt = createProjectDeleteReceipt({
      projectId: "project-a",
      kind: "shots",
      payload
    });
    assert.deepEqual(
      verifyProjectDeleteReceipt(receipt, { projectId: "project-a", kind: "shots" }),
      payload
    );
    assert.throws(
      () => verifyProjectDeleteReceipt(receipt, { projectId: "project-b", kind: "shots" }),
      ProjectDeleteReceiptError
    );
    assert.throws(
      () => verifyProjectDeleteReceipt(receipt, { projectId: "project-a", kind: "daily-plan-round" }),
      ProjectDeleteReceiptError
    );
    const [encoded, signature] = receipt.split(".");
    const tampered = `${encoded.slice(0, -1)}${encoded.endsWith("A") ? "B" : "A"}.${signature}`;
    assert.throws(
      () => verifyProjectDeleteReceipt(tampered, { projectId: "project-a", kind: "shots" }),
      ProjectDeleteReceiptError
    );
  } finally {
    if (previousSecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSecret;
  }
});

test("delete receipts have an enforced expiry and bounded TTL", () => {
  const previousSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalNow = Date.now;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  try {
    Date.now = () => 1_000_000;
    const receipt = createProjectDeleteReceipt({
      projectId: "project-a",
      kind: "shots",
      payload: { id: "shot-1" },
      ttlSeconds: 1
    });
    Date.now = () => 1_002_000;
    assert.throws(
      () => verifyProjectDeleteReceipt(receipt, { projectId: "project-a", kind: "shots" }),
      ProjectDeleteReceiptError
    );
    assert.throws(() => createProjectDeleteReceipt({
      projectId: "project-a",
      kind: "shots",
      payload: {},
      ttlSeconds: 24 * 60 * 60 + 1
    }), ProjectDeleteReceiptError);
  } finally {
    Date.now = originalNow;
    if (previousSecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSecret;
  }
});

test("shot delete receipts preserve exact rows and status-log cascade for single and batch restore", () => {
  const singleRoute = readSource("app/api/projects/[projectId]/shots/[shotId]/route.ts");
  const batchRoute = readSource("app/api/projects/[projectId]/shots/route.ts");
  const data = readSource("lib/data/shots.ts");

  assert.match(singleRoute, /from\("shot_status_logs"\)[\s\S]*createProjectDeleteReceipt[\s\S]*\.delete\(\)/u);
  assert.match(singleRoute, /\.eq\("updated_at", shot\.updated_at\)/u);
  assert.match(batchRoute, /payload:\s*\{[\s\S]*shots,[\s\S]*statusLogs:/u);
  assert.match(batchRoute, /from\("shots"\)[\s\S]*upsert\(restored\.shots\.slice[\s\S]*from\("shot_status_logs"\)[\s\S]*upsert\(restored\.statusLogs\.slice/u);
  assert.match(batchRoute, /per-row updated_at guards[\s\S]*\.in\("id", batch\.map[\s\S]*\.or\(versionFilter\)/u);
  assert.match(data, /operation: "restore_deleted", receipt/u);
  assert.doesNotMatch(data, /operation: "restore_deleted", shots/u);
});

test("daily-plan delete receipt restores stable child IDs and only reattaches still-unassigned progress shots", () => {
  const route = readSource("app/api/projects/[projectId]/daily-plans/[dailyPlanId]/route.ts");
  const data = readSource("lib/data/dailyPlans.ts");
  const navigation = readSource("components/ProjectNavigation.tsx");

  assert.match(route, /dailyPlanShots: shotResult\.data \?\? \[\]/u);
  assert.match(route, /dailyPlanStaffMembers:/u);
  assert.match(route, /progressShotIds:/u);
  assert.match(route, /restoreDailyPlanChildRows\(supabase, "daily_plan_shots", snapshot\.dailyPlanShots\)/u);
  assert.match(route, /\.update\(\{ daily_plan_id: dailyPlanId \}\)[\s\S]*\.is\("daily_plan_id", null\)/u);
  assert.match(route, /deleteDailyPlanChildRowsWithVersions[\s\S]*\.or\(versionFilter\)/u);
  assert.match(route, /remainingProgressResult[\s\S]*progressRelationChanged/u);
  assert.match(route, /finalizeDeletedDailyPlanStorage[\s\S]*dailyPlanStorageReferences/u);
  assert.match(route, /from\("daily_plans"\)[\s\S]*select\("id,memo,meal_times"\)[\s\S]*\.range\(/u);
  assert.match(route, /!liveReferences\.paths\.has\(path\)[\s\S]*storage[\s\S]*\.remove\(/u);
  assert.doesNotMatch(
    sourceBetween(route, "export async function DELETE", "async function deleteDailyPlanChildRowsWithVersions"),
    /storage[\s\S]*\.remove\(/u
  );
  assert.match(data, /operation: "restore_deleted", receipt: mutation\.receipt/u);
  assert.match(data, /keepalive: mutation\.receipt\.length <= 48_000/u);
  assert.match(navigation, /deleteWithUndo\(\{[\s\S]*key: `daily-plan:\$\{target\.id\}`/u);
  assert.doesNotMatch(navigation, /일촬표를 삭제하시겠습니까/u);
});

test("scene-list deletion uses exact signed rows and CAS-protects merge-note rollback", () => {
  const route = readSource("app/api/projects/[projectId]/scene-list/route.ts");
  const data = readSource("lib/data/sceneList.ts");
  const page = readSource("app/projects/[id]/scene-list/page.tsx");

  assert.match(route, /kind: "scene-list-item"[\s\S]*payload: \{ item: itemRow, removedMerges \}/u);
  assert.match(route, /\.eq\("updated_at", String\(itemRow\.updated_at/u);
  assert.match(route, /update\(\{ cell_merges: remainingMerges \}\)[\s\S]*\.eq\("updated_at", String\(noteRow\.updated_at/u);
  assert.match(route, /parseSceneItemDeleteReceipt\(projectId, body\.receipt\)/u);
  assert.doesNotMatch(route, /parseSceneItemDeleteReceipt\(projectId, body\.item/u);
  assert.match(data, /restoreProjectSceneItem[\s\S]*body: JSON\.stringify\(\{ action: "restore-item", receipt \}\)/u);
  assert.match(data, /finalizeDeletedProjectSceneItem[\s\S]*keepalive: receipt\.length <= 48_000/u);
  assert.match(page, /const result = await deleteProjectSceneItem[\s\S]*deleteReceipt = result\?\.receipt[\s\S]*restoreProjectSceneItem\(projectId, deleteReceipt/u);
});

test("staff and calendar deletes restore only server-signed exact rows with updated_at CAS", () => {
  const staffRoute = readSource("app/api/projects/[projectId]/staff-list/route.ts");
  const staffData = readSource("lib/data/staffMembers.ts");
  const calendarRoute = readSource("app/api/projects/[projectId]/calendar-events/route.ts");
  const calendarData = readSource("lib/data/projectCalendarEvents.ts");

  assert.match(staffRoute, /kind: "staff-member"[\s\S]*payload: \{ member, department \}/u);
  assert.match(staffRoute, /\.eq\("updated_at", String\(member\.updated_at/u);
  assert.match(staffRoute, /restoreDeletedStaffMember\(supabase, projectId, body\.receipt\)/u);
  assert.match(staffData, /restore-deleted-member", receipt/u);
  assert.match(staffData, /finalizeDeletedProjectStaffMember[\s\S]*keepalive: receipt\.length <= 48_000/u);

  assert.match(calendarRoute, /kind: "calendar-event"[\s\S]*payload: \{ event: eventRecord \}/u);
  assert.match(calendarRoute, /\.eq\("updated_at", String\(eventRecord\.updated_at/u);
  assert.match(calendarRoute, /restoreDeletedCalendarEvent\(access, body\.receipt\)/u);
  assert.match(calendarData, /operation: "restore_deleted", receipt/u);
  assert.match(calendarData, /finalizeDeletedProjectCalendarEvent[\s\S]*keepalive: receipt\.length <= 48_000/u);
});

test("all owned DB receipt finalizers use bounded unload keepalive", () => {
  const shots = readSource("lib/data/shots.ts");
  const dailyPlans = readSource("lib/data/dailyPlans.ts");
  const basicInfo = readSource("lib/data/projects.ts");

  assert.match(shots, /finalizeDeletedShots[\s\S]*keepalive: receipt\.length <= 48_000/u);
  assert.match(dailyPlans, /finalizeDeletedDailyPlan[\s\S]*keepalive: mutation\.receipt\.length <= 48_000/u);
  assert.match(basicInfo, /finalizeDeletedProjectBasicInfoEntity[\s\S]*keepalive: receipt\.length <= 48_000/u);
});

test("costume scene and item deletes retain storage until signed-receipt finalize", () => {
  const sceneRoute = readSource("app/api/projects/[projectId]/costume-scenes/route.ts");
  const itemRoute = readSource("app/api/projects/[projectId]/costumes/route.ts");
  const data = readSource("lib/data/projectReferenceAssets.ts");

  assert.match(sceneRoute, /select\("\*"\)[\s\S]*payload: \{ scene, items: snapshotItems \}/u);
  assert.match(sceneRoute, /upsert\(\[snapshot\.scene\],[\s\S]*restoreDeletedCostumeItemRows\(supabase, snapshot\.items\)/u);
  assert.match(sceneRoute, /finalizeDeletedCostumeImages/u);
  assert.doesNotMatch(
    sourceBetween(sceneRoute, "export async function DELETE", "function readDeletedCostumeSceneReceipt"),
    /storage[\s\S]*\.remove\(/u
  );
  assert.match(itemRoute, /payload: \{ item: existing \}/u);
  assert.match(itemRoute, /\.eq\("updated_at", existing\.updated_at\)/u);
  assert.doesNotMatch(
    sourceBetween(itemRoute, "export async function DELETE", "function readDeletedCostumeItemReceipt"),
    /storage[\s\S]*\.remove\(/u
  );
  assert.match(data, /restoreDeletedProjectCostumeScene[\s\S]*operation: "restore_deleted"/u);
  assert.match(data, /finalizeDeletedProjectCostume[\s\S]*operation: "finalize_deleted"/u);
  assert.match(itemRoute, /payload: \{ itemId, image, index \}/u);
  assert.match(itemRoute, /restoreDeletedCostumeImage[\s\S]*imagePaths\.splice\(Math\.min\(snapshot\.index/u);
  assert.match(data, /deleteProjectCostumeImage[\s\S]*operation: "delete_image"/u);
  assert.match(data, /restoreDeletedProjectCostumeImage[\s\S]*operation: "restore_deleted_image"/u);
});

test("diagram archive receipts preserve linked rows and space presets keep stable IDs", () => {
  const route = readSource("app/api/projects/[projectId]/shot-diagrams/route.ts");
  const data = readSource("lib/data/shotMediaArchive.ts");

  assert.match(route, /payload: \{ archives, links \}/u);
  assert.match(route, /restoreDiagramRows\(supabase, snapshot\.archives\)[\s\S]*restoreDiagramRows\(supabase, snapshot\.links\)/u);
  assert.match(route, /SPACE_PRESET_DELETE_RECEIPT_KIND[\s\S]*payload: \{ preset: presetRow \}/u);
  assert.match(route, /upsert\(rows\.slice[\s\S]*onConflict: "id"[\s\S]*ignoreDuplicates: true/u);
  assert.match(data, /restoreDeletedOverheadDiagramArchives[\s\S]*restore_deleted_archives/u);
  assert.match(data, /restoreDeletedShotOverheadSpacePreset[\s\S]*restore_deleted_space_preset/u);
});

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

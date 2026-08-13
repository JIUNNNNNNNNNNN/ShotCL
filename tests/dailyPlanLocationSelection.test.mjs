import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorPath = new URL("../components/DailyPlanEditor.tsx", import.meta.url);
const locationMenuPath = new URL("../components/DailyPlanLocationMenu.tsx", import.meta.url);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("Daily Plan location selectors share compact stable-ID options", async () => {
  const source = await readFile(editorPath, "utf8");
  const editorSetup = sourceBetween(
    source,
    "const sceneLocationOptions = useMemo(",
    "const sceneLocationAssignments = useMemo("
  );
  const callLocationSelect = sourceBetween(
    source,
    "function CallLocationSelect({",
    "function resolveDailyPlanLocationSelectValue("
  );

  assert.match(editorSetup, /buildDailyPlanLocationOptions\(locations\)/u);
  assert.match(editorSetup, /resolveEffectiveGatheringLocation\(locations\)/u);
  assert.match(source, /isPrimary=\{effectiveGatheringLocation\?\.id === location\.id\}/u);
  assert.match(source, /aria-label="기본 집합장소"[\s\S]*?<option value="">장소 없음<\/option>[\s\S]*?dailyPlanLocationOptions\.map/u);
  assert.match(source, /onChange=\{\(event\) => setMeetingLocationId\(event\.currentTarget\.value\)\}/u);

  assert.match(callLocationSelect, /resolveDailyPlanLocationReference\(\{ locations, locationId, legacyText: value \}\)/u);
  assert.match(callLocationSelect, /<option value="">장소 없음<\/option>/u);
  assert.match(callLocationSelect, /resolution\.kind === "legacy"/u);
  assert.match(callLocationSelect, /options\.map\(\(option\) =>/u);
  assert.match(callLocationSelect, /value=\{option\.id\}>\{option\.label\}/u);
  assert.match(callLocationSelect, /onChange\(selectedOption\?\.label \?\? "", selectedOption\?\.id \?\? ""\)/u);
  assert.doesNotMatch(callLocationSelect, /datalist|roadAddress|address|providerPlaceName/u);
});

test("additional schedules and call sheets resolve actual addresses only for document output", async () => {
  const source = await readFile(editorPath, "utf8");
  const timetableRows = sourceBetween(
    source,
    "function getPrintTimetableRows(",
    "function sortScenesNaturallyForPreview("
  );
  const previewBuilder = sourceBetween(
    source,
    "function buildDailyPlanPreviewData(",
    "/** 실제 timetable cell에 출력되는 값만으로"
  );

  assert.match(
    source,
    /aria-label=\{`기타 일정 \$\{mealIndex \+ 1\} 장소`\}[\s\S]*?<option value="">장소 없음<\/option>[\s\S]*?dailyPlanLocationOptions\.map/u
  );
  assert.match(timetableRows, /type: "scene"[\s\S]*?location: formatDailyPlanTimetableLocation\(scene\.mainLocation, scene\.subLocation\)/u);
  assert.match(timetableRows, /type: "additionalSchedule"[\s\S]*?location: getDailyPlanLocationReferenceAddress\(\{[\s\S]*?locationId: meal\.locationId/u);
  assert.doesNotMatch(timetableRows, /getDailyPlanLocationOptionLabel/u);

  assert.equal(previewBuilder.match(/getDailyPlanLocationReferenceAddress\(\{/gu)?.length, 2);
  assert.match(previewBuilder, /locationId: person\.callLocationId,[\s\S]*?legacyText: person\.callLocation/u);
  assert.match(previewBuilder, /locationId: team\.callLocationId,[\s\S]*?legacyText: team\.callLocation/u);
});

test("actor and staff choices persist stable IDs and deleted references clear safely", async () => {
  const source = await readFile(editorPath, "utf8");
  const actorSection = sourceBetween(
    source,
    "{printMeta.starring.map((person, index) => {",
    "data-testid=\"daily-plan-staff-department-section\""
  );
  const teamSection = sourceBetween(
    source,
    "{effectivePrintMeta.teams.map((team, index) => (",
    "{gatheringPoints.some((point) => point.photos.length > 0)"
  );
  const deleteLocation = sourceBetween(
    source,
    "function deleteLocation(index: number)",
    "async function openDaumAddressSearch("
  );

  assert.match(actorSection, /locationId=\{person\.callLocationId\}/u);
  assert.match(actorSection, /callLocationId: locationId \|\| undefined/u);
  assert.match(teamSection, /locationId=\{team\.callLocationId\}/u);
  assert.match(teamSection, /callLocationId: locationId \|\| undefined/u);

  assert.match(deleteLocation, /meal\.locationId === target\.id \? \{ \.\.\.meal, locationId: "" \}/u);
  assert.match(deleteLocation, /person\.callLocationId === target\.id[\s\S]*?callLocation: "", callLocationId: undefined/u);
  assert.match(deleteLocation, /team\.callLocationId === target\.id[\s\S]*?callLocation: "", callLocationId: undefined/u);
  assert.doesNotMatch(deleteLocation, /mainLocation: ""|subLocation: ""/u);
});

test("location changes stay in the existing local autosave snapshot without refetching", async () => {
  const source = await readFile(editorPath, "utf8");
  const autosave = sourceBetween(
    source,
    "const dailyPlanAutosaveSnapshot = useMemo<DailyPlanAutosaveSnapshot>",
    "pageSaveActionRef.current"
  );

  assert.match(autosave, /plan,[\s\S]*?printMeta,[\s\S]*?locations,[\s\S]*?mealTimes,[\s\S]*?scenes/u);
  assert.match(autosave, /saveCurrentPlan\(false, undefined, true, snapshot\)/u);
  assert.doesNotMatch(autosave, /router\.refresh|fetch\(/u);
});

test("Daily Plan entity deletes are immediate, undoable, and use the existing autosave queue", async () => {
  const [source, menuSource] = await Promise.all([
    readFile(editorPath, "utf8"),
    readFile(locationMenuPath, "utf8")
  ]);
  const deleteLocation = sourceBetween(
    source,
    "function deleteLocation(index: number)",
    "async function openDaumAddressSearch("
  );
  const deleteRows = sourceBetween(
    source,
    "function deleteTimetableRow(rowKey: string)",
    "function persistActorMutation("
  );
  const deleteActor = sourceBetween(
    source,
    "function deleteActorRow(actorId: string)",
    "function updateSceneLocation("
  );

  for (const deleteSource of [deleteLocation, deleteRows, deleteActor]) {
    assert.match(deleteSource, /deleteWithUndo\(\{/u);
    assert.match(deleteSource, /removeLocal:/u);
    assert.match(deleteSource, /restoreLocal:/u);
    assert.match(deleteSource, /deleteRemote: persistCurrentDeleteState/u);
    assert.match(deleteSource, /restoreRemote: persistCurrentDeleteState/u);
    assert.doesNotMatch(deleteSource, /window\.confirm|role="alertdialog"/u);
  }

  assert.match(menuSource, /onClick=\{\(\) => run\(onDelete\)\}/u);
  assert.doesNotMatch(menuSource, /isDeleteConfirming|role=\{isDeleteConfirming|삭제 확인/u);
  assert.doesNotMatch(source, /pendingTimetableDeleteKey|pendingActorDeleteId/u);
});

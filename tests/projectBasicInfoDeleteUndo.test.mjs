import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const formPath = new URL("../components/ProjectBasicInfoForm.tsx", import.meta.url);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("main staff deletion uses stable IDs, immediate local state, and a targeted signed receipt", async () => {
  const source = await readFile(formPath, "utf8");
  const deleteStaff = sourceBetween(
    source,
    "const deleteStaff = useCallback((index: number) => {",
    "const updateTotalEpisodes = useCallback("
  );

  assert.match(deleteStaff, /key: `basic-info-main-staff:\$\{member\.id\}`/u);
  assert.match(deleteStaff, /deleteWithUndo\(\{/u);
  assert.match(deleteStaff, /removeLocal:/u);
  assert.match(deleteStaff, /restoreLocal:/u);
  assert.match(deleteStaff, /insertMainStaffByAnchors/u);
  assert.match(deleteStaff, /deleteRemote:[\s\S]*?deleteProjectBasicInfoEntity\(projectId, \{ kind: "staff", id: member\.id \}\)/u);
  assert.match(deleteStaff, /restoreRemote:[\s\S]*?restoreDeletedProjectBasicInfoEntity\(projectId, receipt\)/u);
  assert.match(deleteStaff, /finalize:[\s\S]*?finalizeDeletedProjectBasicInfoEntity/u);
  assert.match(source, /pendingEntityDeleteCount === 0/u);
  assert.doesNotMatch(source, /persistBasicInfoDeleteSnapshot/u);
  assert.doesNotMatch(deleteStaff, /window\.confirm|role="alertdialog"/u);
});

test("actors have persisted stable IDs and use the same global delete stack", async () => {
  const source = await readFile(formPath, "utf8");
  const deleteActor = sourceBetween(
    source,
    "const deleteActor = useCallback((index: number) => {",
    "function handleSubmit("
  );

  assert.match(source, /key=\{actor\.id\}/u);
  assert.match(source, /createBlankProjectActor\(\)/u);
  assert.match(deleteActor, /key: `basic-info-actor:\$\{actor\.id\}`/u);
  assert.match(deleteActor, /deleteWithUndo\(\{/u);
  assert.match(deleteActor, /insertActorByAnchors/u);
  assert.match(deleteActor, /deleteRemote:[\s\S]*?deleteProjectBasicInfoEntity\(projectId, \{ kind: "actor", id: actor\.id \}\)/u);
  assert.match(deleteActor, /restoreRemote:[\s\S]*?restoreDeletedProjectBasicInfoEntity\(projectId, receipt\)/u);
  assert.match(deleteActor, /finalize:[\s\S]*?finalizeDeletedProjectBasicInfoEntity/u);
});

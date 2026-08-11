import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorPath = new URL("../components/DailyPlanEditor.tsx", import.meta.url);
const documentPath = new URL("../components/DailyPlanDocument.tsx", import.meta.url);
const globalsPath = new URL("../app/globals.css", import.meta.url);

test("mismatch styling is limited to the two editable timetable start inputs", async () => {
  const source = await readFile(editorPath, "utf8");
  assert.equal(source.match(/isStartTimeMismatch=\{/g)?.length, 2);
  assert.match(source, /showStartTimeMismatch \? "!text-field-danger" : ""/u);
  assert.match(source, /aria-description=\{showStartTimeMismatch/u);
  assert.doesNotMatch(source, /aria-invalid=\{showStartTimeMismatch/u);
  assert.doesNotMatch(source, /showStartTimeMismatch \? "[^"\n]*(?:border|bg-|p-|m-|leading-|h-|w-)/u);
  assert.match(source, /Only rows added in this mounted editor may enter the one-shot queue/u);
  assert.doesNotMatch(source, /new Set\(initialPrintMeta\.automaticTimetableRowIds\)/u);
});

test("table geometry and white PDF renderer remain outside mismatch state", async () => {
  const [editor, document, globals] = await Promise.all([
    readFile(editorPath, "utf8"),
    readFile(documentPath, "utf8"),
    readFile(globalsPath, "utf8")
  ]);
  assert.match(editor, /\[8, 9, 11, 6, 8, 8, 14, 15, 11, 10\]/u);
  assert.match(globals, /\.daily-plan-timetable-row--event \{\s*height: 52px;/u);
  assert.match(globals, /\.daily-plan-timetable-row--scene \{\s*height: 58px;/u);
  assert.match(globals, /\.daily-plan-timetable-control \{\s*height: 42px;\s*min-height: 42px;\s*max-height: 42px;/u);
  assert.doesNotMatch(document, /timetable-start-mismatch|expectedStartTime|text-field-danger/u);
});

test("reorder and delete snapshots preserve the current time fields", async () => {
  const source = await readFile(editorPath, "utf8");
  const snapshotSource = source.slice(
    source.indexOf("function createTimetableMutationSnapshot("),
    source.indexOf("function getEditorTimetableRowKey(")
  );
  assert.match(snapshotSource, /const scenes = rows[\s\S]*\.map\(\(row\) => row\.item\)/u);
  assert.match(snapshotSource, /const mealTimes = rows[\s\S]*\.map\(\(row\) => row\.item\)/u);
  assert.doesNotMatch(snapshotSource, /getAutomaticTimetableStartUpdates|applyTimeFieldEdit/u);
});

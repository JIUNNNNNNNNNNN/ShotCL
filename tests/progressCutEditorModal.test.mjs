import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

const editorSource = readSource("components/ShotEditorModal.tsx");
const pickerSource = readSource("components/ShotArchivePicker.tsx");

test("Cut editor keeps canonical Shot content and actor fields", () => {
  assert.match(editorSource, /description: shot\.description/u);
  assert.match(editorSource, /charactersText: shot\.characters\.join\(", "\)/u);
  assert.match(editorSource, /updateField\("description", event\.target\.value\)/u);
  assert.match(editorSource, /updateField\("charactersText", event\.target\.value\)/u);
});

test("desktop Cut editor contains both media sections without a nested picker dialog", () => {
  assert.match(editorSource, /<ShotEditorMediaSection[\s\S]*?mediaType="overhead"/u);
  assert.match(editorSource, /<ShotEditorMediaSection[\s\S]*?mediaType="storyboard"/u);
  assert.match(editorSource, /<ShotArchiveSelector/u);
  assert.doesNotMatch(editorSource, /<ShotArchivePicker/u);
  assert.match(pickerSource, /export function ShotArchiveSelector/u);
});

test("media selection, unlink, and upload share stable canonical linkage", () => {
  assert.match(pickerSource, /await saveShotMediaLink\(\s*shot,\s*mediaType/u);
  assert.match(pickerSource, /asset \? \{ assetId: asset\.id, source: asset\.source \} : null/u);
  assert.match(editorSource, /const shotKey = getShotDiagramKey\(shot\)/u);
  assert.match(editorSource, /await uploadProjectReferenceAsset\(/u);
  assert.match(editorSource, /await saveShotMediaLink\(shot, mediaType, \{ assetId: uploaded\.id, source: "reference" \}\)/u);
  assert.match(editorSource, /thumbnailFile: optimized\.thumbnailFile/u);
  assert.match(editorSource, /shotRef: shotKey\.shotRef/u);
  assert.doesNotMatch(editorSource, /router\.refresh/u);
});

test("media mutations remain read-only gated and category-local", () => {
  assert.match(editorSource, /readOnly=\{readOnly \|\| !onMediaSaved\}/u);
  assert.match(editorSource, /if \(readOnly \|\| isUploading\) return/u);
  assert.match(editorSource, /const \[isUploading, setIsUploading\] = useState\(false\)/u);
  assert.match(pickerSource, /if \(readOnly \|\| isSaving\) return/u);
  assert.match(pickerSource, /const \[isSaving, setIsSaving\] = useState\(false\)/u);
});

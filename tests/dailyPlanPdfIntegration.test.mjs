import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorPath = new URL("../components/DailyPlanEditor.tsx", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

test("PDF action snapshots current state, locks duplicate clicks, and lazy-loads the real exporter", async () => {
  const editor = await readFile(editorPath, "utf8");
  const handler = editor.slice(
    editor.indexOf("async function handlePrint("),
    editor.indexOf("sidebarPrintRequestRef.current")
  );

  assert.ok(handler.indexOf("if (isPrintingRef.current) return") >= 0);
  assert.ok(handler.indexOf("isPrintingRef.current = true") < handler.indexOf("await "));
  assert.match(handler, /previewDataSnapshot \?\? getCurrentPreviewData\(\)/u);
  assert.match(handler, /await import\("@\/lib\/client\/dailyPlanPdf"\)/u);
  assert.match(handler, /root: exportRoot/u);
  assert.match(handler, /orientation,/u);
  assert.match(handler, /filename: buildDailyPlanPdfFilename\(currentPreviewData\)/u);
  assert.match(handler, /finally \{\s*releasePrintView\(\);\s*\}/u);
  assert.match(handler, /PDF를 만들지 못했습니다\. 다시 시도해 주세요\./u);
  assert.doesNotMatch(handler, /window\.print|fetch\(|router\.refresh/u);
});

test("PDF dependencies are production dependencies but stay out of the initial editor imports", async () => {
  const [editor, packageJson] = await Promise.all([
    readFile(editorPath, "utf8"),
    readFile(packagePath, "utf8").then(JSON.parse)
  ]);
  const importSection = editor.slice(0, editor.indexOf("type DailyPlanEditorProps"));

  assert.equal(packageJson.dependencies.html2canvas, "^1.4.1");
  assert.equal(packageJson.dependencies.jspdf, "^4.2.1");
  assert.doesNotMatch(importSection, /html2canvas|jspdf|dailyPlanPdf/u);
});

test("canonical export staging is a direct body portal and never reuses the scaled preview", async () => {
  const editor = await readFile(editorPath, "utf8");
  const portal = editor.slice(
    editor.indexOf("{printJob && typeof document"),
    editor.indexOf("{typeof document !== \"undefined\" && hasActiveCardDrag")
  );
  const staging = editor.slice(
    editor.indexOf("function PrintDailyPlanView"),
    editor.indexOf("const PRINT_HEIGHT_SAFETY_PX")
  );

  assert.match(portal, /createPortal\([\s\S]*document\.body/u);
  assert.match(staging, /data-testid="daily-plan-export-document-root"/u);
  assert.match(staging, /aria-hidden="true"/u);
  assert.doesNotMatch(`${portal}${staging}`, /measurement\.scale|daily-plan-scaled-preview/u);
});

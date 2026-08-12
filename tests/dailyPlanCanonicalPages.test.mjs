import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const documentPath = new URL("../components/DailyPlanDocument.tsx", import.meta.url);
const editorPath = new URL("../components/DailyPlanEditor.tsx", import.meta.url);
const stylesPath = new URL("../app/globals.css", import.meta.url);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

function cssRule(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "gu"))];
  assert.ok(matches.length > 0, `Missing CSS rule: ${selector}`);
  return matches.at(-1)[1];
}

function cssNumber(rule, property) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = rule.match(new RegExp(`${escapedProperty}\\s*:\\s*([0-9.]+)px`, "u"));
  assert.ok(match, `Missing numeric CSS property: ${property}`);
  return Number(match[1]);
}

test("two-page documents expose canonical primary and secondary capture pages only", async () => {
  const source = await readFile(documentPath, "utf8");
  const landscape = sourceBetween(
    source,
    "export function DailyPlanLandscapeDocument",
    "export function DailyPlanPortraitDocument"
  );
  const portrait = sourceBetween(
    source,
    "export function DailyPlanPortraitDocument",
    "function DailyPlanWeatherTable"
  );

  for (const documentSource of [landscape, portrait]) {
    assert.equal(
      documentSource.match(/data-daily-plan-pdf-page=\{pageLayout === "two" \? "primary" : undefined\}/gu)?.length,
      1
    );
    assert.equal(
      documentSource.match(/data-daily-plan-pdf-page=\{pageLayout === "two" \? "secondary" : undefined\}/gu)?.length,
      1
    );
    assert.match(documentSource, /data-daily-plan-notes-boundary/u);
  }

  const landscapePrimary = sourceBetween(
    landscape,
    'data-daily-plan-pdf-page={pageLayout === "two" ? "primary" : undefined}',
    'data-daily-plan-pdf-page={pageLayout === "two" ? "secondary" : undefined}'
  );
  assert.match(landscapePrimary, /daily-plan-header-grid/u);
  assert.match(landscapePrimary, /createLocationFields/u);
  assert.match(landscapePrimary, /<TimetableColumns \/>/u);
  assert.match(landscapePrimary, /<AdditionalScheduleCells row=\{row\} \/>/u);

  const landscapeSecondary = landscape.slice(
    landscape.indexOf('data-daily-plan-pdf-page={pageLayout === "two" ? "secondary" : undefined}')
  );
  assert.match(landscapeSecondary, /memoFields\.map/u);
  assert.match(landscapeSecondary, /title="Starring"/u);
  assert.match(landscapeSecondary, /title="Team"/u);
});

test("screen two-page layout gives every capture section a padded physical A4 page", async () => {
  const styles = await readFile(stylesPath, "utf8");
  const screenPages = sourceBetween(styles, "@media screen {", ".daily-plan-weather-table--portrait");

  assert.match(screenPages, /\.daily-plan-preview-sheet\[data-preview-layout="two"\][\s\S]*padding:\s*0\s*!important/u);
  assert.match(screenPages, /\.daily-plan-document--portrait\[data-page-layout="two"\][\s\S]*width:\s*210mm/u);
  assert.match(screenPages, /\.daily-plan-document--landscape\[data-page-layout="two"\][\s\S]*width:\s*297mm/u);

  const portraitPage = cssRule(
    screenPages,
    '.daily-plan-document--portrait[data-page-layout="two"] [data-daily-plan-pdf-page]'
  );
  assert.match(portraitPage, /width:\s*210mm/u);
  assert.match(portraitPage, /height:\s*297mm/u);
  assert.match(portraitPage, /min-height:\s*297mm/u);
  assert.match(portraitPage, /padding:\s*10mm/u);

  const landscapePage = cssRule(
    screenPages,
    '.daily-plan-document--landscape[data-page-layout="two"] [data-daily-plan-pdf-page]'
  );
  assert.match(landscapePage, /width:\s*297mm/u);
  assert.match(landscapePage, /height:\s*210mm/u);
  assert.match(landscapePage, /min-height:\s*210mm/u);
  assert.match(landscapePage, /padding:\s*10mm/u);

  const sharedPage = cssRule(
    screenPages,
    '.daily-plan-document[data-page-layout="two"] [data-daily-plan-pdf-page]'
  );
  assert.match(sharedPage, /box-sizing:\s*border-box/u);
  assert.match(sharedPage, /background:\s*#ffffff/u);
  assert.doesNotMatch(`${sharedPage}${portraitPage}${landscapePage}`, /overflow:\s*(?:hidden|clip)/u);

  const secondaryPage = cssRule(
    screenPages,
    '.daily-plan-document[data-page-layout="two"] [data-daily-plan-pdf-page="secondary"]'
  );
  assert.match(secondaryPage, /margin-top:\s*8mm/u);
});

test("offscreen export staging is capturable and delegates two-page padding to page sections", async () => {
  const [styles, editor] = await Promise.all([
    readFile(stylesPath, "utf8"),
    readFile(editorPath, "utf8")
  ]);
  const stagingStyles = sourceBetween(
    styles,
    ".daily-plan-template .daily-plan-additional-cell",
    "/* Shell mode is independent from density."
  );
  const staging = cssRule(stagingStyles, ".daily-plan-print-staging");
  assert.match(staging, /position:\s*fixed/u);
  assert.match(staging, /left:\s*-10000px/u);
  assert.match(staging, /visibility:\s*visible/u);
  assert.match(staging, /pointer-events:\s*none/u);
  assert.match(
    editor,
    /className="print-daily-plan print-only daily-plan-print-staging"[\s\S]*?aria-hidden="true"/u
  );

  assert.match(cssRule(stagingStyles, '.daily-plan-print-staging[data-orientation="portrait"]'), /width:\s*210mm/u);
  assert.match(cssRule(stagingStyles, '.daily-plan-print-staging[data-orientation="landscape"]'), /width:\s*297mm/u);

  const printRoot = cssRule(stagingStyles, ".daily-plan-print-layout");
  assert.match(printRoot, /box-sizing:\s*border-box/u);
  assert.match(printRoot, /padding:\s*10mm/u);
  assert.match(printRoot, /background:\s*#ffffff/u);
  assert.match(cssRule(stagingStyles, '.daily-plan-print-layout[data-orientation="portrait"]'), /height:\s*297mm/u);
  assert.match(cssRule(stagingStyles, '.daily-plan-print-layout[data-orientation="landscape"]'), /height:\s*210mm/u);

  const twoPageRoot = cssRule(stagingStyles, '.daily-plan-print-layout[data-print-layout="two"]');
  assert.match(twoPageRoot, /height:\s*auto/u);
  assert.match(twoPageRoot, /min-height:\s*0/u);
  assert.match(twoPageRoot, /padding:\s*0/u);
  assert.match(twoPageRoot, /background:\s*transparent/u);

  assert.match(
    styles,
    /\.daily-plan-print-layout\[data-print-layout="two"\] \.daily-plan-notes-section\s*\{[\s\S]*break-before:\s*page;[\s\S]*page-break-before:\s*always;/u
  );
});

test("Portrait bordered cells keep native table centering and symmetric density metrics", async () => {
  const [documentSource, styles] = await Promise.all([
    readFile(documentPath, "utf8"),
    readFile(stylesPath, "utf8")
  ]);
  const portrait = sourceBetween(
    documentSource,
    "export function DailyPlanPortraitDocument",
    "function DailyPlanWeatherTable"
  );
  const cellRule = cssRule(styles, ".daily-plan-template th");
  const portraitNormal = cssRule(styles, '.daily-plan-document--portrait[data-density="normal"]');
  const portraitCompact = cssRule(styles, '.daily-plan-document--portrait[data-density="compact"]');
  const portraitDense = cssRule(styles, '.daily-plan-document--portrait[data-density="dense"]');

  assert.match(documentSource, /const cellClass = "daily-plan-cell border border-black text-center align-middle"/u);
  assert.match(portrait, /data-portrait-table="timetable-summary"/u);
  assert.match(portrait, /data-portrait-table="scene-details"/u);
  assert.match(portrait, /<TimetableCells/u);
  assert.match(portrait, /<PortraitAdditionalScheduleSummaryCells row=\{row\} \/>/u);
  assert.match(portrait, /총 컷수 \{totalCutCount\}컷/u);
  assert.match(portrait, /<PortraitCallSheetTable[\s\S]*title="Starring"[\s\S]*title="Team"/u);
  assert.match(documentSource, /daily-plan-additional-cell[^"]*items-center justify-center text-center/u);

  assert.match(cellRule, /padding:\s*var\(--daily-plan-cell-padding-block\) var\(--daily-plan-cell-padding-inline\)/u);
  assert.match(cellRule, /vertical-align:\s*middle/u);
  assert.doesNotMatch(cellRule, /display:\s*(?:flex|grid)/u);
  for (const densityRule of [portraitNormal, portraitCompact, portraitDense]) {
    assert.match(densityRule, /--daily-plan-line-height:\s*[0-9.]+/u);
    assert.match(densityRule, /--daily-plan-cell-padding-block:\s*[0-9.]+px/u);
  }

  const portraitAndCellStyles = `${portrait}\n${cellRule}\n${portraitNormal}\n${portraitCompact}\n${portraitDense}`;
  assert.doesNotMatch(
    portraitAndCellStyles,
    /translateY\(|margin-top:\s*-|padding-(?:top|bottom):|align-items:\s*flex-end|justify-content:\s*flex-end|height:\s*100%/u
  );
  assert.match(portrait, /daily-plan-portrait-memo-cell whitespace-pre-wrap align-top/u);
});

test("landscape density steps reduce canonical vertical metrics monotonically", async () => {
  const styles = await readFile(stylesPath, "utf8");
  const baseStyles = sourceBetween(styles, ".daily-plan-template {", ".daily-plan-document--portrait {");
  const normal = cssRule(baseStyles, ".daily-plan-template");
  const compact = cssRule(styles, '.daily-plan-document--landscape[data-density="compact"]');
  const dense = cssRule(styles, '.daily-plan-document--landscape[data-density="dense"]');

  for (const property of [
    "--daily-plan-cell-height",
    "--daily-plan-memo-height",
    "--daily-plan-additional-min-height",
    "--daily-plan-section-gap"
  ]) {
    assert.ok(cssNumber(normal, property) > cssNumber(compact, property), `${property} should shrink at compact density`);
    assert.ok(cssNumber(compact, property) > cssNumber(dense, property), `${property} should shrink at dense density`);
  }
});

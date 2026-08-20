import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (pathname) => readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");

test("Basic Info owns one compact central header with the title left and owner actions right", () => {
  const page = readSource("app/projects/[id]/basic-info/page.tsx");
  const form = readSource("components/ProjectBasicInfoForm.tsx");
  const headerStart = page.indexOf("<header");
  const headerEnd = page.indexOf("</header>", headerStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart);
  const header = page.slice(headerStart, headerEnd);

  assert.match(page, /<div className="mx-auto grid w-full max-w-4xl gap-4">/u);
  assert.match(header, /data-basic-info-page-header/u);
  assert.match(header, /className="flex min-h-11 w-full items-center justify-between gap-3 px-1"/u);
  assert.match(header, /<h1[^>]*>기본정보<\/h1>/u);
  assert.match(header, /\{projectSettingsActionMenu \? \([\s\S]*<ProjectPageActionsMenu registration=\{projectSettingsActionMenu\} \/>[\s\S]*\) : null\}/u);
  assert.ok(
    header.indexOf("기본정보") < header.indexOf("ProjectPageActionsMenu"),
    "title must precede the right-aligned page action in DOM order"
  );

  assert.doesNotMatch(form, /headerAction|ProjectPageActionsMenu|>프로젝트 기본정보</u);
  assert.doesNotMatch(page, /RightPanel|RightDrawer|fixed[^\n]*ProjectPageActionsMenu/u);
});

test("Basic Info owner action still opens the existing permanent-delete dialog", () => {
  const page = readSource("app/projects/[id]/basic-info/page.tsx");

  assert.match(page, /isCreator && project[\s\S]*projectPermanentDelete:[\s\S]*onSelect: \(\) => setIsDeleteDialogOpen\(true\)/u);
  assert.match(page, /isCreator && isDeleteDialogOpen[\s\S]*<ProjectPermanentDeleteDialog/u);
  assert.doesNotMatch(page, /window\.confirm|useProjectDeleteUndo|deleteWithUndo/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (pathname) => readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

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

test("owner registration resolves to one real 44px overflow button at every workspace width", () => {
  const page = readSource("app/projects/[id]/basic-info/page.tsx");
  const menu = readSource("components/ProjectPageActionsMenu.tsx");
  const actions = readSource("components/ProjectPageActions.tsx");
  const styles = readSource("app/globals.css");
  const header = sourceBetween(page, "<header", "</header>");
  const trigger = sourceBetween(menu, "<button", "</button>");
  const triggerStyles = sourceBetween(
    styles,
    ".project-page-actions__trigger {",
    ".project-page-actions__trigger:hover"
  );

  assert.match(page, /isCreator && project[\s\S]*key: "projectSettings"[\s\S]*projectPermanentDelete/u);
  assert.match(actions, /projectSettings:[\s\S]*actionIds: \["projectPermanentDelete"\]/u);
  assert.match(header, /<ProjectPageActionsMenu registration=\{projectSettingsActionMenu\} \/>/u);
  assert.match(trigger, /type="button"/u);
  assert.match(trigger, /className="project-page-actions__trigger no-print"/u);
  assert.match(trigger, /aria-haspopup="menu"/u);
  assert.match(trigger, /<MoreHorizontal aria-hidden \/>/u);

  assert.match(styles, /--ui-control-height:\s*44px/u);
  assert.match(triggerStyles, /display:\s*grid/u);
  assert.match(triggerStyles, /width:\s*var\(--ui-control-height\)/u);
  assert.match(triggerStyles, /height:\s*var\(--ui-control-height\)/u);
  assert.match(styles, /\.project-page-actions \{[\s\S]*flex:\s*0 0 auto/u);
  assert.doesNotMatch(header, /\b(?:hidden|sm:hidden|md:hidden|lg:hidden)\b|viewport|innerWidth|matchMedia/u);
  assert.equal(
    (styles.match(/\.project-page-actions__trigger\s*\{/gu) ?? []).length,
    1,
    "responsive CSS must not replace or hide the canonical trigger"
  );
});

test("the owner menu and destructive dialog stay viewport-clamped on desktop, iPad, and phone", () => {
  const page = readSource("app/projects/[id]/basic-info/page.tsx");
  const menu = readSource("components/ProjectPageActionsMenu.tsx");
  const dialog = readSource("components/ProjectPermanentDeleteDialog.tsx");
  const styles = readSource("app/globals.css");

  assert.match(menu, /const viewportWidth = window\.innerWidth[\s\S]*const viewportHeight = window\.innerHeight/u);
  assert.match(menu, /Math\.min\([\s\S]*viewportWidth - PAGE_MENU_MARGIN \* 2/u);
  assert.match(menu, /Math\.max\([\s\S]*Math\.min\(triggerRect\.right - width, viewportWidth - PAGE_MENU_MARGIN - width\)/u);
  assert.match(menu, /open && typeof document !== "undefined" \? createPortal\(/u);
  assert.match(menu, /role="menu"[\s\S]*data-project-shell-portal/u);
  assert.match(styles, /\.project-page-actions__menu \{[\s\S]*position:\s*fixed[\s\S]*min-width:\s*min\(220px, calc\(100vw - 16px\)\)/u);

  assert.match(page, /projectPermanentDelete:[\s\S]*onSelect: \(\) => setIsDeleteDialogOpen\(true\)/u);
  assert.match(page, /isCreator && isDeleteDialogOpen[\s\S]*<ProjectPermanentDeleteDialog/u);
  assert.match(dialog, /return createPortal\(/u);
  assert.match(dialog, /className="fixed inset-0 z-\[100\] flex items-end justify-center[^"]*sm:items-center/u);
  assert.match(dialog, /role="alertdialog"[\s\S]*aria-modal="true"/u);
  assert.match(dialog, /max-h-\[min\(92dvh,48rem\)\][^\n]*w-full max-w-xl/u);
});

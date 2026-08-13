import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const shellSource = readSource("components/ProjectWorkspaceShell.tsx");
const actionSource = readSource("components/ProjectPageActions.tsx");
const menuSource = readSource("components/ProjectPageActionsMenu.tsx");
const accessGateSource = readSource("components/ProjectAccessGate.tsx");
const dailyPlanEditorSource = readSource("components/DailyPlanEditor.tsx");
const progressSource = readSource("app/projects/[id]/page.tsx");
const scenarioSource = readSource("app/projects/[id]/scenario/page.tsx");
const archiveSource = readSource("app/projects/[id]/storyboard-overhead/page.tsx");
const globalCss = readSource("app/globals.css");

test("project shell mounts only left navigation and main content", () => {
  assert.doesNotMatch(shellSource, /RightProjectSidebar|useCurrentProjectPageActionMenu|PanelRight/u);
  assert.doesNotMatch(shellSource, /actionDrawer|actionToggle|hasRightPanel|project-action-drawer/u);
  assert.match(shellSource, /<aside className="project-shell__navigation no-print"/u);
  assert.match(shellSource, /<main ref=\{contentRef\} className="project-shell__content"/u);
  assert.match(shellSource, /id="project-navigation-drawer"/u);
  assert.equal(
    existsSync(new URL("../components/RightProjectSidebar.tsx", import.meta.url)),
    false
  );
});

test("persistent shell is a true left plus main two-column grid", () => {
  assert.match(
    globalCss,
    /\.project-shell\[data-project-shell-mode="persistent"\]\s*\{[^}]*grid-template-columns:\s*var\(--project-shell-navigation-width\)\s*minmax\(0, 1fr\);/su
  );
  assert.doesNotMatch(globalCss, /project-shell--has-actions|project-shell-action-width|ui-shell-action-width/u);
  assert.doesNotMatch(globalCss, /project-shell__action-panel|project-shell__action-drawer|project-action-menu__/u);
});

test("phone shell retains only the accessible left navigation drawer", () => {
  assert.match(shellSource, /const \[navigationDrawerOpen, setNavigationDrawerOpen\] = useState\(false\)/u);
  assert.match(shellSource, /useAccessibleProjectNavigationDrawer/u);
  assert.match(shellSource, /aria-label=\{navigationDrawerOpen \? "프로젝트 메뉴 닫기" : "프로젝트 메뉴 열기"\}/u);
  assert.doesNotMatch(shellSource, /페이지 작업 열기|페이지 작업 닫기|data-side="right"/u);
  assert.match(globalCss, /\.project-shell__drawer-layer\[data-open="true"\]/u);
  assert.match(globalCss, /\.project-shell__navigation-drawer\s*\{[\s\S]*?left:\s*0;/u);
  assert.match(globalCss, /\.project-shell__app-bar\s*\{[^}]*grid-template-columns:\s*44px 44px minmax\(0, 1fr\);/su);
  assert.doesNotMatch(globalCss, /project-shell__bar-spacer/u);
});

test("page actions resolve directly and render no empty overflow trigger", () => {
  assert.match(actionSource, /export function resolveProjectPageActionMenu/u);
  assert.match(actionSource, /if \(!registration\) return null/u);
  assert.match(actionSource, /if \(!override \|\| override\.hidden\) return \[\]/u);
  assert.match(actionSource, /disabled: Boolean\(override\.disabled \|\| override\.pending\)/u);
  assert.doesNotMatch(actionSource, /createContext|ProjectPageActionsProvider|useProjectPageActionMenu|useCurrentProjectPageActionMenu/u);
  assert.doesNotMatch(accessGateSource, /ProjectPageActionsProvider/u);
  assert.doesNotMatch(actionSource, /hiddenInDrawer|closeDrawerOnSelect/u);
  assert.match(menuSource, /registration: ProjectPageActionMenuRegistration \| null/u);
  assert.match(menuSource, /resolveProjectPageActionMenu\(registration\)/u);
  assert.match(menuSource, /if \(!menu\) return null/u);
  assert.doesNotMatch(menuSource, /useCurrentProjectPageActionMenu|RightProjectSidebar/u);
});

test("the four former right-panel pages own one header menu directly", () => {
  assert.match(dailyPlanEditorSource, /<ProjectPageActionsMenu registration=\{dailyPlanActionMenu\} \/>/u);
  assert.match(progressSource, /action=\{<ProjectPageActionsMenu registration=\{progressActionMenu\} \/>\}/u);
  assert.match(scenarioSource, /<ProjectPageActionsMenu registration=\{isGuest \? null : scenarioActionMenu\} \/>/u);
  assert.match(archiveSource, /<ProjectPageActionsMenu registration=\{archiveActionMenu\} \/>/u);
  assert.doesNotMatch(
    `${dailyPlanEditorSource}\n${progressSource}\n${scenarioSource}\n${archiveSource}`,
    /useProjectPageActionMenu/u
  );
  assert.match(progressSource, /hidden: progressOnly \|\| !persistentProjectShell/u);
});

test("page overflow menu is closed by default and accessible without a drawer", () => {
  assert.match(menuSource, /const \[open, setOpen\] = useState\(false\)/u);
  assert.match(menuSource, /aria-haspopup="menu"/u);
  assert.match(menuSource, /aria-expanded=\{open\}/u);
  assert.match(menuSource, /open && typeof document !== "undefined" \? createPortal/u);
  assert.match(menuSource, /event\.key === "Escape"[\s\S]*close\(true\)/u);
  assert.match(menuSource, /event\.key === "Tab"[\s\S]*setTimeout\(\(\) => close\(\), 0\)/u);
  assert.match(menuSource, /\["ArrowDown", "ArrowUp", "Home", "End"\]/u);
  assert.match(menuSource, /document\.addEventListener\("pointerdown", handlePointerDown, true\)/u);
  assert.match(menuSource, /document\.addEventListener\("focusin", handleFocusIn, true\)/u);
  assert.match(menuSource, /\[menu\?\.key, menu\?\.scopeKey, routeKey\]/u);
  assert.match(menuSource, /aria-current=\{action\.active \? "true" : undefined\}/u);
  assert.match(menuSource, /activeElement === document\.body[\s\S]*activeElement === actionElement[\s\S]*!activeElement\?\.isConnected[\s\S]*triggerRef\.current\?\.focus\(\)/u);
  assert.match(globalCss, /\.project-page-actions__item\[aria-current\]/u);
  assert.doesNotMatch(menuSource, /drawerOpen|actionDrawer|hiddenInDrawer/u);
});

test("page menu portal is viewport-clamped and uses the existing guide anchors", () => {
  assert.match(menuSource, /Math\.min\(triggerRect\.right - width, viewportWidth - PAGE_MENU_MARGIN - width\)/u);
  assert.match(menuSource, /measuredHeight > availableBelow && availableAbove > availableBelow/u);
  assert.match(menuSource, /menu\?\.key === "dailyPlan"[\s\S]*"daily-plan\.pdf-actions"/u);
  assert.match(menuSource, /menu\?\.key === "scenario"[\s\S]*"scenario\.actions"/u);
  assert.match(globalCss, /\.project-page-actions__menu\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*96;/su);
});

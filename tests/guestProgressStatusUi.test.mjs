import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canUpdateProjectProgressStatus } from "../lib/projectAccess/clientCapability.ts";

const readSource = (pathname) => readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");

test("Guest invite derives only the narrow Progress status capability", () => {
  assert.equal(canUpdateProjectProgressStatus({
    accessMode: "guest",
    role: "progress",
    editorEligible: false
  }), true);
  assert.equal(canUpdateProjectProgressStatus({
    accessMode: "guest",
    role: null,
    editorEligible: false
  }), false);
  assert.equal(canUpdateProjectProgressStatus({
    accessMode: "member",
    role: "progress",
    editorEligible: false
  }), false);
  assert.equal(canUpdateProjectProgressStatus({
    accessMode: "member",
    role: "progress",
    editorEligible: true
  }), true);
  assert.equal(canUpdateProjectProgressStatus({
    accessMode: "member",
    role: "admin",
    editorEligible: true
  }), true);

  const gate = readSource("components/ProjectAccessGate.tsx");
  assert.match(gate, /canUpdateProjectProgressStatus\(\{[\s\S]*accessMode,[\s\S]*role: currentRole,[\s\S]*editorEligible: effectiveEditorEligible/u);
  assert.doesNotMatch(gate, /const canEdit\s*=\s*isGuest|editorEligible:\s*isGuest/u);
});

test("Guest cards hydrate the existing swipe list while reorder and editors stay disabled", () => {
  const page = readSource("app/projects/[id]/page.tsx");
  const list = page.slice(
    page.indexOf("function ProgressShotList"),
    page.indexOf("const ShotEditorModal")
  );

  assert.match(list, /if \(!reorderReadOnly \|\| !statusReadOnly\)/u);
  assert.match(list, /<ShotReorderList[\s\S]*disabled=\{disabled \|\| reorderReadOnly\}[\s\S]*statusReadOnly=\{statusReadOnly\}/u);
  assert.equal((page.match(/reorderReadOnly=\{isGuest\}/gu) ?? []).length, 2);
  assert.match(page, /disabled=\{role !== "admin" \|\| isReordering\}/u);
  assert.match(page, /cardOpenDisabled=\{isGuest\}/u);
  assert.match(page, /onOpen=\{isGuest \? \(\) => undefined : setEditingShot\}/u);
  assert.match(page, /updateShotStatus\(latestShot, status, \{ apiOnly: isGuest \}\)/u);
  assert.match(page, /\[canEditProgressStatus, completeGuide, isGuest, requestGuide\]/u);
  assert.match(page, /\{!isGuest && editingShot \? <ShotEditorModal/u);
  assert.match(page, /\{isGuest \? \([\s\S]*StableDailyPlanGatheringLocationsReadOnly/u);
});

test("Guest-facing copy teaches status interaction without promising edit or reorder", () => {
  const navigation = readSource("components/ProjectNavigation.tsx");
  const accessGate = readSource("components/ProjectAccessGate.tsx");
  const inviteCard = readSource("components/project-invites/ProjectStaffInviteCard.tsx");
  const guides = readSource("lib/contextualGuides.ts");
  const introGuide = guides.slice(
    guides.indexOf('"progress.intro":'),
    guides.indexOf('"progress.status":')
  );
  const statusGuide = guides.slice(
    guides.indexOf('"progress.status":'),
    guides.indexOf('"scene-list.desktop-intro":')
  );

  assert.match(navigation, /진행도 OK·OMIT 가능 · 일촬표\/시나리오 열람/u);
  assert.match(accessGate, /진행도 OK·OMIT만 변경할 수 있고, 일촬표와 시나리오는 읽기 전용/u);
  assert.match(inviteCard, /진행도 OK·OMIT 참여와 일촬표·시나리오 열람/u);
  assert.match(introGuide, /카드 왼쪽 영역은 OMIT, 오른쪽 영역은 OK/u);
  assert.match(introGuide, /오른쪽으로 밀면 OK, 왼쪽으로 밀면 OMIT/u);
  assert.match(statusGuide, /왼쪽 빈 영역을 누르면 OMIT, 오른쪽 빈 영역을 누르면 OK/u);
  assert.match(statusGuide, /오른쪽으로 밀면 OK, 왼쪽으로 밀면 OMIT/u);
  assert.doesNotMatch(statusGuide, /우클릭|편집|길게 누르면 순서|재정렬/u);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERACTION_GUIDES,
  canUseInteractionGuide,
  getInteractionGuideIdsForPage,
  getInteractionGuideInputMode,
  getInteractionGuideStepsForPage,
  getInteractionGuideVariant
} from "../lib/contextualInteractionGuides.ts";
import {
  CONTEXTUAL_GUIDES,
  canUseGuidePermission,
  getGuideIdsForPage
} from "../lib/contextualGuides.ts";

const definitions = Object.values(INTERACTION_GUIDES);

test("interaction registry is manual-only, unique, and outside automatic page guides", () => {
  const ids = definitions.map((definition) => definition.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(definitions.every((definition) => definition.manualOnly === true));

  const automaticIds = new Set([
    "main",
    "home",
    "basicInfo",
    "dailyPlan",
    "progress",
    "sceneList",
    "staff",
    "scenario",
    "wardrobe",
    "archive"
  ].flatMap((page) => getGuideIdsForPage(page)));
  assert.ok(ids.every((id) => !automaticIds.has(id)));
});

test("pages without audited hidden interactions expose no manual tour", () => {
  assert.deepEqual(getInteractionGuideIdsForPage("basicInfo"), []);
  assert.deepEqual(getInteractionGuideIdsForPage("scenario"), []);
  assert.deepEqual(getInteractionGuideIdsForPage("wardrobe"), []);
  assert.deepEqual(getInteractionGuideIdsForPage(null), []);
});

test("Main interaction tour does not duplicate New, Join, or canonical Go", () => {
  const ids = getInteractionGuideIdsForPage("main");
  assert.deepEqual(ids, ["main.interaction-remembered-project"]);
  assert.ok(ids.every((id) => !id.includes("intro") && !id.endsWith("-go")));
});

test("fine/coarse capability chooses only real variants", () => {
  assert.equal(getInteractionGuideInputMode(true), "fine");
  assert.equal(getInteractionGuideInputMode(false), "coarse");

  const sceneDelete = INTERACTION_GUIDES["scene-list.interaction-scene-delete"];
  assert.equal(getInteractionGuideVariant(sceneDelete, "fine")?.demo, "right-click");
  assert.equal(getInteractionGuideVariant(sceneDelete, "coarse"), null);

  const archiveInfo = INTERACTION_GUIDES["archive.interaction-asset-info"];
  assert.equal(getInteractionGuideVariant(archiveInfo, "fine")?.demo, "right-click");
  assert.equal(getInteractionGuideVariant(archiveInfo, "coarse"), null);

  const progressMedia = INTERACTION_GUIDES["progress.interaction-media-gallery"];
  assert.equal(getInteractionGuideVariant(progressMedia, "fine")?.demo, "tap");
  assert.equal(getInteractionGuideVariant(progressMedia, "coarse")?.demo, "swipe");
  assert.equal(progressMedia.anchor, "progress.media-gallery");
});

test("daily-plan wording stays within the audited feature semantics", () => {
  const rowActions = getInteractionGuideVariant(
    INTERACTION_GUIDES["daily-plan.interaction-row-actions"],
    "fine"
  );
  const actorMove = getInteractionGuideVariant(
    INTERACTION_GUIDES["daily-plan.interaction-actor-reorder-trash"],
    "coarse"
  );
  assert.match(rowActions?.description ?? "", /분할 촬영/u);
  assert.doesNotMatch(rowActions?.description ?? "", /다회차 촬영/u);
  assert.doesNotMatch(rowActions?.description ?? "", /행 관리/u);
  assert.match(actorMove?.description ?? "", /배우 카드/u);
  assert.doesNotMatch(actorMove?.description ?? "", /부서|팀 카드/u);
});

test("daily-plan round actions keep the real card anchor and expose a compact shell target", () => {
  const roundActions = INTERACTION_GUIDES["daily-plan.interaction-round-actions"];
  assert.equal(roundActions.anchor, "daily-plan.round-card");
  assert.equal(roundActions.compactAnchor, "shell.navigation-toggle");
  assert.match(getInteractionGuideVariant(roundActions, "fine")?.description ?? "", /프로젝트 메뉴/u);
  assert.match(getInteractionGuideVariant(roundActions, "coarse")?.description ?? "", /프로젝트 메뉴/u);
});

test("interaction steps use feature-specific availability anchors", () => {
  assert.equal(
    INTERACTION_GUIDES["daily-plan.interaction-row-reorder"].anchor,
    "daily-plan.timetable-reorder-row"
  );
  assert.equal(
    INTERACTION_GUIDES["scene-list.interaction-merge-range"].anchor,
    "scene-list.merge-range-cell"
  );
  assert.equal(
    INTERACTION_GUIDES["scene-list.interaction-scene-reorder"].anchor,
    "scene-list.scene-reorder"
  );
  assert.equal(
    INTERACTION_GUIDES["staff.interaction-member-reorder"].anchor,
    "staff.member-reorder-row"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-shift-range"].anchor,
    "archive.asset-multi-select"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-additive-selection"].anchor,
    "archive.asset-multi-select"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-asset-reorder"].anchor,
    "archive.asset-reorder"
  );

  // Sibling actions keep their generic representative targets.
  assert.equal(INTERACTION_GUIDES["daily-plan.interaction-row-actions"].anchor, "daily-plan.timetable-row");
  assert.equal(INTERACTION_GUIDES["scene-list.interaction-merge-menu"].anchor, "scene-list.merge-cell");
  assert.equal(INTERACTION_GUIDES["scene-list.interaction-scene-delete"].anchor, "scene-list.scene-number");
  assert.equal(INTERACTION_GUIDES["staff.interaction-member-delete"].anchor, "staff.member-row");
  assert.equal(INTERACTION_GUIDES["archive.interaction-asset-info"].anchor, "archive.asset");
  assert.equal(INTERACTION_GUIDES["archive.interaction-touch-selection"].anchor, "archive.asset");
  assert.equal(INTERACTION_GUIDES["archive.interaction-asset-delete"].anchor, "archive.asset");
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-person-add"].anchor,
    "archive.diagram-person-tool"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-person-move"].anchor,
    "archive.diagram-canvas"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-camera-move"].anchor,
    "archive.diagram-canvas"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-rotate"].anchor,
    "archive.diagram-canvas"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-room"].anchor,
    "archive.diagram-room-tool"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-path"].anchor,
    "archive.diagram-path-tool"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-undo"].anchor,
    "archive.diagram-history"
  );
});

test("diagram first-use and manual tour share the exact visible editor anchor contract", () => {
  const firstUse = CONTEXTUAL_GUIDES["archive.diagram-editor-first-use"];
  assert.equal(firstUse.type, "anchor");
  assert.equal(firstUse.persistentAnchor, "archive.diagram-canvas");
  assert.equal(firstUse.compactAnchor, "archive.diagram-canvas");
  assert.equal(firstUse.permission, "manage");

  const diagramIds = getInteractionGuideIdsForPage("archive")
    .filter((id) => id.includes("interaction-diagram-"));
  assert.equal(diagramIds.length, 7);
  assert.ok(diagramIds.every((id) => INTERACTION_GUIDES[id].permission === "manage"));
  assert.ok(diagramIds.every((id) => (
    INTERACTION_GUIDES[id].compactAnchor ?? INTERACTION_GUIDES[id].anchor
  ) === "archive.diagram-canvas"));

  // Desktop keeps the precise visible tool/handle anchors while compact mode
  // uses the always-visible canvas instead of an off-screen toolbar item.
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-person-add"].anchor,
    "archive.diagram-person-tool"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-room"].anchor,
    "archive.diagram-room-tool"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-path"].anchor,
    "archive.diagram-path-tool"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-undo"].anchor,
    "archive.diagram-history"
  );
});

test("diagram movement help matches the one-click destination workflow", () => {
  const movement = INTERACTION_GUIDES["archive.interaction-diagram-path"];
  const fine = getInteractionGuideVariant(movement, "fine");
  const coarse = getInteractionGuideVariant(movement, "coarse");

  assert.equal(fine?.demo, "tap");
  assert.equal(coarse?.demo, "tap");
  assert.match(fine?.description ?? "", /도착점을 클릭/u);
  assert.match(coarse?.description ?? "", /도착점을 탭/u);
  assert.doesNotMatch(fine?.description ?? "", /끌|드래그|그립니다/u);
  assert.doesNotMatch(coarse?.description ?? "", /끌|드래그|그립니다/u);
});

test("permission filtering uses the canonical exact key-staff rule", () => {
  assert.equal(canUseGuidePermission("manage", "admin"), true);
  assert.equal(canUseGuidePermission("manage", "progress"), false);
  assert.equal(canUseGuidePermission("manage", null), false);

  const staffReorder = INTERACTION_GUIDES["staff.interaction-member-reorder"];
  assert.equal(canUseInteractionGuide(staffReorder, "admin"), true);
  assert.equal(canUseInteractionGuide(staffReorder, "progress"), false);
  assert.equal(canUseInteractionGuide(staffReorder, null), false);

  assert.equal(getInteractionGuideStepsForPage("dailyPlan", {
    inputMode: "fine",
    role: "progress"
  }).length, 0);
  assert.equal(getInteractionGuideStepsForPage("dailyPlan", {
    inputMode: "fine",
    role: "admin"
  }).length, 5);
  assert.equal(getInteractionGuideStepsForPage("progress", {
    inputMode: "fine",
    role: "progress"
  }).length, 1);
  assert.equal(getInteractionGuideStepsForPage("progress", {
    inputMode: "fine",
    role: "admin"
  }).length, 2);
});

test("platform-specific page tours omit unsupported shortcuts", () => {
  const sceneFine = getInteractionGuideStepsForPage("sceneList", {
    inputMode: "fine",
    role: "admin"
  });
  const sceneCoarse = getInteractionGuideStepsForPage("sceneList", {
    inputMode: "coarse",
    role: "admin"
  });
  assert.equal(sceneFine.length, 5);
  assert.equal(sceneCoarse.length, 4);
  assert.ok(sceneCoarse.every((guide) => guide.variant.demo !== "right-click"));

  const archiveFine = getInteractionGuideStepsForPage("archive", {
    inputMode: "fine",
    role: "admin"
  });
  const archiveCoarse = getInteractionGuideStepsForPage("archive", {
    inputMode: "coarse",
    role: "admin"
  });
  assert.equal(archiveFine.length, 12);
  assert.equal(archiveCoarse.length, 10);
  assert.ok(archiveCoarse.every((guide) => !["shift-range", "modifier-toggle", "right-click"]
    .includes(guide.variant.demo)));
});

test("gesture variants retain the audited long-press thresholds and safe delete wording", () => {
  const duration = (id, mode) => getInteractionGuideVariant(INTERACTION_GUIDES[id], mode)?.durationMs;
  assert.equal(duration("main.interaction-remembered-project", "coarse"), 600);
  assert.equal(duration("home.interaction-calendar-create", "fine"), 500);
  assert.equal(duration("daily-plan.interaction-round-actions", "coarse"), 600);
  assert.equal(duration("daily-plan.interaction-row-actions", "coarse"), 575);
  assert.equal(duration("staff.interaction-member-reorder", "fine"), 575);
  assert.equal(duration("scene-list.interaction-merge-range", "coarse"), 520);
  assert.equal(duration("scene-list.interaction-scene-reorder", "coarse"), 480);
  assert.equal(duration("scene-list.interaction-actor-note", "coarse"), 540);
  assert.equal(duration("archive.interaction-touch-selection", "coarse"), 550);
  assert.equal(duration("archive.interaction-diagram-person-move", "fine"), 200);
  assert.equal(duration("archive.interaction-diagram-person-move", "coarse"), 350);
  assert.equal(duration("archive.interaction-diagram-camera-move", "fine"), 200);
  assert.equal(duration("archive.interaction-diagram-camera-move", "coarse"), 350);

  const archiveDelete = getInteractionGuideVariant(
    INTERACTION_GUIDES["archive.interaction-asset-delete"],
    "coarse"
  );
  const staffDelete = getInteractionGuideVariant(
    INTERACTION_GUIDES["staff.interaction-member-delete"],
    "fine"
  );
  assert.match(archiveDelete?.description ?? "", /삭제 확인/u);
  assert.match(staffDelete?.description ?? "", /삭제 확인/u);
  assert.doesNotMatch(archiveDelete?.description ?? "", /바로 삭제|즉시 삭제/u);
});

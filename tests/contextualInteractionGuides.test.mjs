import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const interactionDemoSource = readFileSync(
  new URL("../components/guides/InteractionDemo.tsx", import.meta.url),
  "utf8"
);
const globalCssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

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
  assert.equal(getInteractionGuideVariant(archiveInfo, "fine")?.demo, "context-scene-cut");
  assert.equal(getInteractionGuideVariant(archiveInfo, "coarse")?.demo, "context-scene-cut");
  assert.equal(getInteractionGuideVariant(archiveInfo, "coarse")?.durationMs, 550);

  const progressMedia = INTERACTION_GUIDES["progress.interaction-media-gallery"];
  assert.equal(getInteractionGuideVariant(progressMedia, "fine")?.demo, "tap");
  assert.equal(getInteractionGuideVariant(progressMedia, "coarse")?.demo, "swipe");
  assert.equal(progressMedia.anchor, "progress.media-gallery");

  const gatheringPhoto = INTERACTION_GUIDES["progress.interaction-gathering-photo"];
  assert.equal(gatheringPhoto.anchor, "progress.gathering-photo-context");
  assert.equal(gatheringPhoto.compactAnchor, undefined);
  assert.equal(gatheringPhoto.standaloneContextAnchors, undefined);
  assert.equal(gatheringPhoto.permission, "manage");
  assert.equal(getInteractionGuideVariant(gatheringPhoto, "fine"), null);
  assert.equal(
    getInteractionGuideVariant(gatheringPhoto, "coarse")?.description,
    "빈 사진 영역을 누르면 촬영하거나 앨범에서 사진을 고를 수 있습니다. 기존 사진을 길게 누르면 사진을 변경하거나 삭제하고, 주소를 누르면 복사할 수 있습니다."
  );
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
    INTERACTION_GUIDES["archive.interaction-asset-reorder"].anchor,
    "archive.asset-reorder"
  );

  // Sibling actions keep their generic representative targets.
  assert.equal(INTERACTION_GUIDES["daily-plan.interaction-row-actions"].anchor, "daily-plan.timetable-row");
  assert.equal(INTERACTION_GUIDES["scene-list.interaction-merge-menu"].anchor, "scene-list.merge-cell");
  assert.equal(INTERACTION_GUIDES["scene-list.interaction-scene-delete"].anchor, "scene-list.scene-number");
  assert.equal(INTERACTION_GUIDES["staff.interaction-member-delete"].anchor, "staff.member-row");
  assert.equal(INTERACTION_GUIDES["archive.interaction-asset-info"].anchor, "archive.asset");
  assert.equal(INTERACTION_GUIDES["archive.interaction-upload"].anchor, "archive.upload");
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-filename-classification"].anchor,
    "archive.upload"
  );
  assert.equal(INTERACTION_GUIDES["archive.interaction-crop-ratio"].anchor, "archive.crop-ratio");
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-crop-scene-cut"].anchor,
    "archive.crop-scene-cut"
  );
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
    "archive.diagram-canvas"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-object-menu"].anchor,
    "archive.diagram-canvas"
  );
  assert.equal(
    INTERACTION_GUIDES["archive.interaction-diagram-curve"].anchor,
    "archive.diagram-canvas"
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
  assert.equal(firstUse.version, 3);
  assert.match(firstUse.description, /오브젝트를 끌어 위치를 이동/u);
  assert.match(firstUse.description, /우클릭.*터치 화면에서는 길게 눌러.*이름·색상.*동작을 편집/u);
  assert.match(firstUse.compactDescription ?? "", /길게 눌러 편집 메뉴/u);
  assert.match(firstUse.description, /모서리나 컨트롤 포인트.*형태와 방향/u);
  assert.match(firstUse.compactDescription ?? "", /모서리나 컨트롤 포인트.*형태와 방향/u);
  assert.doesNotMatch(
    `${firstUse.description} ${firstUse.compactDescription ?? ""}`,
    /잠시 누른 뒤 끌면.*무빙/u
  );

  const diagramIds = getInteractionGuideIdsForPage("archive")
    .filter((id) => id.includes("interaction-diagram-"));
  assert.deepEqual(diagramIds, [
    "archive.interaction-diagram-person-add",
    "archive.interaction-diagram-person-move",
    "archive.interaction-diagram-object-menu",
    "archive.interaction-diagram-camera-move",
    "archive.interaction-diagram-rotate",
    "archive.interaction-diagram-room",
    "archive.interaction-diagram-path",
    "archive.interaction-diagram-curve",
    "archive.interaction-diagram-undo"
  ]);
  assert.ok(diagramIds.every((id) => INTERACTION_GUIDES[id].manualOnly === true));
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
    INTERACTION_GUIDES["archive.interaction-diagram-undo"].anchor,
    "archive.diagram-history"
  );
});

test("diagram movement help uses the object menu and destination drag workflow", () => {
  const movement = INTERACTION_GUIDES["archive.interaction-diagram-path"];
  const fine = getInteractionGuideVariant(movement, "fine");
  const coarse = getInteractionGuideVariant(movement, "coarse");

  assert.equal(fine?.demo, "movement-create");
  assert.equal(coarse?.demo, "movement-create");
  assert.match(fine?.description ?? "", /우클릭.*무빙 만들기.*목적지까지 끌/u);
  assert.match(coarse?.description ?? "", /길게 눌러.*무빙 만들기.*목적지까지 끌/u);
  assert.match(fine?.detail ?? "", /원본 오브젝트 위치는 그대로/u);
});

test("diagram object help keeps direct drag separate from context-menu movement", () => {
  const move = INTERACTION_GUIDES["archive.interaction-diagram-person-move"];
  const menu = INTERACTION_GUIDES["archive.interaction-diagram-object-menu"];
  const moveFine = getInteractionGuideVariant(move, "fine");
  const moveCoarse = getInteractionGuideVariant(move, "coarse");
  const menuFine = getInteractionGuideVariant(menu, "fine");
  const menuCoarse = getInteractionGuideVariant(menu, "coarse");

  assert.equal(moveFine?.demo, "object-drag");
  assert.equal(moveCoarse?.demo, "object-drag");
  assert.match(moveFine?.description ?? "", /카메라와 인물은 아이콘의 어느 부분을 끌어도 위치를 옮길 수 있습니다\..*공간은 벽 선을 끌어.*이동/u);
  assert.match(moveCoarse?.detail ?? "", /공간 안쪽은 이동 대상이 아니므로.*인물과 카메라를 바로 선택/u);
  assert.match(moveFine?.detail ?? "", /무빙 경로를 만들지 않습니다/u);
  assert.doesNotMatch(`${moveFine?.description ?? ""} ${moveCoarse?.description ?? ""}`, /0\.3초|0\.38초|길게.*무빙/u);

  assert.equal(menuFine?.demo, "object-context-menu");
  assert.equal(menuCoarse?.demo, "object-context-menu");
  assert.match(menuFine?.description ?? "", /우클릭.*이름·색상.*동작을 편집/u);
  assert.match(menuCoarse?.description ?? "", /길게 누르면 편집 메뉴.*이름·색상.*동작을 편집/u);
  assert.match(menuCoarse?.detail ?? "", /무빙 경로를 바로 만들지 않습니다/u);
});

test("diagram help describes direct manipulation without a bottom inspector dependency", () => {
  const firstUse = CONTEXTUAL_GUIDES["archive.diagram-editor-first-use"];
  const diagramGuides = getInteractionGuideIdsForPage("archive")
    .filter((id) => id.includes("interaction-diagram-"))
    .map((id) => INTERACTION_GUIDES[id]);
  const guideCopy = [
    firstUse.description,
    firstUse.compactDescription,
    ...diagramGuides.flatMap((guide) => [
      guide.variants.fine.description,
      guide.variants.fine.detail,
      guide.variants.coarse.description,
      guide.variants.coarse.detail
    ])
  ].filter(Boolean).join(" ");

  assert.doesNotMatch(
    guideCopy,
    /하단.*(?:라벨|색상|속성|편집)|아래쪽.*(?:라벨|색상|속성|편집)|인스펙터|inspector/iu
  );

  const rotate = INTERACTION_GUIDES["archive.interaction-diagram-rotate"];
  const move = INTERACTION_GUIDES["archive.interaction-diagram-person-move"];
  const room = INTERACTION_GUIDES["archive.interaction-diagram-room"];
  const curve = INTERACTION_GUIDES["archive.interaction-diagram-curve"];
  assert.match(
    getInteractionGuideVariant(move, "fine")?.description ?? "",
    /카메라와 인물은 아이콘의 어느 부분을 끌어도 위치를 옮길 수 있습니다\./u
  );
  assert.match(
    getInteractionGuideVariant(move, "coarse")?.description ?? "",
    /카메라와 인물은 아이콘의 어느 부분을 끌어도 위치를 옮길 수 있습니다\./u
  );
  assert.match(getInteractionGuideVariant(rotate, "fine")?.description ?? "", /인물.*컨트롤 포인트.*카메라.*화각 선.*방향/u);
  assert.match(
    getInteractionGuideVariant(rotate, "fine")?.detail ?? "",
    /카메라 몸체는 위치 이동, 화각 선은 방향 조절에 사용합니다\./u
  );
  assert.match(getInteractionGuideVariant(room, "coarse")?.detail ?? "", /모서리 컨트롤 포인트.*형태/u);
  assert.match(
    getInteractionGuideVariant(room, "fine")?.detail ?? "",
    /같은 공간을 반복해서 그릴 필요가 없습니다\. 씬리스트의 소장소를 기준으로 공간을 프리셋으로 저장하면 같은 장소의 새 부감도에 공간이 자동 적용됩니다\./u
  );
  assert.match(getInteractionGuideVariant(curve, "fine")?.description ?? "", /컨트롤 포인트.*경로 형태/u);
});

test("diagram manual help matches FOV, open-wall, room-hit, and ghost-direction workflows", () => {
  const cameraMove = INTERACTION_GUIDES["archive.interaction-diagram-camera-move"];
  const rotate = INTERACTION_GUIDES["archive.interaction-diagram-rotate"];
  const room = INTERACTION_GUIDES["archive.interaction-diagram-room"];
  const movement = INTERACTION_GUIDES["archive.interaction-diagram-path"];
  const curve = INTERACTION_GUIDES["archive.interaction-diagram-curve"];
  const cameraMoveFine = getInteractionGuideVariant(cameraMove, "fine");
  const rotateFine = getInteractionGuideVariant(rotate, "fine");
  const rotateCoarse = getInteractionGuideVariant(rotate, "coarse");
  const roomFine = getInteractionGuideVariant(room, "fine");
  const roomCoarse = getInteractionGuideVariant(room, "coarse");
  const movementFine = getInteractionGuideVariant(movement, "fine");
  const curveCoarse = getInteractionGuideVariant(curve, "coarse");

  assert.match(rotateFine?.description ?? "", /카메라는 두 화각 선 중 어느 부분이든 끌어.*방향/u);
  assert.match(rotateCoarse?.description ?? "", /카메라는 두 화각 선 중 어느 부분이든 손가락으로 끌어.*방향/u);
  assert.match(rotateFine?.detail ?? "", /카메라 본체.*위치만 이동.*화각 선.*방향만/u);

  assert.match(roomFine?.description ?? "", /시작점에 연결하면 닫힌 공간.*우클릭하면 열린 벽.*완성/u);
  assert.doesNotMatch(roomCoarse?.description ?? "", /우클릭/u);
  assert.match(roomCoarse?.description ?? "", /열린 벽 완료를 누르면.*그 형태 그대로 완성/u);
  assert.match(roomFine?.detail ?? "", /공간은 벽 선을 끌어.*이동.*모서리 컨트롤 포인트.*형태/u);
  assert.match(roomCoarse?.detail ?? "", /투명한 안쪽.*인물과 카메라 선택을 방해하지 않습니다/u);

  assert.match(cameraMoveFine?.detail ?? "", /고스트 카메라는 원래 카메라 방향을 유지/u);
  assert.match(cameraMoveFine?.detail ?? "", /고스트를 선택.*화각 선.*경로나 원본 카메라와 별개로 최종 방향/u);
  assert.match(movementFine?.detail ?? "", /카메라 고스트의 방향은 이동 경로와 별도로 편집/u);
  assert.match(curveCoarse?.detail ?? "", /끝점.*고스트 위치만.*최종 방향은 경로와 별도로 유지/u);
});

test("diagram demos cover menu, movement, curve, and pan with reduced-motion results", () => {
  for (const demo of ["object-drag", "object-context-menu", "movement-create", "movement-curve", "camera-pan"]) {
    assert.match(interactionDemoSource, new RegExp(`case "${demo}"`, "u"));
  }
  assert.doesNotMatch(interactionDemoSource, /case "actor-movement"/u);
  assert.match(interactionDemoSource, /interaction-demo__movement-route-line/u);
  assert.match(interactionDemoSource, /interaction-demo__curve-control/u);
  assert.match(interactionDemoSource, /interaction-demo__camera-pan-line/u);

  const reducedMotionCss = globalCssSource.slice(
    globalCssSource.lastIndexOf("@media (prefers-reduced-motion: reduce)")
  );
  assert.match(reducedMotionCss, /data-type="object-drag"[^}]*diagram-object--source/u);
  assert.match(reducedMotionCss, /data-type="object-context-menu"[^}]*object-menu/u);
  assert.match(reducedMotionCss, /data-type="movement-create"[^}]*movement-route/u);
  assert.match(reducedMotionCss, /movement-route-line[^}]*stroke-dashoffset:\s*0/u);
  assert.match(reducedMotionCss, /data-type="movement-curve"[^}]*curve-control/u);
  assert.match(reducedMotionCss, /data-type="camera-pan"[^}]*camera-pan-line/u);
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
  assert.equal(getInteractionGuideStepsForPage("progress", {
    inputMode: "coarse",
    role: "progress"
  }).length, 1);
  assert.equal(getInteractionGuideStepsForPage("progress", {
    inputMode: "coarse",
    role: "admin"
  }).length, 3);
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
  const workflowFine = archiveFine.filter((guide) => !guide.id.includes("interaction-diagram-"));
  const workflowCoarse = archiveCoarse.filter((guide) => !guide.id.includes("interaction-diagram-"));
  assert.equal(workflowFine.length, 8);
  assert.equal(workflowCoarse.length, 8);
  assert.ok(archiveCoarse.every((guide) => !["shift-range", "right-click"]
    .includes(guide.variant.demo)));
  assert.ok(workflowCoarse.every((guide) => !guide.variant.description.includes("우클릭")));
});

test("Archive workflow keeps eight audited steps in platform-specific order", () => {
  const workflowIds = (inputMode) => getInteractionGuideStepsForPage("archive", {
    inputMode,
    role: "admin"
  }).filter((guide) => !guide.id.includes("interaction-diagram-")).map((guide) => guide.id);

  assert.deepEqual(workflowIds("fine"), [
    "archive.interaction-upload",
    "archive.interaction-filename-classification",
    "archive.interaction-asset-info",
    "archive.interaction-crop-ratio",
    "archive.interaction-crop-scene-cut",
    "archive.interaction-shift-range",
    "archive.interaction-asset-reorder",
    "archive.interaction-asset-delete"
  ]);
  assert.deepEqual(workflowIds("coarse"), [
    "archive.interaction-upload",
    "archive.interaction-filename-classification",
    "archive.interaction-asset-info",
    "archive.interaction-crop-ratio",
    "archive.interaction-crop-scene-cut",
    "archive.interaction-touch-selection",
    "archive.interaction-asset-reorder",
    "archive.interaction-asset-delete"
  ]);
  assert.ok(workflowIds("fine").every((id) => INTERACTION_GUIDES[id].permission === "manage"));
  assert.ok(workflowIds("coarse").every((id) => INTERACTION_GUIDES[id].permission === "manage"));
  assert.equal(getInteractionGuideStepsForPage("archive", {
    inputMode: "fine",
    role: "progress"
  }).length, 0);
  assert.equal(getInteractionGuideStepsForPage("archive", {
    inputMode: "coarse",
    role: null
  }).length, 0);
  assert.equal(Object.hasOwn(INTERACTION_GUIDES, "archive.interaction-additive-selection"), false);
});

test("Archive standalone crop steps stay scoped to the visible import workflow", () => {
  const ratio = INTERACTION_GUIDES["archive.interaction-crop-ratio"];
  const sceneCut = INTERACTION_GUIDES["archive.interaction-crop-scene-cut"];

  assert.deepEqual(ratio.standaloneContextAnchors, ["archive.upload"]);
  assert.deepEqual(sceneCut.standaloneContextAnchors, ["archive.upload", "archive.crop-ratio"]);
  assert.equal(ratio.anchor, "archive.crop-ratio");
  assert.equal(sceneCut.anchor, "archive.crop-scene-cut");

  for (const definition of [ratio, sceneCut]) {
    assert.equal(getInteractionGuideVariant(definition, "fine")?.demo, definition === ratio
      ? "crop-ratio"
      : "crop-scene-cut");
    assert.equal(getInteractionGuideVariant(definition, "coarse")?.demo, definition === ratio
      ? "crop-ratio"
      : "crop-scene-cut");
  }
});

test("Archive help text matches filename, edit, crop, selection, and delete behavior", () => {
  const filename = getInteractionGuideVariant(
    INTERACTION_GUIDES["archive.interaction-filename-classification"],
    "fine"
  );
  assert.equal(filename?.demo, "filename-archive");
  assert.equal(filename?.title, "파일명 자동 분류");
  assert.match(filename?.description ?? "", /S12C3\.jpg.*S12\/C3/u);
  assert.match(filename?.detail ?? "", /Scene12Cut3|씬12컷3/u);
  assert.match(filename?.detail ?? "", /씬리스트.*유효한 컷/u);
  assert.match(filename?.detail ?? "", /미분류.*정보 수정/u);

  const infoFine = getInteractionGuideVariant(
    INTERACTION_GUIDES["archive.interaction-asset-info"],
    "fine"
  );
  const infoCoarse = getInteractionGuideVariant(
    INTERACTION_GUIDES["archive.interaction-asset-info"],
    "coarse"
  );
  assert.equal(infoFine?.title, "씬 · 컷 지정");
  assert.equal(infoCoarse?.title, "씬 · 컷 지정");
  assert.match(infoFine?.description ?? "", /우클릭.*정보 수정 창.*씬과 컷/u);
  assert.doesNotMatch(infoFine?.description ?? "", /메뉴/u);
  assert.match(infoCoarse?.description ?? "", /길게.*선택 모드.*한 장.*정보 수정/u);

  const cropRatio = getInteractionGuideVariant(
    INTERACTION_GUIDES["archive.interaction-crop-ratio"],
    "fine"
  );
  const cropSceneCut = getInteractionGuideVariant(
    INTERACTION_GUIDES["archive.interaction-crop-scene-cut"],
    "fine"
  );
  assert.equal(cropRatio?.title, "콘티 비율 맞추기");
  assert.equal(cropSceneCut?.title, "씬 · 컷 입력");
  assert.match(cropRatio?.description ?? "", /첫 그림칸.*직접 드래그.*기준 비율/u);
  assert.match(cropRatio?.detail ?? "", /자동 판독.*아니/u);
  assert.match(cropSceneCut?.description ?? "", /왼쪽 위 씬.*오른쪽 위 컷.*추출 확정/u);
  assert.match(cropSceneCut?.detail ?? "", /화살표.*원본.*페이지/u);

  const fineSelection = getInteractionGuideVariant(
    INTERACTION_GUIDES["archive.interaction-shift-range"],
    "fine"
  );
  assert.match(fineSelection?.description ?? "", /Shift\+클릭.*⌘\+클릭.*Ctrl\+클릭/u);
  assert.equal(fineSelection?.modifierLabel, "Shift · ⌘ / Ctrl");

  const archiveDelete = getInteractionGuideVariant(
    INTERACTION_GUIDES["archive.interaction-asset-delete"],
    "coarse"
  );
  assert.match(archiveDelete?.description ?? "", /삭제 확인/u);
  assert.doesNotMatch(archiveDelete?.description ?? "", /바로 삭제|즉시 삭제/u);
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
  assert.equal(duration("archive.interaction-diagram-person-move", "fine"), undefined);
  assert.equal(duration("archive.interaction-diagram-person-move", "coarse"), undefined);
  assert.equal(duration("archive.interaction-diagram-object-menu", "coarse"), 520);
  assert.equal(duration("archive.interaction-diagram-camera-move", "fine"), undefined);
  assert.equal(duration("archive.interaction-diagram-camera-move", "coarse"), 520);
  assert.equal(duration("archive.interaction-diagram-curve", "coarse"), 520);
  const cameraFine = getInteractionGuideVariant(
    INTERACTION_GUIDES["archive.interaction-diagram-camera-move"],
    "fine"
  );
  assert.match(cameraFine?.description ?? "", /무빙.*패닝.*각각 설정/u);
  assert.match(cameraFine?.detail ?? "", /두 열린 선.*현재 화각/u);

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

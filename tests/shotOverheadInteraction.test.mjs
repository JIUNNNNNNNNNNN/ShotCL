import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECT_DRAG_COARSE_TOLERANCE_PX,
  DIRECT_DRAG_FINE_TOLERANCE_PX,
  MOVEMENT_CREATION_MIN_DISTANCE_PX,
  SHOT_OVERHEAD_COARSE_HANDLE_HIT_DIAMETER_PX,
  SHOT_OVERHEAD_COARSE_PATH_HIT_WIDTH_PX,
  SHOT_OVERHEAD_COARSE_VISIBLE_HANDLE_DIAMETER_PX,
  SHOT_OVERHEAD_FINE_HANDLE_HIT_DIAMETER_PX,
  SHOT_OVERHEAD_FINE_PATH_HIT_WIDTH_PX,
  SHOT_OVERHEAD_FINE_VISIBLE_HANDLE_DIAMETER_PX,
  TOUCH_CONTEXT_MENU_HOLD_MS,
  applyShotOverheadPointGrab,
  applyShotOverheadPointTarget,
  applyShotOverheadRotation,
  clientPointToShotOverheadWorld,
  createShotOverheadPointGrab,
  createMovementPath,
  getMovementEndPoint,
  getShotOverheadInteractionTargetMetrics,
  hasMinimumMovementDraft,
  resolveNearestShotOverheadHandle,
  screenDeltaToShotOverheadWorld,
  shotOverheadWorldPointToClient,
  shouldBeginDirectDrag
} from "../lib/shotOverheadInteraction.ts";
import { createEmptyShotOverheadDiagram } from "../lib/shotOverhead.ts";
import {
  createShotOverheadHistory,
  pushShotOverheadHistory,
  replaceShotOverheadHistoryCurrent,
  redoShotOverheadHistory,
  undoShotOverheadHistory
} from "../lib/shotOverheadHistory.ts";

test("direct drag uses distance thresholds without a movement hold duration", () => {
  assert.equal(DIRECT_DRAG_FINE_TOLERANCE_PX, 6);
  assert.equal(DIRECT_DRAG_COARSE_TOLERANCE_PX, 8);
  assert.equal(TOUCH_CONTEXT_MENU_HOLD_MS, 520);
  assert.equal(shouldBeginDirectDrag({ x: 10, y: 10 }, { x: 15, y: 10 }, "mouse"), false);
  assert.equal(shouldBeginDirectDrag({ x: 10, y: 10 }, { x: 16, y: 10 }, "mouse"), true);
  assert.equal(shouldBeginDirectDrag({ x: 10, y: 10 }, { x: 17, y: 10 }, "touch"), false);
  assert.equal(shouldBeginDirectDrag({ x: 10, y: 10 }, { x: 18, y: 10 }, "touch"), true);
});

test("movement creation uses pointer delta instead of the pressed hit-area offset", () => {
  assert.deepEqual(
    getMovementEndPoint(
      { x: 100, y: 100 },
      { x: 118, y: 91 },
      { x: 318, y: 191 },
      { width: 960, height: 640 }
    ),
    { x: 300, y: 200 }
  );
});

test("movement creation keeps a visual minimum and a stable owner reference", () => {
  assert.equal(MOVEMENT_CREATION_MIN_DISTANCE_PX, 12);
  assert.equal(hasMinimumMovementDraft({ x: 10, y: 10 }, { x: 21, y: 10 }, 1), false);
  assert.equal(hasMinimumMovementDraft({ x: 10, y: 10 }, { x: 22, y: 10 }, 1), true);
  assert.deepEqual(
    createMovementPath("movement-1", "camera", "camera-1", { x: 40, y: 50 }, { x: 260, y: 300 }),
    {
      id: "movement-1",
      sourceType: "camera",
      sourceId: "camera-1",
      points: [{ x: 40, y: 50 }, { x: 260, y: 300 }]
    }
  );
});

test("client-to-world fallback stays exact at zoom-out, default, and zoom-in scales", () => {
  const canvas = { width: 960, height: 640 };
  for (const rect of [
    { left: 0, top: 0, width: 480, height: 320 },
    { left: 0, top: 0, width: 960, height: 640 },
    { left: 0, top: 0, width: 1920, height: 1280 }
  ]) {
    assert.deepEqual(
      clientPointToShotOverheadWorld(
        { x: rect.width / 2, y: rect.height / 2 },
        { rect, canvas }
      ),
      { x: 480, y: 320 }
    );
  }
});

test("client-to-world fallback accounts for xMidYMid letterbox, board offset, and pan", () => {
  const transform = {
    rect: { left: 100, top: 50, width: 1200, height: 500 },
    canvas: { width: 960, height: 640 },
    pan: { x: 50, y: -20 }
  };
  assert.deepEqual(
    clientPointToShotOverheadWorld({ x: 520.3125, y: 268.75 }, transform),
    { x: 200, y: 300 }
  );
  assert.deepEqual(
    screenDeltaToShotOverheadWorld({ x: 78.125, y: -39.0625 }, transform),
    { x: 100, y: -50 }
  );
  assert.deepEqual(
    clientPointToShotOverheadWorld({ x: 0, y: 0 }, transform, true),
    { x: 0, y: 0 }
  );
  assert.deepEqual(
    shotOverheadWorldPointToClient({ x: 200, y: 300 }, transform),
    { x: 520.3125, y: 268.75 }
  );
});

test("point grabs preserve the pressed offset and optionally clamp to the board", () => {
  const grab = createShotOverheadPointGrab(
    { x: 100, y: 100 },
    { x: 112, y: 91 }
  );
  assert.deepEqual(
    applyShotOverheadPointGrab(grab, { x: 212, y: 141 }),
    { x: 200, y: 150 }
  );
  assert.deepEqual(
    applyShotOverheadPointGrab(grab, { x: -200, y: 900 }, { width: 960, height: 640 }),
    { x: 0, y: 640 }
  );
});

test("fine and coarse targets keep small visuals with larger interaction areas", () => {
  assert.deepEqual(getShotOverheadInteractionTargetMetrics("mouse"), {
    visibleHandleDiameterPx: SHOT_OVERHEAD_FINE_VISIBLE_HANDLE_DIAMETER_PX,
    handleHitDiameterPx: SHOT_OVERHEAD_FINE_HANDLE_HIT_DIAMETER_PX,
    pathHitWidthPx: SHOT_OVERHEAD_FINE_PATH_HIT_WIDTH_PX
  });
  assert.deepEqual(getShotOverheadInteractionTargetMetrics("touch"), {
    visibleHandleDiameterPx: SHOT_OVERHEAD_COARSE_VISIBLE_HANDLE_DIAMETER_PX,
    handleHitDiameterPx: SHOT_OVERHEAD_COARSE_HANDLE_HIT_DIAMETER_PX,
    pathHitWidthPx: SHOT_OVERHEAD_COARSE_PATH_HIT_WIDTH_PX
  });
  assert.equal(SHOT_OVERHEAD_FINE_VISIBLE_HANDLE_DIAMETER_PX, 10);
  assert.equal(SHOT_OVERHEAD_FINE_HANDLE_HIT_DIAMETER_PX, 28);
  assert.equal(SHOT_OVERHEAD_FINE_PATH_HIT_WIDTH_PX, 28);
  assert.equal(SHOT_OVERHEAD_COARSE_VISIBLE_HANDLE_DIAMETER_PX, 12);
  assert.equal(SHOT_OVERHEAD_COARSE_HANDLE_HIT_DIAMETER_PX, 44);
  assert.equal(SHOT_OVERHEAD_COARSE_PATH_HIT_WIDTH_PX, 44);
});

test("nearest handle resolution is distance-first and deterministic on ties", () => {
  const candidates = [
    { value: "far-high", stableId: "z", center: { x: 12, y: 0 }, hitRadiusPx: 20, priority: 10 },
    { value: "near", stableId: "n", center: { x: 4, y: 0 }, hitRadiusPx: 20, priority: 0 }
  ];
  assert.equal(resolveNearestShotOverheadHandle({ x: 0, y: 0 }, candidates)?.value, "near");

  const tied = [
    { value: "stable-b", stableId: "b", center: { x: -5, y: 0 }, hitRadiusPx: 20 },
    { value: "hovered", stableId: "z", center: { x: 5, y: 0 }, hitRadiusPx: 20, hovered: true },
    { value: "stable-a", stableId: "a", center: { x: 0, y: 5 }, hitRadiusPx: 20 }
  ];
  assert.equal(resolveNearestShotOverheadHandle({ x: 0, y: 0 }, tied)?.value, "hovered");

  const stableTie = tied.map((candidate) => ({ ...candidate, hovered: false }));
  assert.equal(resolveNearestShotOverheadHandle({ x: 0, y: 0 }, stableTie)?.value, "stable-a");
  assert.equal(resolveNearestShotOverheadHandle({ x: 100, y: 100 }, tied), null);
});

test("one direct drag release creates one undo entry", () => {
  const initial = {
    ...createEmptyShotOverheadDiagram(),
    people: [{
      id: "actor-1",
      x: 100,
      y: 120,
      scale: 1,
      rotation: 0,
      label: "A",
      color: "blue"
    }]
  };
  const moved = {
    ...initial,
    people: [{ ...initial.people[0], x: 180, y: 150 }]
  };
  const committed = pushShotOverheadHistory(
    createShotOverheadHistory(initial),
    moved,
    initial
  );

  assert.equal(committed.past.length, 1);
  assert.equal(committed.current.people[0].x, 180);
  assert.equal(undoShotOverheadHistory(committed).current.people[0].x, 100);
  assert.equal(redoShotOverheadHistory(undoShotOverheadHistory(committed)).current.people[0].x, 180);
});

test("line, room, and movement point targets update only the requested geometry", () => {
  const initial = {
    ...createEmptyShotOverheadDiagram(),
    people: [{
      id: "actor-1",
      x: 100,
      y: 120,
      scale: 1,
      rotation: 0,
      label: "A",
      color: "blue"
    }],
    lines: [
      { id: "line-1", x1: 10, y1: 20, x2: 80, y2: 90, color: "black" },
      { id: "line-2", x1: 110, y1: 120, x2: 180, y2: 190, color: "red" }
    ],
    shapes: [{
      id: "room-1",
      type: "polyline",
      points: [{ x: 20, y: 20 }, { x: 120, y: 20 }, { x: 120, y: 120 }],
      closed: true,
      label: "Room"
    }],
    movementPaths: [{
      id: "path-1",
      sourceType: "person",
      sourceId: "actor-1",
      ownerAnchored: true,
      points: [{ x: 100, y: 120 }, { x: 220, y: 180 }, { x: 320, y: 240 }]
    }]
  };

  const line = applyShotOverheadPointTarget(
    initial,
    { target: "line-start", id: "line-1" },
    { x: 30, y: 40 }
  );
  assert.deepEqual(line.lines[0], { ...initial.lines[0], x1: 30, y1: 40 });
  assert.deepEqual(line.lines[1], initial.lines[1]);

  const room = applyShotOverheadPointTarget(
    initial,
    { target: "shape-point", id: "room-1", index: 1 },
    { x: 90, y: 60 }
  );
  assert.deepEqual(room.shapes[0].points, [
    initial.shapes[0].points[0],
    { x: 90, y: 60 },
    initial.shapes[0].points[2]
  ]);

  const movement = applyShotOverheadPointTarget(
    initial,
    { target: "path-point", id: "path-1", index: 2 },
    { x: 430, y: 310 }
  );
  assert.deepEqual(movement.movementPaths[0].points.slice(0, 2), initial.movementPaths[0].points.slice(0, 2));
  assert.deepEqual(movement.movementPaths[0].points[2], { x: 430, y: 310 });
});

test("camera rotation preserves properties and keeps PAN attached to the current icon", () => {
  const initial = {
    ...createEmptyShotOverheadDiagram(),
    cameras: [{ id: "camera-1", x: 140, y: 220, rotation: 350, label: "CAM A", showFov: true }],
    cameraPans: [{
      id: "pan-1",
      cameraId: "camera-1",
      startRotation: 350,
      finalRotation: 75,
      direction: "clockwise"
    }]
  };
  const rotated = applyShotOverheadRotation(initial, { kind: "camera", id: "camera-1" }, 375);
  assert.deepEqual(rotated.cameras[0], { ...initial.cameras[0], rotation: 15 });
  assert.deepEqual(rotated.cameraPans[0], { ...initial.cameraPans[0], startRotation: 15 });
  assert.equal(rotated.cameraPans[0].finalRotation, 75);
  assert.equal(rotated.cameras[0].showFov, true);
  assert.equal(rotated.cameras[0].label, "CAM A");
});

test("many live previews still commit as one history entry on release", () => {
  const initial = {
    ...createEmptyShotOverheadDiagram(),
    lines: [{ id: "line-1", x1: 10, y1: 20, x2: 80, y2: 90, color: "black" }]
  };
  let history = createShotOverheadHistory(initial);
  for (const point of [{ x: 20, y: 30 }, { x: 40, y: 50 }, { x: 70, y: 80 }]) {
    history = replaceShotOverheadHistoryCurrent(
      history,
      applyShotOverheadPointTarget(
        initial,
        { target: "line-end", id: "line-1" },
        point
      )
    );
  }
  history = pushShotOverheadHistory(history, history.current, initial);
  assert.equal(history.past.length, 1);
  assert.deepEqual(history.current.lines[0], { ...initial.lines[0], x2: 70, y2: 80 });
  assert.deepEqual(undoShotOverheadHistory(history).current.lines[0], initial.lines[0]);
  assert.deepEqual(redoShotOverheadHistory(undoShotOverheadHistory(history)).current.lines[0], history.current.lines[0]);
});

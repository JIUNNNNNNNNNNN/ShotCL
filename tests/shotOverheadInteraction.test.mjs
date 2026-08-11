import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECT_DRAG_COARSE_TOLERANCE_PX,
  DIRECT_DRAG_FINE_TOLERANCE_PX,
  MOVEMENT_CREATION_MIN_DISTANCE_PX,
  TOUCH_CONTEXT_MENU_HOLD_MS,
  createMovementPath,
  getMovementEndPoint,
  hasMinimumMovementDraft,
  shouldBeginDirectDrag
} from "../lib/shotOverheadInteraction.ts";
import { createEmptyShotOverheadDiagram } from "../lib/shotOverhead.ts";
import {
  createShotOverheadHistory,
  pushShotOverheadHistory,
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

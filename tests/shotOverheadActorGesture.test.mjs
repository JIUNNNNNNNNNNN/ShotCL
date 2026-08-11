import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTOR_MOVEMENT_COARSE_HOLD_MS,
  ACTOR_MOVEMENT_FINE_HOLD_MS,
  ACTOR_MOVEMENT_MIN_DISTANCE_PX,
  createActorMovementPath,
  getActorMovementEndPoint,
  hasMinimumActorMovement,
  shouldBeginActorReposition
} from "../lib/shotOverheadActorGesture.ts";
import { createEmptyShotOverheadDiagram } from "../lib/shotOverhead.ts";
import {
  createShotOverheadHistory,
  pushShotOverheadHistory,
  redoShotOverheadHistory,
  undoShotOverheadHistory
} from "../lib/shotOverheadHistory.ts";

test("actor hold thresholds distinguish fine and coarse pointers", () => {
  assert.equal(ACTOR_MOVEMENT_FINE_HOLD_MS, 300);
  assert.equal(ACTOR_MOVEMENT_COARSE_HOLD_MS, 380);
});

test("movement before the hold tolerance becomes actor reposition", () => {
  const start = { x: 100, y: 100 };
  assert.equal(shouldBeginActorReposition(start, { x: 105, y: 100 }, "mouse"), false);
  assert.equal(shouldBeginActorReposition(start, { x: 107, y: 100 }, "mouse"), true);
  assert.equal(shouldBeginActorReposition(start, { x: 109, y: 100 }, "touch"), false);
  assert.equal(shouldBeginActorReposition(start, { x: 110, y: 100 }, "touch"), true);
});

test("actor movement uses a 12px visual minimum at the current viewport scale", () => {
  assert.equal(ACTOR_MOVEMENT_MIN_DISTANCE_PX, 12);
  assert.equal(hasMinimumActorMovement({ x: 10, y: 10 }, { x: 21, y: 10 }, 1), false);
  assert.equal(hasMinimumActorMovement({ x: 10, y: 10 }, { x: 22, y: 10 }, 1), true);
  assert.equal(hasMinimumActorMovement({ x: 10, y: 10 }, { x: 34, y: 10 }, 0.5), true);
});

test("actor movement follows pointer delta rather than the pressed hit-area offset", () => {
  const actorOrigin = { x: 100, y: 100 };
  const pointerStart = { x: 118, y: 91 };

  assert.deepEqual(
    getActorMovementEndPoint(
      actorOrigin,
      pointerStart,
      { x: 119, y: 92 },
      { width: 960, height: 640 }
    ),
    { x: 101, y: 101 }
  );
  assert.deepEqual(
    getActorMovementEndPoint(
      actorOrigin,
      pointerStart,
      { x: 318, y: 191 },
      { width: 960, height: 640 }
    ),
    { x: 300, y: 200 }
  );
});

test("a committed actor movement reuses the canonical source-linked path model", () => {
  assert.deepEqual(
    createActorMovementPath("movement-1", "actor-1", { x: 100, y: 120 }, { x: 260, y: 300 }),
    {
      id: "movement-1",
      sourceType: "person",
      sourceId: "actor-1",
      points: [{ x: 100, y: 120 }, { x: 260, y: 300 }]
    }
  );
});

test("one actor movement release creates one history entry and undo/redo preserves actor position", () => {
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
  const path = createActorMovementPath(
    "movement-1",
    "actor-1",
    { x: 100, y: 120 },
    { x: 260, y: 300 }
  );
  const next = { ...initial, movementPaths: [path] };
  const committed = pushShotOverheadHistory(
    createShotOverheadHistory(initial),
    next,
    initial
  );

  assert.equal(committed.past.length, 1);
  assert.deepEqual(committed.current.people[0], initial.people[0]);
  assert.deepEqual(committed.current.movementPaths, [path]);

  const undone = undoShotOverheadHistory(committed);
  assert.deepEqual(undone.current.movementPaths, []);
  assert.deepEqual(undone.current.people[0], initial.people[0]);

  const redone = redoShotOverheadHistory(undone);
  assert.deepEqual(redone.current.movementPaths, [path]);
  assert.deepEqual(redone.current.people[0], initial.people[0]);
});

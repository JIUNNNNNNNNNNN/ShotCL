import assert from "node:assert/strict";
import test from "node:test";
import {
  SHOT_OVERHEAD_HISTORY_LIMIT,
  canRedoShotOverheadHistory,
  canUndoShotOverheadHistory,
  cloneShotOverheadDiagram,
  createShotOverheadHistory,
  pushShotOverheadHistory,
  redoShotOverheadHistory,
  replaceShotOverheadHistoryCurrent,
  undoShotOverheadHistory
} from "../lib/shotOverheadHistory.ts";

function diagram(marker = 0) {
  return {
    version: 1,
    canvas: { width: 1200, height: 800 },
    people: [{ id: "person-1", x: marker, y: 100, scale: 1, rotation: 0, label: "A", color: "blue" }],
    cameras: [],
    lines: [],
    shapes: [],
    movementPaths: []
  };
}

test("undo and redo restore committed documents", () => {
  let history = createShotOverheadHistory(diagram(0));
  assert.equal(canUndoShotOverheadHistory(history), false);
  assert.equal(canRedoShotOverheadHistory(history), false);

  history = pushShotOverheadHistory(history, diagram(1));
  history = pushShotOverheadHistory(history, diagram(2));
  assert.equal(history.current.people[0].x, 2);
  assert.equal(canUndoShotOverheadHistory(history), true);

  history = undoShotOverheadHistory(history);
  assert.equal(history.current.people[0].x, 1);
  assert.equal(canRedoShotOverheadHistory(history), true);

  history = redoShotOverheadHistory(history);
  assert.equal(history.current.people[0].x, 2);
  assert.equal(canRedoShotOverheadHistory(history), false);
});

test("a new commit after undo clears the redo future", () => {
  let history = createShotOverheadHistory(diagram(0));
  history = pushShotOverheadHistory(history, diagram(1));
  history = pushShotOverheadHistory(history, diagram(2));
  history = undoShotOverheadHistory(history);
  assert.equal(canRedoShotOverheadHistory(history), true);

  history = pushShotOverheadHistory(history, diagram(9));
  assert.equal(history.current.people[0].x, 9);
  assert.equal(canRedoShotOverheadHistory(history), false);
  assert.deepEqual(history.future, []);
});

test("history keeps only the latest 75 undo snapshots", () => {
  let history = createShotOverheadHistory(diagram(0));
  for (let marker = 1; marker <= SHOT_OVERHEAD_HISTORY_LIMIT + 5; marker += 1) {
    history = pushShotOverheadHistory(history, diagram(marker));
  }

  assert.equal(history.past.length, SHOT_OVERHEAD_HISTORY_LIMIT);
  for (let index = 0; index < SHOT_OVERHEAD_HISTORY_LIMIT; index += 1) {
    history = undoShotOverheadHistory(history);
  }
  assert.equal(history.current.people[0].x, 5);
  assert.equal(canUndoShotOverheadHistory(history), false);
});

test("snapshots deeply clone nested polygon and movement-path points", () => {
  const initial = {
    ...diagram(0),
    shapes: [{
      id: "space-1",
      type: "polyline",
      points: [{ x: 10, y: 20 }, { x: 80, y: 20 }, { x: 50, y: 90 }],
      closed: true,
      label: "거실"
    }],
    movementPaths: [{
      id: "path-1",
      sourceType: "person",
      sourceId: "person-1",
      points: [{ x: 10, y: 10 }, { x: 30, y: 40 }]
    }]
  };
  let history = createShotOverheadHistory(initial);

  initial.shapes[0].points[0].x = 999;
  initial.movementPaths[0].points[1].y = 999;
  assert.equal(history.current.shapes[0].points[0].x, 10);
  assert.equal(history.current.movementPaths[0].points[1].y, 40);

  const gestureStart = cloneShotOverheadDiagram(history.current);
  const moved = cloneShotOverheadDiagram(history.current);
  moved.shapes[0].points[0].x = 25;
  moved.movementPaths[0].points[1].y = 75;
  history = replaceShotOverheadHistoryCurrent(history, moved);
  history = pushShotOverheadHistory(history, history.current, gestureStart);

  moved.shapes[0].points[0].x = 777;
  moved.movementPaths[0].points[1].y = 777;
  assert.equal(history.current.shapes[0].points[0].x, 25);
  assert.equal(history.current.movementPaths[0].points[1].y, 75);

  history = undoShotOverheadHistory(history);
  assert.equal(history.current.shapes[0].points[0].x, 10);
  assert.equal(history.current.movementPaths[0].points[1].y, 40);
});

test("replace-current is state-only and gesture end commits one entry", () => {
  let history = createShotOverheadHistory(diagram(0));
  const gestureStart = cloneShotOverheadDiagram(history.current);

  history = replaceShotOverheadHistoryCurrent(history, diagram(10));
  history = replaceShotOverheadHistoryCurrent(history, diagram(20));
  history = replaceShotOverheadHistoryCurrent(history, diagram(30));
  assert.equal(history.past.length, 0);

  history = pushShotOverheadHistory(history, history.current, gestureStart);
  assert.equal(history.past.length, 1);
  history = undoShotOverheadHistory(history);
  assert.equal(history.current.people[0].x, 0);
});

test("pushing an identical snapshot is a no-op", () => {
  const history = createShotOverheadHistory(diagram(3));
  const result = pushShotOverheadHistory(history, cloneShotOverheadDiagram(history.current));
  assert.strictEqual(result, history);
  assert.equal(result.past.length, 0);
});

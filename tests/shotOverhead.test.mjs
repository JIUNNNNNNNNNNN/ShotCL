import assert from "node:assert/strict";
import test from "node:test";
import {
  cloneShotOverheadDiagram,
  createEmptyShotOverheadDiagram,
  hasShotOverheadContent,
  normalizeShotOverheadDiagram
} from "../lib/shotOverhead.ts";

test("legacy v1 diagrams keep their geometry and receive additive safe defaults", () => {
  const normalized = normalizeShotOverheadDiagram({
    version: 1,
    canvas: { width: 1200, height: 800 },
    people: [
      { id: "person-a", x: 101, y: 202, scale: 1.25, rotation: 35, label: "A" },
      { id: "person-b", x: 303, y: 404, scale: 0.75, rotation: 270, label: "B" }
    ],
    cameras: [{ id: "camera-a", x: 505, y: 606, rotation: 90, label: "CAM A" }],
    lines: [{ id: "line-a", x1: 11, y1: 22, x2: 333, y2: 444, color: "red" }],
    shapes: [{ id: "room-a", type: "rect", x: 70, y: 80, width: 300, height: 180, rotation: 15, label: "거실" }]
  });

  assert.ok(normalized);
  assert.deepEqual(
    normalized.people.map(({ id, x, y, scale, rotation, label }) => ({ id, x, y, scale, rotation, label })),
    [
      { id: "person-a", x: 101, y: 202, scale: 1.25, rotation: 35, label: "A" },
      { id: "person-b", x: 303, y: 404, scale: 0.75, rotation: 270, label: "B" }
    ]
  );
  assert.deepEqual(normalized.people.map((person) => person.color), ["blue", "red"]);
  assert.deepEqual(normalized.cameras[0], {
    id: "camera-a",
    x: 505,
    y: 606,
    rotation: 90,
    label: "CAM A",
    showFov: false
  });
  assert.deepEqual(normalized.lines[0], {
    id: "line-a",
    x1: 11,
    y1: 22,
    x2: 333,
    y2: 444,
    color: "red"
  });
  assert.deepEqual(normalized.shapes[0], {
    id: "room-a",
    type: "rect",
    x: 70,
    y: 80,
    width: 300,
    height: 180,
    rotation: 15,
    label: "거실"
  });
  assert.deepEqual(normalized.movementPaths, []);
});

test("person color, camera FOV, polyline rooms, and movement paths survive normalization", () => {
  const normalized = normalizeShotOverheadDiagram({
    version: 1,
    canvas: { width: 1200, height: 800 },
    people: [{ id: "actor", x: 100, y: 100, scale: 1, rotation: 0, label: "주인공", color: "cyan" }],
    cameras: [{ id: "camera", x: 300, y: 300, rotation: 45, label: "CAM", showFov: true }],
    lines: [],
    shapes: [
      {
        id: "open-room",
        type: "polyline",
        points: [{ x: 10, y: 10 }, { x: 200, y: 10 }, { x: 200, y: 120 }],
        closed: false,
        label: "복도"
      },
      {
        id: "closed-room",
        type: "polygon",
        points: [{ x: 300, y: 200 }, { x: 500, y: 200 }, { x: 460, y: 380 }],
        label: "방"
      }
    ],
    movementPaths: [
      {
        id: "actor-path",
        sourceType: "person",
        sourceId: "actor",
        points: [{ x: 100, y: 100 }, { x: 150, y: 180 }, { x: 260, y: 220 }]
      },
      {
        id: "camera-path",
        sourceType: "camera",
        sourceId: "camera",
        points: [{ x: 300, y: 300 }, { x: 420, y: 300 }]
      }
    ]
  });

  assert.ok(normalized);
  assert.equal(normalized.people[0]?.color, "cyan");
  assert.equal(normalized.cameras[0]?.showFov, true);
  assert.deepEqual(normalized.shapes, [
    {
      id: "open-room",
      type: "polyline",
      points: [{ x: 10, y: 10 }, { x: 200, y: 10 }, { x: 200, y: 120 }],
      closed: false,
      label: "복도"
    },
    {
      id: "closed-room",
      type: "polyline",
      points: [{ x: 300, y: 200 }, { x: 500, y: 200 }, { x: 460, y: 380 }],
      closed: true,
      label: "방"
    }
  ]);
  assert.deepEqual(normalized.movementPaths, [
    {
      id: "actor-path",
      sourceType: "person",
      sourceId: "actor",
      points: [{ x: 100, y: 100 }, { x: 150, y: 180 }, { x: 260, y: 220 }]
    },
    {
      id: "camera-path",
      sourceType: "camera",
      sourceId: "camera",
      points: [{ x: 300, y: 300 }, { x: 420, y: 300 }]
    }
  ]);
});

test("malformed extended objects are discarded without damaging valid legacy content", () => {
  const normalized = normalizeShotOverheadDiagram({
    version: 1,
    canvas: { width: 1200, height: 800 },
    people: [{ id: "actor", x: 10, y: 20, scale: 1, rotation: 0, label: "A", color: "not-a-color" }],
    cameras: [],
    lines: [{ id: "line", x1: 0, y1: 0, x2: 20, y2: 20, color: "black" }],
    shapes: [{ id: "bad-room", type: "polyline", points: [{ x: 1, y: 2 }], closed: false }],
    movementPaths: [
      { id: "missing-source", sourceType: "person", sourceId: "", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { id: "too-short", sourceType: "camera", sourceId: "camera", points: [{ x: 0, y: 0 }] }
    ]
  });

  assert.ok(normalized);
  assert.equal(normalized.people[0]?.color, "blue");
  assert.equal(normalized.lines.length, 1);
  assert.deepEqual(normalized.shapes, []);
  assert.deepEqual(normalized.movementPaths, []);
});

test("empty documents expose the extended arrays and movement-only content is discoverable", () => {
  const empty = createEmptyShotOverheadDiagram();
  assert.deepEqual(empty.movementPaths, []);
  assert.equal(hasShotOverheadContent(empty), false);

  const movementOnly = {
    ...empty,
    movementPaths: [{
      id: "path",
      sourceType: "camera",
      sourceId: "camera",
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }]
    }]
  };
  assert.equal(hasShotOverheadContent(movementOnly), true);
});

test("diagram clones do not share nested point arrays", () => {
  const original = normalizeShotOverheadDiagram({
    ...createEmptyShotOverheadDiagram(),
    shapes: [{
      id: "room",
      type: "polyline",
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      closed: false,
      label: ""
    }],
    movementPaths: [{
      id: "path",
      sourceType: "person",
      sourceId: "actor",
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }]
    }]
  });
  assert.ok(original);

  const clone = cloneShotOverheadDiagram(original);
  clone.shapes[0].points[0].x = 999;
  clone.movementPaths[0].points[0].y = 888;

  assert.equal(original.shapes[0].points[0].x, 10);
  assert.equal(original.movementPaths[0].points[0].y, 2);
});

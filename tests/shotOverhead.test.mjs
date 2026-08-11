import assert from "node:assert/strict";
import test from "node:test";
import {
  cloneShotOverheadDiagram,
  createEmptyShotOverheadDiagram,
  getShotOverheadCameraMovementGhost,
  getShotOverheadCameraPanArc,
  getShotOverheadFovRays,
  getShotOverheadGridWorldSize,
  getShotOverheadMovementFinalRotation,
  getShotOverheadMovementGeometry,
  getShotOverheadMovementPoints,
  getShotOverheadPolylinePath,
  hasShotOverheadContent,
  LEGACY_OVERHEAD_CANVAS_HEIGHT,
  LEGACY_OVERHEAD_CANVAS_WIDTH,
  normalizeShotOverheadDiagram,
  OVERHEAD_GRID_SIZE
} from "../lib/shotOverhead.ts";

test("new diagrams use compact dimensions while missing legacy canvas keeps the old fallback", () => {
  const empty = createEmptyShotOverheadDiagram();
  assert.deepEqual(empty.canvas, { width: 960, height: 640 });
  assert.deepEqual(empty.cameraPans, []);
  assert.equal(OVERHEAD_GRID_SIZE, 24);
  assert.equal(getShotOverheadGridWorldSize(1), 24);
  assert.equal(getShotOverheadGridWorldSize(0.625) * 0.625, 24);
  assert.equal(getShotOverheadGridWorldSize(1.25) * 1.25, 24);

  const missingCanvas = normalizeShotOverheadDiagram({
    version: 1,
    people: [],
    cameras: [],
    lines: [],
    shapes: []
  });
  assert.ok(missingCanvas);
  assert.deepEqual(missingCanvas.canvas, {
    width: LEGACY_OVERHEAD_CANVAS_WIDTH,
    height: LEGACY_OVERHEAD_CANVAS_HEIGHT
  });

  const explicitLegacyCanvas = normalizeShotOverheadDiagram({
    version: 1,
    canvas: { width: 1200, height: 800 }
  });
  assert.ok(explicitLegacyCanvas);
  assert.deepEqual(explicitLegacyCanvas.canvas, { width: 1200, height: 800 });
});

test("camera FOV geometry is two open local rays and does not depend on rotation", () => {
  const unrotated = getShotOverheadFovRays({ x: 300, y: 200, rotation: 0 });
  const rotated = getShotOverheadFovRays({ x: 300, y: 200, rotation: 225 });

  assert.deepEqual(unrotated, [
    { start: { x: 310, y: 200 }, end: { x: 415, y: 152 } },
    { start: { x: 310, y: 200 }, end: { x: 415, y: 248 } }
  ]);
  assert.equal(unrotated.length, 2);
  assert.deepEqual(rotated, unrotated);
  assert.notDeepEqual(unrotated[0].end, unrotated[1].end);
});

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
  assert.deepEqual(normalized.cameraPans, []);
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
    ],
    cameraPans: [{
      id: "camera-pan",
      cameraId: "camera",
      startRotation: 45,
      finalRotation: 135,
      direction: "clockwise"
    }]
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
      ownerAnchored: true,
      points: [{ x: 100, y: 100 }, { x: 150, y: 180 }, { x: 260, y: 220 }]
    },
    {
      id: "camera-path",
      sourceType: "camera",
      sourceId: "camera",
      ownerAnchored: true,
      points: [{ x: 300, y: 300 }, { x: 420, y: 300 }]
    }
  ]);
  assert.deepEqual(normalized.cameraPans, [{
    id: "camera-pan",
    cameraId: "camera",
    startRotation: 45,
    finalRotation: 135,
    direction: "clockwise"
  }]);
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
      { id: "too-short", sourceType: "camera", sourceId: "camera", points: [{ x: 0, y: 0 }] },
      { id: "orphan", sourceType: "camera", sourceId: "missing-camera", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }
    ],
    cameraPans: [{ id: "orphan-pan", cameraId: "missing-camera", startRotation: 0, finalRotation: 90 }]
  });

  assert.ok(normalized);
  assert.equal(normalized.people[0]?.color, "blue");
  assert.equal(normalized.lines.length, 1);
  assert.deepEqual(normalized.shapes, []);
  assert.deepEqual(normalized.movementPaths, []);
  assert.deepEqual(normalized.cameraPans, []);
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
    people: [{ id: "actor", x: 1, y: 2, scale: 1, rotation: 0, label: "A", color: "blue" }],
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

test("movement starts derive from the owner while controls and endpoint remain in world coordinates", () => {
  const normalized = normalizeShotOverheadDiagram({
    ...createEmptyShotOverheadDiagram(),
    people: [{ id: "actor", x: 140, y: 160, scale: 1, rotation: 15, label: "A", color: "blue" }],
    movementPaths: [{
      id: "legacy-curve",
      sourceType: "person",
      sourceId: "actor",
      points: [{ x: 10, y: 20 }, { x: 260, y: 80 }, { x: 420, y: 260 }]
    }]
  });
  assert.ok(normalized);
  assert.equal(normalized.movementPaths[0].ownerAnchored, true);
  assert.deepEqual(normalized.movementPaths[0].points, [
    { x: 140, y: 160 },
    { x: 260, y: 80 },
    { x: 420, y: 260 }
  ]);

  const relocated = {
    ...normalized,
    people: normalized.people.map((person) => ({ ...person, x: 200, y: 190 }))
  };
  assert.deepEqual(getShotOverheadMovementPoints(relocated, normalized.movementPaths[0]), [
    { x: 200, y: 190 },
    { x: 260, y: 80 },
    { x: 420, y: 260 }
  ]);
  const geometry = getShotOverheadMovementGeometry(relocated, normalized.movementPaths[0]);
  assert.ok(geometry);
  assert.match(geometry.pathData, /^M 200 190 C /);
  assert.match(geometry.pathData, / 260 80 C /);
  assert.match(geometry.pathData, / 420 260$/);
  assert.deepEqual(geometry.end, { x: 420, y: 260 });
  assert.equal(Number.isFinite(geometry.endTangentAngle), true);
});

test("legacy two-point movement remains a straight owner-linked path", () => {
  const diagram = normalizeShotOverheadDiagram({
    ...createEmptyShotOverheadDiagram(),
    cameras: [{ id: "camera", x: 90, y: 120, rotation: 0, label: "CAM", showFov: true }],
    movementPaths: [{
      id: "legacy-straight",
      sourceType: "camera",
      sourceId: "camera",
      points: [{ x: 20, y: 30 }, { x: 300, y: 240 }]
    }]
  });
  assert.ok(diagram);
  const geometry = getShotOverheadMovementGeometry(diagram, diagram.movementPaths[0]);
  assert.ok(geometry);
  assert.equal(geometry.pathData, "M 90 120 L 300 240");
  assert.deepEqual(geometry.end, { x: 300, y: 240 });
  assert.equal(diagram.movementPaths[0].finalRotation, undefined);
  assert.equal(getShotOverheadMovementFinalRotation(diagram, diagram.movementPaths[0]), 0);
});

test("open walls stay open while legacy polygons stay closed in output geometry", () => {
  const open = normalizeShotOverheadDiagram({
    ...createEmptyShotOverheadDiagram(),
    shapes: [{
      id: "open-wall",
      type: "polyline",
      points: [{ x: 10, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 90 }],
      closed: false,
      label: ""
    }]
  });
  const legacyClosed = normalizeShotOverheadDiagram({
    ...createEmptyShotOverheadDiagram(),
    shapes: [{
      id: "legacy-room",
      type: "polygon",
      points: [{ x: 10, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 90 }],
      label: ""
    }]
  });
  assert.ok(open && legacyClosed);
  assert.equal(open.shapes[0].type, "polyline");
  assert.equal(legacyClosed.shapes[0].type, "polyline");
  assert.equal(getShotOverheadPolylinePath(open.shapes[0]), "M 10 20 L 80 20 L 80 90");
  assert.equal(getShotOverheadPolylinePath(legacyClosed.shapes[0]), "M 10 20 L 80 20 L 80 90 Z");
});

test("legacy camera movement fallback stays implicit while explicit orientation survives source changes", () => {
  const diagram = normalizeShotOverheadDiagram({
    ...createEmptyShotOverheadDiagram(),
    cameras: [{ id: "camera", x: 100, y: 100, rotation: 35, label: "CAM", showFov: true }],
    movementPaths: [{
      id: "camera-move",
      sourceType: "camera",
      sourceId: "camera",
      points: [{ x: 100, y: 100 }, { x: 260, y: 100 }]
    }],
    cameraPans: [{
      id: "camera-pan",
      cameraId: "camera",
      startRotation: 35,
      finalRotation: 145,
      direction: "clockwise"
    }]
  });
  assert.ok(diagram);
  const path = diagram.movementPaths[0];
  const geometry = getShotOverheadMovementGeometry(diagram, path);
  const ghost = getShotOverheadCameraMovementGhost(diagram, path);
  assert.ok(geometry);
  assert.ok(ghost);
  assert.equal(geometry.endTangentAngle, 0);
  assert.equal(path.finalRotation, undefined);
  assert.equal(getShotOverheadMovementFinalRotation(diagram, path), 35);
  assert.equal(diagram.cameraPans[0].finalRotation, 145);
  assert.deepEqual(ghost, {
    cameraId: "camera",
    x: 260,
    y: 100,
    rotation: 35,
    showFov: true,
    fovRays: [
      { start: { x: 270, y: 100 }, end: { x: 375, y: 52 } },
      { start: { x: 270, y: 100 }, end: { x: 375, y: 148 } }
    ]
  });

  const implicitAfterSourceRotation = normalizeShotOverheadDiagram({
    ...diagram,
    cameras: [{ ...diagram.cameras[0], rotation: 270 }]
  });
  assert.ok(implicitAfterSourceRotation);
  assert.equal(implicitAfterSourceRotation.movementPaths[0].finalRotation, undefined);
  assert.equal(
    getShotOverheadMovementFinalRotation(
      implicitAfterSourceRotation,
      implicitAfterSourceRotation.movementPaths[0]
    ),
    270
  );

  const edited = normalizeShotOverheadDiagram({
    ...diagram,
    cameras: [{ ...diagram.cameras[0], rotation: 270 }],
    movementPaths: [{ ...path, finalRotation: 405 }]
  });
  assert.ok(edited);
  assert.equal(edited.movementPaths[0].finalRotation, 45);
  assert.equal(getShotOverheadMovementFinalRotation(edited, edited.movementPaths[0]), 45);
  assert.equal(getShotOverheadMovementGeometry(edited, edited.movementPaths[0])?.endTangentAngle, 0);
  assert.equal(edited.cameraPans[0].finalRotation, 145);
  assert.equal(getShotOverheadCameraMovementGhost(edited, edited.movementPaths[0])?.rotation, 45);
});

test("camera pan normalization and arc geometry preserve explicit direction", () => {
  const diagram = normalizeShotOverheadDiagram({
    ...createEmptyShotOverheadDiagram(),
    cameras: [{ id: "camera", x: 300, y: 200, rotation: 0, label: "CAM", showFov: true }],
    cameraPans: [
      { id: "pan-right", sourceId: "camera", startRotation: 0, endRotation: 90, direction: "clockwise" },
      { id: "pan-left", cameraId: "camera", startRotation: 0, finalRotation: 270, direction: "counterclockwise" }
    ]
  });
  assert.ok(diagram);
  assert.deepEqual(diagram.cameraPans, [
    { id: "pan-right", cameraId: "camera", startRotation: 0, finalRotation: 90, direction: "clockwise" },
    { id: "pan-left", cameraId: "camera", startRotation: 0, finalRotation: 270, direction: "counterclockwise" }
  ]);

  const clockwise = getShotOverheadCameraPanArc(diagram.cameras[0], diagram.cameraPans[0]);
  assert.ok(clockwise);
  assert.equal(clockwise.deltaDegrees, 90);
  assert.equal(clockwise.sweep, 1);
  assert.equal(clockwise.largeArc, 0);
  assert.deepEqual(clockwise.start, { x: 342, y: 200 });
  assert.ok(Math.abs(clockwise.end.x - 300) < 0.001);
  assert.ok(Math.abs(clockwise.end.y - 242) < 0.001);

  const counterclockwise = getShotOverheadCameraPanArc(diagram.cameras[0], diagram.cameraPans[1]);
  assert.ok(counterclockwise);
  assert.equal(counterclockwise.deltaDegrees, -90);
  assert.equal(counterclockwise.sweep, 0);
  assert.ok(Math.abs(counterclockwise.end.x - 300) < 0.001);
  assert.ok(Math.abs(counterclockwise.end.y - 158) < 0.001);
});

test("camera-only pan counts as diagram content and follows camera relocation", () => {
  const empty = createEmptyShotOverheadDiagram();
  const diagram = {
    ...empty,
    cameras: [{ id: "camera", x: 100, y: 120, rotation: 15, label: "CAM", showFov: true }],
    cameraPans: [{ id: "pan", cameraId: "camera", startRotation: 15, finalRotation: 120, direction: "clockwise" }]
  };
  assert.equal(hasShotOverheadContent(diagram), true);
  const first = getShotOverheadCameraPanArc(diagram.cameras[0], diagram.cameraPans[0]);
  const moved = getShotOverheadCameraPanArc({ ...diagram.cameras[0], x: 180, y: 210 }, diagram.cameraPans[0]);
  assert.ok(first && moved);
  assert.equal(moved.center.x - first.center.x, 80);
  assert.equal(moved.center.y - first.center.y, 90);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  applyShotOverheadSpaceSnapshot,
  areShotOverheadSpaceSnapshotsEqual,
  createShotOverheadSpaceLocationKey,
  extractShotOverheadSpaceSnapshot,
  hasShotOverheadSpace,
  normalizeShotOverheadSpacePreset,
  resolveShotOverheadSpaceLocation
} from "../lib/shotOverheadSpacePresets.ts";

function diagram(overrides = {}) {
  return {
    version: 1,
    canvas: { width: 960, height: 640 },
    people: [{
      id: "actor-1",
      x: 100,
      y: 120,
      scale: 1,
      rotation: 0,
      label: "A",
      color: "blue"
    }],
    cameras: [{
      id: "camera-1",
      x: 300,
      y: 240,
      rotation: 45,
      label: "CAM",
      showFov: true
    }],
    lines: [{
      id: "annotation-1",
      x1: 10,
      y1: 20,
      x2: 200,
      y2: 220,
      color: "red"
    }],
    shapes: [],
    movementPaths: [{
      id: "movement-1",
      sourceType: "person",
      sourceId: "actor-1",
      ownerAnchored: true,
      points: [{ x: 100, y: 120 }, { x: 240, y: 180 }]
    }],
    cameraPans: [{
      id: "pan-1",
      cameraId: "camera-1",
      startRotation: 45,
      finalRotation: 120,
      direction: "clockwise"
    }],
    ...overrides
  };
}

test("location identity uses the canonical normalized major+minor pair", () => {
  const first = resolveShotOverheadSpaceLocation({
    mainLocation: "  집\u3000A  ",
    subLocation: "  안방 "
  });
  const same = resolveShotOverheadSpaceLocation({
    mainLocation: "집 a",
    subLocation: "안방"
  });
  const differentMajor = resolveShotOverheadSpaceLocation({
    mainLocation: "집 B",
    subLocation: "안방"
  });

  assert.ok(first);
  assert.ok(same);
  assert.ok(differentMajor);
  assert.equal(first.mainLocation, "집 A");
  assert.equal(first.subLocation, "안방");
  assert.equal(first.displayName, "안방");
  assert.equal(first.key, same.key);
  assert.notEqual(first.key, differentMajor.key);
  assert.equal(createShotOverheadSpaceLocationKey("집 A", ""), null);
  assert.equal(resolveShotOverheadSpaceLocation({ mainLocation: "집 A", subLocation: "  " }), null);
});

test("space snapshot keeps multiple rect/open/closed shapes and excludes cut annotations", () => {
  const source = diagram({
    canvas: { width: 1200, height: 800 },
    shapes: [
      {
        id: "rect-room",
        type: "rect",
        x: 50,
        y: 60,
        width: 300,
        height: 180,
        rotation: 15,
        label: "방"
      },
      {
        id: "open-wall",
        type: "polyline",
        points: [{ x: 10, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 180 }],
        closed: false,
        label: "열린 벽"
      },
      {
        id: "closed-room",
        type: "polyline",
        points: [{ x: 400, y: 100 }, { x: 600, y: 100 }, { x: 550, y: 300 }],
        closed: true,
        label: "닫힌 방"
      }
    ]
  });

  const snapshot = extractShotOverheadSpaceSnapshot(source);
  assert.ok(snapshot);
  assert.deepEqual(snapshot.canvas, { width: 1200, height: 800 });
  assert.equal(snapshot.shapes.length, 3);
  assert.equal(snapshot.shapes[1].type, "polyline");
  assert.equal(snapshot.shapes[1].closed, false);
  assert.equal(snapshot.shapes[2].type, "polyline");
  assert.equal(snapshot.shapes[2].closed, true);
  assert.equal("lines" in snapshot, false);
  assert.equal("people" in snapshot, false);
  snapshot.shapes[1].points[0].x = 999;
  assert.equal(source.shapes[1].points[0].x, 10);
  assert.equal(hasShotOverheadSpace(source), true);
  assert.equal(extractShotOverheadSpaceSnapshot(diagram()), null);
});

test("replace copies only shapes with fresh IDs and preserves every cut-specific object", () => {
  const target = diagram({
    shapes: [{
      id: "old-room",
      type: "rect",
      x: 0,
      y: 0,
      width: 80,
      height: 60,
      rotation: 0,
      label: "old"
    }]
  });
  const snapshot = {
    canvas: { width: 1200, height: 800 },
    shapes: [
      {
        id: "source-room",
        type: "rect",
        x: 100,
        y: 50,
        width: 300,
        height: 200,
        rotation: 20,
        label: "room"
      },
      {
        id: "source-wall",
        type: "polyline",
        points: [{ x: 0, y: 0 }, { x: 1200, y: 800 }],
        closed: false,
        label: "wall"
      }
    ]
  };

  const applied = applyShotOverheadSpaceSnapshot(target, snapshot, {
    replace: true,
    idFactory: (_shape, index) => `copy-${index}`
  });

  assert.strictEqual(applied.people, target.people);
  assert.strictEqual(applied.cameras, target.cameras);
  assert.strictEqual(applied.lines, target.lines);
  assert.strictEqual(applied.movementPaths, target.movementPaths);
  assert.strictEqual(applied.cameraPans, target.cameraPans);
  assert.deepEqual(applied.shapes, [
    {
      id: "copy-0",
      type: "rect",
      x: 80,
      y: 40,
      width: 240,
      height: 160,
      rotation: 20,
      label: "room"
    },
    {
      id: "copy-1",
      type: "polyline",
      points: [{ x: 0, y: 0 }, { x: 960, y: 640 }],
      closed: false,
      label: "wall"
    }
  ]);
  assert.notEqual(applied.shapes[0].id, snapshot.shapes[0].id);
  applied.shapes[1].points[0].x = 321;
  assert.equal(snapshot.shapes[1].points[0].x, 0);
});

test("different board ratios use uniform contain scaling and centering", () => {
  const target = diagram({ canvas: { width: 800, height: 800 } });
  const snapshot = {
    canvas: { width: 1000, height: 500 },
    shapes: [{
      id: "wide-room",
      type: "polyline",
      points: [{ x: 0, y: 0 }, { x: 1000, y: 500 }],
      closed: false,
      label: ""
    }]
  };
  const applied = applyShotOverheadSpaceSnapshot(target, snapshot, {
    replace: false,
    idFactory: () => "wide-copy"
  });

  assert.deepEqual(applied.shapes[0].points, [
    { x: 0, y: 200 },
    { x: 800, y: 600 }
  ]);

  const collisionSafe = applyShotOverheadSpaceSnapshot(target, snapshot, {
    replace: true,
    idFactory: (shape) => shape.id
  });
  assert.notEqual(collisionSafe.shapes[0].id, snapshot.shapes[0].id);
});

test("normalization rejects forged keys and snapshot equality is canonical", () => {
  const value = {
    id: "space-preset:abc",
    projectId: "project-a",
    location: {
      key: createShotOverheadSpaceLocationKey("집 A", "안방"),
      mainLocation: "집 A",
      subLocation: "안방"
    },
    snapshot: {
      canvas: { width: 960, height: 640 },
      shapes: [{
        id: "room",
        type: "polyline",
        points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
        closed: false,
        label: ""
      }]
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const preset = normalizeShotOverheadSpacePreset(value);
  assert.ok(preset);
  assert.equal(areShotOverheadSpaceSnapshotsEqual(value.snapshot, preset.snapshot), true);
  assert.equal(normalizeShotOverheadSpacePreset({
    ...value,
    location: { ...value.location, key: "forged" }
  }), null);
});

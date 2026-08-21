import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(
        new URL(`${specifier.slice(2)}.ts`, projectRoot).href,
        context
      );
    }
    return nextResolve(specifier, context);
  }
});

const { orderProgressShotsByShootingOrder } = await import("../lib/progress/shootingOrder.ts");

function shot(sceneNumber, cutNumber, extra = {}) {
  return {
    id: `${sceneNumber}:${cutNumber}`,
    sceneNumber,
    cutNumber: String(cutNumber),
    status: "pending",
    ...extra
  };
}

function sceneRow(sceneNumber, totalCuts, shootingOrder = "", selectedCutNumbers) {
  const row = {
    version: 1,
    rowId: `row:${sceneNumber}:${shootingOrder}`,
    sourceSceneId: `scene:${sceneNumber}`,
    sourceSnapshot: null,
    rowSnapshot: {
      sceneNumber,
      sceneTitle: "",
      description: "",
      startTime: "",
      endTime: "",
      runtimeMinutes: null,
      runtime: "",
      locationId: "",
      locationName: "",
      mainLocation: "",
      subLocation: "",
      dayNight: "",
      storyDay: "",
      shootingOrder,
      notes: "",
      subject: "",
      props: "",
      costumeMakeup: "",
      sceneMemo: "",
      totalCuts,
      cuts: []
    }
  };
  if (selectedCutNumbers !== undefined) row.selectedCutNumbers = selectedCutNumbers;
  return row;
}

function cutNumbers(shots) {
  return shots.map((item) => Number(item.cutNumber));
}

test("A: custom Daily Plan order 1 3 2 wins over input and numeric order", () => {
  const shots = [shot("1", 2), shot("1", 1), shot("1", 3)];
  assert.deepEqual(
    cutNumbers(orderProgressShotsByShootingOrder(shots, [sceneRow("1", 3, "1 3 2")])),
    [1, 3, 2]
  );
});

test("B: blank, whitespace, and absent legacy order use natural numeric order", () => {
  for (const shootingOrder of ["", "   ", null, undefined]) {
    const shots = [shot("1", 10), shot("1", 2), shot("1", 1)];
    assert.deepEqual(
      cutNumbers(orderProgressShotsByShootingOrder(shots, [sceneRow("1", 10, shootingOrder)])),
      [1, 2, 10]
    );
  }
});

test("C: another explicit order 3 2 1 remains exact", () => {
  const shots = [1, 2, 3].map((cut) => shot("1", cut));
  assert.deepEqual(
    cutNumbers(orderProgressShotsByShootingOrder(shots, [sceneRow("1", 3, "3,2,1")])),
    [3, 2, 1]
  );
});

test("D: multi-digit cut tokens remain whole", () => {
  const shots = [1, 2, 10, 12].map((cut) => shot("1", cut));
  assert.deepEqual(
    cutNumbers(orderProgressShotsByShootingOrder(shots, [sceneRow("1", 12, "12-1-10-2")])),
    [12, 1, 10, 2]
  );
});

test("E: split custom order only reorders actual selected membership", () => {
  const shots = [shot("1", 1), shot("1", 3)];
  const row = sceneRow("1", 4, "3 1", [1, 3]);
  assert.deepEqual(cutNumbers(orderProgressShotsByShootingOrder(shots, [row])), [3, 1]);
  assert.equal(orderProgressShotsByShootingOrder(shots, [row]).length, 2);
});

test("F: split blank order uses natural order of selected actual cuts", () => {
  const shots = [shot("1", 3), shot("1", 1)];
  assert.deepEqual(
    cutNumbers(orderProgressShotsByShootingOrder(shots, [sceneRow("1", 4, "", [1, 3])])),
    [1, 3]
  );
});

test("G: each round uses only its own timetable metadata", () => {
  const roundOneShots = [shot("1", 1), shot("1", 3)];
  const roundTwoShots = [shot("1", 2), shot("1", 4)];
  assert.deepEqual(
    cutNumbers(orderProgressShotsByShootingOrder(roundOneShots, [sceneRow("1", 4, "3 1", [1, 3])])),
    [3, 1]
  );
  assert.deepEqual(
    cutNumbers(orderProgressShotsByShootingOrder(roundTwoShots, [sceneRow("1", 4, "4 2", [2, 4])])),
    [4, 2]
  );
});

test("partial order appends only remaining relevant actual cuts naturally", () => {
  const shots = [4, 1, 3, 2].map((cut) => shot("1", cut));
  assert.deepEqual(
    cutNumbers(orderProgressShotsByShootingOrder(shots, [sceneRow("1", 4, "3 1")])),
    [3, 1, 2, 4]
  );
});

test("legacy invalid input uses only safe canonical tokens without duplicating cards", () => {
  const shots = [3, 1, 2].map((cut) => shot("1", cut));
  assert.deepEqual(
    cutNumbers(orderProgressShotsByShootingOrder(shots, [sceneRow("1", 3, "1 3 3 2")])),
    [1, 3, 2]
  );
  assert.deepEqual(
    cutNumbers(orderProgressShotsByShootingOrder(shots, [sceneRow("1", 3, "3 X 1")])),
    [1, 2, 3]
  );
});

test("timetable row order and normalized scene labels determine scene grouping", () => {
  const shots = [shot("S#1", 1), shot("scene 2", 1), shot("1", 2), shot("2", 2)];
  const ordered = orderProgressShotsByShootingOrder(shots, [
    sceneRow("씬 2", 2, "2 1"),
    sceneRow("S1", 2, "1 2")
  ]);
  assert.deepEqual(ordered.map((item) => `${item.sceneNumber}:${item.cutNumber}`), [
    "2:2",
    "scene 2:1",
    "S#1:1",
    "1:2"
  ]);
});

test("suffix-bearing scene labels keep their distinct Daily Plan linkage", () => {
  const firstSuffixShot = shot("S#001A", 1);
  const secondSuffixShot = shot("1A", 2);
  const baseSceneShot = shot("1", 1);
  const shots = [firstSuffixShot, secondSuffixShot, baseSceneShot];
  const ordered = orderProgressShotsByShootingOrder(shots, [
    sceneRow("씬 1A", 2, "2 1"),
    sceneRow("S1", 1, "1")
  ]);

  assert.deepEqual(ordered.map((item) => item.id), [
    secondSuffixShot.id,
    firstSuffixShot.id,
    baseSceneShot.id
  ]);
});

test("hyphenated Scene labels keep distinct Progress grouping and display identity", () => {
  const sceneOneOne = shot("S#1-1", 1);
  const sceneOneZeroOne = shot("1-01", 1);
  const baseScene = shot("1", 1);
  const ordered = orderProgressShotsByShootingOrder(
    [baseScene, sceneOneZeroOne, sceneOneOne],
    [
      sceneRow("1-1", 1, "1"),
      sceneRow("S#1-01", 1, "1"),
      sceneRow("1", 1, "1")
    ]
  );

  assert.deepEqual(ordered.map((item) => item.sceneNumber), ["S#1-1", "1-01", "1"]);
});

test("multiple rows for one scene consume stable shots once in row order", () => {
  const shots = [1, 2, 3, 4].map((cut) => shot("1", cut));
  const ordered = orderProgressShotsByShootingOrder(shots, [
    sceneRow("1", 4, "3 1", [1, 3]),
    sceneRow("1", 4, "4 2", [2, 4])
  ]);
  assert.deepEqual(cutNumbers(ordered), [3, 1, 4, 2]);
  assert.equal(new Set(ordered.map((item) => item.id)).size, 4);
});

test("stable id dedupe and reordering preserve exact object/status/media identity", () => {
  const storyboard = { url: "storyboard.jpg" };
  const first = Object.freeze(shot("1", 1, { status: "ok", storyboard }));
  const second = Object.freeze(shot("1", 2, { status: "omit", overheadImageUrl: "overhead.jpg" }));
  const duplicateSecond = { ...second };
  const input = Object.freeze([second, first, duplicateSecond]);
  const ordered = orderProgressShotsByShootingOrder(input, [sceneRow("1", 2, "1 2")]);

  assert.deepEqual(ordered.map((item) => item.id), [first.id, second.id]);
  assert.strictEqual(ordered[0], first);
  assert.strictEqual(ordered[1], second);
  assert.strictEqual(ordered[0].storyboard, storyboard);
  assert.equal(ordered[0].status, "ok");
  assert.equal(ordered[1].status, "omit");
  assert.equal(ordered[1].overheadImageUrl, "overhead.jpg");
  assert.deepEqual(input, [second, first, duplicateSecond]);
});

test("unmatched and manual cuts are retained in their original relative order", () => {
  const matched = shot("1", 2);
  const unmatchedScene = shot("A", "manual", { id: "manual-a" });
  const unselectedStale = shot("1", 4, { id: "stale-4" });
  const unmatchedSceneTwo = shot("B", "x", { id: "manual-b" });
  const input = [unmatchedScene, unselectedStale, matched, unmatchedSceneTwo];
  const ordered = orderProgressShotsByShootingOrder(
    input,
    [sceneRow("1", 4, "2", [2])]
  );

  assert.deepEqual(ordered.map((item) => item.id), [matched.id, "manual-a", "stale-4", "manual-b"]);
});

test("empty metadata naturally sorts cuts within the existing scene-group order", () => {
  const input = [
    shot("S2", 10),
    shot("1", 2),
    shot("scene 2", 1),
    shot("S#1", 1),
    shot("2", 2)
  ];
  const ordered = orderProgressShotsByShootingOrder(input, []);

  assert.deepEqual(ordered.map((item) => `${item.sceneNumber}:${item.cutNumber}`), [
    "scene 2:1",
    "2:2",
    "S2:10",
    "S#1:1",
    "1:2"
  ]);
});

test("unmatched metadata scenes use natural fallback without changing scene groups", () => {
  const input = [shot("3", 10), shot("3", 1), shot("4", 2), shot("4", 1)];
  const ordered = orderProgressShotsByShootingOrder(
    input,
    [sceneRow("99", 1, "1")]
  );

  assert.deepEqual(ordered.map((item) => `${item.sceneNumber}:${item.cutNumber}`), [
    "3:1",
    "3:10",
    "4:1",
    "4:2"
  ]);
});

test("totalCutsOverride is the canonical parser range when present", () => {
  const row = sceneRow("1", 2, "3 1 2");
  row.totalCutsOverride = 3;
  const input = [shot("1", 1), shot("1", 2), shot("1", 3)];

  assert.deepEqual(cutNumbers(orderProgressShotsByShootingOrder(input, [row])), [3, 1, 2]);
});

test("a zero totalCutsOverride cannot expand split membership", () => {
  const row = sceneRow("1", 3, "", [1, 2, 3]);
  row.totalCutsOverride = 0;
  const input = [shot("1", 3), shot("1", 1), shot("1", 2)];

  // No metadata allocation is allowed at total 0, so actual legacy shots remain
  // safely present through the unmatched natural fallback instead of being added
  // by the split row.
  assert.deepEqual(cutNumbers(orderProgressShotsByShootingOrder(input, [row])), [1, 2, 3]);
});

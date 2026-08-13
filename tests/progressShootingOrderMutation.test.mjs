import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, projectRoot).href, context);
    }
    return nextResolve(specifier, context);
  }
});

const { applyProgressOrderToTimetableScenes } = await import("../lib/progress/shootingOrderMutation.ts");

function sceneRow(sceneNumber, selectedCutNumbers) {
  return {
    version: 1,
    rowId: `row:${sceneNumber}:${selectedCutNumbers?.join("-") ?? "all"}`,
    sourceSceneId: `scene:${sceneNumber}`,
    sourceSnapshot: null,
    ...(selectedCutNumbers ? { selectedCutNumbers } : {}),
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
      shootingOrder: "1-2-3-4",
      notes: "",
      subject: "",
      props: "",
      costumeMakeup: "",
      sceneMemo: "",
      totalCuts: 4,
      cuts: []
    }
  };
}

function shot(id, sceneNumber, cutNumber) {
  return { id, sceneNumber, cutNumber: String(cutNumber) };
}

test("Progress reorder writes the exact stable-shot sequence into canonical row shootingOrder", () => {
  const rows = applyProgressOrderToTimetableScenes(
    [sceneRow("S1")],
    [shot("c1", "1", 1), shot("c3", "S#1", 3), shot("c2", "씬 1", 2)]
  );
  assert.equal(rows[0].rowSnapshot.shootingOrder, "1-3-2");
});

test("split rows consume only their selected cuts without duplicating stable shots", () => {
  const rows = applyProgressOrderToTimetableScenes(
    [sceneRow("1", [1, 3]), sceneRow("1", [2, 4])],
    [shot("c4", "1", 4), shot("c3", "1", 3), shot("c2", "1", 2), shot("c1", "1", 1)]
  );
  assert.deepEqual(rows.map((row) => row.rowSnapshot.shootingOrder), ["3-1", "4-2"]);
});

test("manual nonnumeric and unmatched shots never expand Daily Plan membership", () => {
  const source = sceneRow("1", [1, 3]);
  const [row] = applyProgressOrderToTimetableScenes(
    [source],
    [shot("manual", "1", "A"), shot("foreign", "2", 1), shot("c3", "1", 3)]
  );
  assert.equal(row.rowSnapshot.shootingOrder, "3");
  assert.equal(source.rowSnapshot.shootingOrder, "1-2-3-4");
});

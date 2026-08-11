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

const { parseSceneCutFromAssetName } = await import("../lib/archiveAssetMetadata.ts");

const basenameCases = [
  ["S1C1.jpg", "1", 1, "s_c"],
  ["S#1C#1.png", "1", 1, "s_c"],
  ["Scene1Cut1.webp", "1", 1, "scene_cut"],
  ["S1_C1.jpeg", "1", 1, "s_c"],
  ["S1-C1.pdf", "1", 1, "s_c"],
  ["S1(1).jpg", "1", 1, "s_parenthesized_cut"],
  ["씬1컷1.png", "1", 1, "korean_scene_cut"],
  ["Ｓ＃００１ａ-Ｃ＃００３.webp", "1A", 3, "s_c"]
];

for (const [filename, sceneNumber, cutNumber, pattern] of basenameCases) {
  test(`parses scene and cut metadata from ${filename}`, () => {
    assert.deepEqual(parseSceneCutFromAssetName(filename), {
      sceneNumber,
      cutNumber,
      matched: true,
      pattern,
      source: "basename"
    });
  });
}

test("parses adjacent S/C folders from a neutral basename", () => {
  assert.deepEqual(
    parseSceneCutFromAssetName("reference.jpg", "uploads/S1/C1/reference.jpg"),
    {
      sceneNumber: "1",
      cutNumber: 1,
      matched: true,
      pattern: "relative_path",
      source: "relative_path"
    }
  );
});

test("normalizes scene suffixes and leading zeros in backslash paths", () => {
  assert.deepEqual(
    parseSceneCutFromAssetName("reference.png", "refs\\S0007b\\C004\\reference.png"),
    {
      sceneNumber: "7B",
      cutNumber: 4,
      matched: true,
      pattern: "relative_path",
      source: "relative_path"
    }
  );
});

for (const filename of [
  "reference.jpg",
  "12-3.jpg",
  "S12-3.jpg",
  "S12.jpg",
  "C3.jpg",
  "S1C0.jpg"
]) {
  test(`rejects ambiguous or incomplete metadata in ${filename}`, () => {
    assert.equal(parseSceneCutFromAssetName(filename), null);
  });
}

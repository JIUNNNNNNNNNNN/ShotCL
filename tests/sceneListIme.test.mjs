import assert from "node:assert/strict";
import test from "node:test";

import { LatestAutosaveQueue } from "../lib/client/latestAutosaveQueue.ts";
import {
  getSceneListEditorKeyAction,
  resolveSceneListCompositionEnd
} from "../lib/sceneListIme.ts";

test("IME composing Enter defers editor exit", () => {
  assert.equal(getSceneListEditorKeyAction({
    key: "Enter",
    compositionActive: true,
    nativeIsComposing: true
  }), "defer-enter-exit");
});

test("Safari keyCode 229 defers Enter even when isComposing is false", () => {
  assert.equal(getSceneListEditorKeyAction({
    key: "Enter",
    nativeIsComposing: false,
    legacyKeyCode: 229
  }), "defer-enter-exit");
});

test("an Enter immediately after compositionend is still deferred", () => {
  assert.equal(getSceneListEditorKeyAction({
    key: "Enter",
    compositionJustEnded: true
  }), "defer-enter-exit");
});

test("normal Enter exits once while multiline Shift+Enter keeps its newline", () => {
  assert.equal(getSceneListEditorKeyAction({ key: "Enter" }), "exit");
  assert.equal(getSceneListEditorKeyAction({
    key: "Enter",
    multiline: true,
    shiftKey: true
  }), "allow");
});

test("IME Escape belongs to the IME and normal Escape exits editing", () => {
  assert.equal(getSceneListEditorKeyAction({
    key: "Escape",
    compositionActive: true
  }), "ime-only");
  assert.equal(getSceneListEditorKeyAction({ key: "Escape" }), "exit");
});

test("compositionend replaces with the exact completed value and never appends its last character", () => {
  for (const value of ["안방", "거실", "학교", "침실", "방", "집", "끝", "촬영", "거실이야"]) {
    assert.deepEqual(resolveSceneListCompositionEnd(value.slice(0, -1), value, true), {
      replacementValue: value,
      shouldExit: true
    });
    assert.deepEqual(resolveSceneListCompositionEnd(value, value, false), {
      replacementValue: null,
      shouldExit: false
    });
  }
});

test("both browser event orders keep one exact Korean value and one editor exit", () => {
  const completedValue = "안방";

  const keyDownBeforeCompositionEnd = getSceneListEditorKeyAction({
    key: "Enter",
    compositionActive: true,
    nativeIsComposing: true
  });
  assert.equal(keyDownBeforeCompositionEnd, "defer-enter-exit");
  assert.deepEqual(resolveSceneListCompositionEnd("안바", completedValue, true), {
    replacementValue: completedValue,
    shouldExit: true
  });

  assert.deepEqual(resolveSceneListCompositionEnd("안바", completedValue, false), {
    replacementValue: completedValue,
    shouldExit: false
  });
  assert.equal(getSceneListEditorKeyAction({
    key: "Enter",
    compositionJustEnded: true
  }), "defer-enter-exit");
});

test("consecutive cells retain independent completed values", () => {
  const values = ["안방", "거실", "복도"];
  const committed = values.map((value) => (
    resolveSceneListCompositionEnd(value.slice(0, -1), value, true).replacementValue
  ));
  assert.deepEqual(committed, values);
});

test("English, numeric, and pasted text use the same normal Enter exit", () => {
  for (const value of ["BEDROOM", "123", "안방"]) {
    assert.equal(getSceneListEditorKeyAction({ key: "Enter" }), "exit");
    assert.equal(resolveSceneListCompositionEnd(value, value, false).replacementValue, null);
  }
});

test("composition final value and blur flush collapse to one autosave mutation", async () => {
  const saved = [];
  const queue = new LatestAutosaveQueue({
    delayMs: 1,
    fingerprint: (value) => value,
    save: async (value) => {
      saved.push(value);
      return value;
    }
  });

  queue.schedule("안방");
  queue.schedule("안방");
  assert.equal(await queue.flush(), true);
  assert.deepEqual(saved, ["안방"]);
  queue.dispose({ flush: false });
});

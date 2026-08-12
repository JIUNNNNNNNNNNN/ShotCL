import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isProjectDeleteUndoShortcut,
  PROJECT_DELETE_UNDO_LIMIT,
  ProjectDeleteUndoController
} from "../lib/projectDeleteUndo.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function operation(overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      key: overrides.key ?? "scene:1",
      projectId: overrides.projectId ?? "project-1",
      label: overrides.label ?? "씬 1",
      removeLocal: () => calls.push("remove-local"),
      restoreLocal: () => calls.push("restore-local"),
      deleteRemote: async () => calls.push("delete-remote"),
      restoreRemote: async () => calls.push("restore-remote"),
      finalize: async () => calls.push("finalize"),
      ...overrides
    }
  };
}

test("delete is optimistic and pending delete undo restores locally before the one remote restore", async () => {
  const pendingDelete = deferred();
  const calls = [];
  const controller = new ProjectDeleteUndoController("project-1");
  controller.execute({
    key: "shot:1",
    projectId: "project-1",
    label: "컷 1",
    removeLocal: () => calls.push("remove-local"),
    restoreLocal: () => calls.push("restore-local"),
    deleteRemote: async () => {
      calls.push("delete-start");
      await pendingDelete.promise;
      calls.push("delete-end");
    },
    restoreRemote: async () => calls.push("restore-remote")
  });

  assert.deepEqual(calls, ["remove-local", "delete-start"]);
  assert.equal(controller.undo(), true);
  assert.deepEqual(calls, ["remove-local", "delete-start", "restore-local"]);
  pendingDelete.resolve();
  await flush();
  assert.deepEqual(calls, ["remove-local", "delete-start", "restore-local", "delete-end", "restore-remote"]);
});

test("only three deletions remain undoable and the oldest storage cleanup waits for delete", async () => {
  const controller = new ProjectDeleteUndoController("project-1");
  const oldestDelete = deferred();
  const oldest = operation({
    key: "asset:1",
    deleteRemote: () => oldestDelete.promise
  });
  controller.execute(oldest.value);
  for (let index = 2; index <= PROJECT_DELETE_UNDO_LIMIT + 1; index += 1) {
    controller.execute(operation({ key: `asset:${index}` }).value);
  }
  assert.equal(controller.size, PROJECT_DELETE_UNDO_LIMIT);
  assert.deepEqual(oldest.calls, ["remove-local"]);
  oldestDelete.resolve();
  await flush();
  assert.deepEqual(oldest.calls, ["remove-local", "finalize"]);
});

test("a fourth delete evicts A and leaves D, C, B as the three undo actions", async () => {
  const restored = [];
  const finalized = [];
  const controller = new ProjectDeleteUndoController("project-1");
  for (const id of ["A", "B", "C", "D"]) {
    controller.execute({
      ...operation({ key: `entity:${id}` }).value,
      restoreLocal: () => restored.push(id),
      finalize: async () => finalized.push(id)
    });
  }
  await flush();
  assert.deepEqual(finalized, ["A"]);
  controller.undo();
  controller.undo();
  controller.undo();
  assert.equal(controller.undo(), false);
  assert.deepEqual(restored, ["D", "C", "B"]);
});

test("three retained deletes undo in strict LIFO order", async () => {
  const restored = [];
  const controller = new ProjectDeleteUndoController("project-1");
  for (let index = 1; index <= 3; index += 1) {
    controller.execute({
      ...operation({ key: `row:${index}` }).value,
      restoreLocal: () => restored.push(`local:${index}`),
      restoreRemote: async () => restored.push(`remote:${index}`)
    });
  }
  await flush();
  assert.equal(controller.undo(), true);
  assert.equal(controller.undo(), true);
  assert.equal(controller.undo(), true);
  await flush();
  assert.deepEqual(restored, ["local:3", "local:2", "local:1", "remote:3", "remote:2", "remote:1"]);
  assert.equal(controller.undo(), false);
});

test("disposing a project finalizes every retained storage operation and rejects later undo", async () => {
  const calls = [];
  const controller = new ProjectDeleteUndoController("project-1");
  controller.execute({
    ...operation({ key: "photo:1" }).value,
    finalize: async () => calls.push("finalize:1")
  });
  controller.execute({
    ...operation({ key: "photo:2" }).value,
    finalize: async () => calls.push("finalize:2")
  });
  await flush();
  controller.dispose();
  await flush();
  assert.deepEqual(calls, ["finalize:1", "finalize:2"]);
  assert.equal(controller.undo(), false);
});

test("delete failure restores the item and removes that operation from history", async () => {
  const calls = [];
  const controller = new ProjectDeleteUndoController("project-1");
  controller.execute({
    key: "staff:1",
    projectId: "project-1",
    label: "스탭",
    removeLocal: () => calls.push("remove-local"),
    restoreLocal: () => calls.push("restore-local"),
    deleteRemote: async () => { throw new Error("offline"); },
    restoreRemote: async () => calls.push("restore-remote")
  });
  await flush();
  assert.deepEqual(calls, ["remove-local", "restore-local"]);
  assert.equal(controller.size, 0);
  assert.equal(controller.undo(), false);
});

test("restore failure reconciles the optimistic restore back to server-deleted state", async () => {
  const calls = [];
  const controller = new ProjectDeleteUndoController("project-1");
  controller.execute({
    key: "event:1",
    projectId: "project-1",
    label: "일정",
    removeLocal: () => calls.push("remove-local"),
    restoreLocal: () => calls.push("restore-local"),
    deleteRemote: async () => undefined,
    restoreRemote: async () => { throw new Error("conflict"); }
  });
  await flush();
  controller.undo();
  await flush();
  assert.deepEqual(calls, ["remove-local", "restore-local", "remove-local"]);
});

test("shortcut accepts Command/Ctrl Z but not editors' variants or repeated keys", () => {
  const base = {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    key: "z",
    metaKey: true,
    repeat: false,
    shiftKey: false
  };
  assert.equal(isProjectDeleteUndoShortcut(base), true);
  assert.equal(isProjectDeleteUndoShortcut({ ...base, metaKey: false, ctrlKey: true }), true);
  assert.equal(isProjectDeleteUndoShortcut({ ...base, shiftKey: true }), false);
  assert.equal(isProjectDeleteUndoShortcut({ ...base, isComposing: true }), false);
  assert.equal(isProjectDeleteUndoShortcut({ ...base, defaultPrevented: true }), false);
  assert.equal(isProjectDeleteUndoShortcut({ ...base, repeat: true }), false);
  assert.equal(isProjectDeleteUndoShortcut({ ...base, key: "y" }), false);
});

test("the project listener yields to an active local-editor undo scope", async () => {
  const providerSource = await readFile(
    new URL("../components/ProjectDeleteUndoProvider.tsx", import.meta.url),
    "utf8"
  );
  assert.match(
    providerSource,
    /querySelector\('\[data-local-undo-scope="active"\]'\)[\s\S]*?return;[\s\S]*?undoLastDelete\(\)/u
  );
  assert.equal((providerSource.match(/window\.addEventListener\("keydown"/gu) ?? []).length, 1);
  assert.equal((providerSource.match(/window\.removeEventListener\("keydown"/gu) ?? []).length, 1);
  assert.doesNotMatch(providerSource, /useState\s*\(/u);
});

test("the shared target guard preserves native text, select, combobox, and contenteditable undo", async () => {
  const source = await readFile(new URL("../lib/projectDeleteUndo.ts", import.meta.url), "utf8");
  for (const selector of [
    '"input"',
    '"textarea"',
    '"select"',
    '"[contenteditable]"',
    `'[role="textbox"]'`,
    `'[role="combobox"]'`,
    '"[data-local-undo-scope]"'
  ]) {
    assert.match(source, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
});

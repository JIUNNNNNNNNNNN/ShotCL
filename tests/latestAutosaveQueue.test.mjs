import assert from "node:assert/strict";
import test from "node:test";
import { LatestAutosaveQueue } from "../lib/client/latestAutosaveQueue.ts";
import {
  canRestoreAutosaveDraft,
  clearAutosaveDraftsForProject,
  createAutosaveDraftWriterId,
  discardAutosaveDraft,
  getAutosaveDraft,
  rememberAutosaveDraft,
  settleAutosaveDraft
} from "../lib/client/autosaveDraftCache.ts";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("rapid edits collapse into one trailing save", async () => {
  const saved = [];
  const queue = new LatestAutosaveQueue({
    delayMs: 10,
    initialFingerprint: "0",
    fingerprint: String,
    save: async (value) => { saved.push(value); }
  });
  queue.schedule(1);
  queue.schedule(2);
  queue.schedule(3);
  await wait(25);
  assert.deepEqual(saved, [3]);
});

test("an edit during a request is serialized and latest value wins", async () => {
  const saved = [];
  let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const queue = new LatestAutosaveQueue({
    delayMs: 1,
    initialFingerprint: "0",
    fingerprint: String,
    save: async (value) => {
      saved.push(value);
      if (value === 1) await first;
    }
  });
  queue.schedule(1);
  await wait(5);
  queue.schedule(2);
  queue.schedule(3);
  releaseFirst();
  await queue.flush();
  assert.deepEqual(saved, [1, 3]);
});

test("flush saves immediately and retry keeps the latest failed draft", async () => {
  const saved = [];
  let shouldFail = true;
  const queue = new LatestAutosaveQueue({
    delayMs: 10_000,
    initialFingerprint: "0",
    fingerprint: String,
    save: async (value) => {
      if (shouldFail) throw new Error("offline");
      saved.push(value);
    }
  });
  queue.schedule(4);
  assert.equal(await queue.flush(), false);
  assert.equal(queue.getStatus(), "error");
  shouldFail = false;
  queue.retry();
  await queue.flush();
  assert.deepEqual(saved, [4]);
  assert.equal(queue.getStatus(), "saved");
});

test("saveNow bypasses debounce but remains in the same latest-wins queue", async () => {
  const saved = [];
  const queue = new LatestAutosaveQueue({
    delayMs: 10_000,
    initialFingerprint: "0",
    fingerprint: String,
    save: async (value) => { saved.push(value); }
  });

  assert.equal(await queue.saveNow(7), true);
  assert.deepEqual(saved, [7]);
  assert.equal(queue.getStatus(), "saved");
});

test("pause prevents a scheduled write until resume", async () => {
  const saved = [];
  const queue = new LatestAutosaveQueue({
    delayMs: 5,
    initialFingerprint: "0",
    fingerprint: String,
    save: async (value) => { saved.push(value); }
  });
  queue.schedule(9);
  queue.pause();
  await wait(12);
  assert.deepEqual(saved, []);
  queue.resume();
  await wait(12);
  assert.deepEqual(saved, [9]);
});

test("dispose flushes the latest draft without waiting for the debounce timer", async () => {
  const saved = [];
  const queue = new LatestAutosaveQueue({
    delayMs: 10_000,
    initialFingerprint: "0",
    fingerprint: String,
    save: async (value) => { saved.push(value); }
  });
  queue.schedule(10);
  queue.dispose();
  await wait(5);
  assert.deepEqual(saved, [10]);
});

test("a value that is already saved does not create a duplicate mutation", async () => {
  const saved = [];
  const queue = new LatestAutosaveQueue({
    delayMs: 1,
    initialFingerprint: "0",
    fingerprint: String,
    save: async (value) => { saved.push(value); }
  });
  queue.schedule(11);
  await queue.flush();
  queue.schedule(11);
  await wait(5);
  assert.deepEqual(saved, [11]);
});

test("markSaved during an older request never discards a newer pending draft", async () => {
  const saved = [];
  let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const queue = new LatestAutosaveQueue({
    delayMs: 1,
    initialFingerprint: "0",
    fingerprint: String,
    save: async (value) => {
      saved.push(value);
      if (value === 1) await first;
    }
  });

  queue.schedule(1);
  await wait(5);
  queue.schedule(2);
  // Simulates a canonical echo for the in-flight value while value 2 is still
  // only pending locally.
  queue.markSaved(1);
  releaseFirst();
  await queue.flush();

  assert.deepEqual(saved, [1, 2]);
  assert.equal(queue.getStatus(), "saved");
});

test("markSaved with an older external value keeps a newer queued draft", async () => {
  const saved = [];
  const queue = new LatestAutosaveQueue({
    delayMs: 10_000,
    initialFingerprint: "0",
    fingerprint: String,
    save: async (value) => { saved.push(value); }
  });

  queue.schedule(2);
  queue.markSaved(1);
  await queue.flush();

  assert.deepEqual(saved, [2]);
  assert.equal(queue.getStatus(), "saved");
});

test("a navigation draft restores only over the exact saved baseline", () => {
  const key = "restore-compatible";
  const writerId = createAutosaveDraftWriterId();
  rememberAutosaveDraft(key, "local edit", "local edit", "server v1", "server v1", writerId);

  const draft = getAutosaveDraft(key);
  assert.ok(draft);
  assert.equal(canRestoreAutosaveDraft(draft, "server v1"), true);
  assert.equal(canRestoreAutosaveDraft(draft, "newer local or server value"), false);

  discardAutosaveDraft(key, writerId);
});

test("an older route writer cannot overwrite or settle a newer draft cache", () => {
  const key = "writer-generation";
  const oldWriter = createAutosaveDraftWriterId();
  const newWriter = createAutosaveDraftWriterId();

  rememberAutosaveDraft(key, "old draft", "old draft", "base", "base", oldWriter);
  rememberAutosaveDraft(key, "new draft", "new draft", "base", "base", newWriter);
  rememberAutosaveDraft(key, "late old render", "late old render", "base", "base", oldWriter);
  settleAutosaveDraft(key, "old draft", "old draft", oldWriter);

  assert.deepEqual(getAutosaveDraft(key), {
    value: "new draft",
    fingerprint: "new draft",
    savedFingerprint: "base",
    savedValue: "base",
    writerId: newWriter
  });

  settleAutosaveDraft(key, "new draft", "new draft", newWriter);
  assert.equal(getAutosaveDraft(key), null);
});

test("saving an older snapshot rebases but preserves a newer same-writer draft", () => {
  const key = "same-writer-rebase";
  const writerId = createAutosaveDraftWriterId();
  rememberAutosaveDraft(key, "draft 2", "draft 2", "base", "base", writerId);
  settleAutosaveDraft(key, "draft 1", "draft 1", writerId);

  assert.deepEqual(getAutosaveDraft(key), {
    value: "draft 2",
    fingerprint: "draft 2",
    savedFingerprint: "draft 1",
    savedValue: "draft 1",
    writerId
  });
});

test("project deletion clears only autosave drafts carrying that project id", () => {
  const deletedProjectId = "11111111-1111-4111-8111-111111111111";
  const otherProjectId = "22222222-2222-4222-8222-222222222222";
  const deletedKey = `shot:${deletedProjectId}:shot-a`;
  const otherKey = `shot:${otherProjectId}:shot-b`;
  const deletedWriter = createAutosaveDraftWriterId();
  const otherWriter = createAutosaveDraftWriterId();
  rememberAutosaveDraft(deletedKey, "deleted draft", "deleted draft", "base", "base", deletedWriter);
  rememberAutosaveDraft(otherKey, "other draft", "other draft", "base", "base", otherWriter);

  clearAutosaveDraftsForProject(deletedProjectId);

  assert.equal(getAutosaveDraft(deletedKey), null);
  assert.equal(getAutosaveDraft(otherKey)?.value, "other draft");
  discardAutosaveDraft(otherKey, otherWriter);
});

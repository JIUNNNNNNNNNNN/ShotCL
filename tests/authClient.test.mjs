import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleOAuthCallbackUrl,
  getAccountSessionSyncKey,
  getProjectIdFromInternalPath,
  getSafeInternalPath,
  syncAccountSession
} from "../lib/auth/client.ts";

test("OAuth next accepts only internal absolute paths", () => {
  assert.equal(getSafeInternalPath("/projects/abc?tab=1#top"), "/projects/abc?tab=1#top");
  assert.equal(getSafeInternalPath(" https://evil.example/path "), "/");
  assert.equal(getSafeInternalPath("//evil.example/path"), "/");
  assert.equal(getSafeInternalPath("/\\evil.example/path"), "/");
  assert.equal(getSafeInternalPath("projects/abc"), "/");
  assert.equal(getSafeInternalPath("/auth/callback?next=/again"), "/");
  assert.equal(getSafeInternalPath("/auth/callback/?next=/again"), "/");
});

test("OAuth callback URL keeps the current origin and encoded safe next path", () => {
  const callback = new URL(buildGoogleOAuthCallbackUrl(
    "https://shotcl.example/ignored/path",
    "/projects/abc?tab=progress"
  ));
  assert.equal(callback.origin, "https://shotcl.example");
  assert.equal(callback.pathname, "/auth/callback");
  assert.equal(callback.searchParams.get("next"), "/projects/abc?tab=progress");
});

test("OAuth project membership hint accepts only an internal canonical project UUID", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    getProjectIdFromInternalPath(`/projects/${projectId}/scene-list?tab=1`),
    projectId
  );
  assert.equal(getProjectIdFromInternalPath("/projects/not-a-uuid"), null);
  assert.equal(getProjectIdFromInternalPath("https://evil.example/projects/11111111-1111-4111-8111-111111111111"), null);
  assert.equal(getProjectIdFromInternalPath("/auth/callback?next=/projects/11111111-1111-4111-8111-111111111111"), null);
});

test("account sync dedupe key includes the current project hint", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    getAccountSessionSyncKey(" token ", projectId.toUpperCase()),
    `token\u0000${projectId}\u0000`
  );
  assert.notEqual(
    getAccountSessionSyncKey("token", projectId),
    getAccountSessionSyncKey("token", null)
  );
  assert.notEqual(
    getAccountSessionSyncKey("token", projectId, `/projects/${projectId}?view=progress`),
    getAccountSessionSyncKey("token", projectId, `/projects/${projectId}?view=progress&dailyPlanId=11111111-1111-4111-8111-111111111112`)
  );
});

test("account sync sends the validated current project and exact internal return path", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const returnTo = `/projects/${projectId}?view=progress&dailyPlanId=22222222-2222-4222-8222-222222222222`;
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return new Response(JSON.stringify({
      editorEligible: true,
      destination: null,
      creatorClaimedProjectId: projectId
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const result = await syncAccountSession("token", projectId, returnTo);
    assert.deepEqual(result, {
      editorEligible: true,
      destination: null,
      creatorClaimedProjectId: projectId
    });
    assert.equal(captured.input, "/api/auth/session");
    assert.deepEqual(JSON.parse(captured.init.body), { action: "sync", projectId, returnTo });
    assert.equal(captured.init.headers.Authorization, "Bearer token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("account sync accepts only an exact canonical creator-claim project UUID", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    "11111111-1111-4111-8111-111111111111".toUpperCase(),
    "project_11111111-1111-4111-8111-111111111111",
    "not-a-project-id",
    null
  ];
  try {
    const results = [];
    for (const creatorClaimedProjectId of responses) {
      globalThis.fetch = async () => new Response(JSON.stringify({
        editorEligible: true,
        destination: null,
        creatorClaimedProjectId
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
      results.push((await syncAccountSession("token")).creatorClaimedProjectId);
    }
    assert.deepEqual(results, [
      "11111111-1111-4111-8111-111111111111",
      null,
      null,
      null
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

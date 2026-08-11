import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleOAuthCallbackUrl,
  getSafeInternalPath
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

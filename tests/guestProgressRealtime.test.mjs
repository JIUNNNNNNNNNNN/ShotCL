import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hasGuestModeHint,
  PROJECT_GUEST_MODE_COOKIE
} from "../lib/auth/guestMode.ts";
import { isGuestProjectApiRequestAllowed } from "../lib/projectAccess/guestApiAccess.ts";
import { parseProgressStreamEvent } from "../lib/realtime/progressEvents.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const dailyPlanId = "22222222-2222-4222-8222-222222222222";
const readSource = (pathname) => readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");

test("the readable Guest cookie is an exact non-authoritative bootstrap hint", () => {
  assert.equal(PROJECT_GUEST_MODE_COOKIE, "shotcl_guest_mode");
  assert.equal(hasGuestModeHint("a=1; shotcl_guest_mode=1; b=2"), true);
  assert.equal(hasGuestModeHint("shotcl_guest_mode=0"), false);
  assert.equal(hasGuestModeHint("other_shotcl_guest_mode=1"), false);

  const authSource = readSource("components/AuthSessionProvider.tsx");
  assert.match(authSource, /const guestProjectRoute = \/\^\\\/projects[\s\S]*if \(guestProjectRoute && hasGuestModeHint\(document\.cookie\)\)[\s\S]*setStatus\("anonymous"\)/u);
  assert.match(authSource, /if \(!guestProjectRoute && hasGuestModeHint\(document\.cookie\)\)[\s\S]*clearBrowserGuestModeHint\(\)/u);
  assert.match(authSource, /\}, \[applySession, guestProjectRoute\]\);/u);
  assert.match(authSource, /await import\("@\/lib\/supabase\/client"\)/u);
  assert.doesNotMatch(authSource, /import \{ getSupabaseBrowserClient \} from/u);
  assert.match(authSource, /const startGoogleOAuth[\s\S]*clearBrowserGuestModeHint\(\)/u);
  assert.match(authSource, /const refreshAccount[\s\S]*clearBrowserGuestModeHint\(\)/u);
});

test("Guest allowlist exposes only scoped GET progress streams", () => {
  const allowed = isGuestProjectApiRequestAllowed({
    method: "GET",
    pathname: `/api/projects/${projectId}/progress-events`,
    projectId,
    searchParams: new URLSearchParams({ dailyPlanId })
  });
  assert.equal(allowed, true);
  assert.equal(isGuestProjectApiRequestAllowed({
    method: "GET",
    pathname: `/api/projects/${projectId}/progress-events`,
    projectId,
    searchParams: new URLSearchParams()
  }), false);
  assert.equal(isGuestProjectApiRequestAllowed({
    method: "POST",
    pathname: `/api/projects/${projectId}/progress-events`,
    projectId,
    searchParams: new URLSearchParams({ dailyPlanId })
  }), false);
  assert.equal(isGuestProjectApiRequestAllowed({
    method: "GET",
    pathname: `/api/projects/${projectId}/progress-events`,
    projectId,
    searchParams: new URLSearchParams({ dailyPlanId, extra: "1" })
  }), false);
});

test("Progress stream event parser rejects malformed payloads", () => {
  assert.deepEqual(parseProgressStreamEvent({
    type: "shot",
    eventType: "INSERT",
    newRow: { id: "shot-1" },
    oldRow: {}
  }), {
    type: "shot",
    eventType: "INSERT",
    newRow: { id: "shot-1" },
    oldRow: {}
  });
  assert.deepEqual(parseProgressStreamEvent({
    type: "snapshot",
    shots: [{ id: "shot-1" }],
    dailyPlan: { id: dailyPlanId }
  }), {
    type: "snapshot",
    shots: [{ id: "shot-1" }],
    dailyPlan: { id: dailyPlanId }
  });
  assert.equal(parseProgressStreamEvent({ type: "shot", eventType: "UPSERT" }), null);
  assert.equal(parseProgressStreamEvent({ type: "snapshot", shots: [null] }), null);
});

test("secured SSE validates every connection, subscribes before snapshot, and cleans up", () => {
  const route = readSource("app/api/projects/[projectId]/progress-events/route.ts");
  const accessIndex = route.indexOf("await getProjectRequestAccess(request, projectId)");
  const streamIndex = route.indexOf("new ReadableStream");
  const subscribeIndex = route.indexOf("await waitForSubscription(");
  const snapshotIndex = route.indexOf("const [shotsResult, planResult] = await Promise.all");
  assert.ok(accessIndex >= 0 && accessIndex < streamIndex);
  assert.ok(subscribeIndex >= 0 && subscribeIndex < snapshotIndex);
  assert.match(route, /access\.mode !== "guest"/u);
  assert.match(route, /\.eq\("project_id", projectId\)[\s\S]*\.eq\("daily_plan_id", dailyPlanId\)/u);
  assert.equal((route.match(/\.channel\(/gu) ?? []).length, 1);
  assert.match(route, /table: "shots"/u);
  assert.match(route, /table: "daily_plans"/u);
  assert.match(route, /bufferedEvents\.push\(event\)/u);
  assert.match(route, /replayEvents\.forEach\(enqueueEvent\)/u);
  assert.match(route, /STREAM_MAX_AGE_MS/u);
  assert.match(route, /removeChannel\(activeChannel\)/u);
  assert.match(route, /"Cache-Control": "private, no-cache, no-store, no-transform"/u);
  assert.match(route, /sanitizeShotRow\(recordValue\(payload\.new\)\)/u);
  assert.match(route, /sanitizeDailyPlanRow\(recordValue\(payload\.new\)\)/u);
  const shotColumns = route.match(/const SHOT_COLUMNS = "([^"]+)"/u)?.[1] ?? "";
  assert.doesNotMatch(shotColumns, /storyboard_image_url|public_url|storage_path/u);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey|rawToken/u);
});

test("Guest and member each own one selected-round connection and structural events merge locally", () => {
  const page = readSource("app/projects/[id]/page.tsx");
  const guestSubscriber = readSource("lib/realtime/subscribeToGuestProgress.ts");
  const memberSubscriber = readSource("lib/realtime/subscribeToProgressChanges.ts");
  assert.equal((guestSubscriber.match(/new EventSource\(/gu) ?? []).length, 1);
  assert.match(page, /if \(!isGuest \|\| !isProgressView[\s\S]*subscribeToGuestProgress/u);
  assert.match(page, /change\.eventType === "DELETE"[\s\S]*nextById\.delete\(deletedId\)/u);
  assert.match(page, /nextById\.set\(remote\.id/u);
  assert.match(page, /if \(isGuest \|\| !projectId[\s\S]*import\("@\/lib\/realtime\/subscribeToProgressChanges"\)/u);
  assert.doesNotMatch(page, /import \{ subscribeToProgressChanges \} from/u);
  assert.equal((memberSubscriber.match(/\.channel\(/gu) ?? []).length, 1);
  assert.match(memberSubscriber, /queueMicrotask\(flushShotChanges\)/u);
  assert.doesNotMatch(memberSubscriber, /setTimeout|\b80\b/u);
});

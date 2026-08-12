import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const landing = readSource("../app/invite/[token]/route.ts");
const redemption = readSource("../app/api/project-invites/[token]/route.ts");
const targetResolver = readSource("../lib/progress/resolveInviteProgressTarget.server.ts");
const accessServer = readSource("../lib/projectAccess/server.ts");
const guestMode = readSource("../lib/auth/guestMode.ts");
const inviteServer = readSource("../lib/projectStaffInvites.server.ts");

test("logged-out invite landing validates once and redirects directly to a canonical Progress round", () => {
  assert.equal(landing.match(/inspectProjectStaffInvite\(token\)/gu)?.length, 1);
  assert.match(landing, /if \(request\.cookies\.get\(SHOTCL_ACCOUNT_COOKIE\)\?\.value\)[\s\S]*accountRedemptionBridge/u);
  assert.match(landing, /resolveInviteProgressTarget\(invite\.projectId\)/u);
  assert.match(landing, /buildProgressRoundHref\(invite\.projectId, target\.dailyPlanId\)/u);
  assert.match(landing, /NextResponse\.redirect\(new URL\(destination, request\.url\), 307\)/u);
  assert.match(landing, /setProjectGuestInviteCookie\(response, token\)/u);
  assert.doesNotMatch(landing, /setProjectGuestModeCookie\(response\)/u);
  assert.match(accessServer, /setProjectGuestInviteCookie[\s\S]*setProjectGuestModeCookie\(response\)/u);
  assert.doesNotMatch(landing, /\buseEffect\b|\buseRouter\b|router\.(?:push|replace)/u);
  assert.equal(existsSync(new URL("../app/invite/[token]/page.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../components/project-invites/ProjectInviteRedeemer.tsx", import.meta.url)), false);
});

test("visit-time target resolution is two batched lightweight reads with the canonical resolver", () => {
  assert.match(targetResolver, /Promise\.all\(\[/u);
  assert.match(targetResolver, /\.from\("daily_plans"\)[\s\S]*\.select\("id,shooting_date,episode"\)/u);
  assert.match(targetResolver, /\.from\("shots"\)[\s\S]*\.select\("id,daily_plan_id,status"\)/u);
  assert.match(targetResolver, /calculateDailyProgressByPlan/u);
  assert.match(targetResolver, /getKoreaDateOnly\(\)/u);
  assert.match(targetResolver, /resolveRelevantProgressRound/u);
  assert.doesNotMatch(targetResolver, /\.from\("(?:daily_plan_shots|project_reference_assets|shot_diagrams)"\)|\.storage\b/u);
});

test("account cookies retain same-origin POST membership linking instead of mutating on GET", () => {
  assert.doesNotMatch(landing, /linkShotclAccountProjectMembership/u);
  assert.match(landing, /fetch\('\/api\/project-invites\/'\+encodeURIComponent\(segment\),\{method:'POST'/u);
  assert.match(redemption, /isSameOriginJoinRequest\(request\)/u);
  assert.match(redemption, /linkShotclAccountProjectMembership\(account\.userId, invite\.projectId\)/u);
  assert.match(redemption, /resolveInviteProgressTarget\(invite\.projectId\)/u);
});

test("invite responses and the short-lived target hint remain private and non-authoritative", () => {
  assert.match(landing, /Cache-Control", "private, no-store, max-age=0"/u);
  assert.match(landing, /Referrer-Policy", "no-referrer"/u);
  assert.match(landing, /X-Robots-Tag", "noindex, nofollow, noarchive"/u);
  assert.match(landing, /frame-ancestors 'none'/u);
  assert.match(landing, /script-src 'nonce-\$\{scriptNonce\}'/u);
  assert.doesNotMatch(landing, /script-src 'unsafe-inline'/u);
  assert.match(accessServer, /PROJECT_GUEST_PROGRESS_TARGET_COOKIE = "shotcl_guest_progress_target"/u);
  assert.match(guestMode, /PROJECT_GUEST_MODE_COOKIE = "shotcl_guest_mode"/u);
  assert.match(accessServer, /export \{ PROJECT_GUEST_MODE_COOKIE \} from "@\/lib\/auth\/guestMode"/u);
  assert.match(accessServer, /setProjectGuestModeCookie[\s\S]*httpOnly: false/u);
  assert.match(accessServer, /GUEST_PROGRESS_TARGET_MAX_AGE_SECONDS = 60 \* 5/u);
  assert.match(accessServer, /httpOnly: true[\s\S]*sameSite: "lax"[\s\S]*maxAge: GUEST_PROGRESS_TARGET_MAX_AGE_SECONDS/u);
  assert.match(accessServer, /Selected-round SSR hint only[\s\S]*never grants access/u);
});

test("one invite join also carries the validated project snapshot for layout reuse", () => {
  assert.match(inviteServer, /projects!inner\(id,name,shoot_date,description,created_at,share_enabled\)/u);
  assert.match(inviteServer, /project:\s*\{[\s\S]*shoot_date:[\s\S]*description:[\s\S]*created_at:[\s\S]*share_enabled: true/u);
  assert.match(accessServer, /mode: "guest"[\s\S]*project: invite\.project[\s\S]*grant:/u);
});

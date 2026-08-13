import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (pathname) => readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
const detailPage = readSource("app/projects/[id]/daily-plans/[dailyPlanId]/page.tsx");
const listPage = readSource("app/projects/[id]/daily-plans/page.tsx");
const readClient = readSource("lib/data/dailyPlanRead.ts");
const projectLayout = readSource("app/projects/[id]/layout.tsx");

function functionSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} source boundary must exist`);
  return source.slice(start, end);
}

test("Guest detail mounts only the canonical read document and one fail-closed API read", () => {
  const guest = functionSlice(detailPage, "function GuestDailyPlanDetail", "/** 기존 인증 사용자용 editor 경로");
  assert.match(detailPage, /return isGuest \? \([\s\S]*<GuestDailyPlanDetail[\s\S]*<EditableDailyPlanDetail/u);
  assert.match(guest, /getDailyPlanWithShotsFromApi\(projectId, dailyPlanId/u);
  assert.match(guest, /<DailyPlanReadOnlyView[\s\S]*plan=\{result\.dailyPlan\.plan\}[\s\S]*shots=\{result\.dailyPlan\.shots\}/u);
  assert.match(guest, /requestKey: ""[\s\S]*result\.requestKey !== requestKey/u);
  assert.match(guest, /AbortController[\s\S]*return \(\) => abortController\.abort\(\)/u);
  assert.doesNotMatch(guest, /DailyPlanEditor|getProjectBasicInfo|listProjectStaffMembers|getProjectSceneList|useAutosave|router\.refresh|subscribe/u);

  assert.match(readClient, /cache: "no-store"[\s\S]*credentials: "same-origin"/u);
  assert.doesNotMatch(readClient, /supabase|localStore|getSupabaseBrowserClient|readLocalBuckets/u);
});

test("authenticated detail keeps the existing editor and supporting batched reads", () => {
  const member = functionSlice(detailPage, "function EditableDailyPlanDetail", "\n}");
  assert.match(member, /import\("@\/components\/DailyPlanEditor"\)/u);
  assert.match(member, /Promise\.all\(\[[\s\S]*getDailyPlanWithShots[\s\S]*getProjectBasicInfo[\s\S]*listProjectStaffMembers[\s\S]*getProjectSceneList/u);
  assert.match(member, /<DailyPlanEditor/u);
});

test("Guest list never exposes creation UI and empty rounds remain truthful", () => {
  assert.match(listPage, /const \{ isGuest \} = useProjectAccess\(\)/u);
  assert.match(listPage, /initialProgress\?\.dailyPlanId[\s\S]*resolveRelevantProgressRound/u);
  assert.match(listPage, /isGuest\s*\? guestTargetDailyPlanId[\s\S]*buildDailyPlanRoundHref/u);
  assert.match(listPage, /등록된 일촬표가 없습니다\./u);
  assert.match(listPage, /!isGuest \? \([\s\S]*buildNewDailyPlanHref/u);
});

test("every Guest workspace stays summary-only while the Progress seed remains scoped", () => {
  assert.match(projectLayout, /access\.mode === "guest",[\s\S]*progressTarget\?\.projectId === projectId/u);
  assert.match(projectLayout, /const planListQuery = isGuestWorkspace[\s\S]*DAILY_PLAN_SUMMARY_COLUMNS[\s\S]*DAILY_PLAN_LIST_COLUMNS/u);
  assert.match(projectLayout, /isGuestWorkspace\s*\? Promise\.resolve\(\{ data: null, error: null \}\)[\s\S]*from\("project_basic_info"\)/u);
  assert.match(projectLayout, /isGuestWorkspace\s*\? Promise\.resolve\(\{ data: \[\], error: null \}\)[\s\S]*from\("daily_plan_shots"\)/u);
  assert.match(projectLayout, /hasGuestProgressSeed[\s\S]*\.eq\("id", guestProgressDailyPlanId!\)/u);
  assert.doesNotMatch(projectLayout, /DAILY_PLAN_SUMMARY_COLUMNS[^\n]*memo|DAILY_PLAN_SUMMARY_COLUMNS[^\n]*shooting_locations|DAILY_PLAN_SUMMARY_COLUMNS[^\n]*meal_times/u);
});

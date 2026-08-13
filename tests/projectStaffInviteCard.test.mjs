import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cardSource = readFileSync(
  new URL("../components/project-invites/ProjectStaffInviteCard.tsx", import.meta.url),
  "utf8"
);
const calendarSource = readFileSync(
  new URL("../components/ProjectShootingCalendar.tsx", import.meta.url),
  "utf8"
);
const homeSource = readFileSync(
  new URL("../components/ProjectGuideMenu.tsx", import.meta.url),
  "utf8"
);
const guideSource = readFileSync(
  new URL("../lib/contextualGuides.ts", import.meta.url),
  "utf8"
);
const inviteServerSource = readFileSync(
  new URL("../lib/projectStaffInvites.server.ts", import.meta.url),
  "utf8"
);

test("one primary Kakao action ensures only when no reusable invite exists", () => {
  const shareStart = cardSource.indexOf("async function shareInviteToKakao");
  const copyStart = cardSource.indexOf("async function copyActiveInviteMessage", shareStart);
  const shareSource = cardSource.slice(shareStart, copyStart);
  assert.ok(shareStart > 0 && copyStart > shareStart);
  assert.match(shareSource, /activeState\.status === "inactive" \|\| activeState\.status === "error"/u);
  assert.match(shareSource, /runAction\("ensure"\)/u);
  assert.equal(shareSource.match(/runAction\("ensure"\)/gu)?.length, 1);
  assert.match(shareSource, /activeState\.status !== "active"/u);
  assert.match(shareSource, /copyActiveInviteMessage\(activeState\.inviteUrl\)/u);
  assert.ok(shareSource.indexOf('runAction("ensure")') < shareSource.indexOf("copyActiveInviteMessage(activeState.inviteUrl)"));
  assert.match(cardSource, /"카카오톡 공유하기"/u);
  assert.doesNotMatch(cardSource, /카카오톡으로 복사/u);
});

test("Kakao sharing retains the canonical message clipboard flow", () => {
  assert.match(cardSource, /copyText\(buildKakaoInviteMessage\(projectName, inviteUrl\)\)/u);
  assert.match(cardSource, /초대 문구와 링크가 복사되었습니다\./u);
  assert.match(cardSource, /\[ShotCL\] \$\{projectName\} 스탭 초대/u);
  assert.match(cardSource, /로그인 없이 진행도, 일촬표와 시나리오를 바로 확인할 수 있습니다\./u);
  assert.doesNotMatch(cardSource, /navigator\.share|Kakao\.init|getUserMedia/u);
});

test("repeated taps are locked and active copy/share paths do not rotate", () => {
  assert.match(cardSource, /if \(requestInFlightRef\.current/u);
  assert.match(cardSource, /requestInFlightRef\.current = true/u);
  const copyStart = cardSource.indexOf("async function copyActiveInviteMessage");
  const linkStart = cardSource.indexOf("async function copyInviteUrl", copyStart);
  const confirmationStart = cardSource.indexOf("async function confirmManagementAction", linkStart);
  const activeCopySources = cardSource.slice(copyStart, confirmationStart);
  assert.doesNotMatch(activeCopySources, /runAction\("(?:ensure|rotate|revoke)"\)|mutateInvite|setInviteState/u);
  assert.match(activeCopySources, /copyText\(inviteState\.inviteUrl\)/u);
  assert.match(activeCopySources, /catch \(error\)[\s\S]*showFeedback/u);
  assert.match(cardSource, /inviteState\.status === "rotation_required"[\s\S]*setConfirmAction\("rotate"\)/u);
});

test("link lifecycle actions stay in compact management with confirmation", () => {
  assert.match(cardSource, /variant="ghost"[\s\S]*링크 복사/u);
  assert.match(cardSource, /aria-label="링크 관리"/u);
  assert.match(cardSource, /className="min-h-11 min-w-11 px-0"/u);
  assert.match(cardSource, />\s*새 링크 발급\s*</u);
  assert.match(cardSource, /이전 링크는 즉시 사용할 수 없게 되며/u);
  assert.match(cardSource, />\s*링크 비활성화\s*</u);
  assert.doesNotMatch(cardSource, /새 링크 만들기|새로 만들기/u);
});

test("Home exposes invite management only to the canonical admin role", () => {
  assert.match(homeSource, /canManageInvites=\{role === "admin"\}/u);
  assert.match(calendarSource, /detailFooter=\{canManageInvites \?/u);
  assert.match(calendarSource, /<ProjectStaffInviteCard projectId=\{projectId\} projectName=\{projectName\} \/>/u);
  assert.match(guideSource, /카카오톡 공유하기를 누르면 초대 문구와 링크를 복사할 수 있습니다\./u);
  assert.doesNotMatch(guideSource, /카카오톡으로 초대 링크를 바로 복사/u);
});

test("server active state excludes revoked links and ensure remains canonical", () => {
  assert.match(inviteServerSource, /\.eq\("project_id", projectId\)[\s\S]*\.is\("revoked_at", null\)/u);
  assert.match(inviteServerSource, /ensure_project_staff_invite/u);
  assert.match(inviteServerSource, /p_rotate:\s*rotate/u);
});

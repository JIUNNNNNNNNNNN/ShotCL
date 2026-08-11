import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveProjectAccountPermissionNotice
} from "../lib/projectAccess/accountPresentation.ts";

const base = {
  projectId: "project-a",
  joinNoticeProjectId: null,
  joinReason: null,
  isGuest: false,
  status: "anonymous",
  isGoogle: false,
  editorAllowed: false
};

const accountUtilitySource = readFileSync(
  new URL("../components/ProjectAccountUtility.tsx", import.meta.url),
  "utf8"
);
const projectGuideMenuSource = readFileSync(
  new URL("../components/ProjectGuideMenu.tsx", import.meta.url),
  "utf8"
);
const projectWorkspaceShellSource = readFileSync(
  new URL("../components/ProjectWorkspaceShell.tsx", import.meta.url),
  "utf8"
);

test("ordinary Staff and Guest do not receive the Key staff Google-required notice", () => {
  assert.equal(resolveProjectAccountPermissionNotice(base), null);
  assert.equal(resolveProjectAccountPermissionNotice({
    ...base,
    isGuest: true,
    joinNoticeProjectId: "project-a",
    joinReason: "key_staff_google_required"
  }), null);
});

test("the verified Key staff intent is scoped to its project and explains Google permission", () => {
  assert.equal(resolveProjectAccountPermissionNotice({
    ...base,
    joinNoticeProjectId: "project-b",
    joinReason: "key_staff_google_required"
  }), null);
  assert.deepEqual(resolveProjectAccountPermissionNotice({
    ...base,
    joinNoticeProjectId: "project-a",
    joinReason: "key_staff_google_required"
  }), {
    kind: "google-required",
    title: "Google 로그인이 필요합니다.",
    description: "Key staff 비밀번호가 확인되었습니다. 수정·관리 권한을 사용하려면 승인된 Google 계정으로 로그인해 주세요.",
    actionLabel: "Google 로그인"
  });
});

test("a non-allowlisted Google account stays authenticated and receives permission guidance", () => {
  assert.deepEqual(resolveProjectAccountPermissionNotice({
    ...base,
    status: "authenticated",
    isGoogle: true,
    editorAllowed: false
  }), {
    kind: "editor-permission-required",
    title: "수정 권한이 필요합니다.",
    description: "Google 로그인은 완료되었습니다. 이 계정은 현재 수정 권한이 승인되지 않았습니다. 권한이 필요하면 프로젝트 관리자에게 요청해 주세요.",
    actionLabel: null
  });
});

test("approved Google, hydration, and actual auth failures never render a permission warning", () => {
  assert.equal(resolveProjectAccountPermissionNotice({
    ...base,
    status: "authenticated",
    isGoogle: true,
    editorAllowed: true
  }), null);
  for (const status of ["loading", "syncing", "error", "unavailable"]) {
    assert.equal(resolveProjectAccountPermissionNotice({
      ...base,
      status,
      isGoogle: status === "error",
      joinNoticeProjectId: "project-a",
      joinReason: "key_staff_google_required"
    }), null);
  }
});

test("Home and the left utility share one safe OAuth action without extra auth requests", () => {
  assert.match(accountUtilitySource, /const safeReturnTo = getSafeInternalPath\(returnTo,/u);
  assert.equal((accountUtilitySource.match(/await startGoogleOAuth\(safeReturnTo\)/gu) ?? []).length, 1);
  assert.match(accountUtilitySource, /home\.key-staff-google-required/u);
  assert.match(accountUtilitySource, /!keyStaffGoogleGuideEligible/u);
  assert.match(accountUtilitySource, /!keyStaffIntentHistoryRef\.current\.seen/u);
  assert.match(projectGuideMenuSource, /data-project-account-permission-slot/u);
  assert.doesNotMatch(accountUtilitySource, /fetch\s*\(|router\.refresh\s*\(/u);
});

test("Home owns one full notice while the closed mobile drawer keeps only compact account state", () => {
  assert.equal(
    (accountUtilitySource.match(/<ProjectAccountPermissionNotice/gu) ?? []).length,
    1
  );
  assert.match(accountUtilitySource, /<ProjectAccountAuthErrorNotice/u);
  assert.match(accountUtilitySource, /!actionError[\s\S]*!sessionError/u);
  const consumeEffect = projectWorkspaceShellSource.slice(
    projectWorkspaceShellSource.indexOf("const notice = consumePendingProjectJoinNotice"),
    projectWorkspaceShellSource.indexOf("}, [projectId])")
  );
  assert.doesNotMatch(consumeEffect, /setOpenDrawer/u);
});

test("the verified intent is dismissed only after OAuth initiation succeeds", () => {
  const loginHandler = accountUtilitySource.slice(
    accountUtilitySource.indexOf("async function handleGoogleLogin"),
    accountUtilitySource.indexOf("return (", accountUtilitySource.indexOf("async function handleGoogleLogin"))
  );
  const oauthStart = loginHandler.indexOf("await startGoogleOAuth(safeReturnTo)");
  const dismiss = loginHandler.indexOf("onDismissJoinNotice?.()");
  assert.ok(oauthStart >= 0 && dismiss > oauthStart);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (pathname) => readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("Basic Info exposes permanent deletion only through the server-derived creator capability", () => {
  const layout = readSource("app/projects/[id]/layout.tsx");
  const gate = readSource("components/ProjectAccessGate.tsx");
  const page = readSource("app/projects/[id]/basic-info/page.tsx");
  const actions = readSource("components/ProjectPageActions.tsx");

  assert.match(layout, /isOwner = access\?\.isOwner \?\? false/u);
  assert.match(layout, /isOwner=\{isOwner\}/u);
  assert.match(layout, /editorEligible=\{editorEligible\}/u);
  assert.match(gate, /editorEligible: serverEditorEligible/u);
  assert.match(gate, /const isCreator = resolveProjectCreatorCapability\(\{[\s\S]*projectId,[\s\S]*accessMode,[\s\S]*serverRole: role,[\s\S]*serverEditorEligible,[\s\S]*serverAccountUserId: accountUserId,[\s\S]*serverIsOwner: isOwner,[\s\S]*liveAccountUserId: liveAccountUser\?\.id \?\? null,[\s\S]*creatorClaimedProjectId/u);
  assert.match(page, /isCreator && project[\s\S]*key: "projectSettings"[\s\S]*projectPermanentDelete/u);
  assert.match(actions, /projectPermanentDelete:[\s\S]*label: "프로젝트 영구 삭제"[\s\S]*tone: "danger"/u);
  assert.doesNotMatch(page, /created_by|createdBy|fetch\(/u);
  assert.doesNotMatch(gate, /router\.refresh\(/u);
});

test("Permanent deletion uses the dedicated two-phrase dialog and never joins normal Undo", () => {
  const dialog = readSource("components/ProjectPermanentDeleteDialog.tsx");
  const page = readSource("app/projects/[id]/basic-info/page.tsx");

  assert.match(dialog, /role="alertdialog"/u);
  assert.match(dialog, /projectNameConfirmation\.trim\(\) === projectName\.trim\(\)/u);
  assert.match(dialog, /phraseConfirmation === PROJECT_PERMANENT_DELETE_PHRASE/u);
  assert.match(dialog, /모든 프로젝트 데이터 영구 삭제/u);
  assert.match(dialog, /submissionLockedRef\.current/u);
  assert.match(dialog, /setProjectNameConfirmation\(""\)[\s\S]*setPhraseConfirmation\(""\)[\s\S]*onClose\(\)/u);
  assert.match(dialog, /Cmd\/Ctrl\+Z로 복구되지 않습니다/u);
  assert.doesNotMatch(dialog, /window\.confirm|confirm\(/u);
  assert.doesNotMatch(page, /deleteWithUndo|useProjectDeleteUndo/u);
});

test("Delete submit obtains a fresh user bearer only at action time", () => {
  const deletion = readSource("lib/data/projectPermanentDeletion.ts");

  assert.match(deletion, /await import\("@\/lib\/supabase\/client"\)/u);
  assert.match(deletion, /supabase\.auth\.getSession\(\)/u);
  assert.match(deletion, /Authorization: `Bearer \$\{accessToken\}`/u);
  assert.match(deletion, /method: "DELETE"/u);
  assert.match(deletion, /response\.status === 404 && payload\.code === "PROJECT_NOT_FOUND"/u);
  assert.match(deletion, /payload\.ok !== true[\s\S]*normalizeProjectId\(payload\.deletedProjectId \?\? ""\) !== projectId/u);
  assert.match(deletion, /body: JSON\.stringify\(\{[\s\S]*projectName:[\s\S]*confirmationPhrase:/u);
  assert.doesNotMatch(deletion, /from\("projects"\)|\.delete\(\)/u);
});

test("Success cleanup is target-only, lazy, and stale browser history is fail-closed", () => {
  const page = readSource("app/projects/[id]/basic-info/page.tsx");
  const main = readSource("app/page.tsx");
  const cleanup = readSource("lib/projectAccess/projectDeletion.client.ts");
  const marker = readSource("lib/projectAccess/deletedProjectMarker.client.ts");
  const gate = readSource("components/ProjectAccessGate.tsx");

  assert.match(page, /await import\("@\/lib\/projectAccess\/projectDeletion\.client"\)/u);
  assert.match(page, /markProjectDeletedInThisTab\(projectId\)[\s\S]*window\.location\.replace\("\/"\)/u);
  assert.match(main, /projectDeletionNotice\.client/u);
  assert.doesNotMatch(main, /projectDeletion\.client/u);
  assert.match(cleanup, /clearProjectReadCache\(projectId\)/u);
  assert.match(cleanup, /clearDailyPlanReadCache\(projectId\)/u);
  assert.match(cleanup, /clearProjectCalendarClientCache\(projectId\)/u);
  assert.match(cleanup, /clearAutosaveDraftsForProject\(projectId\)/u);
  assert.match(cleanup, /clearLocalProjectBuckets\(projectId\)/u);
  assert.match(cleanup, /clearLocalProjectSceneList\(projectId\)/u);
  assert.match(cleanup, /clearLocalProjectShotDiagrams\(projectId\)/u);
  assert.match(cleanup, /forgetProjectSelection\(projectId\)/u);
  assert.doesNotMatch(cleanup, /localStorage\.clear|sessionStorage\.clear/u);
  assert.match(marker, /shotcl:deletedProjectIds/u);
  assert.match(gate, /useLayoutEffect\(\(\) => \{[\s\S]*isProjectDeletedInThisTab\(projectId\)[\s\S]*window\.location\.replace\("\/"\)/u);
  assert.match(gate, /addEventListener\("pageshow", handlePageShow\)/u);
  assert.match(gate, /if \(deletedInThisTab\) return null/u);
});

test("Existing Progress streams close and leave the project after canonical deletion", () => {
  const memberStream = readSource("lib/realtime/subscribeToProgressChanges.ts");
  const guestStream = readSource("lib/realtime/subscribeToGuestProgress.ts");
  const guestRoute = readSource("app/api/projects/[projectId]/progress-events/route.ts");
  const deletionServer = readSource("lib/projectDeletion/server.ts");
  const deletionMigration = readSource("supabase/migration_project_permanent_deletion.sql");
  const progress = readSource("app/projects/[id]/page.tsx");
  const reconnectProbe = sourceBetween(
    progress,
    "const handleRealtimeConnectionError = useCallback(",
    "useEffect(() => {\n    if (accessMode !== \"member\" || !isProgressView || !projectId || !selectedDailyPlanId)"
  );

  assert.match(memberStream, /event: "INSERT"[\s\S]*table: "project_deletion_events"[\s\S]*event: "UPDATE"[\s\S]*table: "project_deletion_events"/u);
  assert.match(memberStream, /newRow\.project_id[\s\S]*newRow\.deletion_started_at[\s\S]*onProjectDeleted/u);
  assert.match(memberStream, /channel\(`progress-project:\$\{projectId\}`, \{[\s\S]*private: true[\s\S]*broadcast: \{ ack: true \}[\s\S]*"broadcast"[\s\S]*event: "project-deleted"[\s\S]*onConnectionError/u);
  assert.match(guestStream, /event\.type === "project-deleted"[\s\S]*source\.close\(\)/u);
  assert.match(progress, /markProjectDeletedInThisTab\(projectId\)[\s\S]*clearDeletedProjectClientState[\s\S]*window\.location\.replace\("\/"\)/u);
  assert.match(memberStream, /let hasSubscribed = false[\s\S]*\.subscribe\(\(status\)[\s\S]*status === "SUBSCRIBED"[\s\S]*if \(!hasSubscribed\)[\s\S]*hasSubscribed = true;[\s\S]*return;[\s\S]*onConnectionError/u);
  assert.match(guestStream, /addEventListener\("error", handleError\)[\s\S]*removeEventListener\("error", handleError\)/u);
  assert.match(guestStream, /"stream-close", handleExpectedRotation[\s\S]*if \(expectedRotationClose\)[\s\S]*return;/u);
  assert.match(guestStream, /source\.readyState !== EventSource\.CLOSED\) return;[\s\S]*handlers\.onConnectionError\(\)/u);
  assert.match(guestStream, /"stream-error", handleStreamFailure[\s\S]*"project-access-check", handleProjectAccessCheck/u);
  assert.match(guestRoute, /channel\(`progress-project:\$\{projectId\}`, \{[\s\S]*private: true[\s\S]*broadcast: \{ ack: true \}[\s\S]*"broadcast"[\s\S]*event: "project-deleted"[\s\S]*event: project-access-check/u);
  assert.match(deletionServer, /beginResult !== "started"[\s\S]*broadcastProjectDeletionWakeup\(supabase, input\.projectId\)[\s\S]*saveDeletionInventory/u);
  assert.match(deletionServer, /channel\(`progress-project:\$\{projectId\}`, \{[\s\S]*private: true[\s\S]*broadcast: \{ ack: true \}[\s\S]*type: "broadcast"[\s\S]*event: "project-deleted"/u);
  assert.match(deletionMigration, /primary key \(project_id, user_id\)[\s\S]*user_id = auth\.uid\(\)/u);
  assert.match(deletionMigration, /insert into public\.project_deletion_events \(project_id, user_id, deletion_started_at\)[\s\S]*select member\.user_id[\s\S]*on conflict \(project_id, user_id\)/u);
  assert.match(deletionMigration, /on realtime\.messages for select[\s\S]*to authenticated[\s\S]*join public\.projects as project[\s\S]*realtime\.topic\(\) = 'progress-project:' \|\| member\.project_id::text[\s\S]*project\.deletion_started_at is null/u);
  assert.doesNotMatch(deletionMigration, /on realtime\.messages for insert[\s\S]*to authenticated/u);
  assert.match(reconnectProbe, /projectAccessProbeRef\.current[\s\S]*fetch\(`\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}`[\s\S]*response\.status === 410 \|\| response\.status === 404[\s\S]*response\.status === 401 \|\| response\.status === 403/u);
  assert.match(reconnectProbe, /leaveProjectAfterRealtimeAccessEnds\(true\)[\s\S]*leaveProjectAfterRealtimeAccessEnds\(false\)/u);
  assert.equal((reconnectProbe.match(/\bfetch\(/gu) ?? []).length, 1);
  assert.doesNotMatch(memberStream, /\bfetch\(/u);
  assert.doesNotMatch(guestStream, /\bfetch\(/u);
});

test("Every non-Progress project route owns one deletion boundary without duplicating Progress", () => {
  const gate = readSource("components/ProjectAccessGate.tsx");
  const boundary = readSource("lib/realtime/subscribeToProjectDeletionBoundary.ts");
  const route = readSource("app/api/projects/[projectId]/deletion-events/route.ts");
  const progress = readSource("app/projects/[id]/page.tsx");

  assert.match(gate, /const progressOwnsDeletionBoundary = pathname === progressPath[\s\S]*searchParams\.get\("view"\) === "progress"[\s\S]*searchParams\.get\("dailyPlanId"\)/u);
  assert.match(gate, /denied[\s\S]*progressOwnsDeletionBoundary[\s\S]*!currentRole[\s\S]*!accessMode[\s\S]*return undefined/u);
  assert.match(gate, /accessMode === "member"[\s\S]*subscribeToMemberProjectDeletionBoundary[\s\S]*subscribeToServerProjectDeletionBoundary/u);
  assert.match(gate, /event\.persisted\) probeProjectAccess\(\)[\s\S]*addEventListener\("pageshow", handlePageShow\)/u);
  assert.doesNotMatch(gate, /addEventListener\("focus"/u);
  assert.match(gate, /isProjectPermanentDeletionInitiatedHere\(projectId\)[\s\S]*return/u);
  assert.match(progress, /if \(accessMode !== "member" \|\| !isProgressView \|\| !projectId \|\| !selectedDailyPlanId\) return undefined/u);

  assert.equal((boundary.match(/\.channel\(/gu) ?? []).length, 1);
  assert.match(boundary, /channel\(`progress-project:\$\{projectId\}`, \{[\s\S]*private: true[\s\S]*broadcast: \{ ack: true \}/u);
  assert.match(boundary, /let hasSubscribed = false[\s\S]*status === "SUBSCRIBED" && !hasSubscribed[\s\S]*hasSubscribed = true;[\s\S]*return;/u);
  assert.match(boundary, /new EventSource\([\s\S]*\/deletion-events/u);
  assert.match(boundary, /const handleExpectedRotation = \(\) => \{[\s\S]*expectedRotationClose = true/u);
  assert.match(boundary, /if \(expectedRotationClose\) \{[\s\S]*return;[\s\S]*source\.readyState !== EventSource\.CLOSED/u);
  assert.match(boundary, /addEventListener\("stream-close", handleExpectedRotation\)/u);
  assert.doesNotMatch(boundary, /setInterval|setTimeout|\bfetch\(/u);

  const accessIndex = route.indexOf("await getProjectRequestAccess(request, projectId)");
  const streamIndex = route.indexOf("new ReadableStream");
  assert.ok(accessIndex >= 0 && accessIndex < streamIndex);
  assert.equal((route.match(/\.channel\(/gu) ?? []).length, 1);
  assert.match(route, /request\.nextUrl\.searchParams\.size !== 0/u);
  assert.match(route, /config: \{ private: true, broadcast: \{ ack: true \} \}/u);
  assert.match(route, /event: "INSERT"[\s\S]*table: "project_deletion_events"[\s\S]*event: "UPDATE"[\s\S]*table: "project_deletion_events"/u);
  assert.match(route, /event: project-access-check/u);
  assert.match(route, /event: project-deleted/u);
  assert.match(route, /event: stream-close/u);
  assert.match(route, /removeChannel\(activeChannel\)/u);
  assert.doesNotMatch(route, /from\("shots"\)|from\("daily_plans"\)|type: "snapshot"/u);
});

test("Permanent deletion initiator suppresses only its own tab until dialog close or hard navigation", () => {
  const dialog = readSource("components/ProjectPermanentDeleteDialog.tsx");
  const initiator = readSource("lib/projectAccess/projectDeletionInitiator.client.ts");
  const gate = readSource("components/ProjectAccessGate.tsx");

  const beginIndex = dialog.indexOf("beginProjectPermanentDeletionHere(projectId)");
  const requestIndex = dialog.indexOf("await permanentlyDeleteProject(");
  assert.ok(beginIndex >= 0 && beginIndex < requestIndex);
  assert.match(dialog, /useEffect\(\(\) => \{[\s\S]*return \(\) => \{[\s\S]*endProjectPermanentDeletionHere\(projectId\)/u);
  assert.match(dialog, /function requestClose\(\)[\s\S]*endProjectPermanentDeletionHere\(projectId\)[\s\S]*onClose\(\)/u);
  assert.doesNotMatch(sourceBetween(dialog, "    } catch (error) {", "\n  }\n\n  function requestClose"), /endProjectPermanentDeletionHere/u);
  assert.match(initiator, /const activeDeletionAttempts = new Set<string>\(\)/u);
  assert.match(gate, /isProjectPermanentDeletionInitiatedHere\(projectId\)/u);
});

test("Autosave cache namespaces retain their owning project UUID", () => {
  const shotEditor = readSource("components/ShotEditorModal.tsx");
  const scheduleEditor = readSource("components/ProgressScheduleEditorModal.tsx");
  const calendarEditor = readSource("components/project-calendar/ProjectCalendarEventEditor.tsx");
  const gathering = readSource("components/DailyPlanGatheringLocations.tsx");

  assert.match(shotEditor, /`shot:\$\{shot\.projectId\}:\$\{shot\.id\}`/u);
  assert.match(scheduleEditor, /`progress-schedule-memo:\$\{projectId\}:\$\{item\.id\}`/u);
  assert.match(calendarEditor, /`project-calendar:\$\{projectId\}:\$\{event\?\.id \?\? "new"\}`/u);
  assert.match(gathering, /const addressAutosaveScopeKey = `gathering-address:\$\{projectId\}:/u);
  assert.match(gathering, /getAutosaveDraft<string>\(addressAutosaveScopeKey\)/u);
});

test("Existing authenticated project creation remains atomic under the root deletion guard", () => {
  const createRoute = readSource("app/api/projects/create/route.ts");
  const migration = readSource("supabase/migration_project_permanent_deletion.sql");

  assert.match(createRoute, /crypto\.randomUUID\(\)[\s\S]*\.rpc\([\s\S]*"create_project_with_access"/u);
  assert.doesNotMatch(createRoute, /from\("projects"\)\.delete\(\)/u);
  assert.match(migration, /create or replace function public\.create_project_with_access\([\s\S]*insert into public\.projects[\s\S]*insert into public\.project_access_credentials[\s\S]*insert into public\.project_members/u);
  assert.match(migration, /grant execute on function public\.create_project_with_access[\s\S]*to service_role/u);
});

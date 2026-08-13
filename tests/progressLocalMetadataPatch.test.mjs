import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const progressPageSource = readFileSync(
  new URL("../app/projects/[id]/page.tsx", import.meta.url),
  "utf8"
);
const gatheringLocationSource = readFileSync(
  new URL("../components/DailyPlanGatheringLocations.tsx", import.meta.url),
  "utf8"
);

function sourceBetween(startMarker, endMarker) {
  const start = progressPageSource.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = progressPageSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return progressPageSource.slice(start, end);
}

test("local daily-plan metadata patches do not re-key the Progress detail fetch", () => {
  const refreshSource = sourceBetween(
    "const refresh = useCallback(async () => {",
    "useEffect(() => {\n    if (resetProgressEntryRef.current === progressEntryKey) return;"
  );

  assert.match(refreshSource, /selectedDailyPlanId/);
  assert.match(refreshSource, /hasCurrentProject/);
  assert.doesNotMatch(refreshSource, /\bselectedPlan\b/);
  assert.doesNotMatch(refreshSource, /\bproject\b/);
});

test("archive rebuild and metadata patch callbacks are scoped by the selected round ID", () => {
  const rebuildSource = sourceBetween(
    "const rebuildArchiveMedia = useCallback((nextShots: Shot[]) => {",
    "const refreshSelectedShots = useCallback(async () => {"
  );
  const metadataPatchSource = sourceBetween(
    "const handleDailyPlanMetadataChange = useCallback((",
    "const handleStatusChange = useCallback(async"
  );

  assert.match(rebuildSource, /selectedPlanRef\.current/);
  assert.match(rebuildSource, /\}, \[selectedDailyPlanId\]\);/);
  assert.doesNotMatch(rebuildSource, /\bselectedPlan\b/);
  assert.match(metadataPatchSource, /commitDailyPlanPatch\(selectedDailyPlanId, patch\)/);
  assert.match(metadataPatchSource, /\[commitDailyPlanPatch, selectedDailyPlanId\]/);
  assert.doesNotMatch(metadataPatchSource, /\bselectedPlan\b/);
});

test("Progress keeps only page-wide cut creation in its local page menu", () => {
  const actionMenuSource = sourceBetween(
    "const progressActionMenu = useMemo<ProjectPageActionMenuRegistration | null>(() => {",
    "const handleImagePreview = useCallback"
  );

  assert.match(actionMenuSource, /progressAddCut:\s*\{/u);
  assert.match(actionMenuSource, /hidden: progressOnly \|\| !persistentProjectShell/u);
  assert.doesNotMatch(actionMenuSource, /progressGatheringPhoto|progressGatheringAddress/u);
  assert.match(progressPageSource, /action=\{<ProjectPageActionsMenu registration=\{progressActionMenu\} \/>\}/u);
});

test("gathering-place actions live in its permission-aware section context menu", () => {
  assert.match(gatheringLocationSource, /role="menu"[\s\S]*aria-label="집합장소 작업 메뉴"/u);
  assert.match(gatheringLocationSource, /label="사진 추가"[\s\S]*label="사진 관리"[\s\S]*label="주소 수정"/u);
  assert.match(gatheringLocationSource, /Boolean\(canEdit && place\)/u);
  assert.match(gatheringLocationSource, /onContextMenu=\{handleSectionContextMenu\}/u);
  assert.match(gatheringLocationSource, /GATHERING_CONTEXT_MENU_LONG_PRESS_MS = 500/u);
  assert.doesNotMatch(progressPageSource, /onActionsChange|GatheringLocationActions/u);
});

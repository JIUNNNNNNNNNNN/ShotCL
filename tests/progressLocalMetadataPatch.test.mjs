import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const progressPageSource = readFileSync(
  new URL("../app/projects/[id]/page.tsx", import.meta.url),
  "utf8"
);
const rightSidebarSource = readFileSync(
  new URL("../components/RightProjectSidebar.tsx", import.meta.url),
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
    "useEffect(() => {\n    selectedShotsRefreshVersionRef.current += 1;"
  );

  assert.match(refreshSource, /selectedPlanRef\.current/);
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

test("compact Progress actions omit duplicate photo controls but keep address editing", () => {
  const actionMenuSource = sourceBetween(
    "const progressActionMenu = useMemo<ProjectPageActionMenuRegistration | null>(() => {",
    "useProjectPageActionMenu(progressActionMenu);"
  );
  const addPhotos = actionMenuSource.slice(
    actionMenuSource.indexOf("progressGatheringPhotoAdd: {"),
    actionMenuSource.indexOf("progressGatheringPhotoManage: {")
  );
  const managePhotos = actionMenuSource.slice(
    actionMenuSource.indexOf("progressGatheringPhotoManage: {"),
    actionMenuSource.indexOf("progressGatheringAddressEdit: {")
  );
  const editAddress = actionMenuSource.slice(
    actionMenuSource.indexOf("progressGatheringAddressEdit: {")
  );

  assert.match(addPhotos, /hiddenInDrawer: true/u);
  assert.match(managePhotos, /hiddenInDrawer: true/u);
  assert.doesNotMatch(editAddress, /hiddenInDrawer: true/u);
  assert.match(rightSidebarSource, /mode === "drawer"[\s\S]*!action\.hiddenInDrawer/u);
  assert.doesNotMatch(rightSidebarSource, /progress\.gathering-photo/u);
});

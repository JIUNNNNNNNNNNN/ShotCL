"use client";

import dynamic from "next/dynamic";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { PageLoader, SectionLoader } from "@/components/PixelDogLoader";
import {
  useProjectPageActionMenu,
  type ProjectPageActionMenuRegistration
} from "@/components/ProjectPageActions";
import { ProjectGuideMenu } from "@/components/ProjectGuideMenu";
import { useProjectDeleteUndo } from "@/components/ProjectDeleteUndoProvider";
import { ProgressDetailHeader } from "@/components/ProgressDetailHeader";
import { DailyProgressSummary } from "@/components/DailyProgressSummary";
import type { GatheringLocationActions } from "@/components/DailyPlanGatheringLocations";
import { ProgressScheduleCard } from "@/components/ProgressScheduleCard";
import { ProgressStatusSection } from "@/components/ProgressStatusSection";
import type { ProgressScheduleEditorValues } from "@/components/ProgressScheduleEditorModal";
import type { ShotEditorValues } from "@/components/ShotEditorModal";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createShotsFromDrafts, deleteAllShots, deleteShot, finalizeDeletedShots, listShots, reorderShots, restoreDeletedShots, updateShot, updateShotStatus } from "@/lib/data/shots";
import { dailyPlanFromRow, shotFromRow } from "@/lib/data/mappers";
import { getShotDiagramKey, loadShotOverheadDiagram, loadShotOverheadDiagrams } from "@/lib/data/shotDiagrams";
import {
  applyShotMediaLinks,
  buildProgressArchiveMediaByShotId,
  loadProgressArchiveMediaAssets,
  loadShotMediaLinks,
  type ProgressArchiveMediaAsset
} from "@/lib/data/shotMediaArchive";
import {
  getProgressDailyPlan,
  updateDailyPlanProgressOrder,
  updateDailyPlanScheduleItem,
  type DailyPlanScheduleItemMutationResult
} from "@/lib/data/dailyPlans";
import { AutosaveConflictError } from "@/lib/data/autosaveConflict";
import { decodeDailyPlanMemo, encodeDailyPlanMemo, normalizeDailyPlanPrintMeta } from "@/lib/dailyPlan/printMeta";
import {
  deleteScheduleImageWithReceipt,
  finalizeScheduleImageDelete,
  restoreScheduleImageDelete,
  saveScheduleImage
} from "@/lib/data/storyboardFiles";
import type { ShotRealtimeChange } from "@/lib/realtime/subscribeToShots";
import { subscribeToGuestProgress } from "@/lib/realtime/subscribeToGuestProgress";
import type { ProgressSnapshotStreamEvent } from "@/lib/realtime/progressEvents";
import { auditQuery } from "@/lib/queryAudit";
import { getKoreaDateOnly } from "@/lib/koreaDate";
import {
  calculateDailyProgress,
  createDailyProgressCompletion
} from "@/lib/progress/dailyProgress";
import { buildProgressMediaGalleryItems } from "@/lib/progress/mediaGallery";
import { resolveRelevantProgressRound } from "@/lib/progress/resolveRelevantRound";
import { orderProgressShotsByShootingOrder } from "@/lib/progress/shootingOrder";
import { applyProgressOrderToTimetableScenes } from "@/lib/progress/shootingOrderMutation";
import { hasShotOverheadContent } from "@/lib/shotOverhead";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import {
  useAutoContextualGuide,
  useContextualGuide,
  useContextualGuideAnchor,
  useContextualGuideBlocker
} from "@/components/guides/ContextualGuideProvider";
import type { DailyPlan, DailyPlanMealTime, Shot, ShotDraft, ShotMediaLink, ShotMediaType, ShotStatus } from "@/lib/types";

type ProgressVisualBucket = "active" | "ok" | "omit";
type EditingScheduleState = {
  dailyPlanId: string;
  entryKey: string;
  sessionId: number;
  item: DailyPlanMealTime;
};
type ProgressImagePreview = { url: string; title: string };
const EMPTY_PROGRESS_ARCHIVE_MEDIA: ProgressArchiveMediaAsset[] = [];

function hasMultipleProgressGalleryItems(
  shot: Shot,
  archiveMedia: readonly ProgressArchiveMediaAsset[]
) {
  const storyboardItems = buildProgressMediaGalleryItems(
    archiveMedia,
    "storyboard",
    shot.storyboardImageUrl ? {
      id: `${shot.id}:legacy-storyboard`,
      title: "",
      url: shot.storyboardImageUrl,
      thumbnailUrl: ""
    } : null
  );
  if (storyboardItems.length >= 2) return true;

  const overheadItems = buildProgressMediaGalleryItems(
    archiveMedia,
    "overhead",
    shot.overheadImageUrl ? {
      id: `${shot.id}:legacy-overhead`,
      title: "",
      url: shot.overheadImageUrl,
      thumbnailUrl: ""
    } : null
  );
  return overheadItems.length + (hasShotOverheadContent(shot.overheadDiagram) ? 1 : 0) >= 2;
}

const DailyPlanGatheringLocations = dynamic(
  () => import("@/components/DailyPlanGatheringLocations").then((module) => module.DailyPlanGatheringLocations)
);
const DailyPlanGatheringLocationsReadOnly = dynamic(
  () => import("@/components/DailyPlanGatheringLocationsReadOnly").then((module) => module.DailyPlanGatheringLocationsReadOnly)
);
const StableDailyPlanGatheringLocations = memo(DailyPlanGatheringLocations);
const StableDailyPlanGatheringLocationsReadOnly = memo(DailyPlanGatheringLocationsReadOnly);
const ShotCard = dynamic(
  () => import("@/components/ShotCard").then((module) => module.ShotCard)
);
const ShotReorderList = dynamic(
  () => import("@/components/ShotReorderList").then((module) => module.ShotReorderList)
);

type ProgressShotListProps = {
  allShots: Shot[];
  visibleShots: Shot[];
  readOnly: boolean;
  disabled: boolean;
  statusReadOnly: boolean;
  interactionGuideTarget: boolean;
  onReorder: (shots: Shot[]) => Promise<void> | void;
  onStatusChange: (shot: Shot, status: ShotStatus) => Promise<void> | void;
  renderShot: (shot: Shot) => ReactNode;
  renderRowsBeforeIndex?: (index: number) => ReactNode;
};

/** Guest readers do not hydrate pointer/drag state or download the reorder implementation. */
function ProgressShotList({
  allShots,
  visibleShots,
  readOnly,
  disabled,
  statusReadOnly,
  interactionGuideTarget,
  onReorder,
  onStatusChange,
  renderShot,
  renderRowsBeforeIndex
}: ProgressShotListProps) {
  if (!readOnly) {
    return (
      <ShotReorderList
        allShots={allShots}
        visibleShots={visibleShots}
        disabled={disabled}
        statusReadOnly={statusReadOnly}
        interactionGuideTarget={interactionGuideTarget}
        onReorder={onReorder}
        onStatusChange={onStatusChange}
        renderShot={renderShot}
        renderRowsBeforeIndex={renderRowsBeforeIndex}
      />
    );
  }

  return (
    <div className="grid gap-2">
      {visibleShots.map((shot, index) => (
        <Fragment key={shot.id}>
          {renderRowsBeforeIndex?.(index)}
          {renderShot(shot)}
        </Fragment>
      ))}
      {renderRowsBeforeIndex?.(visibleShots.length)}
    </div>
  );
}

const ShotEditorModal = dynamic(
  () => import("@/components/ShotEditorModal").then((module) => module.ShotEditorModal),
  { ssr: false, loading: ModalLoadingFallback }
);
const ImagePreviewModal = dynamic(
  () => import("@/components/ImagePreviewModal").then((module) => module.ImagePreviewModal),
  { ssr: false, loading: ModalLoadingFallback }
);
const ProgressScheduleEditorModal = dynamic(
  () => import("@/components/ProgressScheduleEditorModal").then((module) => module.ProgressScheduleEditorModal),
  { ssr: false, loading: ModalLoadingFallback }
);
const ShotArchivePicker = dynamic(
  () => import("@/components/ShotArchivePicker").then((module) => module.ShotArchivePicker),
  { ssr: false, loading: ModalLoadingFallback }
);

/** 쉼표로 입력한 등장 인물을 배열로 정리합니다. */
function parseCharacters(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 일촬표에 저장된 씬/기타 일정 순서를 진행 컷 배열의 삽입 위치로 바꿉니다. */
function placeScheduleRows(
  shots: Shot[],
  rows: DailyPlanMealTime[],
  rowOrder: Array<"scene" | "event">
) {
  const placements = new Map<number, DailyPlanMealTime[]>();
  const scheduleRows = rows;
  const sceneOrder = [...new Set(shots.map((shot) => shot.sceneNumber.trim()))];
  const sceneCounts = new Map<string, number>();
  shots.forEach((shot) => {
    const scene = shot.sceneNumber.trim();
    sceneCounts.set(scene, (sceneCounts.get(scene) ?? 0) + 1);
  });

  let shotIndex = 0;
  let sceneIndex = 0;
  let scheduleIndex = 0;
  rowOrder.forEach((type) => {
    if (type === "scene") {
      const scene = sceneOrder[sceneIndex];
      sceneIndex += 1;
      shotIndex += scene ? sceneCounts.get(scene) ?? 0 : 0;
      return;
    }

    const schedule = scheduleRows[scheduleIndex];
    scheduleIndex += 1;
    if (!schedule || !isMeaningfulScheduleRow(schedule)) return;
    const targetIndex = Math.min(shotIndex, shots.length);
    placements.set(targetIndex, [...(placements.get(targetIndex) ?? []), schedule]);
  });

  scheduleRows.slice(scheduleIndex).filter(isMeaningfulScheduleRow).forEach((schedule) => {
    placements.set(shots.length, [...(placements.get(shots.length) ?? []), schedule]);
  });
  return placements;
}

function isMeaningfulScheduleRow(row: DailyPlanMealTime) {
  return Boolean(
    row.startTime.trim()
    || row.endTime.trim()
    || row.runtimeMinutes
    || row.runtime?.trim()
    || row.locationId?.trim()
    || row.memo.trim()
    || row.progressMemo?.trim()
    || row.imageUrl
  );
}

/** 프로젝트 상세 화면: 일일촬영 진행표 + 컷 편집 모달을 담당합니다. */
export default function ProjectDetailPage() {
  const { role, isGuest, canEditProgressStatus } = useProjectAccess();
  const {
    projectId,
    project,
    dailyPlans,
    initialProgress,
    isLoading: isWorkspaceLoading,
    error: workspaceError,
    upsertDailyPlan
  } = useProjectWorkspace();
  const progressOnly = role === "progress";
  const searchParams = useSearchParams();
  const requestedDailyPlanId = searchParams.get("dailyPlanId") ?? "";
  const isProgressView = searchParams.get("view") === "progress" || Boolean(requestedDailyPlanId);
  const initialRoundResolutionRef = useRef<{ projectId: string; dailyPlanId: string } | null>(null);
  const isFreshProgressRoot = isProgressView && !requestedDailyPlanId;
  if (!isFreshProgressRoot) {
    initialRoundResolutionRef.current = null;
  } else if (
    !isWorkspaceLoading
    && project
    && initialRoundResolutionRef.current?.projectId !== projectId
  ) {
    const todayKorea = getKoreaDateOnly();
    const resolution = todayKorea
      ? resolveRelevantProgressRound(
          dailyPlans.map((plan) => ({
            id: plan.id,
            shootingDate: plan.shootingDate,
            episode: plan.episode,
            progress: createDailyProgressCompletion(
              plan.progressTotal,
              plan.progressCompleted
            )
          })),
          todayKorea
        )
      : null;
    // An empty/invalid result is latched too: automatic selection belongs to
    // this landing only and must not react to later workspace or Realtime changes.
    initialRoundResolutionRef.current = {
      projectId,
      dailyPlanId: resolution?.status === "resolved" ? resolution.round.id : ""
    };
  }
  const initialDailyPlanId = isFreshProgressRoot
    && initialRoundResolutionRef.current?.projectId === projectId
    ? initialRoundResolutionRef.current.dailyPlanId
    : "";
  const seededDailyPlanId = isFreshProgressRoot ? initialProgress?.dailyPlanId ?? "" : "";
  // A query-selected round always wins. The derived ID only bridges the first
  // Progress-root render so detail loading can start on the first client render.
  const dailyPlanId = requestedDailyPlanId || seededDailyPlanId || initialDailyPlanId;
  const progressEntryKey = `${projectId ?? "missing-project"}:${dailyPlanId || "episode-selection"}`;
  const seededProgress = initialProgress?.dailyPlanId === dailyPlanId ? initialProgress : null;
  const initialShots = seededProgress?.shots ?? [];
  const [shots, setShots] = useState<Shot[]>(() => initialShots);
  const [sessionBucketByShotId, setSessionBucketByShotId] = useState<Map<string, ProgressVisualBucket>>(
    () => reconcileSessionBuckets(initialShots, new Map(), true)
  );
  const [archiveMediaByShotId, setArchiveMediaByShotId] = useState<Map<string, ProgressArchiveMediaAsset[]>>(() => new Map());
  const [processedExpanded, setProcessedExpanded] = useState(true);
  const [isLoading, setIsLoading] = useState(
    () => Boolean(isProgressView && dailyPlanId && !seededProgress)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editingShot, setEditingShot] = useState<Shot | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<EditingScheduleState | null>(null);
  const [savingScheduleSessionId, setSavingScheduleSessionId] = useState<number | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [gatheringLocationActions, setGatheringLocationActions] = useState<GatheringLocationActions | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    title: string;
    images?: ProgressImagePreview[];
    index?: number;
  } | null>(null);
  const [mediaLinksByShotId, setMediaLinksByShotId] = useState<Map<string, ShotMediaLink[]>>(new Map());
  const [mediaPicker, setMediaPicker] = useState<{ shot: Shot; type: ShotMediaType } | null>(null);
  const shotsRef = useRef(shots);
  const archiveAssetsRef = useRef<ProgressArchiveMediaAsset[]>([]);
  const sessionBucketByShotIdRef = useRef(sessionBucketByShotId);
  const pendingStatusByShotIdRef = useRef(new Map<string, { version: number; status: ShotStatus }>());
  const persistedStatusByShotIdRef = useRef(new Map(initialShots.map((shot) => [shot.id, shot.status])));
  const statusMutationVersionByShotIdRef = useRef(new Map<string, number>());
  const statusMutationQueueByShotIdRef = useRef(new Map<string, Promise<Shot>>());
  const selectedShotsRefreshVersionRef = useRef(0);
  const criticalLoadVersionRef = useRef(0);
  const progressMediaLoadVersionRef = useRef(0);
  const criticalLoadedEntriesRef = useRef(new Set(seededProgress ? [progressEntryKey] : []));
  const criticalLoadingEntriesRef = useRef(new Map<string, number>());
  const progressMediaLoadedEntriesRef = useRef(new Set<string>());
  const progressMediaLoadingEntriesRef = useRef(new Map<string, number>());
  const galleryArchiveRequestRef = useRef<{
    entryKey: string;
    promise: Promise<ProgressArchiveMediaAsset[]>;
  } | null>(null);
  const resetProgressEntryRef = useRef(progressEntryKey);
  const realtimeRefreshStateRef = useRef(new Map<string, { inFlight: boolean; queued: boolean }>());
  const initializedBucketEntryRef = useRef(seededProgress ? progressEntryKey : "");
  const activeProgressEntryKeyRef = useRef(progressEntryKey);
  const editingScheduleRef = useRef(editingSchedule);
  const nextScheduleSessionIdRef = useRef(0);
  editingScheduleRef.current = editingSchedule;
  const progressCutListGuideRef = useContextualGuideAnchor<HTMLDivElement>("progress.cut-list");
  const progressStatusGuideRef = useContextualGuideAnchor<HTMLDivElement>(
    canEditProgressStatus ? "progress.status-controls" : null
  );
  const { completeGuide, requestGuide } = useContextualGuide();
  const { deleteWithUndo } = useProjectDeleteUndo();
  useAutoContextualGuide(
    "progress.intro",
    isProgressView && Boolean(dailyPlanId) && !isWorkspaceLoading && !isLoading
  );
  useContextualGuideBlocker(
    "progress-overlay",
    Boolean(editingShot || editingSchedule || isAddOpen || preview || mediaPicker)
  );

  const commitSessionBuckets = useCallback((next: Map<string, ProgressVisualBucket>) => {
    sessionBucketByShotIdRef.current = next;
    setSessionBucketByShotId(next);
  }, []);

  useEffect(() => {
    activeProgressEntryKeyRef.current = progressEntryKey;
  }, [progressEntryKey]);

  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

  const selectedPlan = useMemo(
    () => dailyPlans.find((plan) => plan.id === dailyPlanId) ?? null,
    [dailyPlanId, dailyPlans]
  );
  const selectedPrintMeta = useMemo(
    () => decodeDailyPlanMemo(selectedPlan?.memo ?? ""),
    [selectedPlan?.memo]
  );
  // Progress keeps Shot objects and their stable IDs untouched. Only the
  // rendered current-round sequence is derived from the Daily Plan source of
  // truth, so status/media updates cannot fall back to stale order_index rows.
  const orderedShots = useMemo(
    () => orderProgressShotsByShootingOrder(shots, selectedPrintMeta.timetableScenes),
    [selectedPrintMeta.timetableScenes, shots]
  );
  const hasCanonicalProgressOrder = selectedPrintMeta.timetableScenes.length > 0
    && shots.some((shot) => /^\d+$/.test(String(shot.cutNumber ?? "").trim()));
  const selectedPlanRef = useRef<DailyPlan | null>(selectedPlan);
  useLayoutEffect(() => {
    selectedPlanRef.current = selectedPlan;
  }, [selectedPlan]);
  const dailyPlansRef = useRef(dailyPlans);
  dailyPlansRef.current = dailyPlans;
  const commitDailyPlanPatch = useCallback((
    targetDailyPlanId: string,
    patch: Partial<DailyPlan> & Pick<DailyPlan, "updatedAt">
  ) => {
    const current = dailyPlansRef.current.find((plan) => plan.id === targetDailyPlanId);
    if (!current || compareUpdatedAt(patch.updatedAt, current.updatedAt) < 0) return;
    const next = { ...current, ...patch };
    dailyPlansRef.current = [
      next,
      ...dailyPlansRef.current.filter((plan) => plan.id !== targetDailyPlanId)
    ];
    upsertDailyPlan(next);
  }, [upsertDailyPlan]);
  const selectedDailyPlanId = selectedPlan?.id ?? "";
  const hasCurrentProject = Boolean(project && project.id === projectId);

  const handleRealtimeDailyPlanUpdate = useCallback((newRow: Record<string, unknown>) => {
    let remotePlan: DailyPlan;
    try {
      remotePlan = dailyPlanFromRow(newRow);
    } catch {
      return;
    }
    const currentSelectedPlan = selectedPlanRef.current;
    if (
      !currentSelectedPlan
      || remotePlan.projectId !== currentSelectedPlan.projectId
      || remotePlan.id !== currentSelectedPlan.id
      || !remotePlan.updatedAt
    ) return;
    commitDailyPlanPatch(remotePlan.id, remotePlan);
  }, [commitDailyPlanPatch]);

  const startProgressMediaLoad = useCallback((
    criticalShots: Shot[],
    requestedEntryKey: string,
    requestedDailyPlanId: string
  ) => {
    if (
      !projectId
      || !requestedDailyPlanId
      || progressMediaLoadedEntriesRef.current.has(requestedEntryKey)
      || progressMediaLoadingEntriesRef.current.has(requestedEntryKey)
    ) return;

    const mediaLoadVersion = ++progressMediaLoadVersionRef.current;
    progressMediaLoadingEntriesRef.current.set(requestedEntryKey, mediaLoadVersion);
    void (async () => {
      try {
        const [archiveAssets, diagrams, linksByRef] = await Promise.all([
          auditQuery(
            "progress.loadArchiveMediaSummary",
            "app/projects/[id]/page.tsx:startProgressMediaLoad",
            () => loadProgressArchiveMediaAssets(projectId, requestedDailyPlanId, "summary")
          ).catch(() => [] as ProgressArchiveMediaAsset[]),
          criticalShots.length > 0
            ? auditQuery(
                "progress.loadOverheadDiagrams",
                "app/projects/[id]/page.tsx:startProgressMediaLoad",
                () => loadShotOverheadDiagrams(criticalShots)
              ).catch(() => new Map())
            : Promise.resolve(new Map()),
          criticalShots.length > 0
            ? auditQuery(
                "progress.loadMediaLinks",
                "app/projects/[id]/page.tsx:startProgressMediaLoad",
                () => loadShotMediaLinks(criticalShots)
              ).catch(() => new Map<string, ShotMediaLink[]>())
            : Promise.resolve(new Map<string, ShotMediaLink[]>())
        ]);
        if (
          activeProgressEntryKeyRef.current !== requestedEntryKey
          || progressMediaLoadVersionRef.current !== mediaLoadVersion
        ) return;

        const currentSelectedPlan = selectedPlanRef.current?.id === requestedDailyPlanId
          ? selectedPlanRef.current
          : null;
        // Media requests are intentionally non-blocking. Merge their result into
        // the latest Shot instances so an OK/OMIT or Realtime patch that landed
        // while the requests were in flight cannot be replaced by the older seed.
        const currentShots = shotsRef.current;
        const resolvedMediaByShotId = new Map(
          applyShotMediaLinks(currentShots, linksByRef, diagrams)
            .map((shot) => [shot.id, shot])
        );
        const nextShots = currentShots.map((shot) => {
          const resolved = resolvedMediaByShotId.get(shot.id);
          if (
            !resolved
            || (
              resolved.storyboardImageUrl === shot.storyboardImageUrl
              && resolved.overheadImageUrl === shot.overheadImageUrl
              && resolved.overheadDiagram === shot.overheadDiagram
            )
          ) return shot;
          return {
            ...shot,
            storyboardImageUrl: resolved.storyboardImageUrl,
            overheadImageUrl: resolved.overheadImageUrl,
            overheadDiagram: resolved.overheadDiagram
          };
        });
        archiveAssetsRef.current = archiveAssets;
        shotsRef.current = nextShots;
        setShots(nextShots);
        setArchiveMediaByShotId(currentSelectedPlan
          ? buildProgressArchiveMediaByShotId({
              shots: nextShots,
              assets: archiveAssets,
              timetableScenes: decodeDailyPlanMemo(currentSelectedPlan.memo).timetableScenes,
              dailyPlanId: currentSelectedPlan.id,
              episodeNumber: parseEpisodeNumber(currentSelectedPlan.episode)
            })
          : new Map());
        setMediaLinksByShotId(new Map(nextShots.map((shot) => [
          shot.id,
          linksByRef.get(getShotDiagramKey(shot).shotRef) ?? []
        ])));
        progressMediaLoadedEntriesRef.current.add(requestedEntryKey);
      } catch {
        // Background media must never replace the already-rendered critical UI with an error state.
      } finally {
        if (progressMediaLoadingEntriesRef.current.get(requestedEntryKey) === mediaLoadVersion) {
          progressMediaLoadingEntriesRef.current.delete(requestedEntryKey);
        }
      }
    })();
  }, [projectId]);

  const refresh = useCallback(async () => {
    if (!isProgressView || !projectId || isWorkspaceLoading) return;
    const requestedEntryKey = progressEntryKey;

    if (!hasCurrentProject) {
      shotsRef.current = [];
      setShots([]);
      archiveAssetsRef.current = [];
      persistedStatusByShotIdRef.current.clear();
      setArchiveMediaByShotId(new Map());
      setMediaLinksByShotId(new Map());
      commitSessionBuckets(new Map());
      setErrorMessage(workspaceError);
      setIsLoading(false);
      return;
    }
    if (!selectedDailyPlanId) {
      setIsLoading(false);
      return;
    }

    let selectedShots = shotsRef.current;
    if (!criticalLoadedEntriesRef.current.has(requestedEntryKey)) {
      if (criticalLoadingEntriesRef.current.has(requestedEntryKey)) return;
      const criticalLoadVersion = criticalLoadVersionRef.current;
      criticalLoadingEntriesRef.current.set(requestedEntryKey, criticalLoadVersion);
      try {
        const [loadedShots, selectedPlanDetail] = await Promise.all([
          auditQuery(
            "progress.loadCuts",
            "app/projects/[id]/page.tsx:refresh",
            () => listShots(projectId, selectedDailyPlanId)
          ),
          isGuest
            ? auditQuery(
                "progress.loadDailyPlanDetail",
                "app/projects/[id]/page.tsx:refresh",
                () => getProgressDailyPlan(projectId, selectedDailyPlanId)
              )
            : Promise.resolve(null)
        ]);
        if (isGuest && !selectedPlanDetail) {
          throw new Error("선택한 회차 정보를 불러오지 못했습니다.");
        }
        selectedShots = loadedShots;
        if (
          activeProgressEntryKeyRef.current !== requestedEntryKey
          || criticalLoadVersionRef.current !== criticalLoadVersion
        ) return;
        if (selectedPlanDetail) {
          selectedPlanRef.current = selectedPlanDetail;
          commitDailyPlanPatch(selectedPlanDetail.id, selectedPlanDetail);
        }
        criticalLoadedEntriesRef.current.add(requestedEntryKey);
        persistedStatusByShotIdRef.current = new Map(selectedShots.map((shot) => [
          shot.id,
          shot.status
        ]));
        shotsRef.current = selectedShots;
        setShots(selectedShots);
        const shouldInitializeBuckets = initializedBucketEntryRef.current !== requestedEntryKey;
        const nextBuckets = reconcileSessionBuckets(
          selectedShots,
          shouldInitializeBuckets ? new Map() : sessionBucketByShotIdRef.current,
          shouldInitializeBuckets
        );
        initializedBucketEntryRef.current = requestedEntryKey;
        commitSessionBuckets(nextBuckets);
      } catch (error) {
        if (
          activeProgressEntryKeyRef.current === requestedEntryKey
          && criticalLoadVersionRef.current === criticalLoadVersion
        ) {
          setErrorMessage(error instanceof Error ? error.message : "프로젝트 정보를 불러오지 못했습니다.");
          setIsLoading(false);
        }
        return;
      } finally {
        if (criticalLoadingEntriesRef.current.get(requestedEntryKey) === criticalLoadVersion) {
          criticalLoadingEntriesRef.current.delete(requestedEntryKey);
        }
      }
    }

    if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
    setErrorMessage("");
    setIsLoading(false);
    startProgressMediaLoad(selectedShots, requestedEntryKey, selectedDailyPlanId);
  }, [
    commitSessionBuckets,
    commitDailyPlanPatch,
    hasCurrentProject,
    isGuest,
    isProgressView,
    isWorkspaceLoading,
    progressEntryKey,
    projectId,
    selectedDailyPlanId,
    startProgressMediaLoad,
    workspaceError
  ]);

  useEffect(() => {
    if (resetProgressEntryRef.current === progressEntryKey) return;
    resetProgressEntryRef.current = progressEntryKey;
    criticalLoadVersionRef.current += 1;
    progressMediaLoadVersionRef.current += 1;
    criticalLoadedEntriesRef.current.clear();
    criticalLoadingEntriesRef.current.clear();
    progressMediaLoadedEntriesRef.current.clear();
    progressMediaLoadingEntriesRef.current.clear();
    galleryArchiveRequestRef.current = null;
    selectedShotsRefreshVersionRef.current += 1;
    pendingStatusByShotIdRef.current.clear();
    persistedStatusByShotIdRef.current.clear();
    statusMutationVersionByShotIdRef.current.clear();
    statusMutationQueueByShotIdRef.current.clear();
    initializedBucketEntryRef.current = "";
    commitSessionBuckets(new Map());
    shotsRef.current = [];
    setShots([]);
    archiveAssetsRef.current = [];
    setArchiveMediaByShotId(new Map());
    setMediaLinksByShotId(new Map());
    setProcessedExpanded(true);
    setEditingShot(null);
    setEditingSchedule(null);
    setSavingScheduleSessionId(null);
    setIsAddOpen(false);
    setIsSaving(false);
    setIsLoading(Boolean(isProgressView && dailyPlanId));
  }, [commitSessionBuckets, dailyPlanId, isProgressView, progressEntryKey]);

  useEffect(() => {
    if (!isProgressView) {
      setIsLoading(false);
      return;
    }
    void refresh();
  }, [isProgressView, refresh]);

  const nextOrderIndex = shots.length + 1;
  const rebuildArchiveMedia = useCallback((nextShots: Shot[]) => {
    const currentSelectedPlan = selectedPlanRef.current?.id === selectedDailyPlanId
      ? selectedPlanRef.current
      : null;
    setArchiveMediaByShotId(currentSelectedPlan
      ? buildProgressArchiveMediaByShotId({
          shots: nextShots,
          assets: archiveAssetsRef.current,
          timetableScenes: decodeDailyPlanMemo(currentSelectedPlan.memo).timetableScenes,
          dailyPlanId: currentSelectedPlan.id,
          episodeNumber: parseEpisodeNumber(currentSelectedPlan.episode)
        })
      : new Map());
  }, [selectedDailyPlanId]);

  const loadShotGalleryMedia = useCallback(async (shot: Shot) => {
    if (!projectId || !selectedDailyPlanId) return [];
    const requestedEntryKey = progressEntryKey;
    let archiveRequest = galleryArchiveRequestRef.current;
    if (!archiveRequest || archiveRequest.entryKey !== requestedEntryKey) {
      archiveRequest = {
        entryKey: requestedEntryKey,
        promise: auditQuery(
          "progress.loadArchiveMediaGallery",
          "app/projects/[id]/page.tsx:loadShotGalleryMedia",
          () => loadProgressArchiveMediaAssets(projectId, selectedDailyPlanId, "gallery")
        )
      };
      galleryArchiveRequestRef.current = archiveRequest;
    }

    const [archiveAssets, diagram, linksByRef] = await Promise.all([
      archiveRequest.promise,
      auditQuery(
        "progress.loadOverheadDiagram",
        "app/projects/[id]/page.tsx:loadShotGalleryMedia",
        () => loadShotOverheadDiagram(shot)
      ).catch(() => null),
      auditQuery(
        "progress.loadMediaLinksForShot",
        "app/projects/[id]/page.tsx:loadShotGalleryMedia",
        () => loadShotMediaLinks([shot])
      ).catch(() => new Map<string, ShotMediaLink[]>())
    ]);
    if (activeProgressEntryKeyRef.current !== requestedEntryKey) return [];

    const diagramByShotId = diagram ? new Map([[shot.id, diagram]]) : new Map();
    const enrichedShot = applyShotMediaLinks([shot], linksByRef, diagramByShotId)[0] ?? shot;
    const nextShots = shotsRef.current.map((currentShot) => (
      currentShot.id === shot.id
        ? {
            ...currentShot,
            storyboardImageUrl: enrichedShot.storyboardImageUrl,
            overheadImageUrl: enrichedShot.overheadImageUrl,
            overheadDiagram: enrichedShot.overheadDiagram
          }
        : currentShot
    ));
    const currentSelectedPlan = selectedPlanRef.current?.id === selectedDailyPlanId
      ? selectedPlanRef.current
      : null;
    const archiveByShotId = currentSelectedPlan
      ? buildProgressArchiveMediaByShotId({
          shots: nextShots,
          assets: archiveAssets,
          timetableScenes: decodeDailyPlanMemo(currentSelectedPlan.memo).timetableScenes,
          dailyPlanId: currentSelectedPlan.id,
          episodeNumber: parseEpisodeNumber(currentSelectedPlan.episode)
        })
      : new Map<string, ProgressArchiveMediaAsset[]>();
    archiveAssetsRef.current = archiveAssets;
    shotsRef.current = nextShots;
    setShots(nextShots);
    setArchiveMediaByShotId(archiveByShotId);
    setMediaLinksByShotId((current) => {
      const next = new Map(current);
      next.set(shot.id, linksByRef.get(getShotDiagramKey(shot).shotRef) ?? []);
      return next;
    });
    return archiveByShotId.get(shot.id) ?? [];
  }, [progressEntryKey, projectId, selectedDailyPlanId]);

  const refreshSelectedShots = useCallback(async () => {
    if (!projectId || !selectedDailyPlanId) return;
    const requestedProgressEntryKey = progressEntryKey;
    const refreshState = realtimeRefreshStateRef.current.get(requestedProgressEntryKey) ?? {
      inFlight: false,
      queued: false
    };
    realtimeRefreshStateRef.current.set(requestedProgressEntryKey, refreshState);
    if (refreshState.inFlight) {
      refreshState.queued = true;
      return;
    }

    refreshState.inFlight = true;
    try {
      do {
        refreshState.queued = false;
        const requestedEntryKey = progressEntryKey;
        const refreshVersion = ++selectedShotsRefreshVersionRef.current;
        try {
          const refreshedShots = await auditQuery(
            "progress.realtime.reloadCuts",
            "app/projects/[id]/page.tsx:refreshSelectedShots",
            () => listShots(projectId, selectedDailyPlanId)
          );
          if (
            activeProgressEntryKeyRef.current !== requestedEntryKey
            || selectedShotsRefreshVersionRef.current !== refreshVersion
          ) continue;
          const currentById = new Map(shotsRef.current.map((shot) => [shot.id, shot]));
          persistedStatusByShotIdRef.current = new Map(refreshedShots.map((shot) => [
            shot.id,
            shot.status
          ]));
          const nextShots = refreshedShots.map((shot) => {
            const enrichedShot = preserveShotMedia(shot, currentById.get(shot.id));
            const pendingStatus = pendingStatusByShotIdRef.current.get(shot.id);
            return pendingStatus ? { ...enrichedShot, status: pendingStatus.status } : enrichedShot;
          });
          shotsRef.current = nextShots;
          setShots(nextShots);
          rebuildArchiveMedia(nextShots);
          setMediaLinksByShotId((current) => new Map(nextShots.map((shot) => [
            shot.id,
            current.get(shot.id) ?? []
          ])));
          commitSessionBuckets(reconcileSessionBuckets(nextShots, sessionBucketByShotIdRef.current, false));
        } catch (error) {
          if (
            activeProgressEntryKeyRef.current !== requestedEntryKey
            || selectedShotsRefreshVersionRef.current !== refreshVersion
          ) continue;
          setErrorMessage(error instanceof Error ? error.message : "진행도 화면을 갱신하지 못했습니다.");
        }
      } while (
        refreshState.queued
        && activeProgressEntryKeyRef.current === progressEntryKey
      );
    } finally {
      refreshState.inFlight = false;
      realtimeRefreshStateRef.current.delete(requestedProgressEntryKey);
    }
  }, [commitSessionBuckets, progressEntryKey, projectId, rebuildArchiveMedia, selectedDailyPlanId]);

  const handleRealtimeShotChanges = useCallback((changes: ShotRealtimeChange[] | null) => {
    if (!changes || changes.length === 0) {
      void refreshSelectedShots();
      return;
    }

    const nextById = new Map(shotsRef.current.map((shot) => [shot.id, shot]));
    let didChange = false;
    for (const change of changes) {
      if (change.eventType === "DELETE") {
        const deletedId = String(change.oldRow.id ?? change.newRow.id ?? "").trim();
        if (!deletedId) {
          void refreshSelectedShots();
          return;
        }
        const deletedPlanId = String(change.oldRow.daily_plan_id ?? "").trim();
        if (deletedPlanId && deletedPlanId !== selectedDailyPlanId) continue;
        if (!nextById.delete(deletedId)) continue;
        didChange = true;
        pendingStatusByShotIdRef.current.delete(deletedId);
        persistedStatusByShotIdRef.current.delete(deletedId);
        statusMutationVersionByShotIdRef.current.delete(deletedId);
        statusMutationQueueByShotIdRef.current.delete(deletedId);
        continue;
      }

      let remote: Shot;
      try {
        remote = shotFromRow(change.newRow);
      } catch {
        void refreshSelectedShots();
        return;
      }
      if (!remote.id || remote.projectId !== projectId || remote.dailyPlanId !== selectedDailyPlanId) {
        void refreshSelectedShots();
        return;
      }
      const previous = nextById.get(remote.id);
      if (previous?.updatedAt === remote.updatedAt) continue;
      persistedStatusByShotIdRef.current.set(remote.id, remote.status);
      const enriched = preserveShotMedia(remote, previous);
      const pendingStatus = pendingStatusByShotIdRef.current.get(remote.id);
      nextById.set(remote.id, pendingStatus ? { ...enriched, status: pendingStatus.status } : enriched);
      didChange = true;
    }
    if (!didChange) return;
    const nextShots = [...nextById.values()]
      .sort((left, right) => left.orderIndex - right.orderIndex || left.createdAt.localeCompare(right.createdAt));
    shotsRef.current = nextShots;
    setShots(nextShots);
    rebuildArchiveMedia(nextShots);
    setMediaLinksByShotId((current) => new Map(nextShots.map((shot) => [
      shot.id,
      current.get(shot.id) ?? []
    ])));
    commitSessionBuckets(reconcileSessionBuckets(
      nextShots,
      sessionBucketByShotIdRef.current,
      false
    ));
  }, [commitSessionBuckets, projectId, rebuildArchiveMedia, refreshSelectedShots, selectedDailyPlanId]);

  const applyGuestRealtimeSnapshot = useCallback((event: ProgressSnapshotStreamEvent) => {
    const requestedEntryKey = progressEntryKey;
    if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
    let snapshotShots: Shot[];
    try {
      snapshotShots = event.shots.map(shotFromRow);
    } catch {
      return;
    }
    if (snapshotShots.some((shot) => (
      !shot.id
      || shot.projectId !== projectId
      || shot.dailyPlanId !== selectedDailyPlanId
    ))) return;

    if (event.dailyPlan) handleRealtimeDailyPlanUpdate(event.dailyPlan);
    criticalLoadVersionRef.current += 1;
    criticalLoadingEntriesRef.current.delete(requestedEntryKey);
    criticalLoadedEntriesRef.current.add(requestedEntryKey);
    selectedShotsRefreshVersionRef.current += 1;
    const currentById = new Map(shotsRef.current.map((shot) => [shot.id, shot]));
    const nextShots = snapshotShots.map((shot) => {
      persistedStatusByShotIdRef.current.set(shot.id, shot.status);
      const enriched = preserveShotMedia(shot, currentById.get(shot.id));
      const pendingStatus = pendingStatusByShotIdRef.current.get(shot.id);
      return pendingStatus ? { ...enriched, status: pendingStatus.status } : enriched;
    });
    const snapshotIds = new Set(nextShots.map((shot) => shot.id));
    [...persistedStatusByShotIdRef.current.keys()].forEach((shotId) => {
      if (!snapshotIds.has(shotId)) persistedStatusByShotIdRef.current.delete(shotId);
    });
    shotsRef.current = nextShots;
    setShots(nextShots);
    rebuildArchiveMedia(nextShots);
    setMediaLinksByShotId((current) => new Map(nextShots.map((shot) => [
      shot.id,
      current.get(shot.id) ?? []
    ])));
    initializedBucketEntryRef.current = requestedEntryKey;
    commitSessionBuckets(reconcileSessionBuckets(
      nextShots,
      sessionBucketByShotIdRef.current,
      false
    ));
    setErrorMessage("");
    setIsLoading(false);
    startProgressMediaLoad(nextShots, requestedEntryKey, selectedDailyPlanId);
  }, [
    commitSessionBuckets,
    handleRealtimeDailyPlanUpdate,
    progressEntryKey,
    projectId,
    rebuildArchiveMedia,
    selectedDailyPlanId,
    startProgressMediaLoad
  ]);

  useEffect(() => {
    if (isGuest || !projectId || !selectedDailyPlanId) return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void import("@/lib/realtime/subscribeToProgressChanges")
      .then(({ subscribeToProgressChanges }) => {
        if (cancelled) return;
        unsubscribe = subscribeToProgressChanges(projectId, selectedDailyPlanId, {
          onShotChanges: handleRealtimeShotChanges,
          onDailyPlanChange: (change) => handleRealtimeDailyPlanUpdate(change.newRow)
        });
      })
      .catch(() => {
        // A later navigation/reload can retry a failed member-only chunk.
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    handleRealtimeDailyPlanUpdate,
    handleRealtimeShotChanges,
    isGuest,
    projectId,
    selectedDailyPlanId
  ]);

  useEffect(() => {
    if (!isGuest || !isProgressView || !projectId || !selectedDailyPlanId) return undefined;
    return subscribeToGuestProgress(projectId, selectedDailyPlanId, {
      onSnapshot: applyGuestRealtimeSnapshot,
      onShot: (event) => handleRealtimeShotChanges([event]),
      onDailyPlan: (event) => handleRealtimeDailyPlanUpdate(event.newRow)
    });
  }, [
    applyGuestRealtimeSnapshot,
    handleRealtimeDailyPlanUpdate,
    handleRealtimeShotChanges,
    isGuest,
    isProgressView,
    projectId,
    selectedDailyPlanId
  ]);

  const refreshSelectedShotMedia = useCallback(async () => {
    if (!projectId || !dailyPlanId) return;
    const requestedEntryKey = progressEntryKey;
    const currentShots = shotsRef.current;
    progressMediaLoadVersionRef.current += 1;
    selectedShotsRefreshVersionRef.current += 1;
    if (currentShots.length === 0) {
      setMediaLinksByShotId(new Map());
      return;
    }
    const [diagrams, linksByRef] = await Promise.all([
      auditQuery(
        "progress.reloadOverheadDiagrams",
        "app/projects/[id]/page.tsx:refreshSelectedShotMedia",
        () => loadShotOverheadDiagrams(currentShots)
      ),
      auditQuery(
        "progress.reloadMediaLinks",
        "app/projects/[id]/page.tsx:refreshSelectedShotMedia",
        () => loadShotMediaLinks(currentShots)
      )
    ]);
    if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
    // Linked storyboard URLs are projected onto the shot model for rendering. Strip
    // the previous projection before applying the newly fetched links so unlinking
    // an asset does not keep the old URL alive through applyShotMediaLinks' legacy
    // storyboard fallback.
    const mediaBaselineShots = currentShots.map((shot) => {
      const previousStoryboardLink = (mediaLinksByShotId.get(shot.id) ?? [])
        .find((link) => link.mediaType === "storyboard");
      return previousStoryboardLink?.publicUrl === shot.storyboardImageUrl
        ? { ...shot, storyboardImageUrl: null }
        : shot;
    });
    const refreshedMediaByShotId = new Map(
      applyShotMediaLinks(mediaBaselineShots, linksByRef, diagrams).map((shot) => [shot.id, shot])
    );
    const nextShots = shotsRef.current.map((shot) => {
      const refreshedMedia = refreshedMediaByShotId.get(shot.id);
      return refreshedMedia
        ? {
            ...shot,
            storyboardImageUrl: refreshedMedia.storyboardImageUrl,
            overheadImageUrl: refreshedMedia.overheadImageUrl,
            overheadDiagram: refreshedMedia.overheadDiagram
          }
        : shot;
    });
    shotsRef.current = nextShots;
    setShots(nextShots);
    rebuildArchiveMedia(nextShots);
    commitSessionBuckets(reconcileSessionBuckets(
      nextShots,
      sessionBucketByShotIdRef.current,
      false
    ));
    setMediaLinksByShotId(new Map(nextShots.map((shot) => [
      shot.id,
      linksByRef.get(getShotDiagramKey(shot).shotRef) ?? []
    ])));
  }, [commitSessionBuckets, dailyPlanId, mediaLinksByShotId, progressEntryKey, projectId, rebuildArchiveMedia]);
  const dailyProgress = useMemo(() => calculateDailyProgress(shots), [shots]);
  const activeShots = useMemo(
    () => orderedShots.filter((shot) => getPersistedStatusBucket(shot.status) === "active"),
    [orderedShots]
  );
  const okShots = useMemo(
    () => orderedShots.filter((shot) => getPersistedStatusBucket(shot.status) === "ok"),
    [orderedShots]
  );
  const omitShots = useMemo(
    () => orderedShots.filter((shot) => getPersistedStatusBucket(shot.status) === "omit"),
    [orderedShots]
  );
  const processedShots = useMemo(
    () => orderedShots.filter((shot) => getPersistedStatusBucket(shot.status) !== "active"),
    [orderedShots]
  );
  const visibleShotsForMediaGuide = useMemo(() => [
    ...activeShots,
    ...(processedExpanded ? processedShots : [])
  ], [activeShots, processedExpanded, processedShots]);
  const mediaGuideShotId = useMemo(() => (
    visibleShotsForMediaGuide.find((shot) => hasMultipleProgressGalleryItems(
      shot,
      archiveMediaByShotId.get(shot.id) ?? EMPTY_PROGRESS_ARCHIVE_MEDIA
    ))?.id ?? null
  ), [archiveMediaByShotId, visibleShotsForMediaGuide]);
  const reorderGuideBucket = useMemo<ProgressVisualBucket | null>(() => {
    if (role !== "admin" || isReordering) return null;
    if (activeShots.length >= 2) return "active";
    if (processedExpanded && processedShots.length >= 2) return "ok";
    return null;
  }, [activeShots.length, isReordering, processedExpanded, processedShots.length, role]);
  const scheduleRowsByIndex = useMemo(
    () => selectedPlan ? placeScheduleRows(orderedShots, selectedPlan.mealTimes, selectedPrintMeta.timetableRowOrder) : new Map<number, DailyPlanMealTime[]>(),
    [orderedShots, selectedPlan, selectedPrintMeta.timetableRowOrder]
  );
  const activeScheduleRowsByIndex = useMemo(
    () => remapScheduleRowsForVisibleShots(orderedShots, activeShots, scheduleRowsByIndex),
    [activeShots, orderedShots, scheduleRowsByIndex]
  );
  const scheduleRowCount = selectedPlan?.mealTimes.filter(isMeaningfulScheduleRow).length ?? 0;
  const progressActionMenu = useMemo<ProjectPageActionMenuRegistration | null>(() => {
    if (
      !project
      || !projectId
      || project.id !== projectId
      || !isProgressView
      || !dailyPlanId
      || !selectedPlan
      || selectedPlan.projectId !== project.id
    ) return null;
    return {
      key: "progressDetail",
      scopeKey: `progress-detail:${project.id}:${dailyPlanId}`,
      actions: {
        progressAddCut: {
          onSelect: () => setIsAddOpen(true),
          hidden: progressOnly,
          disabled: isSaving
        },
        progressGatheringPhotoAdd: {
          onSelect: gatheringLocationActions?.addPhotos,
          hidden: progressOnly || !gatheringLocationActions?.visible,
          hiddenInDrawer: true,
          disabled: gatheringLocationActions?.addPhotosDisabled ?? true,
          pending: gatheringLocationActions?.addPhotosPending ?? false
        },
        progressGatheringPhotoManage: {
          onSelect: gatheringLocationActions?.managePhotos,
          hidden: progressOnly || !gatheringLocationActions?.visible,
          hiddenInDrawer: true,
          disabled: gatheringLocationActions?.managePhotosDisabled ?? true
        },
        progressGatheringAddressEdit: {
          onSelect: gatheringLocationActions?.editAddress,
          hidden: progressOnly || !gatheringLocationActions?.visible,
          disabled: gatheringLocationActions?.editAddressDisabled ?? true,
          pending: gatheringLocationActions?.editAddressPending ?? false
        }
      }
    };
  }, [
    dailyPlanId,
    gatheringLocationActions,
    isProgressView,
    isSaving,
    progressOnly,
    project,
    projectId,
    selectedPlan
  ]);
  useProjectPageActionMenu(progressActionMenu);
  const handleImagePreview = useCallback((url: string, title: string) => {
    setPreview({ url, title: title.trim() || "콘티" });
  }, []);
  const handleDailyPlanMetadataChange = useCallback((
    patch: Pick<DailyPlan, "memo" | "updatedAt"> & Partial<Pick<DailyPlan, "shootingLocations">>
  ) => {
    if (!selectedDailyPlanId) return;
    commitDailyPlanPatch(selectedDailyPlanId, patch);
  }, [commitDailyPlanPatch, selectedDailyPlanId]);

  const handleStatusChange = useCallback(async (targetShot: Shot, status: ShotStatus) => {
    if (!canEditProgressStatus) return;
    completeGuide("progress.intro");
    requestGuide("progress.status", "feature");
    const requestedEntryKey = activeProgressEntryKeyRef.current;
    const currentShot = shotsRef.current.find((shot) => shot.id === targetShot.id) ?? targetShot;
    const persistedStatusBeforeMutation = persistedStatusByShotIdRef.current.get(targetShot.id) ?? currentShot.status;
    const mutationVersion = (statusMutationVersionByShotIdRef.current.get(targetShot.id) ?? 0) + 1;
    statusMutationVersionByShotIdRef.current.set(targetShot.id, mutationVersion);
    pendingStatusByShotIdRef.current.set(targetShot.id, { version: mutationVersion, status });
    selectedShotsRefreshVersionRef.current += 1;
    setErrorMessage("");
    const optimisticShots = shotsRef.current.map((shot) => (
      shot.id === targetShot.id ? { ...shot, status } : shot
    ));
    shotsRef.current = optimisticShots;
    setShots(optimisticShots);

    const previousMutation = statusMutationQueueByShotIdRef.current.get(targetShot.id);
    const mutation = (previousMutation
      ? previousMutation.catch(() => currentShot)
      : Promise.resolve(currentShot)
    ).then((latestShot) => updateShotStatus(latestShot, status));
    statusMutationQueueByShotIdRef.current.set(targetShot.id, mutation);

    try {
      const savedShot = await mutation;
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      persistedStatusByShotIdRef.current.set(targetShot.id, savedShot.status);
      selectedShotsRefreshVersionRef.current += 1;
      const pendingStatus = pendingStatusByShotIdRef.current.get(targetShot.id);
      if (
        pendingStatus?.version !== mutationVersion
      ) return;
      pendingStatusByShotIdRef.current.delete(targetShot.id);
      const persistedShots = shotsRef.current.map((shot) => (
        shot.id === savedShot.id
          ? { ...shot, status: savedShot.status, updatedAt: savedShot.updatedAt }
          : shot
      ));
      shotsRef.current = persistedShots;
      setShots(persistedShots);
    } catch (error) {
      const pendingStatus = pendingStatusByShotIdRef.current.get(targetShot.id);
      if (
        activeProgressEntryKeyRef.current !== requestedEntryKey
        || pendingStatus?.version !== mutationVersion
      ) return;
      pendingStatusByShotIdRef.current.delete(targetShot.id);
      const restoredStatus = persistedStatusByShotIdRef.current.get(targetShot.id)
        ?? persistedStatusBeforeMutation;
      const restoredShots = shotsRef.current.map((shot) => (
        shot.id === targetShot.id ? { ...shot, status: restoredStatus } : shot
      ));
      shotsRef.current = restoredShots;
      setShots(restoredShots);
      setErrorMessage(
        error instanceof Error
          ? `${error.message} 이전 상태로 되돌렸습니다.`
          : "상태를 저장하지 못해 이전 상태로 되돌렸습니다."
      );
    } finally {
      if (statusMutationQueueByShotIdRef.current.get(targetShot.id) === mutation) {
        statusMutationQueueByShotIdRef.current.delete(targetShot.id);
      }
    }
  }, [canEditProgressStatus, completeGuide, requestGuide]);

  async function handleSaveNewShot(values: ShotEditorValues) {
    if (!projectId || !dailyPlanId) return;
    const requestedEntryKey = activeProgressEntryKeyRef.current;

    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const drafts: ShotDraft[] = [
        {
          sceneNumber: values.sceneNumber.trim() || "1",
          cutNumber: values.cutNumber.trim() || String(nextOrderIndex),
          title: values.title.trim(),
          description: values.description.trim(),
          location: values.location.trim(),
          characters: parseCharacters(values.charactersText),
          memo: values.memo.trim(),
          orderIndex: nextOrderIndex,
          status: values.status
        }
      ];

      const createdShots = await createShotsFromDrafts(projectId, drafts, dailyPlanId);
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      selectedShotsRefreshVersionRef.current += 1;

      const currentShots = shotsRef.current;
      const currentById = new Map(currentShots.map((shot) => [shot.id, shot]));
      const createdIds = new Set(createdShots.map((shot) => shot.id));
      const nextShots = [
        ...currentShots.filter((shot) => !createdIds.has(shot.id)),
        ...createdShots.map((shot) => preserveShotMedia(shot, currentById.get(shot.id)))
      ].sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt));
      createdShots.forEach((shot) => persistedStatusByShotIdRef.current.set(shot.id, shot.status));

      shotsRef.current = nextShots;
      setShots(nextShots);
      rebuildArchiveMedia(nextShots);
      commitSessionBuckets(reconcileSessionBuckets(
        nextShots,
        sessionBucketByShotIdRef.current,
        false
      ));

      setIsAddOpen(false);
      setSuccessMessage("새 컷을 추가했습니다.");
    } catch (error) {
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setErrorMessage(error instanceof Error ? error.message : "컷을 추가하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveExistingShot(values: ShotEditorValues) {
    if (!projectId || !editingShot || role !== "admin") return;
    const requestedEntryKey = activeProgressEntryKeyRef.current;

    setErrorMessage("");

    try {
      const savedShot = await updateShot(editingShot.id, {
        description: values.description.trim(),
        characters: parseCharacters(values.charactersText)
      }, projectId);
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      selectedShotsRefreshVersionRef.current += 1;

      const nextShots = shotsRef.current.map((shot) => (
        shot.id === savedShot.id
          ? {
              ...shot,
              description: savedShot.description,
              characters: savedShot.characters,
              updatedAt: savedShot.updatedAt
            }
          : shot
      ));
      shotsRef.current = nextShots;
      setShots(nextShots);
      rebuildArchiveMedia(nextShots);
      commitSessionBuckets(reconcileSessionBuckets(
        nextShots,
        sessionBucketByShotIdRef.current,
        false
      ));
    } catch (error) {
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setErrorMessage(error instanceof Error ? error.message : "컷을 저장하지 못했습니다.");
      throw error;
    }
  }

  async function persistScheduleItemPatch(
    targetDailyPlanId: string,
    itemId: string,
    patch: Partial<Pick<DailyPlanMealTime, "progressMemo" | "imageUrl">>
  ) {
    const basePlan = dailyPlansRef.current.find((plan) => plan.id === targetDailyPlanId);
    if (!projectId || !basePlan) {
      throw new Error("일촬표를 찾을 수 없습니다.");
    }
    let expectedUpdatedAt = basePlan.updatedAt;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await updateDailyPlanScheduleItem(
          projectId,
          targetDailyPlanId,
          itemId,
          patch,
          expectedUpdatedAt
        );
        commitDailyPlanPatch(targetDailyPlanId, {
          mealTimes: result.mealTimes,
          updatedAt: result.updatedAt
        });
        return result.mealTimes;
      } catch (error) {
        const latest = error instanceof AutosaveConflictError
          ? error.latest as DailyPlanScheduleItemMutationResult | null
          : null;
        if (attempt === 0 && latest?.updatedAt) {
          const currentPlan = dailyPlansRef.current.find((plan) => plan.id === targetDailyPlanId);
          expectedUpdatedAt = currentPlan
            && compareUpdatedAt(currentPlan.updatedAt, latest.updatedAt) > 0
            ? currentPlan.updatedAt
            : latest.updatedAt;
          continue;
        }
        throw error;
      }
    }
    throw new Error("기타일정 정보를 저장하지 못했습니다.");
  }

  function scheduleEditorTargetIsCurrent(target: EditingScheduleState) {
    const current = editingScheduleRef.current;
    return activeProgressEntryKeyRef.current === target.entryKey
      && current?.sessionId === target.sessionId
      && current.dailyPlanId === target.dailyPlanId
      && current.item.id === target.item.id;
  }

  async function handleSaveSchedule(values: ProgressScheduleEditorValues) {
    const target = editingSchedule;
    if (!projectId || !target || progressOnly) return;

    setSavingScheduleSessionId(target.sessionId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      let imageUrl = values.imageUrl;
      if (values.imageFile) {
        imageUrl = await saveScheduleImage(projectId, target.dailyPlanId, target.item.id, values.imageFile);
      }
      await persistScheduleItemPatch(target.dailyPlanId, target.item.id, {
        imageUrl
      });
      if (scheduleEditorTargetIsCurrent(target)) {
        setEditingSchedule((current) => current?.sessionId === target.sessionId ? null : current);
      }
    } catch (error) {
      if (scheduleEditorTargetIsCurrent(target)) {
        setErrorMessage(error instanceof Error ? error.message : "기타일정 정보를 저장하지 못했습니다.");
      }
    } finally {
      setSavingScheduleSessionId((current) => current === target.sessionId ? null : current);
    }
  }

  function handleDeleteScheduleImage(imageUrl: string) {
    const target = editingSchedule;
    const basePlan = target
      ? dailyPlansRef.current.find((plan) => plan.id === target.dailyPlanId)
      : null;
    if (!projectId || !target || !basePlan || progressOnly || target.item.imageUrl !== imageUrl) return;
    const originalImageUrl = imageUrl;
    const expectedUpdatedAt = basePlan.updatedAt;
    let receipt = "";
    let locallyRestored = false;
    const patchLocalImage = (nextImageUrl: string | null, restoreOnlyIfEmpty = false) => {
      const currentPlan = dailyPlansRef.current.find((plan) => plan.id === target.dailyPlanId);
      if (!currentPlan) return;
      commitDailyPlanPatch(target.dailyPlanId, {
        mealTimes: currentPlan.mealTimes.map((item) => (
          item.id === target.item.id
            ? restoreOnlyIfEmpty && item.imageUrl && item.imageUrl !== originalImageUrl
              ? item
              : { ...item, imageUrl: nextImageUrl }
            : item
        )),
        updatedAt: currentPlan.updatedAt
      });
    };
    deleteWithUndo({
      key: `schedule-image:${target.dailyPlanId}:${target.item.id}`,
      label: "기타일정 이미지",
      removeLocal: () => {
        locallyRestored = false;
        patchLocalImage(null);
        setEditingSchedule((current) => current?.sessionId === target.sessionId ? null : current);
        setErrorMessage("");
      },
      restoreLocal: () => {
        locallyRestored = true;
        patchLocalImage(originalImageUrl, true);
      },
      deleteRemote: async () => {
        try {
          const result = await deleteScheduleImageWithReceipt({
            projectId,
            dailyPlanId: target.dailyPlanId,
            itemId: target.item.id,
            imageUrl: originalImageUrl,
            expectedUpdatedAt
          });
          receipt = result.receipt;
          if (!locallyRestored) {
            commitDailyPlanPatch(target.dailyPlanId, {
              mealTimes: result.mealTimes,
              updatedAt: result.updatedAt
            });
          }
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "기타일정 이미지를 삭제하지 못했습니다.");
          throw error;
        }
      },
      restoreRemote: async () => {
        try {
          const result = await restoreScheduleImageDelete(projectId, receipt);
          commitDailyPlanPatch(target.dailyPlanId, {
            mealTimes: result.mealTimes,
            updatedAt: result.updatedAt
          });
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "기타일정 이미지 삭제를 되돌리지 못했습니다.");
          throw error;
        }
      },
      finalize: () => finalizeScheduleImageDelete(projectId, receipt)
    });
  }

  async function handleAutosaveScheduleMemo(memo: string) {
    const target = editingSchedule;
    if (!projectId || !target || progressOnly) return;
    try {
      await persistScheduleItemPatch(target.dailyPlanId, target.item.id, {
        progressMemo: memo.trim()
      });
      if (scheduleEditorTargetIsCurrent(target)) setErrorMessage("");
    } catch (error) {
      if (scheduleEditorTargetIsCurrent(target)) {
        setErrorMessage(error instanceof Error ? error.message : "기타일정 메모를 자동 저장하지 못했습니다.");
      }
      throw error;
    }
  }

  function handleDeleteShot(shot: Shot) {
    const requestedEntryKey = activeProgressEntryKeyRef.current;
    const originalIndex = shotsRef.current.findIndex((item) => item.id === shot.id);
    const originalBucket = sessionBucketByShotIdRef.current.get(shot.id) ?? getPersistedStatusBucket(shot.status);
    const originalLinks = mediaLinksByShotId.get(shot.id) ?? [];
    let deleteReceipt: string | null = null;
    deleteWithUndo({
      key: `shot:${shot.id}`,
      label: `컷 “${shot.title}”`,
      removeLocal: () => {
        if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
        selectedShotsRefreshVersionRef.current += 1;
        const nextShots = shotsRef.current.filter((item) => item.id !== shot.id);
        pendingStatusByShotIdRef.current.delete(shot.id);
        persistedStatusByShotIdRef.current.delete(shot.id);
        statusMutationVersionByShotIdRef.current.delete(shot.id);
        statusMutationQueueByShotIdRef.current.delete(shot.id);
        shotsRef.current = nextShots;
        setShots(nextShots);
        rebuildArchiveMedia(nextShots);
        setMediaLinksByShotId((current) => {
          const next = new Map(current);
          next.delete(shot.id);
          return next;
        });
        commitSessionBuckets(reconcileSessionBuckets(nextShots, sessionBucketByShotIdRef.current, false));
        setEditingShot(null);
      },
      restoreLocal: () => {
        if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
        if (shotsRef.current.some((item) => item.id === shot.id)) return;
        const nextShots = [...shotsRef.current];
        nextShots.splice(Math.max(0, Math.min(originalIndex, nextShots.length)), 0, shot);
        shotsRef.current = nextShots;
        setShots(nextShots);
        rebuildArchiveMedia(nextShots);
        persistedStatusByShotIdRef.current.set(shot.id, shot.status);
        const nextBuckets = new Map(sessionBucketByShotIdRef.current);
        nextBuckets.set(shot.id, originalBucket);
        commitSessionBuckets(nextBuckets);
        if (originalLinks.length > 0) {
          setMediaLinksByShotId((current) => new Map(current).set(shot.id, originalLinks));
        }
      },
      deleteRemote: async () => {
        deleteReceipt = await deleteShot(shot);
      },
      restoreRemote: () => restoreDeletedShots(shot.projectId, deleteReceipt, [shot]),
      finalize: () => finalizeDeletedShots(shot.projectId, deleteReceipt)
    });
  }

  const handleOpenMedia = useCallback((shot: Shot, type: ShotMediaType) => {
    if (isGuest) return;
    setMediaPicker({ shot, type });
  }, [isGuest]);

  const renderShot = useCallback((shot: Shot) => (
    <ShotCard
      shot={shot}
      onOpen={isGuest ? () => undefined : setEditingShot}
      onOpenMedia={handleOpenMedia}
      archiveMedia={archiveMediaByShotId.get(shot.id) ?? EMPTY_PROGRESS_ARCHIVE_MEDIA}
      onLoadGalleryMedia={loadShotGalleryMedia}
      onStatusChange={handleStatusChange}
      progressOnly={progressOnly}
      cardOpenDisabled={isGuest}
      statusReadOnly={!canEditProgressStatus}
      showMediaActions={!isGuest}
      interactionMediaGuideTarget={shot.id === mediaGuideShotId}
    />
  ), [archiveMediaByShotId, canEditProgressStatus, handleOpenMedia, handleStatusChange, isGuest, loadShotGalleryMedia, mediaGuideShotId, progressOnly]);

  async function handleReorderShots(nextShots: Shot[]) {
    if (!projectId || !dailyPlanId || !selectedPlan || role !== "admin" || isReordering) return;

    const requestedEntryKey = activeProgressEntryKeyRef.current;
    const previousShots = shotsRef.current;
    const previousPlan = selectedPlan;
    let optimisticMemo: string | null = null;
    selectedShotsRefreshVersionRef.current += 1;
    setIsReordering(true);
    setErrorMessage("");
    shotsRef.current = nextShots;
    setShots(nextShots);

    try {
      if (hasCanonicalProgressOrder) {
        optimisticMemo = encodeDailyPlanMemo(normalizeDailyPlanPrintMeta({
          ...selectedPrintMeta,
          timetableScenes: applyProgressOrderToTimetableScenes(
            selectedPrintMeta.timetableScenes,
            nextShots
          )
        }));
        commitDailyPlanPatch(dailyPlanId, {
          memo: optimisticMemo,
          updatedAt: selectedPlan.updatedAt
        });
        const saved = await updateDailyPlanProgressOrder(
          projectId,
          dailyPlanId,
          nextShots,
          selectedPlan.updatedAt
        );
        if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
        commitDailyPlanPatch(dailyPlanId, saved);
        return;
      }
      const savedShots = await reorderShots(projectId, dailyPlanId, nextShots.map((shot) => shot.id));
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      const persistedShots = mergeShotOrder(shotsRef.current, savedShots);
      shotsRef.current = persistedShots;
      setShots(persistedShots);
    } catch (error) {
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      const currentPlan = dailyPlansRef.current.find((plan) => plan.id === dailyPlanId);
      if (
        hasCanonicalProgressOrder
        && optimisticMemo
        && currentPlan?.memo === optimisticMemo
        && currentPlan.updatedAt === previousPlan.updatedAt
      ) {
        commitDailyPlanPatch(dailyPlanId, previousPlan);
      }
      const restoredShots = mergeShotOrder(shotsRef.current, previousShots);
      shotsRef.current = restoredShots;
      setShots(restoredShots);
      setErrorMessage(error instanceof Error ? error.message : "컷 순서를 저장하지 못했습니다.");
    } finally {
      setIsReordering(false);
    }
  }

  function handleResetCurrentProjectShots() {
    if (!projectId || !dailyPlanId) return;
    const requestedEntryKey = activeProgressEntryKeyRef.current;
    const snapshots = [...shotsRef.current];
    if (snapshots.length === 0) return;
    const originalBuckets = new Map(sessionBucketByShotIdRef.current);
    const originalLinks = new Map(mediaLinksByShotId);
    let deleteReceipt: string | null = null;
    deleteWithUndo({
      key: `shots:${dailyPlanId}:all`,
      label: "현재 회차 컷 목록",
      removeLocal: () => {
        if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
        selectedShotsRefreshVersionRef.current += 1;
        pendingStatusByShotIdRef.current.clear();
        persistedStatusByShotIdRef.current.clear();
        statusMutationVersionByShotIdRef.current.clear();
        statusMutationQueueByShotIdRef.current.clear();
        shotsRef.current = [];
        setShots([]);
        setArchiveMediaByShotId(new Map());
        setMediaLinksByShotId(new Map());
        commitSessionBuckets(new Map());
      },
      restoreLocal: () => {
        if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
        shotsRef.current = snapshots;
        setShots(snapshots);
        rebuildArchiveMedia(snapshots);
        setMediaLinksByShotId(originalLinks);
        persistedStatusByShotIdRef.current = new Map(snapshots.map((shot) => [shot.id, shot.status]));
        commitSessionBuckets(originalBuckets);
      },
      deleteRemote: async () => {
        deleteReceipt = await deleteAllShots(projectId, dailyPlanId);
      },
      restoreRemote: () => restoreDeletedShots(projectId, deleteReceipt, snapshots),
      finalize: () => finalizeDeletedShots(projectId, deleteReceipt)
    });
  }

  if (isWorkspaceLoading || isLoading) {
    return <PageLoader />;
  }

  if (!project) {
    return (
      <Card className="border-field-danger text-field-danger">
        <p className="font-bold">{workspaceError || errorMessage || "프로젝트를 찾을 수 없습니다."}</p>
        <ButtonLink href="/" className="mt-4">
          프로젝트 선택으로
        </ButtonLink>
      </Card>
    );
  }

  if (!isProgressView) {
    return (
      <ProjectGuideMenu
        projectId={project.id}
        projectName={project.name}
        role={role}
        calendarInfo={project.calendarInfo ?? project.basicInfo ?? null}
        dailyPlans={dailyPlans}
      />
    );
  }

  if (!dailyPlanId || !selectedPlan) {
    return (
      <EpisodeSelection
        hasPlans={dailyPlans.length > 0}
        invalidSelection={Boolean(requestedDailyPlanId)}
      />
    );
  }

  return (
    <>
      <ProgressDetailHeader
        projectName={project.name}
        episodeLabel={formatEpisodeLabel(selectedPlan, 0)}
        shootingDate={selectedPlan.shootingDate}
        action={null}
      />

      <DailyProgressSummary progress={dailyProgress} />

      {isGuest ? (
        <StableDailyPlanGatheringLocationsReadOnly plan={selectedPlan} />
      ) : (
        <StableDailyPlanGatheringLocations
          projectId={project.id}
          plan={selectedPlan}
          canEdit={role === "admin"}
          onPlanMetadataChange={handleDailyPlanMetadataChange}
          onActionsChange={setGatheringLocationActions}
        />
      )}

      {errorMessage ? (
        <div role="alert" className="mb-3 border border-field-danger bg-field-panel p-3 text-sm font-semibold text-field-danger">
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div role="status" className="mb-3 border border-field-divider bg-field-soft p-3 text-sm font-semibold text-field-subtle">
          {successMessage}
        </div>
      ) : null}

      <div ref={progressCutListGuideRef} id="cut-board" className="scroll-mt-28 pb-24">
        <div className="mb-2 px-1">
          <h2 className="text-lg font-black text-field-text">오늘 컷</h2>
        </div>
        {orderedShots.length === 0 && scheduleRowCount === 0 ? (
          <Card>
            <h2 className="text-xl font-black text-field-text">아직 등록된 컷이 없습니다</h2>
            <p className="mt-2 text-base leading-6 text-field-muted">필요하면 새 컷을 추가해 진행을 시작할 수 있습니다.</p>
          </Card>
        ) : (
          <div ref={progressStatusGuideRef} className="grid gap-3">
            <section aria-labelledby="active-progress-shots-title" className="grid gap-2">
              <div className="flex min-h-10 items-center gap-2 rounded-[10px] border border-field-border bg-field-section px-3 py-2">
                <h3 id="active-progress-shots-title" className="text-sm font-bold text-field-text">미촬영·촬영중</h3>
                <span className="tabular-nums text-xs font-bold text-field-subtle">{activeShots.length}</span>
              </div>
              <ProgressShotList
                allShots={orderedShots}
                visibleShots={activeShots}
                readOnly={isGuest}
                disabled={role !== "admin" || isReordering}
                statusReadOnly={!canEditProgressStatus}
                interactionGuideTarget={reorderGuideBucket === "active"}
                onReorder={handleReorderShots}
                onStatusChange={handleStatusChange}
                renderShot={renderShot}
                renderRowsBeforeIndex={(index) => activeScheduleRowsByIndex.get(index)?.map((item) => (
                  <ProgressScheduleCard
                    key={item.id}
                    item={item}
                    onOpen={(scheduleItem) => {
                      if (isGuest) return;
                      setEditingSchedule({
                        dailyPlanId,
                        entryKey: progressEntryKey,
                        sessionId: ++nextScheduleSessionIdRef.current,
                        item: scheduleItem
                      });
                    }}
                    onImagePreview={handleImagePreview}
                  />
                ))}
              />
            </section>

            <ProgressStatusSection
              okCount={okShots.length}
              omitCount={omitShots.length}
              expanded={processedExpanded}
              onExpandedChange={setProcessedExpanded}
            >
              {processedShots.length > 0 ? (
                <ProgressShotList
                  allShots={orderedShots}
                  visibleShots={processedShots}
                  readOnly={isGuest}
                  disabled={role !== "admin" || isReordering}
                  statusReadOnly={!canEditProgressStatus}
                  interactionGuideTarget={reorderGuideBucket !== null && reorderGuideBucket !== "active"}
                  onReorder={handleReorderShots}
                  onStatusChange={handleStatusChange}
                  renderShot={renderShot}
                />
              ) : <p className="px-1 py-2 text-xs text-field-muted">처리된 컷이 없습니다.</p>}
            </ProgressStatusSection>
          </div>
        )}
      </div>

      {process.env.NODE_ENV !== "production" && !progressOnly ? (
        <details className="mt-4 border border-field-border bg-field-panel">
          <summary className="cursor-pointer px-4 py-3 text-xs font-black text-field-muted">개발용 도구</summary>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-field-border p-4">
            <p className="text-xs leading-5 text-field-muted">테스트 중 컷이 너무 많아졌을 때만 사용하세요. 프로젝트 정보는 삭제하지 않습니다.</p>
            <Button variant="danger" onClick={handleResetCurrentProjectShots} disabled={isSaving || shots.length === 0}>
              <RotateCcw className="h-5 w-5" aria-hidden /> 현재 회차 컷 목록 초기화
            </Button>
          </div>
        </details>
      ) : null}

      {role === "admin" && isAddOpen ? <ShotEditorModal
        mode="add"
        open
        shot={null}
        defaultOrderIndex={nextOrderIndex}
        isSaving={isSaving}
        onClose={() => setIsAddOpen(false)}
        onSave={handleSaveNewShot}
      /> : null}

      {!isGuest && editingShot ? <ShotEditorModal
        key={editingShot.id}
        mode="edit"
        open
        shot={shots.find((shot) => shot.id === editingShot.id) ?? editingShot}
        defaultOrderIndex={nextOrderIndex}
        isSaving={isSaving}
        readOnly={role !== "admin"}
        onClose={() => setEditingShot(null)}
        onAutoSave={handleSaveExistingShot}
        onDelete={role === "admin" ? handleDeleteShot : undefined}
        archiveMedia={archiveMediaByShotId.get(editingShot.id) ?? EMPTY_PROGRESS_ARCHIVE_MEDIA}
        selectedMediaLinks={mediaLinksByShotId.get(editingShot.id) ?? []}
        mediaContext={{ episodeNumber: parseEpisodeNumber(selectedPlan?.episode) }}
        onMediaSaved={role === "admin" ? async () => {
          await refreshSelectedShotMedia();
        } : undefined}
      /> : null}

      {!isGuest && editingSchedule ? (
        <ProgressScheduleEditorModal
          key={`${editingSchedule.dailyPlanId}:${editingSchedule.item.id}:${editingSchedule.sessionId}`}
          item={editingSchedule.item}
          readOnly={role !== "admin"}
          isSaving={savingScheduleSessionId === editingSchedule.sessionId}
          onClose={() => setEditingSchedule(null)}
          onSave={handleSaveSchedule}
          onAutoSaveMemo={handleAutosaveScheduleMemo}
          onDeleteImage={handleDeleteScheduleImage}
        />
      ) : null}

      {preview ? (
        <ImagePreviewModal
          imageUrl={preview.url}
          title={preview.title}
          images={preview.images}
          activeIndex={preview.index}
          onNavigate={preview.images ? (index) => {
            const target = preview.images?.[index];
            if (!target) return;
            setPreview((current) => current ? {
              ...current,
              url: target.url,
              title: target.title,
              index
            } : current);
          } : undefined}
          onClose={() => setPreview(null)}
        />
      ) : null}
      {!isGuest && mediaPicker ? (
        <ShotArchivePicker
          shot={mediaPicker.shot}
          initialType={mediaPicker.type}
          selectedLinks={mediaLinksByShotId.get(mediaPicker.shot.id) ?? []}
          readOnly={role !== "admin"}
          onClose={() => setMediaPicker(null)}
          onSaved={async () => {
            await refreshSelectedShotMedia();
          }}
        />
      ) : null}
    </>
  );
}

function reconcileSessionBuckets(
  shots: Shot[],
  current: Map<string, ProgressVisualBucket>,
  initialize: boolean
) {
  const next = new Map<string, ProgressVisualBucket>();
  shots.forEach((shot) => {
    next.set(shot.id, initialize
      ? getPersistedStatusBucket(shot.status)
      : current.get(shot.id) ?? getPersistedStatusBucket(shot.status));
  });
  return next;
}

function getPersistedStatusBucket(status: ShotStatus): ProgressVisualBucket {
  if (status === "ok") return "ok";
  if (status === "omit") return "omit";
  return "active";
}

function remapScheduleRowsForVisibleShots(
  allShots: Shot[],
  visibleShots: Shot[],
  rowsByIndex: Map<number, DailyPlanMealTime[]>
) {
  const visibleIds = new Set(visibleShots.map((shot) => shot.id));
  const result = new Map<number, DailyPlanMealTime[]>();
  let visibleIndex = 0;

  for (let allIndex = 0; allIndex <= allShots.length; allIndex += 1) {
    const rows = rowsByIndex.get(allIndex);
    if (rows?.length) {
      result.set(visibleIndex, [...(result.get(visibleIndex) ?? []), ...rows]);
    }
    const shot = allShots[allIndex];
    if (shot && visibleIds.has(shot.id)) visibleIndex += 1;
  }
  return result;
}

function parseEpisodeNumber(value: string) {
  const match = value.match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function preserveShotMedia(next: Shot, previous: Shot | undefined): Shot {
  if (!previous) return next;
  return {
    ...next,
    storyboardImageUrl: previous.storyboardImageUrl,
    overheadImageUrl: previous.overheadImageUrl ?? null,
    overheadDiagram: previous.overheadDiagram
  };
}

/** 순서 저장 응답은 orderIndex만 반영하여 동시에 바뀐 상태·자료 연결을 보존합니다. */
function mergeShotOrder(currentShots: Shot[], orderedShots: Shot[]) {
  const orderByShotId = new Map(orderedShots.map((shot) => [shot.id, shot.orderIndex]));
  return currentShots
    .map((shot) => {
      const orderIndex = orderByShotId.get(shot.id);
      return orderIndex === undefined || orderIndex === shot.orderIndex
        ? shot
        : { ...shot, orderIndex };
    })
    .sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt));
}

function compareUpdatedAt(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.localeCompare(right);
}

function EpisodeSelection({
  hasPlans,
  invalidSelection
}: {
  hasPlans: boolean;
  invalidSelection: boolean;
}) {
  return (
    <section className="flex min-h-[min(24rem,calc(100dvh-8rem))] min-w-0 items-center justify-center px-3 py-6">
      <Card className="w-full max-w-md text-center">
        {invalidSelection ? <p role="alert" className="mt-3 border border-field-danger/40 bg-field-panel px-4 py-2 text-center text-sm font-semibold text-field-danger">선택한 회차를 찾을 수 없어 회차 목록으로 돌아왔습니다.</p> : null}
        <h1 className="ui-density-heading font-display font-black text-field-text">진행도</h1>
        <p className="mt-3 text-sm leading-6 text-field-muted">
          {!hasPlans
            ? "진행 가능한 일촬표가 없습니다."
            : "진행도 회차를 자동으로 결정하지 못했습니다. 잠시 후 다시 시도해 주세요."}
        </p>
      </Card>
    </section>
  );
}

function ModalLoadingFallback() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-field-bg/80">
      <div className="border border-field-divider bg-field-dialog p-4 shadow-dialog">
        <SectionLoader className="!min-h-16" />
      </div>
    </div>
  );
}

function formatEpisodeLabel(plan: Pick<DailyPlan, "episode" | "shootingDate">, index: number) {
  const episode = plan.episode.trim();
  if (episode) return episode.includes("회차") ? episode : `${episode}회차`;
  return plan.shootingDate || `${index + 1}회차`;
}

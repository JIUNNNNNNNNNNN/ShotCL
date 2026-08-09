"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { PageLoader, SectionLoader } from "@/components/PixelDogLoader";
import {
  useProjectPageActionMenu,
  type ProjectPageActionMenuRegistration
} from "@/components/ProjectPageActions";
import { ProjectGuideMenu } from "@/components/ProjectGuideMenu";
import { ProgressDetailHeader } from "@/components/ProgressDetailHeader";
import { DailyProgressSummary } from "@/components/DailyProgressSummary";
import type {
  GatheringLocationActions,
  GatheringPhotoPreview
} from "@/components/DailyPlanGatheringLocations";
import { ProgressScheduleCard } from "@/components/ProgressScheduleCard";
import { ProgressStatusSection } from "@/components/ProgressStatusSection";
import type { ProgressScheduleEditorValues } from "@/components/ProgressScheduleEditorModal";
import type { ShotEditorValues } from "@/components/ShotEditorModal";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createShotsFromDrafts, deleteAllShots, deleteShot, listShots, reorderShots, updateShot, updateShotStatus } from "@/lib/data/shots";
import { getShotDiagramKey, loadShotOverheadDiagrams } from "@/lib/data/shotDiagrams";
import {
  applyShotMediaLinks,
  buildProgressArchiveMediaByShotId,
  loadProgressArchiveMediaAssets,
  loadShotMediaLinks,
  type ProgressArchiveMediaAsset
} from "@/lib/data/shotMediaArchive";
import {
  updateDailyPlanScheduleItem,
  type DailyPlanListItem
} from "@/lib/data/dailyPlans";
import { decodeDailyPlanMemo } from "@/lib/dailyPlan/printMeta";
import { compareDailyPlanEpisodes } from "@/lib/dailyPlan/carouselPresentation";
import { saveScheduleImage } from "@/lib/data/storyboardFiles";
import { subscribeToShotChanges } from "@/lib/realtime/subscribeToShots";
import { auditQuery } from "@/lib/queryAudit";
import { calculateDailyProgress } from "@/lib/progress/dailyProgress";
import { buildProgressRoundHref } from "@/lib/projectNavigation";
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
const EMPTY_PROGRESS_ARCHIVE_MEDIA: ProgressArchiveMediaAsset[] = [];

const DailyPlanGatheringLocations = dynamic(
  () => import("@/components/DailyPlanGatheringLocations").then((module) => module.DailyPlanGatheringLocations),
  { ssr: false }
);
const ShotCard = dynamic(
  () => import("@/components/ShotCard").then((module) => module.ShotCard),
  { ssr: false }
);
const ShotReorderList = dynamic(
  () => import("@/components/ShotReorderList").then((module) => module.ShotReorderList),
  { ssr: false }
);

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
  const { role } = useProjectAccess();
  const {
    projectId,
    project,
    dailyPlans,
    isLoading: isWorkspaceLoading,
    error: workspaceError,
    upsertDailyPlan
  } = useProjectWorkspace();
  const progressOnly = role === "progress";
  const searchParams = useSearchParams();
  const dailyPlanId = searchParams.get("dailyPlanId") ?? "";
  const isProgressView = searchParams.get("view") === "progress" || Boolean(dailyPlanId);
  const progressEntryKey = `${projectId ?? "missing-project"}:${dailyPlanId || "episode-selection"}`;
  const [shots, setShots] = useState<Shot[]>([]);
  const [sessionBucketByShotId, setSessionBucketByShotId] = useState<Map<string, ProgressVisualBucket>>(() => new Map());
  const [archiveMediaByShotId, setArchiveMediaByShotId] = useState<Map<string, ProgressArchiveMediaAsset[]>>(() => new Map());
  const [okExpanded, setOkExpanded] = useState(false);
  const [omitExpanded, setOmitExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editingShot, setEditingShot] = useState<Shot | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<DailyPlanMealTime | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [gatheringLocationActions, setGatheringLocationActions] = useState<GatheringLocationActions | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    title: string;
    images?: GatheringPhotoPreview[];
    index?: number;
  } | null>(null);
  const [mediaLinksByShotId, setMediaLinksByShotId] = useState<Map<string, ShotMediaLink[]>>(new Map());
  const [mediaPicker, setMediaPicker] = useState<{ shot: Shot; type: ShotMediaType } | null>(null);
  const shotsRef = useRef(shots);
  const archiveAssetsRef = useRef<ProgressArchiveMediaAsset[]>([]);
  const sessionBucketByShotIdRef = useRef(sessionBucketByShotId);
  const pendingStatusByShotIdRef = useRef(new Map<string, { version: number; status: ShotStatus }>());
  const persistedStatusByShotIdRef = useRef(new Map<string, ShotStatus>());
  const statusMutationVersionByShotIdRef = useRef(new Map<string, number>());
  const statusMutationQueueByShotIdRef = useRef(new Map<string, Promise<Shot>>());
  const selectedShotsRefreshVersionRef = useRef(0);
  const realtimeRefreshStateRef = useRef(new Map<string, { inFlight: boolean; queued: boolean }>());
  const initializedBucketEntryRef = useRef("");
  const activeProgressEntryKeyRef = useRef(progressEntryKey);
  const progressCutListGuideRef = useContextualGuideAnchor<HTMLDivElement>("progress.cut-list");
  const progressStatusGuideRef = useContextualGuideAnchor<HTMLDivElement>("progress.status-controls");
  const { completeGuide, requestGuide } = useContextualGuide();
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

  useEffect(() => {
    if (!isProgressView) return;
    void Promise.all([
      import("@/components/DailyPlanGatheringLocations"),
      import("@/components/ShotCard"),
      import("@/components/ShotReorderList")
    ]);
  }, [isProgressView]);

  const selectedPlan = useMemo(
    () => dailyPlans.find((plan) => plan.id === dailyPlanId) ?? null,
    [dailyPlanId, dailyPlans]
  );
  const selectedDailyPlanId = selectedPlan?.id ?? "";

  const refresh = useCallback(async () => {
    if (!projectId || isWorkspaceLoading) return;
    const requestedEntryKey = progressEntryKey;

    try {
      if (!project) {
        shotsRef.current = [];
        setShots([]);
        archiveAssetsRef.current = [];
        persistedStatusByShotIdRef.current.clear();
        setArchiveMediaByShotId(new Map());
        setMediaLinksByShotId(new Map());
        commitSessionBuckets(new Map());
        setErrorMessage(workspaceError);
        return;
      }

      const [selectedShots, archiveAssets] = await Promise.all([
        selectedDailyPlanId
          ? auditQuery(
              "progress.loadCuts",
              "app/projects/[id]/page.tsx:refresh",
              () => listShots(projectId, selectedDailyPlanId)
            )
          : Promise.resolve([]),
        selectedDailyPlanId
          ? auditQuery(
              "progress.loadArchiveMedia",
              "app/projects/[id]/page.tsx:refresh",
              () => loadProgressArchiveMediaAssets(projectId)
            ).catch(() => [] as ProgressArchiveMediaAsset[])
          : Promise.resolve([] as ProgressArchiveMediaAsset[])
      ]);
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      let shotsWithDiagrams = selectedShots;
      let nextMediaLinksByShotId = new Map<string, ShotMediaLink[]>();
      if (selectedShots.length > 0) {
        try {
          const [diagrams, linksByRef] = await Promise.all([
            auditQuery(
              "progress.loadOverheadDiagrams",
              "app/projects/[id]/page.tsx:refresh",
              () => loadShotOverheadDiagrams(selectedShots)
            ),
            auditQuery(
              "progress.loadMediaLinks",
              "app/projects/[id]/page.tsx:refresh",
              () => loadShotMediaLinks(selectedShots)
            )
          ]);
          shotsWithDiagrams = applyShotMediaLinks(selectedShots, linksByRef, diagrams);
          nextMediaLinksByShotId = new Map(selectedShots.map((shot) => [
            shot.id,
            linksByRef.get(getShotDiagramKey(shot).shotRef) ?? []
          ]));
        } catch {
          // 자료 연결 조회 실패가 진행표 자체를 막지 않도록 기존 컷 데이터는 그대로 표시합니다.
          nextMediaLinksByShotId = new Map();
        }
      }
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      archiveAssetsRef.current = archiveAssets;
      setArchiveMediaByShotId(selectedPlan
        ? buildProgressArchiveMediaByShotId({
            shots: shotsWithDiagrams,
            assets: archiveAssets,
            timetableScenes: decodeDailyPlanMemo(selectedPlan.memo).timetableScenes,
            dailyPlanId: selectedPlan.id,
            episodeNumber: parseEpisodeNumber(selectedPlan.episode)
          })
        : new Map());
      setMediaLinksByShotId(nextMediaLinksByShotId);
      persistedStatusByShotIdRef.current = new Map(shotsWithDiagrams.map((shot) => [
        shot.id,
        shot.status
      ]));
      shotsRef.current = shotsWithDiagrams;
      setShots(shotsWithDiagrams);
      const shouldInitializeBuckets = initializedBucketEntryRef.current !== requestedEntryKey;
      const nextBuckets = reconcileSessionBuckets(
        shotsWithDiagrams,
        shouldInitializeBuckets ? new Map() : sessionBucketByShotIdRef.current,
        shouldInitializeBuckets
      );
      initializedBucketEntryRef.current = requestedEntryKey;
      commitSessionBuckets(nextBuckets);
      setErrorMessage("");
    } catch (error) {
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setErrorMessage(error instanceof Error ? error.message : "프로젝트 정보를 불러오지 못했습니다.");
    } finally {
      if (activeProgressEntryKeyRef.current === requestedEntryKey) setIsLoading(false);
    }
  }, [
    commitSessionBuckets,
    isWorkspaceLoading,
    progressEntryKey,
    project,
    projectId,
    selectedPlan,
    selectedDailyPlanId,
    workspaceError
  ]);

  useEffect(() => {
    selectedShotsRefreshVersionRef.current += 1;
    pendingStatusByShotIdRef.current.clear();
    persistedStatusByShotIdRef.current.clear();
    statusMutationVersionByShotIdRef.current.clear();
    statusMutationQueueByShotIdRef.current.clear();
    initializedBucketEntryRef.current = "";
    commitSessionBuckets(new Map());
    archiveAssetsRef.current = [];
    setArchiveMediaByShotId(new Map());
    setOkExpanded(false);
    setOmitExpanded(false);
    setIsLoading(true);
  }, [commitSessionBuckets, progressEntryKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const nextOrderIndex = shots.length + 1;
  const rebuildArchiveMedia = useCallback((nextShots: Shot[]) => {
    setArchiveMediaByShotId(selectedPlan
      ? buildProgressArchiveMediaByShotId({
          shots: nextShots,
          assets: archiveAssetsRef.current,
          timetableScenes: decodeDailyPlanMemo(selectedPlan.memo).timetableScenes,
          dailyPlanId: selectedPlan.id,
          episodeNumber: parseEpisodeNumber(selectedPlan.episode)
        })
      : new Map());
  }, [selectedPlan]);

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

  useEffect(() => {
    if (!projectId || !selectedDailyPlanId) return undefined;
    return subscribeToShotChanges(projectId, refreshSelectedShots, selectedDailyPlanId);
  }, [projectId, refreshSelectedShots, selectedDailyPlanId]);

  const refreshSelectedShotMedia = useCallback(async () => {
    if (!projectId || !dailyPlanId) return;
    const requestedEntryKey = progressEntryKey;
    const currentShots = shotsRef.current;
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
    () => shots.filter((shot) => sessionBucketByShotId.get(shot.id) === "active"),
    [sessionBucketByShotId, shots]
  );
  const okShots = useMemo(
    () => shots.filter((shot) => sessionBucketByShotId.get(shot.id) === "ok"),
    [sessionBucketByShotId, shots]
  );
  const omitShots = useMemo(
    () => shots.filter((shot) => sessionBucketByShotId.get(shot.id) === "omit"),
    [sessionBucketByShotId, shots]
  );
  const scheduleRowsByIndex = useMemo(
    () => selectedPlan ? placeScheduleRows(shots, selectedPlan.mealTimes, decodeDailyPlanMemo(selectedPlan.memo).timetableRowOrder) : new Map<number, DailyPlanMealTime[]>(),
    [selectedPlan, shots]
  );
  const activeScheduleRowsByIndex = useMemo(
    () => remapScheduleRowsForVisibleShots(shots, activeShots, scheduleRowsByIndex),
    [activeShots, scheduleRowsByIndex, shots]
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
          disabled: gatheringLocationActions?.addPhotosDisabled ?? true,
          pending: gatheringLocationActions?.addPhotosPending ?? false
        },
        progressGatheringPhotoManage: {
          onSelect: gatheringLocationActions?.managePhotos,
          hidden: progressOnly || !gatheringLocationActions?.visible,
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
  const handleGatheringPhotoPreview = useCallback((images: GatheringPhotoPreview[], index: number) => {
    const target = images[index];
    if (!target) return;
    setPreview({ url: target.url, title: target.title, images, index });
  }, []);
  const handleDailyPlanMetadataChange = useCallback((
    patch: Pick<DailyPlan, "memo" | "updatedAt"> & Partial<Pick<DailyPlan, "shootingLocations">>
  ) => {
    if (!selectedPlan) return;
    upsertDailyPlan({ ...selectedPlan, ...patch });
  }, [selectedPlan, upsertDailyPlan]);

  const handleStatusChange = useCallback(async (targetShot: Shot, status: ShotStatus) => {
    completeGuide("progress.intro");
    requestGuide("progress.status", "feature");
    const requestedEntryKey = activeProgressEntryKeyRef.current;
    const currentShot = shotsRef.current.find((shot) => shot.id === targetShot.id) ?? targetShot;
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
      const persistedStatus = persistedStatusByShotIdRef.current.get(targetShot.id) ?? currentShot.status;
      const rolledBackShots = shotsRef.current.map((shot) => (
        shot.id === targetShot.id ? { ...shot, status: persistedStatus } : shot
      ));
      shotsRef.current = rolledBackShots;
      setShots(rolledBackShots);
      setErrorMessage(error instanceof Error ? error.message : "상태를 변경하지 못했습니다.");
    } finally {
      if (statusMutationQueueByShotIdRef.current.get(targetShot.id) === mutation) {
        statusMutationQueueByShotIdRef.current.delete(targetShot.id);
      }
    }
  }, [completeGuide, requestGuide]);

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
    if (!projectId || !editingShot) return;
    const requestedEntryKey = activeProgressEntryKeyRef.current;

    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

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
      setEditingShot(null);
      setSuccessMessage("컷을 저장했습니다.");
    } catch (error) {
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setErrorMessage(error instanceof Error ? error.message : "컷을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveSchedule(values: ProgressScheduleEditorValues) {
    if (!projectId || !dailyPlanId || !editingSchedule || progressOnly) return;

    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      let imageUrl = values.imageUrl;
      if (values.imageFile) {
        imageUrl = await saveScheduleImage(projectId, dailyPlanId, editingSchedule.id, values.imageFile);
      }
      const mealTimes = await updateDailyPlanScheduleItem(projectId, dailyPlanId, editingSchedule.id, {
        progressMemo: values.progressMemo.trim(),
        imageUrl
      });
      if (selectedPlan) upsertDailyPlan({ ...selectedPlan, mealTimes });
      setEditingSchedule(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "기타일정 정보를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteShot(shot: Shot) {
    const shouldDelete = window.confirm(`"${shot.title}" 컷을 삭제할까요?`);
    if (!shouldDelete) return;
    const requestedEntryKey = activeProgressEntryKeyRef.current;

    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await deleteShot(shot);
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
      commitSessionBuckets(reconcileSessionBuckets(
        nextShots,
        sessionBucketByShotIdRef.current,
        false
      ));
      setEditingShot(null);
      setSuccessMessage("컷을 삭제했습니다.");
    } catch (error) {
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setErrorMessage(error instanceof Error ? error.message : "컷을 삭제하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  const handleOpenMedia = useCallback((shot: Shot, type: ShotMediaType) => {
    setMediaPicker({ shot, type });
  }, []);

  const handleArchivePreview = useCallback((
    asset: ProgressArchiveMediaAsset,
    assets: ProgressArchiveMediaAsset[]
  ) => {
    const images = assets.map((item) => ({
      url: item.publicUrl,
      title: item.title || (item.mediaType === "storyboard" ? "콘티" : "부감도")
    }));
    const index = Math.max(0, assets.findIndex((item) => item.id === asset.id));
    setPreview({
      url: asset.publicUrl,
      title: asset.title || (asset.mediaType === "storyboard" ? "콘티" : "부감도"),
      images,
      index
    });
  }, []);

  const renderShot = useCallback((shot: Shot) => (
    <ShotCard
      shot={shot}
      onOpen={setEditingShot}
      onOpenMedia={handleOpenMedia}
      onImagePreview={handleImagePreview}
      archiveMedia={archiveMediaByShotId.get(shot.id) ?? EMPTY_PROGRESS_ARCHIVE_MEDIA}
      onArchivePreview={handleArchivePreview}
      onStatusChange={handleStatusChange}
      progressOnly={progressOnly}
    />
  ), [archiveMediaByShotId, handleArchivePreview, handleImagePreview, handleOpenMedia, handleStatusChange, progressOnly]);

  async function handleReorderShots(nextShots: Shot[]) {
    if (!projectId || !dailyPlanId || role !== "admin" || isReordering) return;

    const requestedEntryKey = activeProgressEntryKeyRef.current;
    const previousShots = shotsRef.current;
    selectedShotsRefreshVersionRef.current += 1;
    setIsReordering(true);
    setErrorMessage("");
    shotsRef.current = nextShots;
    setShots(nextShots);

    try {
      const savedShots = await reorderShots(projectId, dailyPlanId, nextShots.map((shot) => shot.id));
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      const persistedShots = mergeShotOrder(shotsRef.current, savedShots);
      shotsRef.current = persistedShots;
      setShots(persistedShots);
    } catch {
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      const restoredShots = mergeShotOrder(shotsRef.current, previousShots);
      shotsRef.current = restoredShots;
      setShots(restoredShots);
      setErrorMessage("컷 순서를 저장하지 못했습니다.");
    } finally {
      setIsReordering(false);
    }
  }

  async function handleResetCurrentProjectShots() {
    if (!projectId || !dailyPlanId) return;

    const shouldReset = window.confirm("현재 회차의 컷 목록만 삭제합니다. 다른 회차와 프로젝트 정보는 유지됩니다. 계속할까요?");
    if (!shouldReset) return;
    const requestedEntryKey = activeProgressEntryKeyRef.current;

    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await deleteAllShots(projectId, dailyPlanId);
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
      setSuccessMessage("현재 회차의 컷 목록을 초기화했습니다. 다른 회차는 유지됩니다.");
    } catch (error) {
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setErrorMessage(error instanceof Error ? error.message : "컷 목록을 초기화하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
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
        projectId={project.id}
        plans={dailyPlans}
        invalidSelection={Boolean(dailyPlanId)}
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

      <DailyPlanGatheringLocations
        projectId={project.id}
        plan={selectedPlan}
        canEdit={role === "admin"}
        onPlanMetadataChange={handleDailyPlanMetadataChange}
        onPreview={handleGatheringPhotoPreview}
        onActionsChange={setGatheringLocationActions}
      />

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
        {shots.length === 0 && scheduleRowCount === 0 ? (
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
              <ShotReorderList
                allShots={shots}
                visibleShots={activeShots}
                disabled={role !== "admin" || isReordering}
                onReorder={handleReorderShots}
                renderShot={renderShot}
                renderRowsBeforeIndex={(index) => activeScheduleRowsByIndex.get(index)?.map((item) => (
                  <ProgressScheduleCard
                    key={item.id}
                    item={item}
                    onOpen={setEditingSchedule}
                    onImagePreview={handleImagePreview}
                  />
                ))}
              />
            </section>

            <ProgressStatusSection
              kind="ok"
              count={okShots.length}
              expanded={okExpanded}
              onExpandedChange={setOkExpanded}
            >
              {okShots.length > 0 ? (
                <ShotReorderList
                  allShots={shots}
                  visibleShots={okShots}
                  disabled={role !== "admin" || isReordering}
                  onReorder={handleReorderShots}
                  renderShot={renderShot}
                />
              ) : <p className="px-1 py-2 text-xs text-field-muted">OK 컷이 없습니다.</p>}
            </ProgressStatusSection>

            <ProgressStatusSection
              kind="omit"
              count={omitShots.length}
              expanded={omitExpanded}
              onExpandedChange={setOmitExpanded}
            >
              {omitShots.length > 0 ? (
                <ShotReorderList
                  allShots={shots}
                  visibleShots={omitShots}
                  disabled={role !== "admin" || isReordering}
                  onReorder={handleReorderShots}
                  renderShot={renderShot}
                />
              ) : <p className="px-1 py-2 text-xs text-field-muted">OMIT 컷이 없습니다.</p>}
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

      {!progressOnly && isAddOpen ? <ShotEditorModal
        mode="add"
        open
        shot={null}
        defaultOrderIndex={nextOrderIndex}
        isSaving={isSaving}
        onClose={() => setIsAddOpen(false)}
        onSave={handleSaveNewShot}
      /> : null}

      {editingShot ? <ShotEditorModal
        mode="edit"
        open
        shot={editingShot}
        defaultOrderIndex={nextOrderIndex}
        isSaving={isSaving}
        readOnly={progressOnly}
        onClose={() => setEditingShot(null)}
        onSave={handleSaveExistingShot}
        onDelete={progressOnly ? undefined : handleDeleteShot}
      /> : null}

      {editingSchedule ? (
        <ProgressScheduleEditorModal
          item={editingSchedule}
          readOnly={progressOnly}
          isSaving={isSaving}
          onClose={() => setEditingSchedule(null)}
          onSave={handleSaveSchedule}
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
      {mediaPicker ? (
        <ShotArchivePicker
          shot={mediaPicker.shot}
          initialType={mediaPicker.type}
          selectedLinks={mediaLinksByShotId.get(mediaPicker.shot.id) ?? []}
          readOnly={progressOnly}
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

function EpisodeSelection({
  projectId,
  plans,
  invalidSelection
}: {
  projectId: string;
  plans: DailyPlanListItem[];
  invalidSelection: boolean;
}) {
  const router = useRouter();
  const sortedPlans = useMemo(() => [...plans].sort(compareDailyPlanEpisodes), [plans]);
  const onlyPlanId = sortedPlans.length === 1 ? sortedPlans[0]?.id.trim() ?? "" : "";

  useEffect(() => {
    if (!onlyPlanId) return;
    router.replace(buildProgressRoundHref(projectId, onlyPlanId));
  }, [onlyPlanId, projectId, router]);

  return (
    <section className="flex min-h-[min(24rem,calc(100dvh-8rem))] min-w-0 items-center justify-center px-3 py-6">
      <Card className="w-full max-w-md text-center">
        {invalidSelection ? <p role="alert" className="mt-3 border border-field-danger/40 bg-field-panel px-4 py-2 text-center text-sm font-semibold text-field-danger">선택한 회차를 찾을 수 없어 회차 목록으로 돌아왔습니다.</p> : null}
        <h1 className="ui-density-heading font-display font-black text-field-text">진행도</h1>
        <p className="mt-3 text-sm leading-6 text-field-muted">
          {sortedPlans.length === 0
            ? "진행 가능한 일촬표가 없습니다."
            : onlyPlanId
              ? "회차 진행도로 이동하고 있습니다."
              : "좌측 진행도 메뉴에서 회차를 선택하세요."}
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

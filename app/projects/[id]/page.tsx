"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { DailyPlanCoverflow, type DailyPlanCarouselItem } from "@/components/DailyPlanCoverflow";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import {
  useProjectPageActionMenu,
  type ProjectPageActionMenuRegistration
} from "@/components/ProjectPageActions";
import { ProjectGuideMenu } from "@/components/ProjectGuideMenu";
import { ProgressDetailHeader } from "@/components/ProgressDetailHeader";
import { DailyProgressSummary } from "@/components/DailyProgressSummary";
import {
  DailyPlanGatheringLocations,
  type GatheringPhotoPreview
} from "@/components/DailyPlanGatheringLocations";
import { ProgressScheduleCard } from "@/components/ProgressScheduleCard";
import {
  ProgressSceneDurationEditor,
  type ProgressSceneDurationSaveInput
} from "@/components/ProgressSceneDurationEditor";
import { ProgressStatusSection } from "@/components/ProgressStatusSection";
import type { ProgressScheduleEditorValues } from "@/components/ProgressScheduleEditorModal";
import { ShotCard } from "@/components/ShotCard";
import type { ShotEditorValues } from "@/components/ShotEditorModal";
import { ShotReorderList } from "@/components/ShotReorderList";
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
  listDailyPlans,
  updateDailyPlanSceneDuration,
  updateDailyPlanScheduleItem,
  type DailyPlanListItem
} from "@/lib/data/dailyPlans";
import { getProject } from "@/lib/data/projects";
import { decodeDailyPlanMemo } from "@/lib/dailyPlan/printMeta";
import { compareDailyPlanEpisodes, formatDailyPlanEpisodeLabel } from "@/lib/dailyPlan/carouselPresentation";
import { formatDailyPlanCardDate, formatDailyPlanCardDateAria } from "@/lib/dailyPlan/dateOnly";
import { saveScheduleImage } from "@/lib/data/storyboardFiles";
import { subscribeToShotChanges } from "@/lib/realtime/subscribeToShots";
import { auditQuery } from "@/lib/queryAudit";
import { calculateDailyProgress, calculateProgressPercent } from "@/lib/progress/dailyProgress";
import { normalizeSceneNumber } from "@/lib/sceneNumber";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import type { DailyPlan, DailyPlanMealTime, Project, Shot, ShotDraft, ShotMediaLink, ShotMediaType, ShotStatus } from "@/lib/types";

type ProgressVisualBucket = "active" | "ok" | "omit";

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

/** URL 파라미터에서 프로젝트 ID를 안전하게 읽습니다. */
function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  const id = params.id;
  return Array.isArray(id) ? id[0] : id;
}

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
  const progressOnly = role === "progress";
  const projectId = useProjectId();
  const searchParams = useSearchParams();
  const dailyPlanId = searchParams.get("dailyPlanId") ?? "";
  const isProgressView = searchParams.get("view") === "progress" || Boolean(dailyPlanId);
  const progressEntryKey = `${projectId ?? "missing-project"}:${dailyPlanId || "episode-selection"}`;
  const [project, setProject] = useState<Project | null>(null);
  const [dailyPlans, setDailyPlans] = useState<DailyPlanListItem[]>([]);
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
  const [preview, setPreview] = useState<{
    url: string;
    title: string;
    images?: GatheringPhotoPreview[];
    index?: number;
  } | null>(null);
  const [mediaLinksByShotId, setMediaLinksByShotId] = useState<Map<string, ShotMediaLink[]>>(new Map());
  const [mediaPicker, setMediaPicker] = useState<{ shot: Shot; type: ShotMediaType } | null>(null);
  const shotsRef = useRef(shots);
  const sessionBucketByShotIdRef = useRef(sessionBucketByShotId);
  const initializedBucketEntryRef = useRef("");
  const activeProgressEntryKeyRef = useRef(progressEntryKey);

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

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const requestedEntryKey = progressEntryKey;

    try {
      const [projectData, planData, selectedShots, archiveAssets] = await Promise.all([
        auditQuery(
          "progress.loadProject",
          "app/projects/[id]/page.tsx:refresh",
          () => getProject(projectId)
        ),
        auditQuery(
          "progress.loadDailyPlans",
          "app/projects/[id]/page.tsx:refresh",
          () => listDailyPlans(projectId)
        ),
        dailyPlanId
          ? auditQuery(
              "progress.loadCuts",
              "app/projects/[id]/page.tsx:refresh",
              () => listShots(projectId, dailyPlanId)
            )
          : Promise.resolve([]),
        dailyPlanId
          ? auditQuery(
              "progress.loadArchiveMedia",
              "app/projects/[id]/page.tsx:refresh",
              () => loadProgressArchiveMediaAssets(projectId)
            ).catch(() => [] as ProgressArchiveMediaAsset[])
          : Promise.resolve([] as ProgressArchiveMediaAsset[])
      ]);
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setProject(projectData);
      if (!projectData) {
        setDailyPlans([]);
        setShots([]);
        setArchiveMediaByShotId(new Map());
        commitSessionBuckets(new Map());
        setErrorMessage("");
        return;
      }
      let shotsWithDiagrams = selectedShots;
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
          setMediaLinksByShotId(new Map(selectedShots.map((shot) => [
            shot.id,
            linksByRef.get(getShotDiagramKey(shot).shotRef) ?? []
          ])));
        } catch {
          // 자료 연결 조회 실패가 진행표 자체를 막지 않도록 기존 컷 데이터는 그대로 표시합니다.
          setMediaLinksByShotId(new Map());
        }
      } else {
        setMediaLinksByShotId(new Map());
      }
      const selectedPlanForAssets = planData.find((plan) => plan.id === dailyPlanId) ?? null;
      setArchiveMediaByShotId(selectedPlanForAssets
        ? buildProgressArchiveMediaByShotId({
            shots: shotsWithDiagrams,
            assets: archiveAssets,
            timetableScenes: decodeDailyPlanMemo(selectedPlanForAssets.memo).timetableScenes,
            dailyPlanId: selectedPlanForAssets.id,
            episodeNumber: parseEpisodeNumber(selectedPlanForAssets.episode)
          })
        : new Map());
      setDailyPlans(planData);
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
  }, [commitSessionBuckets, dailyPlanId, progressEntryKey, projectId]);

  useEffect(() => {
    initializedBucketEntryRef.current = "";
    commitSessionBuckets(new Map());
    setArchiveMediaByShotId(new Map());
    setOkExpanded(false);
    setOmitExpanded(false);
    setIsLoading(true);
  }, [commitSessionBuckets, progressEntryKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const refreshSelectedShots = useCallback(async () => {
    if (!projectId || !dailyPlanId) return;
    const requestedEntryKey = progressEntryKey;
    try {
      const refreshedShots = await auditQuery(
        "progress.realtime.reloadCuts",
        "app/projects/[id]/page.tsx:refreshSelectedShots",
        () => listShots(projectId, dailyPlanId)
      );
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      const nextShots = refreshedShots.map((shot) => (
        preserveShotMedia(shot, shotsRef.current.find((item) => item.id === shot.id))
      ));
      setShots(nextShots);
      commitSessionBuckets(reconcileSessionBuckets(nextShots, sessionBucketByShotIdRef.current, false));
    } catch (error) {
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setErrorMessage(error instanceof Error ? error.message : "진행도 화면을 갱신하지 못했습니다.");
    }
  }, [commitSessionBuckets, dailyPlanId, progressEntryKey, projectId]);

  useEffect(() => {
    if (!projectId || !dailyPlanId) return undefined;
    return subscribeToShotChanges(projectId, refreshSelectedShots, dailyPlanId);
  }, [dailyPlanId, projectId, refreshSelectedShots]);

  const nextOrderIndex = shots.length + 1;
  const selectedPlan = dailyPlans.find((plan) => plan.id === dailyPlanId) ?? null;
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
  const sceneDurationRowByShotId = useMemo(
    () => buildProgressSceneDurationRowsByFirstShot(selectedPlan, shots),
    [selectedPlan, shots]
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
        progressRounds: {
          href: `/projects/${project.id}?view=progress`
        },
        progressAddCut: {
          onSelect: () => setIsAddOpen(true),
          hidden: progressOnly,
          disabled: isSaving
        }
      }
    };
  }, [dailyPlanId, isProgressView, isSaving, progressOnly, project, projectId, selectedPlan]);
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
    setDailyPlans((current) => current.map((item) => (
      item.id === dailyPlanId ? { ...item, ...patch } : item
    )));
  }, [dailyPlanId]);

  const handleStatusChange = useCallback(async (targetShot: Shot, status: ShotStatus) => {
    const requestedEntryKey = activeProgressEntryKeyRef.current;
    setErrorMessage("");
    setShots((current) => current.map((shot) => (shot.id === targetShot.id ? { ...shot, status } : shot)));

    try {
      const savedShot = await updateShotStatus(targetShot, status);
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setShots((current) => current.map((shot) => (
        shot.id === savedShot.id
          ? preserveShotMedia(savedShot, shot)
          : shot
      )));
    } catch (error) {
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setShots((current) => current.map((shot) => (shot.id === targetShot.id ? targetShot : shot)));
      setErrorMessage(error instanceof Error ? error.message : "상태를 변경하지 못했습니다.");
    }
  }, []);

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

      const currentShots = shotsRef.current;
      const currentById = new Map(currentShots.map((shot) => [shot.id, shot]));
      const createdIds = new Set(createdShots.map((shot) => shot.id));
      const nextShots = [
        ...currentShots.filter((shot) => !createdIds.has(shot.id)),
        ...createdShots.map((shot) => preserveShotMedia(shot, currentById.get(shot.id)))
      ].sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt));

      shotsRef.current = nextShots;
      setShots(nextShots);
      commitSessionBuckets(reconcileSessionBuckets(
        nextShots,
        sessionBucketByShotIdRef.current,
        false
      ));

      setIsAddOpen(false);
      setSuccessMessage("새 컷을 추가했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "컷을 추가하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveExistingShot(values: ShotEditorValues) {
    if (!projectId || !editingShot) return;

    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await updateShot(editingShot.id, {
        sceneNumber: values.sceneNumber.trim() || "1",
        cutNumber: values.cutNumber.trim() || "1",
        title: editingShot.title,
        description: values.description.trim(),
        location: values.location.trim(),
        characters: parseCharacters(values.charactersText),
        memo: editingShot.memo,
        orderIndex: editingShot.orderIndex,
        status: editingShot.status
      }, projectId);

      setEditingShot(null);
      await refresh();
    } catch (error) {
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
      setDailyPlans((current) => current.map((plan) => (
        plan.id === dailyPlanId ? { ...plan, mealTimes } : plan
      )));
      setEditingSchedule(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "기타일정 정보를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  const handleSaveSceneDuration = useCallback(async ({
    rowId,
    runtimeMinutes
  }: ProgressSceneDurationSaveInput) => {
    if (!projectId || !dailyPlanId || role !== "admin") {
      throw new Error("씬 예정 소요시간을 수정할 권한이 없습니다.");
    }
    const currentPlan = dailyPlans.find((plan) => plan.id === dailyPlanId);
    if (!currentPlan) throw new Error("일촬표를 찾을 수 없습니다.");

    const result = await updateDailyPlanSceneDuration({
      projectId,
      dailyPlanId,
      rowId,
      runtimeMinutes,
      expectedUpdatedAt: currentPlan.updatedAt
    });
    setDailyPlans((current) => current.map((plan) => (
      plan.id === dailyPlanId
        ? { ...plan, memo: result.memo, updatedAt: result.updatedAt }
        : plan
    )));
  }, [dailyPlanId, dailyPlans, projectId, role]);

  const renderSceneDurationBeforeIndex = useCallback((visibleShots: Shot[], index: number) => {
    const shot = visibleShots[index];
    const row = shot ? sceneDurationRowByShotId.get(shot.id) : null;
    return row ? (
      <ProgressSceneDurationEditor
        rows={[row]}
        canEdit={role === "admin"}
        onSave={handleSaveSceneDuration}
        showTitle={false}
      />
    ) : null;
  }, [handleSaveSceneDuration, role, sceneDurationRowByShotId]);

  async function handleDeleteShot(shot: Shot) {
    const shouldDelete = window.confirm(`"${shot.title}" 컷을 삭제할까요?`);
    if (!shouldDelete) return;

    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await deleteShot(shot);
      setEditingShot(null);
      setSuccessMessage("컷을 삭제했습니다.");
      await refresh();
    } catch (error) {
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
      archiveMedia={archiveMediaByShotId.get(shot.id) ?? []}
      onArchivePreview={handleArchivePreview}
      onStatusChange={handleStatusChange}
      progressOnly={progressOnly}
    />
  ), [archiveMediaByShotId, handleArchivePreview, handleImagePreview, handleOpenMedia, handleStatusChange, progressOnly]);

  async function handleReorderShots(nextShots: Shot[]) {
    if (!projectId || !dailyPlanId || role !== "admin" || isReordering) return;

    const previousShots = shots;
    setIsReordering(true);
    setErrorMessage("");
    setShots(nextShots);

    try {
      const savedShots = await reorderShots(projectId, dailyPlanId, nextShots.map((shot) => shot.id));
      setShots((current) => savedShots.map((shot) => preserveShotMedia(shot, current.find((item) => item.id === shot.id))));
    } catch {
      setShots(previousShots);
      setErrorMessage("컷 순서를 저장하지 못했습니다.");
    } finally {
      setIsReordering(false);
    }
  }

  async function handleResetCurrentProjectShots() {
    if (!projectId || !dailyPlanId) return;

    const shouldReset = window.confirm("현재 회차의 컷 목록만 삭제합니다. 다른 회차와 프로젝트 정보는 유지됩니다. 계속할까요?");
    if (!shouldReset) return;

    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await deleteAllShots(projectId, dailyPlanId);
      setShots([]);
      setSuccessMessage("현재 회차의 컷 목록을 초기화했습니다. 다른 회차는 유지됩니다.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "컷 목록을 초기화하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <PixelDogLoader size="lg" />;
  }

  if (!project) {
    return (
      <Card className="border-field-danger text-field-danger">
        <p className="font-bold">{errorMessage || "프로젝트를 찾을 수 없습니다."}</p>
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
        role={role}
        queryString={searchParams.toString()}
      />
    );
  }

  if (!dailyPlanId || !selectedPlan) {
    return (
      <EpisodeSelection
        project={project}
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
      />

      {errorMessage ? (
        <div className="mb-3 border border-field-danger bg-field-panel p-3 text-sm font-bold text-field-danger">
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div className="mb-3 border border-field-divider bg-field-soft p-3 text-sm font-bold text-field-subtle">
          {successMessage}
        </div>
      ) : null}

      <div id="cut-board" className="scroll-mt-28 pb-24">
        <div className="mb-2 px-1">
          <h2 className="text-lg font-black text-field-text">오늘 컷</h2>
        </div>
        {shots.length === 0 && scheduleRowCount === 0 ? (
          <Card>
            <h2 className="text-xl font-black text-field-text">아직 등록된 컷이 없습니다</h2>
            <p className="mt-2 text-base leading-6 text-field-muted">필요하면 새 컷을 추가해 진행을 시작할 수 있습니다.</p>
          </Card>
        ) : (
          <div className="grid gap-3">
            <section aria-labelledby="active-progress-shots-title" className="grid gap-2">
              <div className="flex min-h-10 items-center gap-2 border border-field-border bg-field-section px-3 py-2">
                <h3 id="active-progress-shots-title" className="text-sm font-bold text-field-text">미촬영·촬영중</h3>
                <span className="tabular-nums text-xs font-bold text-field-subtle">{activeShots.length}</span>
              </div>
              <ShotReorderList
                allShots={shots}
                visibleShots={activeShots}
                disabled={role !== "admin" || isReordering}
                onReorder={handleReorderShots}
                renderShot={renderShot}
                renderRowsBeforeIndex={(index) => (
                  <>
                    {activeScheduleRowsByIndex.get(index)?.map((item) => (
                      <ProgressScheduleCard
                        key={item.id}
                        item={item}
                        onOpen={setEditingSchedule}
                        onImagePreview={handleImagePreview}
                      />
                    ))}
                    {renderSceneDurationBeforeIndex(activeShots, index)}
                  </>
                )}
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
                  renderRowsBeforeIndex={(index) => renderSceneDurationBeforeIndex(okShots, index)}
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
                  renderRowsBeforeIndex={(index) => renderSceneDurationBeforeIndex(omitShots, index)}
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
            await refresh();
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

function buildProgressSceneDurationRowsByFirstShot(plan: DailyPlan | null, shots: Shot[]) {
  const result = new Map<string, {
    rowId: string;
    sceneLabel: string;
    runtimeMinutes: number | null;
  }>();
  if (!plan) return result;

  const firstShotByScene = new Map<string, string>();
  shots.forEach((shot) => {
    const sceneNumber = normalizeSceneNumber(shot.sceneNumber);
    if (sceneNumber && !firstShotByScene.has(sceneNumber)) {
      firstShotByScene.set(sceneNumber, shot.id);
    }
  });

  const assignedScenes = new Set<string>();
  decodeDailyPlanMemo(plan.memo).timetableScenes.forEach((scene) => {
    const sceneNumber = normalizeSceneNumber(
      scene.rowSnapshot.sceneNumber || scene.sourceSnapshot?.sceneNumber
    );
    const rowId = scene.rowId.trim();
    const shotId = firstShotByScene.get(sceneNumber);
    if (!sceneNumber || !rowId || !shotId || assignedScenes.has(sceneNumber)) return;
    assignedScenes.add(sceneNumber);
    result.set(shotId, {
      rowId,
      sceneLabel: `S#${sceneNumber}`,
      runtimeMinutes: scene.rowSnapshot.runtimeMinutes
    });
  });
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

function EpisodeSelection({
  project,
  plans,
  invalidSelection
}: {
  project: Project;
  plans: DailyPlanListItem[];
  invalidSelection: boolean;
}) {
  const router = useRouter();
  const navigationLockedRef = useRef(false);
  const navigationUnlockTimerRef = useRef<number | null>(null);
  const sortedPlans = useMemo(() => [...plans].sort(compareDailyPlanEpisodes), [plans]);
  const carouselItems = useMemo<DailyPlanCarouselItem[]>(() => sortedPlans.map((plan) => {
    const episodeLabel = formatDailyPlanEpisodeLabel(plan.episode);
    const dateLabel = formatDailyPlanCardDate(plan.shootingDate);
    const totalCuts = plan.progressTotal;
    const progressPercent = calculateProgressPercent(totalCuts, plan.progressCompleted);
    return {
      id: `progress-daily-plan:${plan.id}`,
      kind: "plan",
      label: episodeLabel,
      dateLabel,
      metaLabel: `총 ${totalCuts}컷`,
      progressPercent,
      ariaLabel: `${episodeLabel}, 촬영일 ${formatDailyPlanCardDateAria(plan.shootingDate)}, 총 ${totalCuts}컷, 진행률 ${progressPercent}퍼센트`,
      planId: plan.id
    };
  }), [sortedPlans]);

  useEffect(() => () => {
    if (navigationUnlockTimerRef.current !== null) {
      window.clearTimeout(navigationUnlockTimerRef.current);
    }
  }, []);

  function handleActivatePlan(item: DailyPlanCarouselItem) {
    if (!item.planId || navigationLockedRef.current) return false;
    navigationLockedRef.current = true;
    try {
      router.push(`/projects/${project.id}?dailyPlanId=${encodeURIComponent(item.planId)}`);
      navigationUnlockTimerRef.current = window.setTimeout(() => {
        navigationLockedRef.current = false;
        navigationUnlockTimerRef.current = null;
      }, 1_500);
      return true;
    } catch {
      navigationLockedRef.current = false;
      return false;
    }
  }

  return (
    <main className="flex min-h-[calc(100dvh-8rem)] min-w-0 items-start justify-center overflow-x-clip pb-12 pt-4 md:pt-7">
      <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col items-center justify-start">
        <div className="relative flex w-full min-w-0 items-start justify-center px-4">
          <h1 className="max-w-full truncate text-center text-xl font-black leading-[1.35] text-field-text md:text-2xl" title={project.name}>
            {project.name}
          </h1>
        </div>

        {invalidSelection ? <p className="mt-3 border border-field-danger/40 bg-field-panel px-4 py-2 text-center text-sm font-bold text-field-danger">선택한 회차를 찾을 수 없어 회차 목록으로 돌아왔습니다.</p> : null}

        {carouselItems.length === 0 ? (
          <p className="mt-8 text-center text-sm text-field-muted">진행 가능한 일촬표가 없습니다.</p>
        ) : (
          <DailyPlanCoverflow
            items={carouselItems}
            onActivate={handleActivatePlan}
            ariaLabel="진행도 회차 선택 카드"
          />
        )}
      </div>
    </main>
  );
}

function ModalLoadingFallback() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-field-bg/80">
      <div className="border border-field-divider bg-field-dialog p-4 shadow-dialog">
        <PixelDogLoader size="sm" compact />
      </div>
    </div>
  );
}

function formatEpisodeLabel(plan: Pick<DailyPlan, "episode" | "shootingDate">, index: number) {
  const episode = plan.episode.trim();
  if (episode) return episode.includes("회차") ? episode : `${episode}회차`;
  return plan.shootingDate || `${index + 1}회차`;
}

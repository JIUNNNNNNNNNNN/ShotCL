"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarPlus, Ellipsis, FolderOpen, Plus, RotateCcw } from "lucide-react";
import { DailyPlanCoverflow, type DailyPlanCarouselItem } from "@/components/DailyPlanCoverflow";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { ProjectGuideMenu } from "@/components/ProjectGuideMenu";
import { DailyProgressSummary } from "@/components/DailyProgressSummary";
import {
  DailyPlanGatheringLocations,
  type GatheringPhotoPreview
} from "@/components/DailyPlanGatheringLocations";
import { ProgressScheduleCard } from "@/components/ProgressScheduleCard";
import type { ProgressScheduleEditorValues } from "@/components/ProgressScheduleEditorModal";
import { ShotCard } from "@/components/ShotCard";
import type { ShotEditorValues } from "@/components/ShotEditorModal";
import { ShotReorderList } from "@/components/ShotReorderList";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createShotsFromDrafts, deleteAllShots, deleteShot, listShots, reorderShots, updateShot, updateShotStatus } from "@/lib/data/shots";
import { getShotDiagramKey, loadShotOverheadDiagrams } from "@/lib/data/shotDiagrams";
import { applyShotMediaLinks, loadShotMediaLinks } from "@/lib/data/shotMediaArchive";
import { listDailyPlans, updateDailyPlanScheduleItem, type DailyPlanListItem } from "@/lib/data/dailyPlans";
import { getProject } from "@/lib/data/projects";
import { decodeDailyPlanMemo } from "@/lib/dailyPlan/printMeta";
import { compareDailyPlanEpisodes, formatDailyPlanEpisodeLabel } from "@/lib/dailyPlan/carouselPresentation";
import { formatDailyPlanCardDate, formatDailyPlanCardDateAria } from "@/lib/dailyPlan/dateOnly";
import { saveScheduleImage } from "@/lib/data/storyboardFiles";
import { subscribeToShotChanges } from "@/lib/realtime/subscribeToShots";
import { auditQuery } from "@/lib/queryAudit";
import { calculateDailyProgress, calculateProgressPercent, isProcessedCutStatus } from "@/lib/progress/dailyProgress";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import type { DailyPlan, DailyPlanMealTime, Project, Shot, ShotDraft, ShotMediaLink, ShotMediaType, ShotStatus } from "@/lib/types";

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
  const scheduleRows = rows.filter(isMeaningfulScheduleRow);
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
    if (!schedule) return;
    const targetIndex = Math.min(shotIndex, shots.length);
    placements.set(targetIndex, [...(placements.get(targetIndex) ?? []), schedule]);
  });

  scheduleRows.slice(scheduleIndex).forEach((schedule) => {
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
  const [collapsedCutIds, setCollapsedCutIds] = useState<Set<string>>(() => new Set());
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
  const collapsedCutIdsRef = useRef(collapsedCutIds);
  const initializedCollapseEntryRef = useRef("");
  const activeProgressEntryKeyRef = useRef(progressEntryKey);
  activeProgressEntryKeyRef.current = progressEntryKey;

  const updateCollapsedCutIds = useCallback((update: (current: Set<string>) => Set<string>) => {
    setCollapsedCutIds((current) => {
      const next = update(current);
      collapsedCutIdsRef.current = next;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const requestedEntryKey = progressEntryKey;

    try {
      const [projectData, planData, selectedShots] = await Promise.all([
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
          : Promise.resolve([])
      ]);
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setProject(projectData);
      if (!projectData) {
        setDailyPlans([]);
        setShots([]);
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
      setDailyPlans(planData);
      setShots(shotsWithDiagrams);
      if (initializedCollapseEntryRef.current !== requestedEntryKey) {
        const initiallyCollapsedIds = new Set(
          shotsWithDiagrams
            .filter((shot) => isProcessedCutStatus(shot.status))
            .map((shot) => shot.id)
        );
        initializedCollapseEntryRef.current = requestedEntryKey;
        collapsedCutIdsRef.current = initiallyCollapsedIds;
        setCollapsedCutIds(initiallyCollapsedIds);
      }
      setErrorMessage("");
    } catch (error) {
      if (activeProgressEntryKeyRef.current !== requestedEntryKey) return;
      setErrorMessage(error instanceof Error ? error.message : "프로젝트 정보를 불러오지 못했습니다.");
    } finally {
      if (activeProgressEntryKeyRef.current === requestedEntryKey) setIsLoading(false);
    }
  }, [dailyPlanId, progressEntryKey, projectId]);

  useEffect(() => {
    initializedCollapseEntryRef.current = "";
    const emptySet = new Set<string>();
    collapsedCutIdsRef.current = emptySet;
    setCollapsedCutIds(emptySet);
  }, [progressEntryKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const refreshSelectedShots = useCallback(async () => {
    if (!projectId || !dailyPlanId) return;
    try {
      const refreshedShots = await auditQuery(
        "progress.realtime.reloadCuts",
        "app/projects/[id]/page.tsx:refreshSelectedShots",
        () => listShots(projectId, dailyPlanId)
      );
      setShots((current) => refreshedShots.map((shot) => preserveShotMedia(shot, current.find((item) => item.id === shot.id))));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "진행도 화면을 갱신하지 못했습니다.");
    }
  }, [dailyPlanId, projectId]);

  useEffect(() => {
    if (!projectId || !dailyPlanId) return undefined;
    return subscribeToShotChanges(projectId, refreshSelectedShots, dailyPlanId);
  }, [dailyPlanId, projectId, refreshSelectedShots]);

  const nextOrderIndex = shots.length + 1;
  const selectedPlan = dailyPlans.find((plan) => plan.id === dailyPlanId) ?? null;
  const dailyProgress = useMemo(() => calculateDailyProgress(shots), [shots]);
  const scheduleRowsByIndex = useMemo(
    () => selectedPlan ? placeScheduleRows(shots, selectedPlan.mealTimes, decodeDailyPlanMemo(selectedPlan.memo).timetableRowOrder) : new Map<number, DailyPlanMealTime[]>(),
    [selectedPlan, shots]
  );
  const scheduleRowCount = selectedPlan?.mealTimes.filter(isMeaningfulScheduleRow).length ?? 0;
  const handleImagePreview = useCallback((url: string, title: string) => {
    setPreview({ url, title: title.trim() || "콘티" });
  }, []);
  const handleGatheringPhotoPreview = useCallback((images: GatheringPhotoPreview[], index: number) => {
    const target = images[index];
    if (!target) return;
    setPreview({ url: target.url, title: target.title, images, index });
  }, []);
  const handleDailyPlanMetadataChange = useCallback((patch: Pick<DailyPlan, "memo" | "updatedAt">) => {
    setDailyPlans((current) => current.map((item) => (
      item.id === dailyPlanId ? { ...item, ...patch } : item
    )));
  }, [dailyPlanId]);

  const handleStatusChange = useCallback(async (targetShot: Shot, status: ShotStatus) => {
    const wasProcessed = isProcessedCutStatus(targetShot.status);
    const willBeProcessed = isProcessedCutStatus(status);
    const wasCollapsed = collapsedCutIdsRef.current.has(targetShot.id);
    setErrorMessage("");
    if (wasProcessed && !willBeProcessed) {
      updateCollapsedCutIds((current) => withCollapsedCut(current, targetShot.id, false));
    }
    setShots((current) => current.map((shot) => (shot.id === targetShot.id ? { ...shot, status } : shot)));

    try {
      const savedShot = await updateShotStatus(targetShot, status);
      const savedIsProcessed = isProcessedCutStatus(savedShot.status);
      setShots((current) => current.map((shot) => (
        shot.id === savedShot.id
          ? preserveShotMedia(savedShot, shot)
          : shot
      )));
      if (!wasProcessed && savedIsProcessed) {
        updateCollapsedCutIds((current) => withCollapsedCut(current, savedShot.id, true));
      } else if (!savedIsProcessed) {
        updateCollapsedCutIds((current) => withCollapsedCut(current, savedShot.id, false));
      }
    } catch (error) {
      setShots((current) => current.map((shot) => (shot.id === targetShot.id ? targetShot : shot)));
      updateCollapsedCutIds((current) => withCollapsedCut(current, targetShot.id, wasCollapsed));
      setErrorMessage(error instanceof Error ? error.message : "상태를 변경하지 못했습니다.");
    }
  }, [updateCollapsedCutIds]);

  const handleToggleShotCollapsed = useCallback((shot: Shot) => {
    if (!isProcessedCutStatus(shot.status)) return;
    updateCollapsedCutIds((current) => withCollapsedCut(current, shot.id, !current.has(shot.id)));
  }, [updateCollapsedCutIds]);

  async function handleSaveNewShot(values: ShotEditorValues) {
    if (!projectId || !dailyPlanId) return;

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

      await createShotsFromDrafts(projectId, drafts, dailyPlanId);

      setIsAddOpen(false);
      setSuccessMessage("새 컷을 추가했습니다.");
      await refresh();
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

  const renderShot = useCallback((shot: Shot) => (
    <ShotCard
      shot={shot}
      onOpen={setEditingShot}
      onOpenMedia={handleOpenMedia}
      onImagePreview={handleImagePreview}
      onStatusChange={handleStatusChange}
      collapsed={collapsedCutIds.has(shot.id)}
      onToggleCollapsed={handleToggleShotCollapsed}
      progressOnly={progressOnly}
    />
  ), [collapsedCutIds, handleImagePreview, handleOpenMedia, handleStatusChange, handleToggleShotCollapsed, progressOnly]);

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
        canEdit={role === "admin"}
      />
    );
  }

  return (
    <>
      <div className="relative z-30 mb-3 flex items-center justify-between" aria-label="진행 페이지 이동 메뉴">
        <div className="min-w-0 flex-1 pr-3 text-left md:text-center">
          <p className="truncate text-sm font-black text-field-primary">{project.name} / {formatEpisodeLabel(selectedPlan, 0)}</p>
          <p className="truncate text-[11px] font-bold text-field-muted">{selectedPlan.shootingDate || "촬영일 미정"}</p>
        </div>

        {!progressOnly ? <details className="group relative">
          <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-[3px] border border-field-border bg-white text-field-muted transition-[background-color,transform,border-color] marker:content-none hover:border-field-secondary hover:bg-field-light active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]">
            <Ellipsis className="h-5 w-5" aria-hidden />
            <span className="sr-only">프로젝트 보조 기능</span>
          </summary>
          <nav className="absolute right-0 top-[calc(100%+0.4rem)] z-40 grid w-56 gap-1 rounded-[1.25rem] border border-field-border bg-white p-2 shadow-[0_8px_22px_rgba(28,28,26,0.12)]" aria-label="프로젝트 보조 기능">
            <div className="mb-1 min-w-0 border-b border-field-border px-2 pb-2">
              <p className="truncate text-xs font-black text-field-primary">{project.name}</p>
              <p className="truncate text-[10px] font-bold text-field-muted">{project.shootDate || "촬영일 미정"}</p>
            </div>
            <button type="button" onClick={() => setIsAddOpen(true)} className="flex min-h-[38px] items-center gap-2 rounded-[3px] px-3 py-1.5 text-left text-xs font-black leading-[1.35] text-field-primary hover:bg-field-light">
              <span className="font-display"><span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" aria-hidden /> 새 컷 추가</span></span>
            </button>
            <Link href={`/projects/${project.id}/daily-plans/new`} className="flex min-h-[38px] items-center gap-2 rounded-[3px] px-3 py-1.5 text-xs font-black leading-[1.35] text-field-muted hover:bg-field-soft">
              <span className="font-display"><span className="inline-flex items-center gap-2"><CalendarPlus className="h-4 w-4" aria-hidden /> 새 일촬표</span></span>
            </Link>
            <Link href={`/projects/${project.id}/daily-plans`} className="flex min-h-[38px] items-center gap-2 rounded-[3px] px-3 py-1.5 text-xs font-black leading-[1.35] text-field-muted hover:bg-field-soft">
              <span className="font-display"><span className="inline-flex items-center gap-2"><FolderOpen className="h-4 w-4" aria-hidden /> 일촬표 목록</span></span>
            </Link>
          </nav>
        </details> : <span className="rounded-[3px] border border-field-border bg-white px-3 py-2 text-xs font-black text-field-muted">진행도</span>}
      </div>

      <Link href={`/projects/${project.id}?view=progress`} className="mb-3 inline-flex min-h-[38px] items-center gap-1 rounded-[3px] border border-field-border bg-white px-3 py-1.5 text-xs font-black leading-[1.35] text-field-muted transition-colors hover:border-field-secondary hover:bg-field-light">
        <span className="font-display"><span className="inline-flex items-center gap-1"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> 회차 선택</span></span>
      </Link>

      <DailyProgressSummary progress={dailyProgress} />

      <DailyPlanGatheringLocations
        projectId={project.id}
        plan={selectedPlan}
        canEdit={role === "admin"}
        onPlanMetadataChange={handleDailyPlanMetadataChange}
        onPreview={handleGatheringPhotoPreview}
      />

      {errorMessage ? (
        <div className="mb-3 rounded-[1.25rem] border border-field-danger bg-white p-3 text-sm font-bold text-field-danger">
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div className="mb-3 rounded-[1.25rem] border border-field-primary bg-field-light p-3 text-sm font-bold text-field-primary">
          {successMessage}
        </div>
      ) : null}

      <div id="cut-board" className="scroll-mt-28">
        <div className="mb-2 px-1">
          <h2 className="text-lg font-black text-field-primary">오늘 컷</h2>
        </div>
        {shots.length === 0 && scheduleRowCount === 0 ? (
          <Card className="rounded-[1.5rem]">
            <h2 className="text-xl font-black text-field-primary">아직 등록된 컷이 없습니다</h2>
            <p className="mt-2 text-base leading-6 text-field-muted">필요하면 아래의 새 컷 추가 버튼으로 직접 컷을 만들 수 있습니다.</p>
            <div className="mt-5 max-w-xs">
              {!progressOnly ? <Button onClick={() => setIsAddOpen(true)} className="rounded-[3px]">
                <Plus className="h-5 w-5" aria-hidden />
                새 컷 추가
              </Button> : null}
            </div>
          </Card>
        ) : (
          <ShotReorderList
            allShots={shots}
            visibleShots={shots}
            disabled={role !== "admin" || isReordering}
            onReorder={handleReorderShots}
            renderShot={renderShot}
            renderRowsBeforeIndex={(index) => scheduleRowsByIndex.get(index)?.map((item) => (
              <ProgressScheduleCard
                key={item.id}
                item={item}
                onOpen={setEditingSchedule}
                onImagePreview={handleImagePreview}
              />
            ))}
          />
        )}
      </div>

      {process.env.NODE_ENV !== "production" && !progressOnly ? (
        <details className="mt-4 rounded-[1.25rem] border border-field-border bg-white">
          <summary className="cursor-pointer px-4 py-3 text-xs font-black text-field-muted">개발용 도구</summary>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-field-border p-4">
            <p className="text-xs font-bold leading-5 text-field-muted">테스트 중 컷이 너무 많아졌을 때만 사용하세요. 프로젝트 정보는 삭제하지 않습니다.</p>
            <Button variant="danger" onClick={handleResetCurrentProjectShots} disabled={isSaving || shots.length === 0}>
              <RotateCcw className="h-5 w-5" aria-hidden /> 현재 회차 컷 목록 초기화
            </Button>
          </div>
        </details>
      ) : null}

      {!progressOnly ? <button
        type="button"
        onClick={() => setIsAddOpen(true)}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-[3px] border border-field-primary bg-field-primary text-white shadow-[0_6px_16px_rgba(15,61,46,0.18)] transition-[filter,transform] hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2 md:right-8"
        aria-label="새 컷 추가"
        title="새 컷 추가"
      >
        <Plus className="h-6 w-6" aria-hidden />
      </button> : null}

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

function withCollapsedCut(current: Set<string>, shotId: string, shouldCollapse: boolean) {
  if (current.has(shotId) === shouldCollapse) return current;
  const next = new Set(current);
  if (shouldCollapse) next.add(shotId);
  else next.delete(shotId);
  return next;
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
  invalidSelection,
  canEdit
}: {
  project: Project;
  plans: DailyPlanListItem[];
  invalidSelection: boolean;
  canEdit: boolean;
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
        <div className="relative flex w-full min-w-0 items-start justify-center px-14">
          <h1 className="max-w-full truncate text-center text-xl font-black leading-[1.35] text-field-primary md:text-2xl" title={project.name}>
            {project.name}
          </h1>
          {canEdit ? (
            <details className="group absolute right-1 top-0 shrink-0 md:right-3">
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary transition-[background-color,transform,border-color] marker:content-none hover:border-field-secondary hover:bg-field-light active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]">
                <span className="font-display"><span className="inline-flex items-center gap-1.5"><Ellipsis className="h-4 w-4" aria-hidden /> 프로젝트 수정</span></span>
              </summary>
              <div className="absolute right-0 top-[calc(100%+0.4rem)] z-40 grid w-56 gap-1 rounded-[1.25rem] border border-field-border bg-white p-2 shadow-[0_8px_22px_rgba(28,28,26,0.12)]">
                <Link href={`/projects/${project.id}/daily-plans`} className="flex min-h-[38px] items-center gap-2 rounded-[3px] px-3 py-1.5 text-xs font-black leading-[1.35] text-field-primary hover:bg-field-light">
                  <span className="font-display"><span className="inline-flex items-center gap-2"><FolderOpen className="h-4 w-4" aria-hidden /> 일촬표 수정</span></span>
                </Link>
                <details className="group/settings">
                  <summary className="flex min-h-[38px] cursor-pointer list-none items-center gap-2 rounded-[3px] px-3 py-1.5 text-xs font-black leading-[1.35] text-field-muted marker:content-none hover:bg-field-soft">
                    <span className="font-display"><span className="inline-flex items-center gap-2"><Ellipsis className="h-4 w-4" aria-hidden /> 프로젝트 설정</span></span>
                  </summary>
                  <div className="mx-2 mt-1 rounded-xl border border-field-border bg-field-soft/60 px-3 py-2 text-[10px] font-bold leading-5 text-field-muted">
                    <p className="truncate text-xs font-black text-field-primary">{project.name}</p>
                    <p>현재 권한: admin</p>
                    <p>프로젝트 ID: {project.id.slice(0, 8)}…</p>
                    <p>실제 삭제는 아직 지원하지 않습니다.</p>
                  </div>
                </details>
              </div>
            </details>
          ) : null}
        </div>

        {invalidSelection ? <p className="mt-3 border border-field-danger/40 bg-white px-4 py-2 text-center text-sm font-bold text-field-danger">선택한 회차를 찾을 수 없어 회차 목록으로 돌아왔습니다.</p> : null}

        {carouselItems.length === 0 ? (
          <p className="mt-8 text-center text-sm font-bold text-field-muted">진행 가능한 일촬표가 없습니다.</p>
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/20">
      <div className="rounded-2xl border border-field-border bg-white p-4 shadow-lg">
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

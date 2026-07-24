"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarDays, CalendarPlus, Ellipsis, FolderOpen, Plus, RotateCcw } from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { ProgressScheduleCard } from "@/components/ProgressScheduleCard";
import { ShotCard } from "@/components/ShotCard";
import type { ShotEditorValues } from "@/components/ShotEditorModal";
import { ShotReorderList } from "@/components/ShotReorderList";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createShotsFromDrafts, deleteAllShots, deleteShot, listShots, reorderShots, updateShot, updateShotStatus } from "@/lib/data/shots";
import { loadShotOverheadDiagram, loadShotOverheadDiagrams, saveShotOverheadDiagram } from "@/lib/data/shotDiagrams";
import { listDailyPlans, type DailyPlanListItem } from "@/lib/data/dailyPlans";
import { getProject } from "@/lib/data/projects";
import { decodeDailyPlanMemo } from "@/lib/dailyPlan/printMeta";
import { saveShotStoryboardImage } from "@/lib/data/storyboardFiles";
import { subscribeToShotChanges } from "@/lib/realtime/subscribeToShots";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import type { DailyPlan, DailyPlanMealTime, Project, Shot, ShotDraft, ShotOverheadDiagram, ShotStatus } from "@/lib/types";

const ShotEditorModal = dynamic(
  () => import("@/components/ShotEditorModal").then((module) => module.ShotEditorModal),
  { ssr: false, loading: ModalLoadingFallback }
);
const ShotOverheadEditor = dynamic(
  () => import("@/components/ShotOverheadEditor").then((module) => module.ShotOverheadEditor),
  { ssr: false, loading: ModalLoadingFallback }
);
const ImagePreviewModal = dynamic(
  () => import("@/components/ImagePreviewModal").then((module) => module.ImagePreviewModal),
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
  );
}

/** 프로젝트 상세 화면: 일일촬영 진행표 + 컷 편집 모달을 담당합니다. */
export default function ProjectDetailPage() {
  const { role } = useProjectAccess();
  const progressOnly = role === "progress";
  const projectId = useProjectId();
  const searchParams = useSearchParams();
  const dailyPlanId = searchParams.get("dailyPlanId") ?? "";
  const [project, setProject] = useState<Project | null>(null);
  const [dailyPlans, setDailyPlans] = useState<DailyPlanListItem[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editingShot, setEditingShot] = useState<Shot | null>(null);
  const [overheadShot, setOverheadShot] = useState<Shot | null>(null);
  const [overheadLoadingShotId, setOverheadLoadingShotId] = useState<string | null>(null);
  const overheadLoadingShotIdRef = useRef<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;

    try {
      const [projectData, planData, selectedShots] = await Promise.all([
        getProject(projectId),
        listDailyPlans(projectId),
        dailyPlanId ? listShots(projectId, dailyPlanId) : Promise.resolve([])
      ]);
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
          const diagrams = await loadShotOverheadDiagrams(selectedShots);
          shotsWithDiagrams = selectedShots.map((shot) => ({
            ...shot,
            overheadDiagram: diagrams.get(shot.id) ?? null
          }));
        } catch {
          // 부감도 미리보기 실패가 컷 진행표 자체를 막지 않도록 카드 데이터는 그대로 표시합니다.
        }
      }
      setDailyPlans(planData);
      setShots(shotsWithDiagrams);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "프로젝트 정보를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [dailyPlanId, projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const refreshSelectedShots = useCallback(async () => {
    if (!projectId || !dailyPlanId) return;
    try {
      const refreshedShots = await listShots(projectId, dailyPlanId);
      setShots((current) => refreshedShots.map((shot) => ({
        ...shot,
        overheadDiagram: current.find((item) => item.id === shot.id)?.overheadDiagram ?? null
      })));
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
  const scheduleRowsByIndex = useMemo(
    () => selectedPlan ? placeScheduleRows(shots, selectedPlan.mealTimes, decodeDailyPlanMemo(selectedPlan.memo).timetableRowOrder) : new Map<number, DailyPlanMealTime[]>(),
    [selectedPlan, shots]
  );
  const scheduleRowCount = selectedPlan?.mealTimes.filter(isMeaningfulScheduleRow).length ?? 0;
  const meetingLocation = selectedPlan ? getProgressMeetingLocation(selectedPlan) : "";
  const handleImagePreview = useCallback((url: string, title: string) => {
    setPreview({ url, title: title.trim() || "콘티" });
  }, []);

  const handleStatusChange = useCallback(async (targetShot: Shot, status: ShotStatus) => {
    setErrorMessage("");
    setShots((current) => current.map((shot) => (shot.id === targetShot.id ? { ...shot, status } : shot)));

    try {
      const savedShot = await updateShotStatus(targetShot, status);
      setShots((current) => current.map((shot) => (
        shot.id === savedShot.id
          ? { ...savedShot, overheadDiagram: shot.overheadDiagram }
          : shot
      )));
    } catch (error) {
      setShots((current) => current.map((shot) => (shot.id === targetShot.id ? targetShot : shot)));
      setErrorMessage(error instanceof Error ? error.message : "상태를 변경하지 못했습니다.");
    }
  }, []);

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

      const [createdShot] = await createShotsFromDrafts(projectId, drafts, dailyPlanId);
      if (createdShot && values.imageFile) {
        const imageUrl = await saveShotStoryboardImage(projectId, createdShot.id, values.imageFile);
        await updateShot(createdShot.id, { storyboardImageUrl: imageUrl }, projectId);
      }

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
      let imageUrl = values.storyboardImageUrl;
      if (values.imageFile) {
        imageUrl = await saveShotStoryboardImage(projectId, editingShot.id, values.imageFile);
      }

      await updateShot(editingShot.id, {
        sceneNumber: values.sceneNumber.trim() || "1",
        cutNumber: values.cutNumber.trim() || "1",
        title: editingShot.title,
        description: values.description.trim(),
        location: values.location.trim(),
        characters: parseCharacters(values.charactersText),
        memo: editingShot.memo,
        orderIndex: editingShot.orderIndex,
        status: editingShot.status,
        storyboardImageUrl: imageUrl
      }, projectId);

      setEditingShot(null);
      setSuccessMessage("컷 정보를 저장했습니다.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "컷을 저장하지 못했습니다.");
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

  async function handleSaveOverhead(diagram: ShotOverheadDiagram) {
    if (!projectId || !overheadShot || progressOnly) return;

    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const savedDiagram = await saveShotOverheadDiagram(overheadShot, diagram);
      const updatedShot = { ...overheadShot, overheadDiagram: savedDiagram };
      setShots((current) => current.map((shot) => shot.id === updatedShot.id ? updatedShot : shot));
      setOverheadShot(null);
      setSuccessMessage("컷 부감도를 저장했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "컷 부감도를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  const handleOpenOverhead = useCallback(async (shot: Shot) => {
    if (overheadLoadingShotIdRef.current) return;
    overheadLoadingShotIdRef.current = shot.id;
    setOverheadLoadingShotId(shot.id);
    setErrorMessage("");

    try {
      const diagram = await loadShotOverheadDiagram(shot);
      const loadedShot = { ...shot, overheadDiagram: diagram };
      setShots((current) => current.map((item) => item.id === shot.id ? loadedShot : item));
      setOverheadShot(loadedShot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "컷 부감도를 불러오지 못했습니다.");
    } finally {
      overheadLoadingShotIdRef.current = null;
      setOverheadLoadingShotId(null);
    }
  }, []);

  const renderShot = useCallback((shot: Shot) => (
    <ShotCard
      shot={shot}
      onOpen={setEditingShot}
      onOpenOverhead={handleOpenOverhead}
      isOverheadLoading={overheadLoadingShotId === shot.id}
      onImagePreview={handleImagePreview}
      onStatusChange={handleStatusChange}
      progressOnly={progressOnly}
    />
  ), [handleImagePreview, handleOpenOverhead, handleStatusChange, overheadLoadingShotId, progressOnly]);

  async function handleReorderShots(nextShots: Shot[]) {
    if (!projectId || !dailyPlanId || role !== "admin" || isReordering) return;

    const previousShots = shots;
    setIsReordering(true);
    setErrorMessage("");
    setShots(nextShots);

    try {
      const savedShots = await reorderShots(projectId, dailyPlanId, nextShots.map((shot) => shot.id));
      setShots(savedShots);
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
          <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-field-border bg-white text-field-muted transition-[background-color,transform,border-color] marker:content-none hover:border-field-secondary hover:bg-field-light active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]">
            <Ellipsis className="h-5 w-5" aria-hidden />
            <span className="sr-only">프로젝트 보조 기능</span>
          </summary>
          <nav className="absolute right-0 top-[calc(100%+0.4rem)] z-40 grid w-56 gap-1 rounded-[1.25rem] border border-field-border bg-white p-2 shadow-[0_8px_22px_rgba(28,28,26,0.12)]" aria-label="프로젝트 보조 기능">
            <div className="mb-1 min-w-0 border-b border-field-border px-2 pb-2">
              <p className="truncate text-xs font-black text-field-primary">{project.name}</p>
              <p className="truncate text-[10px] font-bold text-field-muted">{project.shootDate || "촬영일 미정"}</p>
            </div>
            <button type="button" onClick={() => setIsAddOpen(true)} className="flex min-h-[38px] items-center gap-2 rounded-full px-3 py-1.5 text-left text-xs font-black leading-[1.35] text-field-primary hover:bg-field-light">
              <span className="font-display"><span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" aria-hidden /> 새 컷 추가</span></span>
            </button>
            <Link href={`/projects/${project.id}/daily-plans/new`} className="flex min-h-[38px] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black leading-[1.35] text-field-muted hover:bg-field-soft">
              <span className="font-display"><span className="inline-flex items-center gap-2"><CalendarPlus className="h-4 w-4" aria-hidden /> 새 일촬표</span></span>
            </Link>
            <Link href={`/projects/${project.id}/daily-plans`} className="flex min-h-[38px] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black leading-[1.35] text-field-muted hover:bg-field-soft">
              <span className="font-display"><span className="inline-flex items-center gap-2"><FolderOpen className="h-4 w-4" aria-hidden /> 일촬표 목록</span></span>
            </Link>
          </nav>
        </details> : <span className="rounded-full border border-field-border bg-white px-3 py-2 text-xs font-black text-field-muted">진행도</span>}
      </div>

      <Link href={`/projects/${project.id}`} className="mb-3 inline-flex min-h-[38px] items-center gap-1 rounded-full border border-field-border bg-white px-3 py-1.5 text-xs font-black leading-[1.35] text-field-muted transition-colors hover:border-field-secondary hover:bg-field-light">
        <span className="font-display"><span className="inline-flex items-center gap-1"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> 회차 선택</span></span>
      </Link>

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
        <section className="mb-3 rounded-[1.35rem] border border-field-border bg-white px-4 py-3">
          <p className="text-[11px] font-black text-field-muted">집합 장소</p>
          <p className="mt-1 min-h-5 break-words text-sm font-black leading-5 text-field-primary">
            {meetingLocation}
          </p>
        </section>
        <div className="mb-2 px-1">
          <h2 className="text-lg font-black text-field-primary">오늘 컷</h2>
        </div>
        {shots.length === 0 && scheduleRowCount === 0 ? (
          <Card className="rounded-[1.5rem]">
            <h2 className="text-xl font-black text-field-primary">아직 등록된 컷이 없습니다</h2>
            <p className="mt-2 text-base leading-6 text-field-muted">필요하면 아래의 새 컷 추가 버튼으로 직접 컷을 만들 수 있습니다.</p>
            <div className="mt-5 max-w-xs">
              {!progressOnly ? <Button onClick={() => setIsAddOpen(true)} className="rounded-full">
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
              <ProgressScheduleCard key={item.id} item={item} />
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
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-field-primary bg-field-primary text-white shadow-[0_6px_16px_rgba(15,61,46,0.18)] transition-[filter,transform] hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2 md:right-8"
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

      {overheadShot ? (
        <ShotOverheadEditor
          shot={overheadShot}
          readOnly={progressOnly}
          isSaving={isSaving}
          onClose={() => setOverheadShot(null)}
          onSave={handleSaveOverhead}
        />
      ) : null}

      {preview ? <ImagePreviewModal imageUrl={preview.url} title={preview.title} onClose={() => setPreview(null)} /> : null}
    </>
  );
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
  return (
    <main className="mx-auto w-full max-w-3xl pb-12">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="max-w-[45vw] truncate rounded-full border border-field-border bg-white px-3 py-1.5 text-xs font-black text-field-primary">
            <span className="font-display">{project.name}</span>
          </p>
          <p className="truncate text-xs font-bold text-field-muted">진행할 회차 선택</p>
        </div>
        {canEdit ? (
          <details className="group relative shrink-0">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary transition-[background-color,transform,border-color] marker:content-none hover:border-field-secondary hover:bg-field-light active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]">
              <span className="font-display"><span className="inline-flex items-center gap-1.5"><Ellipsis className="h-4 w-4" aria-hidden /> 프로젝트 수정</span></span>
            </summary>
            <div className="absolute right-0 top-[calc(100%+0.4rem)] z-40 grid w-56 gap-1 rounded-[1.25rem] border border-field-border bg-white p-2 shadow-[0_8px_22px_rgba(28,28,26,0.12)]">
              <Link href={`/projects/${project.id}/daily-plans`} className="flex min-h-[38px] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black leading-[1.35] text-field-primary hover:bg-field-light">
                <span className="font-display"><span className="inline-flex items-center gap-2"><FolderOpen className="h-4 w-4" aria-hidden /> 일촬표 수정</span></span>
              </Link>
              <details className="group/settings">
                <summary className="flex min-h-[38px] cursor-pointer list-none items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black leading-[1.35] text-field-muted marker:content-none hover:bg-field-soft">
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

      {invalidSelection ? <p className="mb-4 rounded-full border border-field-danger/40 bg-white px-4 py-2 text-center text-sm font-bold text-field-danger">선택한 회차를 찾을 수 없어 회차 목록으로 돌아왔습니다.</p> : null}

      {plans.length === 0 ? (
        <section className="rounded-[2rem] border border-field-border bg-white px-6 py-10 text-center">
          <CalendarDays className="mx-auto h-9 w-9 text-field-secondary" aria-hidden />
          <h1 className="mt-3 text-lg font-black text-field-primary">아직 오늘의 진행표가 없습니다</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-field-muted">일촬표를 작성하면 회차별 진행률이 생성됩니다.</p>
        </section>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((plan, index) => {
            const total = plan.progressTotal || plan.shotCount;
            const completed = plan.progressCompleted;
            const progress = total === 0 ? 0 : Math.round((completed / total) * 100);
            return (
              <Link
                key={plan.id}
                href={`/projects/${project.id}?dailyPlanId=${encodeURIComponent(plan.id)}`}
                className="group rounded-[2rem] border border-field-border bg-white p-5 transition-[background-color,border-color,transform] hover:border-field-secondary hover:bg-field-light active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-black text-field-primary">
                      <span className="font-display">{formatEpisodeLabel(plan, index)}</span>
                    </h2>
                    <p className="mt-1 text-xs font-bold text-field-muted">{plan.shootingDate || "촬영일 미정"}</p>
                  </div>
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-field-border bg-field-light text-sm font-black text-field-primary">{progress}%</div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-full border border-field-border bg-field-soft/60 px-4 py-2 text-xs font-black">
                  {total > 0 ? <><span className="text-field-primary">총 {total}컷</span><span className="text-field-muted">완료 {completed}컷</span></> : <span className="w-full text-center text-field-muted">컷 없음 · 일촬표에서 컷수를 입력하세요</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
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

function getProgressMeetingLocation(plan: DailyPlan) {
  const explicitMeetingLocation = plan.meetingLocation?.trim() ?? "";
  if (explicitMeetingLocation) return explicitMeetingLocation;

  const meta = decodeDailyPlanMemo(plan.memo);
  const callLocations = [
    ...meta.starring.map((person) => person.callLocation.trim()),
    ...meta.teams.map((team) => team.callLocation.trim())
  ].filter(Boolean);
  if (callLocations.length > 0) {
    const counts = new Map<string, number>();
    callLocations.forEach((location) => {
      counts.set(location, (counts.get(location) ?? 0) + 1);
    });
    return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
  }

  const firstLocation = plan.shootingLocations?.[0];
  if (firstLocation) {
    return [
      firstLocation.name,
      firstLocation.roadAddress,
      firstLocation.address,
      firstLocation.detail
    ].find((value) => value?.trim())?.trim() ?? "";
  }

  return plan.shootingLocation?.trim() ?? "";
}

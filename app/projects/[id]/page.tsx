"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarPlus, FileSpreadsheet, FolderOpen, History, ListChecks, Plus, RotateCcw, Upload } from "lucide-react";
import { FilterTabs, type ShotFilter } from "@/components/FilterTabs";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { ProgressSummary } from "@/components/ProgressSummary";
import { ShotCard } from "@/components/ShotCard";
import { ShotEditorModal, type ShotEditorValues } from "@/components/ShotEditorModal";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createShotsFromDrafts, deleteAllShots, deleteShot, listShots, moveShot, updateShot, updateShotStatus } from "@/lib/data/shots";
import { getProject } from "@/lib/data/projects";
import { saveShotStoryboardImage } from "@/lib/data/storyboardFiles";
import { downloadStandardDailyPlanTemplate } from "@/lib/dailyPlan/excel";
import { subscribeToShotChanges } from "@/lib/realtime/subscribeToShots";
import type { Project, Shot, ShotDraft, ShotStatus } from "@/lib/types";

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

/** 카드 필터에 맞는 컷만 남깁니다. */
function filterShots(shots: Shot[], filter: ShotFilter) {
  if (filter === "ok") return shots.filter((shot) => shot.status === "ok");
  if (filter === "omit") return shots.filter((shot) => shot.status === "omit");
  if (filter === "remaining") return shots.filter((shot) => shot.status === "pending");
  return shots;
}

/** 프로젝트 상세 화면: 일일촬영 진행표 + 컷 편집 모달을 담당합니다. */
export default function ProjectDetailPage() {
  const projectId = useProjectId();
  const [project, setProject] = useState<Project | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [filter, setFilter] = useState<ShotFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editingShot, setEditingShot] = useState<Shot | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;

    try {
      const [projectData, shotData] = await Promise.all([getProject(projectId), listShots(projectId)]);
      setProject(projectData);
      setShots(shotData);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "프로젝트 정보를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projectId) return undefined;
    return subscribeToShotChanges(projectId, refresh);
  }, [projectId, refresh]);

  const filteredShots = useMemo(() => filterShots(shots, filter), [filter, shots]);
  const nextOrderIndex = shots.length + 1;

  async function handleStatusChange(targetShot: Shot, status: ShotStatus) {
    const previousShots = shots;
    setShots((current) => current.map((shot) => (shot.id === targetShot.id ? { ...shot, status } : shot)));

    try {
      await updateShotStatus(targetShot, status);
      await refresh();
    } catch (error) {
      setShots(previousShots);
      setErrorMessage(error instanceof Error ? error.message : "상태를 변경하지 못했습니다.");
    }
  }

  async function handleSaveNewShot(values: ShotEditorValues) {
    if (!projectId) return;

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

      const [createdShot] = await createShotsFromDrafts(projectId, drafts);
      if (createdShot && values.imageFile) {
        const imageUrl = await saveShotStoryboardImage(projectId, createdShot.id, values.imageFile);
        await updateShot(createdShot.id, { storyboardImageUrl: imageUrl });
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
        title: values.title.trim() || "제목 없음",
        description: values.description.trim(),
        location: values.location.trim(),
        characters: parseCharacters(values.charactersText),
        memo: values.memo.trim(),
        orderIndex: values.orderIndex,
        status: values.status,
        storyboardImageUrl: imageUrl
      });

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

  async function handleMoveShot(shot: Shot, direction: "up" | "down") {
    if (!projectId) return;

    try {
      await moveShot(projectId, shot.id, direction);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "순서를 바꾸지 못했습니다.");
    }
  }

  async function handleResetCurrentProjectShots() {
    if (!projectId) return;

    const shouldReset = window.confirm("현재 프로젝트의 컷 목록만 삭제합니다. 프로젝트 정보와 분석 기록은 유지됩니다. 계속할까요?");
    if (!shouldReset) return;

    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await deleteAllShots(projectId);
      setShots([]);
      setSuccessMessage("현재 프로젝트의 컷 목록을 초기화했습니다. 프로젝트 정보는 유지됩니다.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "컷 목록을 초기화하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <Card className="text-field-muted">컷 리스트를 불러오는 중입니다.</Card>;
  }

  if (!project) {
    return (
      <Card className="border-field-danger text-field-danger">
        <p className="font-bold">프로젝트를 찾을 수 없습니다.</p>
        {errorMessage ? <p className="mt-2 break-words text-sm font-medium">{errorMessage}</p> : null}
        <ButtonLink href="/" className="mt-4">
          목록으로
        </ButtonLink>
      </Card>
    );
  }

  return (
    <>
      <section className="mb-5 rounded-md border border-field-border bg-white p-5 md:p-6">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
          <div className="min-w-0">
            <p className="text-xs font-black text-field-muted">오늘의 진행표</p>
            <h1 className="mt-1 break-words text-2xl font-black text-field-primary">{project.name}</h1>
            <p className="mt-1 text-sm font-bold text-field-muted">
              {project.shootDate || "촬영일 미정"}
              {project.description ? ` · ${project.description}` : ""}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 md:min-w-[36rem] lg:grid-cols-3">
            <Link
              href={`/projects/${project.id}/daily-plans/new`}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-field-primary bg-field-primary px-3 text-sm font-black text-white"
              title="새 일촬표 만들기"
            >
              <CalendarPlus className="h-4 w-4" aria-hidden />
              새 일촬표 만들기
            </Link>
            <Link
              href={`/projects/${project.id}/daily-plan/import`}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-field-border bg-white px-3 text-sm font-black text-field-primary"
              title="Excel 일촬표 업로드"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              Excel 일촬표 업로드
            </Link>
            <Link
              href={`/projects/${project.id}/daily-plans`}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-field-border bg-white px-3 text-sm font-black text-field-primary"
              title="저장된 일촬표 목록"
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
              저장된 일촬표 목록
            </Link>
            <Link
              href={`/projects/${project.id}`}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-field-border bg-field-light px-3 text-sm font-black text-field-primary"
              title="컷 진행표 보기"
            >
              <ListChecks className="h-4 w-4" aria-hidden />
              컷 진행표 보기
            </Link>
            <Button variant="secondary" onClick={() => downloadStandardDailyPlanTemplate(project)} className="min-h-11">
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              표준 Excel 양식 다운로드
            </Button>
            <Link
              href={`/projects/${project.id}/upload`}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-field-border bg-white px-3 text-sm font-black text-field-muted"
              title="PDF 업로드 분석"
            >
              <Upload className="h-4 w-4" aria-hidden />
              PDF 업로드 분석
            </Link>
            <Link
              href={`/projects/${project.id}/analysis-runs`}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-field-border bg-white px-3 text-sm font-black text-field-primary"
              title="분석 기록"
            >
              <History className="h-4 w-4" aria-hidden />
              분석 기록
            </Link>
            <Button onClick={() => setIsAddOpen(true)} className="hidden md:inline-flex min-h-11">
              <Plus className="h-5 w-5" aria-hidden />
              새 컷 추가
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <ProgressSummary shots={shots} />
        </div>
        <div className="mt-3">
          <FilterTabs value={filter} onChange={setFilter} />
        </div>
        <div className="mt-4 rounded-md border border-field-border bg-field-soft p-3 text-sm font-bold leading-6 text-field-muted">
          가장 안정적인 방식은 Excel 일촬표를 업로드하거나 웹 일촬표 편집기에서 수정하는 것입니다. PDF 분석은 외부에서 PDF만 받은 경우에만 보조 기능으로 사용하세요.
        </div>
      </section>

      {errorMessage ? (
        <div className="mb-4 rounded-md border border-field-danger bg-white p-4 text-sm font-bold text-field-danger">
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div className="mb-4 rounded-md border border-field-primary bg-field-light p-4 text-sm font-bold text-field-primary">
          {successMessage}
        </div>
      ) : null}

      {shots.length === 0 ? (
        <Card>
          <h2 className="text-xl font-black text-field-primary">아직 등록된 컷이 없습니다</h2>
          <p className="mt-2 text-base leading-6 text-field-muted">필요하면 아래의 새 컷 추가 버튼으로 직접 컷을 만들 수 있습니다.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 md:max-w-lg">
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="h-5 w-5" aria-hidden />
              새 컷 추가
            </Button>
            <ButtonLink href={`/projects/${project.id}/upload`} variant="secondary">
              <Upload className="h-5 w-5" aria-hidden />
              PDF 업로드 분석
            </ButtonLink>
          </div>
        </Card>
      ) : filteredShots.length === 0 ? (
        <Card className="text-field-muted">선택한 필터에 해당하는 컷이 없습니다.</Card>
      ) : (
        <div className="grid gap-4 pb-24 md:grid-cols-2 xl:grid-cols-3">
          {filteredShots.map((shot) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              onOpen={setEditingShot}
              onImagePreview={(url, title) => setPreview({ url, title })}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}

      {process.env.NODE_ENV !== "production" ? (
        <section className="mt-6 rounded-md border border-field-border bg-white p-5">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="text-base font-black text-field-primary">개발용 초기화</h2>
              <p className="mt-1 text-sm font-bold leading-6 text-field-muted">
                테스트 중 컷이 너무 많아졌을 때만 사용하세요. 프로젝트 정보는 삭제하지 않습니다.
              </p>
            </div>
            <Button variant="danger" onClick={handleResetCurrentProjectShots} disabled={isSaving || shots.length === 0}>
              <RotateCcw className="h-5 w-5" aria-hidden />
              현재 프로젝트 컷 목록 초기화
            </Button>
          </div>
        </section>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-field-border bg-white/95 p-4 backdrop-blur md:hidden">
        <div className="mx-auto max-w-6xl">
          <Button onClick={() => setIsAddOpen(true)} className="w-full">
            <Plus className="h-5 w-5" aria-hidden />
            새 컷 추가
          </Button>
        </div>
      </div>

      <ShotEditorModal
        mode="add"
        open={isAddOpen}
        shot={null}
        defaultOrderIndex={nextOrderIndex}
        isSaving={isSaving}
        onClose={() => setIsAddOpen(false)}
        onSave={handleSaveNewShot}
      />

      <ShotEditorModal
        mode="edit"
        open={Boolean(editingShot)}
        shot={editingShot}
        defaultOrderIndex={nextOrderIndex}
        isSaving={isSaving}
        onClose={() => setEditingShot(null)}
        onSave={handleSaveExistingShot}
        onDelete={handleDeleteShot}
        onMove={handleMoveShot}
      />

      <ImagePreviewModal imageUrl={preview?.url ?? null} title={preview?.title ?? ""} onClose={() => setPreview(null)} />
    </>
  );
}

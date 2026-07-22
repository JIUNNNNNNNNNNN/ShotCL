"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarPlus, Ellipsis, FileSpreadsheet, FolderOpen, History, House, Plus, RotateCcw, Upload } from "lucide-react";
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
      <div className="relative z-30 mb-3 flex items-center justify-between" aria-label="진행 페이지 이동 메뉴">
        <Link
          href="/"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-field-secondary bg-white text-field-primary transition-[background-color,transform,border-color] hover:border-field-primary hover:bg-field-light active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2"
          aria-label="홈으로 이동"
          title="홈"
        >
          <House className="h-5 w-5" aria-hidden />
        </Link>

        <details className="group relative">
          <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-field-border bg-white text-field-muted transition-[background-color,transform,border-color] marker:content-none hover:border-field-secondary hover:bg-field-light active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]">
            <Ellipsis className="h-5 w-5" aria-hidden />
            <span className="sr-only">프로젝트 보조 기능</span>
          </summary>
          <nav className="absolute right-0 top-[calc(100%+0.4rem)] z-40 grid w-56 gap-1 rounded-[1.25rem] border border-field-border bg-white p-2 shadow-[0_8px_22px_rgba(28,28,26,0.12)]" aria-label="프로젝트 보조 기능">
            <div className="mb-1 min-w-0 border-b border-field-border px-2 pb-2">
              <p className="truncate text-xs font-black text-field-primary">{project.name}</p>
              <p className="truncate text-[10px] font-bold text-field-muted">{project.shootDate || "촬영일 미정"}</p>
            </div>
            <button type="button" onClick={() => setIsAddOpen(true)} className="flex min-h-9 items-center gap-2 rounded-full px-3 text-left text-xs font-black text-field-primary hover:bg-field-light">
              <Plus className="h-4 w-4" aria-hidden /> 새 컷 추가
            </button>
            <Link href={`/projects/${project.id}/daily-plans/new`} className="flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-black text-field-muted hover:bg-field-soft">
              <CalendarPlus className="h-4 w-4" aria-hidden /> 새 일촬표
            </Link>
            <Link href={`/projects/${project.id}/daily-plans`} className="flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-black text-field-muted hover:bg-field-soft">
              <FolderOpen className="h-4 w-4" aria-hidden /> 일촬표 목록
            </Link>
            <Link href={`/projects/${project.id}/daily-plan/import`} className="flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-black text-field-muted hover:bg-field-soft">
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel 일촬표 업로드
            </Link>
            <Link href={`/projects/${project.id}/upload`} className="flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-black text-field-muted hover:bg-field-soft">
              <Upload className="h-4 w-4" aria-hidden /> PDF 업로드 분석
            </Link>
            <Link href={`/projects/${project.id}/analysis-runs`} className="flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-black text-field-muted hover:bg-field-soft">
              <History className="h-4 w-4" aria-hidden /> 분석 기록
            </Link>
            <button type="button" onClick={() => downloadStandardDailyPlanTemplate(project)} className="flex min-h-9 items-center gap-2 rounded-full px-3 text-left text-xs font-black text-field-muted hover:bg-field-soft">
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> 표준 Excel 양식 다운로드
            </button>
          </nav>
        </details>
      </div>

      <section className="mb-3">
        <ProgressSummary shots={shots} />
        <div className="mt-2">
          <FilterTabs value={filter} onChange={setFilter} />
        </div>
      </section>

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
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-lg font-black text-field-primary">오늘 컷</h2>
        <p className="text-xs font-bold text-field-muted">{filteredShots.length}개 표시</p>
      </div>
      {shots.length === 0 ? (
        <Card className="rounded-[1.5rem]">
          <h2 className="text-xl font-black text-field-primary">아직 등록된 컷이 없습니다</h2>
          <p className="mt-2 text-base leading-6 text-field-muted">필요하면 아래의 새 컷 추가 버튼으로 직접 컷을 만들 수 있습니다.</p>
          <div className="mt-5 max-w-xs">
            <Button onClick={() => setIsAddOpen(true)} className="rounded-full">
              <Plus className="h-5 w-5" aria-hidden />
              새 컷 추가
            </Button>
          </div>
        </Card>
      ) : filteredShots.length === 0 ? (
        <Card className="rounded-[1.5rem] text-field-muted">선택한 필터에 해당하는 컷이 없습니다.</Card>
      ) : (
        <div className="grid gap-2 pb-24">
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
      </div>

      {process.env.NODE_ENV !== "production" ? (
        <details className="mt-4 rounded-[1.25rem] border border-field-border bg-white">
          <summary className="cursor-pointer px-4 py-3 text-xs font-black text-field-muted">개발용 도구</summary>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-field-border p-4">
            <p className="text-xs font-bold leading-5 text-field-muted">테스트 중 컷이 너무 많아졌을 때만 사용하세요. 프로젝트 정보는 삭제하지 않습니다.</p>
            <Button variant="danger" onClick={handleResetCurrentProjectShots} disabled={isSaving || shots.length === 0}>
              <RotateCcw className="h-5 w-5" aria-hidden /> 현재 프로젝트 컷 목록 초기화
            </Button>
          </div>
        </details>
      ) : null}

      <button
        type="button"
        onClick={() => setIsAddOpen(true)}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-field-primary bg-field-primary text-white shadow-[0_6px_16px_rgba(15,61,46,0.18)] transition-[filter,transform] hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2 md:right-8"
        aria-label="새 컷 추가"
        title="새 컷 추가"
      >
        <Plus className="h-6 w-6" aria-hidden />
      </button>

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

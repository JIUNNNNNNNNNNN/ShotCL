"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarDays, CalendarPlus, Ellipsis, FolderOpen, History, Plus, RotateCcw, Upload } from "lucide-react";
import { FilterTabs, type ShotFilter } from "@/components/FilterTabs";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { ProgressSummary } from "@/components/ProgressSummary";
import { ShotCard } from "@/components/ShotCard";
import { ShotEditorModal, type ShotEditorValues } from "@/components/ShotEditorModal";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createShotsFromDrafts, deleteAllShots, deleteShot, listShots, moveShot, updateShot, updateShotStatus } from "@/lib/data/shots";
import { listDailyPlans } from "@/lib/data/dailyPlans";
import { getProject } from "@/lib/data/projects";
import { saveShotStoryboardImage } from "@/lib/data/storyboardFiles";
import { subscribeToShotChanges } from "@/lib/realtime/subscribeToShots";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import type { DailyPlan, Project, Shot, ShotDraft, ShotStatus } from "@/lib/types";

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
  const { role } = useProjectAccess();
  const progressOnly = role === "progress";
  const projectId = useProjectId();
  const searchParams = useSearchParams();
  const dailyPlanId = searchParams.get("dailyPlanId") ?? "";
  const [project, setProject] = useState<Project | null>(null);
  const [dailyPlans, setDailyPlans] = useState<Array<DailyPlan & { shotCount: number }>>([]);
  const [episodeShots, setEpisodeShots] = useState<Record<string, Shot[]>>({});
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
      const projectData = await getProject(projectId);
      setProject(projectData);
      if (!projectData) {
        setDailyPlans([]);
        setEpisodeShots({});
        setShots([]);
        setErrorMessage("");
        return;
      }
      const planData = await listDailyPlans(projectData.id);
      const shotEntries = await Promise.all(planData.map(async (plan) => [plan.id, await listShots(projectData.id, plan.id)] as const));
      const shotsByPlan = Object.fromEntries(shotEntries);
      setDailyPlans(planData);
      setEpisodeShots(shotsByPlan);
      setShots(dailyPlanId ? shotsByPlan[dailyPlanId] ?? [] : []);
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

  useEffect(() => {
    if (!projectId || !dailyPlanId) return undefined;
    return subscribeToShotChanges(projectId, refresh, dailyPlanId);
  }, [dailyPlanId, projectId, refresh]);

  const filteredShots = useMemo(() => filterShots(shots, filter), [filter, shots]);
  const nextOrderIndex = shots.length + 1;
  const selectedPlan = dailyPlans.find((plan) => plan.id === dailyPlanId) ?? null;

  async function handleStatusChange(targetShot: Shot, status: ShotStatus) {
    if (progressOnly && !(targetShot.status === "pending" && status === "ok")) {
      setErrorMessage("진행도 권한은 대기 중인 컷을 OK로만 변경할 수 있습니다.");
      return;
    }
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
        title: values.title.trim() || "제목 없음",
        description: values.description.trim(),
        location: values.location.trim(),
        characters: parseCharacters(values.charactersText),
        memo: values.memo.trim(),
        orderIndex: values.orderIndex,
        status: values.status,
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

  async function handleMoveShot(shot: Shot, direction: "up" | "down") {
    if (!projectId || !dailyPlanId) return;

    try {
      await moveShot(projectId, shot.id, direction, dailyPlanId);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "순서를 바꾸지 못했습니다.");
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
        shotsByPlan={episodeShots}
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
            <button type="button" onClick={() => setIsAddOpen(true)} className="flex min-h-[38px] items-center gap-2 rounded-full px-3 py-1.5 text-left text-xs font-black leading-[1.35] tracking-[-0.05em] text-field-primary hover:bg-field-light">
              <span className="font-condensed gap-2"><Plus className="h-4 w-4" aria-hidden /> 새 컷 추가</span>
            </button>
            <Link href={`/projects/${project.id}/daily-plans/new`} className="flex min-h-[38px] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black leading-[1.35] tracking-[-0.05em] text-field-muted hover:bg-field-soft">
              <span className="font-condensed gap-2"><CalendarPlus className="h-4 w-4" aria-hidden /> 새 일촬표</span>
            </Link>
            <Link href={`/projects/${project.id}/daily-plans`} className="flex min-h-[38px] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black leading-[1.35] tracking-[-0.05em] text-field-muted hover:bg-field-soft">
              <span className="font-condensed gap-2"><FolderOpen className="h-4 w-4" aria-hidden /> 일촬표 목록</span>
            </Link>
            <Link href={`/projects/${project.id}/upload?dailyPlanId=${encodeURIComponent(selectedPlan.id)}`} className="flex min-h-[38px] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black leading-[1.35] tracking-[-0.05em] text-field-muted hover:bg-field-soft">
              <span className="font-condensed gap-2"><Upload className="h-4 w-4" aria-hidden /> PDF 업로드 분석</span>
            </Link>
            <Link href={`/projects/${project.id}/analysis-runs`} className="flex min-h-[38px] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black leading-[1.35] tracking-[-0.05em] text-field-muted hover:bg-field-soft">
              <span className="font-condensed gap-2"><History className="h-4 w-4" aria-hidden /> 분석 기록</span>
            </Link>
          </nav>
        </details> : <span className="rounded-full border border-field-border bg-white px-3 py-2 text-xs font-black text-field-muted">진행도 권한</span>}
      </div>

      <section className="mb-3">
        <Link href={`/projects/${project.id}`} className="mb-2 inline-flex min-h-[38px] items-center gap-1 rounded-full border border-field-border bg-white px-3 py-1.5 text-xs font-black leading-[1.35] tracking-[-0.05em] text-field-muted transition-colors hover:border-field-secondary hover:bg-field-light">
          <span className="font-condensed gap-1"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> 회차 선택</span>
        </Link>
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
            {!progressOnly ? <Button onClick={() => setIsAddOpen(true)} className="rounded-full">
              <Plus className="h-5 w-5" aria-hidden />
              새 컷 추가
            </Button> : null}
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
              progressOnly={progressOnly}
            />
          ))}
        </div>
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

      {!progressOnly ? <ShotEditorModal
        mode="add"
        open={isAddOpen}
        shot={null}
        defaultOrderIndex={nextOrderIndex}
        isSaving={isSaving}
        onClose={() => setIsAddOpen(false)}
        onSave={handleSaveNewShot}
      /> : null}

      {!progressOnly ? <ShotEditorModal
        mode="edit"
        open={Boolean(editingShot)}
        shot={editingShot}
        defaultOrderIndex={nextOrderIndex}
        isSaving={isSaving}
        onClose={() => setEditingShot(null)}
        onSave={handleSaveExistingShot}
        onDelete={handleDeleteShot}
        onMove={handleMoveShot}
      /> : null}

      <ImagePreviewModal imageUrl={preview?.url ?? null} title={preview?.title ?? ""} onClose={() => setPreview(null)} />
    </>
  );
}

function EpisodeSelection({
  project,
  plans,
  shotsByPlan,
  invalidSelection,
  canEdit
}: {
  project: Project;
  plans: Array<DailyPlan & { shotCount: number }>;
  shotsByPlan: Record<string, Shot[]>;
  invalidSelection: boolean;
  canEdit: boolean;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl pb-12">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="max-w-[45vw] truncate rounded-full border border-field-border bg-white px-3 py-1.5 text-xs font-black text-field-primary">
            <span className="font-condensed">{project.name}</span>
          </p>
          <p className="truncate text-xs font-bold text-field-muted">
            <span className="font-condensed">진행할 회차 선택</span>
          </p>
        </div>
        {canEdit ? (
          <details className="group relative shrink-0">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary transition-[background-color,transform,border-color] marker:content-none hover:border-field-secondary hover:bg-field-light active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]">
              <span className="font-condensed gap-1.5"><Ellipsis className="h-4 w-4" aria-hidden /> 프로젝트 수정</span>
            </summary>
            <div className="absolute right-0 top-[calc(100%+0.4rem)] z-40 grid w-56 gap-1 rounded-[1.25rem] border border-field-border bg-white p-2 shadow-[0_8px_22px_rgba(28,28,26,0.12)]">
              <Link href={`/projects/${project.id}/daily-plans`} className="flex min-h-[38px] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black leading-[1.35] tracking-[-0.05em] text-field-primary hover:bg-field-light">
                <span className="font-condensed gap-2"><FolderOpen className="h-4 w-4" aria-hidden /> 일촬표 수정</span>
              </Link>
              <details className="group/settings">
                <summary className="flex min-h-[38px] cursor-pointer list-none items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black leading-[1.35] tracking-[-0.05em] text-field-muted marker:content-none hover:bg-field-soft">
                  <span className="font-condensed gap-2"><Ellipsis className="h-4 w-4" aria-hidden /> 프로젝트 설정</span>
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
          <h1 className="mt-3 text-lg font-black text-field-primary">아직 저장된 일촬표가 없습니다</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-field-muted">관리자가 일촬표를 저장하면 회차별 진행보기가 생성됩니다.</p>
        </section>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((plan, index) => {
            const planShots = shotsByPlan[plan.id] ?? [];
            const total = planShots.length || plan.shotCount;
            const completed = planShots.filter((shot) => shot.status === "ok" || shot.status === "omit").length;
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
                      <span className="font-condensed">{formatEpisodeLabel(plan, index)}</span>
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

function formatEpisodeLabel(plan: Pick<DailyPlan, "episode" | "shootingDate">, index: number) {
  const episode = plan.episode.trim();
  if (episode) return episode.includes("회차") ? episode : `${episode}회차`;
  return plan.shootingDate || `${index + 1}회차`;
}

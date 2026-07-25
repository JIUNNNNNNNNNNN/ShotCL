"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ImagePlus, Map as MapIcon, Pencil, Trash2, Upload } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { listDailyPlans, type DailyPlanListItem } from "@/lib/data/dailyPlans";
import {
  deleteProjectReferenceAsset,
  listProjectReferenceAssets,
  updateProjectReferenceAsset,
  uploadProjectReferenceAsset
} from "@/lib/data/projectReferenceAssets";
import { getProject } from "@/lib/data/projects";
import {
  getShotDiagramKey,
  loadShotOverheadDiagrams,
  saveShotOverheadDiagram
} from "@/lib/data/shotDiagrams";
import { listShots } from "@/lib/data/shots";
import type { ProjectReferenceAsset, Shot, ShotOverheadDiagram } from "@/lib/types";

const ShotOverheadEditor = dynamic(
  () => import("@/components/ShotOverheadEditor").then((module) => module.ShotOverheadEditor),
  { ssr: false, loading: () => <PixelDogLoader size="md" /> }
);

export default function ProjectStoryboardOverheadPage() {
  const params = useParams<{ id: string | string[] }>();
  const searchParams = useSearchParams();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const targetShotRef = searchParams.get("shotRef") ?? "";
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const [projectName, setProjectName] = useState("");
  const [plans, setPlans] = useState<DailyPlanListItem[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState(searchParams.get("dailyPlanId") ?? "");
  const [shots, setShots] = useState<Shot[]>([]);
  const [overheads, setOverheads] = useState<ProjectReferenceAsset[]>([]);
  const [storyboards, setStoryboards] = useState<ProjectReferenceAsset[]>([]);
  const [editingShot, setEditingShot] = useState<Shot | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [storyboardGroup, setStoryboardGroup] = useState("기본");
  const [cropRatio, setCropRatio] = useState(4 / 3);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadProjectData = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [project, dailyPlans, storyboardAssets] = await Promise.all([
        getProject(projectId),
        listDailyPlans(projectId),
        listProjectReferenceAssets(projectId, "storyboard")
      ]);
      setProjectName(project?.name ?? "프로젝트");
      setPlans(dailyPlans);
      setStoryboards(storyboardAssets);
      setSelectedPlanId((current) => current || dailyPlans[0]?.id || "");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "부감도와 콘티 자료를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const loadPlanAssets = useCallback(async () => {
    if (!projectId || !selectedPlanId) {
      setShots([]);
      setOverheads([]);
      return;
    }
    try {
      const [planShots, overheadAssets] = await Promise.all([
        listShots(projectId, selectedPlanId),
        listProjectReferenceAssets(projectId, "overhead", selectedPlanId)
      ]);
      const diagrams = await loadShotOverheadDiagrams(planShots).catch(() => new Map<string, ShotOverheadDiagram>());
      setShots(planShots.map((shot) => ({
        ...shot,
        overheadDiagram: diagrams.get(shot.id) ?? null,
        overheadImageUrl: overheadAssets.find((asset) => asset.shotRef === getShotDiagramKey(shot).shotRef)?.publicUrl ?? null
      })));
      setOverheads(overheadAssets);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "회차별 부감도를 불러오지 못했습니다.");
    }
  }, [projectId, selectedPlanId]);

  useEffect(() => {
    void loadProjectData();
  }, [loadProjectData]);

  useEffect(() => {
    void loadPlanAssets();
  }, [loadPlanAssets]);

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  const overheadByRef = useMemo(
    () => new Map(overheads.filter((asset) => asset.shotRef).map((asset) => [asset.shotRef as string, asset])),
    [overheads]
  );

  async function handleOverheadUpload(shot: Shot, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!projectId || !file) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const key = getShotDiagramKey(shot);
      await uploadProjectReferenceAsset(projectId, "overhead", file, {
        dailyPlanId: key.dailyPlanId,
        shotRef: key.shotRef,
        sceneNo: shot.sceneNumber,
        cutNo: shot.cutNumber
      });
      await loadPlanAssets();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "부감도 이미지를 업로드하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDiagramSave(diagram: ShotOverheadDiagram) {
    if (!editingShot) return;
    setIsSaving(true);
    try {
      await saveShotOverheadDiagram(editingShot, diagram);
      setEditingShot(null);
      await loadPlanAssets();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "부감도를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStoryboardUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!projectId || files.length === 0) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      for (let index = 0; index < files.length; index += 1) {
        await uploadProjectReferenceAsset(projectId, "storyboard", files[index], {
          groupId: storyboardGroup,
          cropRatio,
          sortOrder: storyboards.length + index
        });
      }
      setStoryboards(await listProjectReferenceAssets(projectId, "storyboard"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "콘티 이미지를 업로드하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCropRatio(asset: ProjectReferenceAsset, ratio: number) {
    if (!projectId) return;
    try {
      const saved = await updateProjectReferenceAsset(projectId, asset.id, {
        groupId: asset.groupId ?? storyboardGroup,
        crop: { ...asset.crop, ratio }
      });
      setStoryboards((current) => current.map((item) => item.id === saved.id ? saved : item));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "콘티 비율을 저장하지 못했습니다.");
    }
  }

  async function handleDelete(asset: ProjectReferenceAsset) {
    if (!projectId || !window.confirm(`"${asset.filename}"을 삭제할까요?`)) return;
    try {
      await deleteProjectReferenceAsset(projectId, asset.id);
      if (asset.assetType === "overhead") await loadPlanAssets();
      else setStoryboards(await listProjectReferenceAssets(projectId, "storyboard"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "자료를 삭제하지 못했습니다.");
    }
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  return (
    <>
      <div className="mx-auto grid w-full max-w-6xl gap-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display truncate text-xl font-black text-field-primary">부감도&콘티</h1>
            <p className="truncate text-xs font-bold text-field-muted">{projectName} · 프로젝트 촬영 자료</p>
          </div>
          {!canEdit ? <span className="rounded-full border border-field-border bg-white px-3 py-2 text-xs font-black text-field-muted">읽기 전용</span> : null}
        </div>

        {errorMessage ? (
          <p role="alert" className="rounded-xl border border-field-danger bg-red-50 px-3 py-2 text-sm font-bold text-field-danger">{errorMessage}</p>
        ) : null}

        <Card>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-black text-field-primary">부감도</h2>
              <p className="text-xs font-bold text-field-muted">컷별 업로드 이미지를 진행도 카드에서 가장 먼저 표시합니다.</p>
            </div>
            <label className="grid min-w-[12rem] gap-1 text-xs font-black text-field-muted">
              회차
              <select value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm font-bold text-field-text">
                {plans.length === 0 ? <option value="">저장된 회차 없음</option> : null}
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.episode || plan.title}</option>)}
              </select>
            </label>
          </div>

          {!selectedPlan ? (
            <p className="py-8 text-center text-sm font-bold text-field-muted">부감도를 연결할 저장된 일촬표가 없습니다.</p>
          ) : shots.length === 0 ? (
            <p className="py-8 text-center text-sm font-bold text-field-muted">이 회차에 연결된 컷이 없습니다.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {shots.map((shot) => {
                const key = getShotDiagramKey(shot);
                const uploaded = overheadByRef.get(key.shotRef);
                return (
                  <article
                    key={shot.id}
                    className={`grid overflow-hidden rounded-xl border bg-white ${
                      targetShotRef && key.shotRef === targetShotRef
                        ? "border-[#d7b95f] ring-2 ring-[#d7b95f]/35"
                        : "border-field-border"
                    }`}
                  >
                    <button
                      type="button"
                      disabled={!uploaded && !shot.overheadDiagram}
                      onClick={() => {
                        if (uploaded) setPreview({ url: uploaded.publicUrl, title: `S#${shot.sceneNumber} C#${shot.cutNumber} 부감도` });
                        else if (shot.overheadDiagram) setEditingShot(shot);
                      }}
                      className="grid aspect-[4/3] place-items-center overflow-hidden bg-field-soft disabled:cursor-default"
                    >
                      {uploaded ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={uploaded.publicUrl} alt={`S#${shot.sceneNumber} C#${shot.cutNumber} 부감도`} className="h-full w-full rounded-none object-contain" />
                      ) : shot.overheadDiagram ? (
                        <ShotOverheadPreview diagram={shot.overheadDiagram} label={`S#${shot.sceneNumber} C#${shot.cutNumber} 부감도`} />
                      ) : (
                        <MapIcon className="h-8 w-8 text-field-muted" aria-hidden />
                      )}
                    </button>
                    <div className="grid gap-2 p-2.5">
                      <p className="truncate text-sm font-black text-field-primary">S#{shot.sceneNumber} · C#{shot.cutNumber}</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {canEdit ? (
                          <>
                            <label className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1 rounded-full border border-field-border bg-white px-2 text-[11px] font-black text-field-primary">
                              <Upload className="h-3.5 w-3.5" aria-hidden />
                              이미지
                              <input type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={(event) => handleOverheadUpload(shot, event)} disabled={isSaving} />
                            </label>
                            <button type="button" onClick={() => setEditingShot(shot)} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-full border border-field-border text-[11px] font-black text-field-primary">
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                              {shot.overheadDiagram ? "도면 수정" : "도면 만들기"}
                            </button>
                            {uploaded ? (
                              <button type="button" onClick={() => handleDelete(uploaded)} className="col-span-2 inline-flex min-h-8 items-center justify-center gap-1 rounded-full text-[11px] font-black text-field-danger">
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                업로드 이미지 삭제
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <span className="col-span-2 text-center text-[11px] font-bold text-field-muted">{uploaded || shot.overheadDiagram ? "보기 가능" : "부감도 없음"}</span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-black text-field-primary">콘티</h2>
              <p className="text-xs font-bold text-field-muted">원본은 보존하고 선택한 비율을 crop metadata로 저장합니다.</p>
            </div>
            {canEdit ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-[11px] font-black text-field-muted">
                  세트
                  <input value={storyboardGroup} onChange={(event) => setStoryboardGroup(event.target.value)} className="min-h-9 w-24 rounded-lg border border-field-border px-2 text-xs" />
                </label>
                <label className="grid gap-1 text-[11px] font-black text-field-muted">
                  기준 비율
                  <select value={cropRatio} onChange={(event) => setCropRatio(Number(event.target.value))} className="min-h-9 rounded-lg border border-field-border bg-white px-2 text-xs">
                    <option value={4 / 3}>4:3</option>
                    <option value={16 / 9}>16:9</option>
                    <option value={1}>1:1</option>
                    <option value={3 / 2}>3:2</option>
                  </select>
                </label>
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-field-primary bg-field-primary px-3 text-sm font-black text-white">
                  <ImagePlus className="h-4 w-4" aria-hidden />
                  여러 장 업로드
                  <input type="file" accept="image/*,.heic,.heif" multiple className="sr-only" onChange={handleStoryboardUpload} disabled={isSaving} />
                </label>
              </div>
            ) : null}
          </div>

          {storyboards.length === 0 ? (
            <p className="py-8 text-center text-sm font-bold text-field-muted">등록된 콘티 이미지가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {storyboards.map((asset) => {
                const ratio = asset.crop.ratio || 4 / 3;
                return (
                  <article key={asset.id} className="overflow-hidden border border-field-border bg-white">
                    <button type="button" onClick={() => setPreview({ url: asset.publicUrl, title: asset.filename })} className="block w-full overflow-hidden bg-field-soft" style={{ aspectRatio: ratio }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.publicUrl}
                        alt={asset.filename}
                        className="h-full w-full rounded-none object-cover"
                        style={{ objectPosition: `${asset.crop.x * 100}% ${asset.crop.y * 100}%` }}
                      />
                    </button>
                    <div className="grid gap-1.5 p-2">
                      <p className="truncate text-xs font-black text-field-text">{asset.filename}</p>
                      <p className="truncate text-[10px] font-bold text-field-muted">{asset.groupId || "기본 세트"}</p>
                      {canEdit ? (
                        <div className="flex items-center gap-1">
                          <select
                            aria-label={`${asset.filename} crop 비율`}
                            value={ratio}
                            onChange={(event) => handleCropRatio(asset, Number(event.target.value))}
                            className="min-h-8 min-w-0 flex-1 rounded border border-field-border bg-white px-1 text-[10px] font-bold"
                          >
                            <option value={4 / 3}>4:3</option>
                            <option value={16 / 9}>16:9</option>
                            <option value={1}>1:1</option>
                            <option value={3 / 2}>3:2</option>
                          </select>
                          <button type="button" onClick={() => handleDelete(asset)} className="grid h-8 w-8 place-items-center text-field-danger" aria-label={`${asset.filename} 삭제`}>
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {editingShot ? (
        <ShotOverheadEditor
          shot={editingShot}
          readOnly={!canEdit}
          isSaving={isSaving}
          onClose={() => setEditingShot(null)}
          onSave={handleDiagramSave}
        />
      ) : null}
      <ImagePreviewModal imageUrl={preview?.url ?? null} title={preview?.title ?? "자료"} onClose={() => setPreview(null)} />
    </>
  );
}

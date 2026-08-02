"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useParams } from "next/navigation";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { ScenarioPdfSceneSegments } from "@/components/ScenarioPdfSceneSegments";
import {
  analyzeScenarioPdfImages
} from "@/lib/client/scenarioPdfImages";
import {
  deleteProjectReferenceAsset,
  listProjectReferenceAssets,
  updateProjectReferenceAsset,
  uploadProjectReferenceAsset
} from "@/lib/data/projectReferenceAssets";
import { getProject } from "@/lib/data/projects";
import { auditQuery } from "@/lib/queryAudit";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { SCENARIO_MARKER_NOT_FOUND_MESSAGE } from "@/lib/scenarioSceneMarker";
import type { ProjectReferenceAsset, ProjectScenarioScene } from "@/lib/types";

type ViewMode = "scenes" | "pdf";

export default function ProjectScenarioPage() {
  const params = useParams<{ id: string | string[] }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedAssetIdRef = useRef("");
  const [projectName, setProjectName] = useState("");
  const [assets, setAssets] = useState<ProjectReferenceAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("scenes");
  const [query, setQuery] = useState("");
  const [draftScenes, setDraftScenes] = useState<ProjectScenarioScene[]>([]);
  const [expandedSceneId, setExpandedSceneId] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  useUnsavedChangesGuard(hasChanges);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedId) ?? null,
    [assets, selectedId]
  );

  const load = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [project, scenarioAssets] = await Promise.all([
        auditQuery(
          "scenario.loadProject",
          "app/projects/[id]/scenario/page.tsx:load",
          () => getProject(projectId)
        ),
        auditQuery(
          "scenario.loadFilesAndSceneMetadata",
          "app/projects/[id]/scenario/page.tsx:load",
          () => listProjectReferenceAssets(projectId, "scenario")
        )
      ]);
      setProjectName(project?.name ?? "프로젝트");
      setAssets(scenarioAssets);
      setSelectedId((current) => scenarioAssets.some((asset) => asset.id === current)
        ? current
        : scenarioAssets[0]?.id ?? "");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "시나리오 자료를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const scenes = selectedAsset?.scenarioScenes ?? [];
    const nextSelectedAssetId = selectedAsset?.id ?? "";
    const selectedAssetChanged = selectedAssetIdRef.current !== nextSelectedAssetId;
    setDraftScenes(scenes.map((scene) => ({ ...scene })));
    setExpandedSceneId((current) => (
      selectedAssetChanged || !scenes.some((scene) => scene.id === current)
        ? ""
        : current
    ));
    selectedAssetIdRef.current = nextSelectedAssetId;
    setIsEditing(false);
    setHasChanges(false);
    setQuery("");
  }, [selectedAsset?.id, selectedAsset?.updatedAt]);

  const filteredScenes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalizedQuery) return draftScenes;
    return draftScenes.filter((scene) =>
      [scene.sceneNo, scene.title]
        .join("\n")
        .toLocaleLowerCase("ko-KR")
        .includes(normalizedQuery)
    );
  }, [draftScenes, query]);
  const detectedSceneNumbers = useMemo(
    () => draftScenes
      .filter((scene) => scene.imageSegments.length > 0)
      .map((scene) => scene.sceneNo),
    [draftScenes]
  );

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!projectId || files.length === 0) return;
    setIsUploading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      let uploadedId = "";
      let analysisWarning = "";
      for (const file of files) {
        const uploadedAsset = await uploadProjectReferenceAsset(projectId, "scenario", file);
        uploadedId = uploadedAsset.id;
        try {
          const imageScenes = await analyzeScenarioPdfImages(uploadedAsset.publicUrl);
          await updateProjectReferenceAsset(projectId, uploadedAsset.id, {
            scenarioScenes: imageScenes
          });
        } catch (analysisError) {
          analysisWarning = analysisError instanceof Error
            ? analysisError.message
            : "PDF 이미지 분할에 실패했습니다.";
          await updateProjectReferenceAsset(projectId, uploadedAsset.id, {
            scenarioScenes: [],
            scenarioParseError: analysisWarning
          });
        }
      }
      await load();
      if (uploadedId) setSelectedId(uploadedId);
      setViewMode("scenes");
      setStatusMessage(analysisWarning
        ? "PDF 업로드는 완료되었습니다."
        : "PDF 업로드와 씬 이미지 분석이 완료되었습니다.");
      if (analysisWarning) setErrorMessage(analysisWarning);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "PDF를 업로드하지 못했습니다.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(asset: ProjectReferenceAsset) {
    if (!projectId || !window.confirm(`"${asset.filename}"을 삭제할까요?`)) return;
    try {
      await deleteProjectReferenceAsset(projectId, asset.id);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "PDF를 삭제하지 못했습니다.");
    }
  }

  async function handleSaveScenes() {
    if (!projectId || !selectedAsset || !canEdit) return;
    setIsSaving(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const saved = await updateProjectReferenceAsset(projectId, selectedAsset.id, {
        scenarioScenes: draftScenes
      });
      replaceAsset(saved);
      setIsEditing(false);
      setHasChanges(false);
      setStatusMessage("씬 구성이 저장되었습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "씬 구성을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReanalyze() {
    if (!projectId || !selectedAsset || !canEdit) return;
    if (hasChanges && !window.confirm("저장하지 않은 변경사항을 버리고 자동 분할을 다시 실행할까요?")) return;
    setIsAnalyzing(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const imageScenes = await analyzeScenarioPdfImages(selectedAsset.publicUrl);
      const analyzed = await updateProjectReferenceAsset(projectId, selectedAsset.id, {
        scenarioScenes: imageScenes
      });
      replaceAsset(analyzed);
      setStatusMessage(analyzed.scenarioScenes.length > 0
        ? "자동 씬 분할을 다시 실행했습니다."
        : "자동 분할 결과가 없습니다. 원본 PDF 보기 또는 수동 씬 추가를 사용하세요.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "자동 씬 분할을 실행하지 못했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function replaceAsset(asset: ProjectReferenceAsset) {
    setAssets((current) => current.map((item) => item.id === asset.id ? asset : item));
  }

  function updateScene(id: string, patch: Partial<ProjectScenarioScene>) {
    setDraftScenes((current) => current.map((scene) => scene.id === id ? { ...scene, ...patch } : scene));
    setHasChanges(true);
  }

  function addScene() {
    const scene = createBlankScene(draftScenes.length + 1);
    setDraftScenes((current) => [...current, scene]);
    setIsEditing(true);
    setHasChanges(true);
  }

  function removeScene(id: string) {
    const target = draftScenes.find((scene) => scene.id === id);
    if (!target || !window.confirm(`"${target.title}" 씬을 삭제할까요? 저장 전까지 DB에는 반영되지 않습니다.`)) return;
    setDraftScenes((current) => current.filter((scene) => scene.id !== id));
    setExpandedSceneId((current) => current === id ? "" : current);
    setHasChanges(true);
  }

  function moveScene(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= draftScenes.length) return;
    setDraftScenes((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setHasChanges(true);
  }

  function cancelEditing() {
    const scenes = selectedAsset?.scenarioScenes ?? [];
    setDraftScenes(scenes.map((scene) => ({ ...scene })));
    setExpandedSceneId((current) => scenes.some((scene) => scene.id === current) ? current : "");
    setIsEditing(false);
    setHasChanges(false);
    setErrorMessage("");
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  return (
    <div className="grid w-full min-w-0 gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-field-border pb-2">
        <div className="mr-1 min-w-0 shrink-0">
          <h1 className="font-display text-base font-bold leading-normal text-field-text sm:text-lg">
            시나리오
          </h1>
          <p className="hidden max-w-40 truncate text-[11px] leading-normal text-field-muted sm:block">
            {projectName}
          </p>
        </div>

        {assets.length > 0 ? (
          <label className="min-w-[9.5rem] flex-1 sm:max-w-sm">
            <span className="sr-only">시나리오 PDF 선택</span>
            <select
              value={selectedId}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setErrorMessage("");
                setStatusMessage("");
              }}
              aria-label="시나리오 PDF 선택"
              className="min-h-9 w-full min-w-0 truncate border border-field-border bg-field-input px-3 text-xs text-field-text outline-none transition focus:border-field-primary focus:ring-2 focus:ring-field-primary/30"
            >
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.filename}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="min-w-0 flex-1 truncate text-xs text-field-muted">
            등록된 PDF가 없습니다.
          </p>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {selectedAsset ? (
            <>
              <a
                href={selectedAsset.publicUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`${selectedAsset.filename} 새 창에서 열기`}
                title="원본 PDF 새 창"
                className="grid h-9 w-9 place-items-center border border-field-border bg-field-panel text-field-muted transition hover:border-field-divider hover:bg-field-hover hover:text-field-text active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
              <a
                href={selectedAsset.publicUrl}
                download={selectedAsset.filename}
                target="_blank"
                rel="noreferrer"
                aria-label={`${selectedAsset.filename} 다운로드`}
                title="다운로드"
                className="grid h-9 w-9 place-items-center border border-field-border bg-field-panel text-field-muted transition hover:border-field-divider hover:bg-field-hover hover:text-field-text active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
              </a>
            </>
          ) : null}

          {canEdit ? (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                aria-label={isUploading ? "PDF 업로드 중" : "PDF 업로드"}
                title="PDF 업로드"
                className="inline-flex min-h-9 items-center gap-1 border border-field-primary bg-field-primary px-2.5 text-[11px] font-bold text-field-accent-foreground transition hover:border-field-secondary hover:bg-field-secondary active:scale-95 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              >
                {isUploading ? <PixelDogLoader size="xs" compact /> : <Upload className="h-3.5 w-3.5" aria-hidden />}
                <span className="hidden sm:inline">{isUploading ? "분석 중" : "+ PDF"}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="sr-only"
                onChange={handleUpload}
              />
              {selectedAsset ? (
                <button
                  type="button"
                  onClick={() => void handleDelete(selectedAsset)}
                  aria-label={`${selectedAsset.filename} 삭제`}
                  title="선택한 PDF 삭제"
                  className="grid h-9 w-9 place-items-center border border-field-danger/50 bg-field-panel text-field-danger transition hover:bg-field-danger/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {selectedAsset ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="inline-flex border border-field-border bg-field-panel p-0.5">
            <ModeButton active={viewMode === "scenes"} onClick={() => setViewMode("scenes")} icon={List}>
              씬별 보기
            </ModeButton>
            <ModeButton active={viewMode === "pdf"} onClick={() => setViewMode("pdf")} icon={FileText}>
              전체 PDF
            </ModeButton>
          </div>

          {viewMode === "scenes" ? (
            <label className="relative min-w-[10rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-field-muted" aria-hidden />
              <span className="sr-only">씬 검색</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="씬 번호·제목 검색"
                className="min-h-9 w-full border border-field-border bg-field-input py-1.5 pl-8 pr-3 text-xs text-field-text outline-none transition focus:border-field-primary focus:ring-2 focus:ring-field-primary/30"
              />
            </label>
          ) : null}

          {viewMode === "scenes" && canEdit ? (
            <div className="ml-auto flex items-center gap-1">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={cancelEditing}
                    disabled={isSaving}
                    className="inline-flex min-h-9 items-center gap-1 border border-field-border bg-field-panel px-2.5 text-[11px] font-bold text-field-muted transition hover:border-field-divider hover:bg-field-hover hover:text-field-text active:scale-95"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveScenes()}
                    disabled={isSaving || !hasChanges}
                    className="inline-flex min-h-9 items-center gap-1 border border-field-primary bg-field-primary px-3 text-[11px] font-bold text-field-accent-foreground transition hover:border-field-secondary hover:bg-field-secondary active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Save className="h-3.5 w-3.5" aria-hidden />
                    {isSaving ? "저장 중" : "저장"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="inline-flex min-h-9 items-center gap-1 border border-field-border bg-field-panel px-2.5 text-[11px] font-bold text-field-text transition hover:border-field-divider hover:bg-field-hover active:scale-95"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  편집
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleReanalyze()}
                disabled={isAnalyzing}
                title="원본 PDF에서 자동 분할 다시 실행"
                className="grid h-9 w-9 place-items-center border border-field-border bg-field-panel text-field-muted transition hover:border-field-divider hover:bg-field-hover hover:text-field-text active:scale-95 disabled:cursor-wait disabled:opacity-50"
              >
                {isAnalyzing ? <PixelDogLoader size="xs" compact /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                <span className="sr-only">자동 분할 다시 실행</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="border-l-2 border-field-danger bg-field-danger/10 px-2.5 py-1.5 text-xs font-bold text-field-danger">
          {errorMessage}
        </p>
      ) : null}
      {statusMessage ? (
        <p role="status" className="border-l-2 border-field-divider bg-field-soft px-2.5 py-1.5 text-xs font-bold text-field-subtle">
          {statusMessage}
        </p>
      ) : null}
      {selectedAsset && canEdit && detectedSceneNumbers.length > 0 ? (
        <p
          role={detectedSceneNumbers.length <= 2 ? "alert" : "status"}
          className={`border-l-2 px-2.5 py-1.5 text-[11px] font-bold leading-normal ${
            detectedSceneNumbers.length <= 2
              ? "border-field-primary bg-field-primary/10 text-field-primary"
              : "border-field-divider bg-field-soft text-field-subtle"
          }`}
        >
          감지된 씬: {detectedSceneNumbers.length}개 ·{" "}
          {detectedSceneNumbers.map((sceneNo) => `S#${sceneNo}`).join(", ")}
          {detectedSceneNumbers.length <= 2
            ? " · 후반 씬 marker가 있다면 재분석 결과와 개발 로그를 확인하세요."
            : ""}
        </p>
      ) : null}
      {hasChanges ? (
        <p className="text-right text-[11px] font-bold text-field-primary">
          저장하지 않은 변경사항이 있습니다.
        </p>
      ) : null}

      {viewMode === "pdf" ? (
        <FullPdfView asset={selectedAsset} canEdit={canEdit} />
      ) : (
        <section aria-label="씬별 시나리오 읽기" className="min-w-0">
          {!selectedAsset ? (
            <EmptyState canEdit={canEdit} onAdd={addScene} hasAsset={false} />
          ) : draftScenes.length === 0 ? (
            <div className="grid min-h-[18rem] place-items-center border-y border-field-border px-4 py-8 text-center">
              <div className="max-w-lg">
                <p className="text-sm font-bold text-field-text">
                  {selectedAsset.scenarioParseError
                    || SCENARIO_MARKER_NOT_FOUND_MESSAGE}
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setViewMode("pdf")}
                    className="min-h-9 border border-field-border bg-field-panel px-3 text-xs font-bold text-field-text transition-colors hover:border-field-divider hover:bg-field-hover"
                  >
                    원본 PDF 보기
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={addScene}
                      className="inline-flex min-h-9 items-center gap-1 border border-field-primary bg-field-primary px-3 text-xs font-bold text-field-accent-foreground transition hover:border-field-secondary hover:bg-field-secondary"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      수동 씬 추가
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid min-w-0 gap-1.5">
              {filteredScenes.map((scene) => {
                const index = draftScenes.findIndex((item) => item.id === scene.id);
                const expanded = expandedSceneId === scene.id;
                return (
                  <article key={scene.id} className="min-w-0 border border-field-border bg-field-panel">
                    <div className="flex min-w-0 items-center gap-1.5 px-2.5 py-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setExpandedSceneId(expanded ? "" : scene.id)}
                        className="flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-field-muted transition-transform ${expanded ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                        <span className="shrink-0 border border-field-border bg-field-soft px-2 py-0.5 text-xs font-bold text-field-subtle">
                          S#{scene.sceneNo || index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-bold leading-normal text-field-text">
                          {scene.title || `Scene ${index + 1}`}
                        </span>
                        {scene.pageStart ? (
                          <span className="shrink-0 text-[11px] text-field-muted">
                            p.{formatPageRange(scene)}
                          </span>
                        ) : null}
                      </button>
                      {isEditing ? (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <SmallIconButton
                            label="씬 위로 이동"
                            disabled={index <= 0}
                            onClick={() => moveScene(index, -1)}
                            icon={ArrowUp}
                          />
                          <SmallIconButton
                            label="씬 아래로 이동"
                            disabled={index >= draftScenes.length - 1}
                            onClick={() => moveScene(index, 1)}
                            icon={ArrowDown}
                          />
                          <SmallIconButton
                            label="씬 삭제"
                            danger
                            onClick={() => removeScene(scene.id)}
                            icon={Trash2}
                          />
                        </div>
                      ) : null}
                    </div>

                    {expanded ? (
                      <div className="border-t border-field-border px-3 py-3 sm:px-4">
                        <div className="grid gap-2">
                          {isEditing ? (
                            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                              <label>
                                <span className="mb-1 block text-[11px] font-bold text-field-subtle">씬 번호</span>
                                <input
                                  value={scene.sceneNo}
                                  onChange={(event) => updateScene(scene.id, { sceneNo: event.target.value })}
                                  className="min-h-9 w-full border border-field-border bg-field-input px-2.5 py-1.5 text-sm text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-primary/30"
                                />
                              </label>
                              <label>
                                <span className="mb-1 block text-[11px] font-bold text-field-subtle">씬 제목</span>
                                <input
                                  value={scene.title}
                                  onChange={(event) => updateScene(scene.id, { title: event.target.value })}
                                  className="min-h-9 w-full border border-field-border bg-field-input px-2.5 py-1.5 text-sm text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-primary/30"
                                />
                              </label>
                            </div>
                          ) : null}
                          <ScenarioPdfSceneSegments
                            pdfUrl={selectedAsset.publicUrl}
                            filename={selectedAsset.filename}
                            segments={scene.imageSegments}
                            pageStart={scene.pageStart}
                            pageEnd={scene.pageEnd}
                          />
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}

              {filteredScenes.length === 0 ? (
                <p className="py-12 text-center text-sm text-field-muted">
                  검색어와 일치하는 씬이 없습니다.
                </p>
              ) : null}

              {isEditing ? (
                <button
                  type="button"
                  onClick={addScene}
                  className="inline-flex min-h-10 items-center justify-center gap-1 border border-dashed border-field-divider bg-field-panel px-3 text-xs font-bold text-field-subtle transition-colors hover:bg-field-hover hover:text-field-text"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  씬 추가
                </button>
              ) : null}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  children
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof List;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-8 items-center gap-1 px-2.5 text-[11px] font-bold transition ${
        active
          ? "border border-field-primary bg-field-primary/15 text-field-text"
          : "border border-transparent text-field-muted hover:bg-field-hover hover:text-field-text"
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </button>
  );
}

function SmallIconButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  danger = false
}: {
  label: string;
  icon: typeof ArrowUp;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 place-items-center transition active:scale-95 disabled:opacity-25 ${
        danger ? "text-field-danger hover:bg-field-danger/10" : "text-field-muted hover:bg-field-hover hover:text-field-text"
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function FullPdfView({ asset, canEdit }: { asset: ProjectReferenceAsset | null; canEdit: boolean }) {
  return (
    <section
      aria-label="시나리오 PDF 읽기"
      className="h-[calc(100dvh-11.5rem)] min-h-[28rem] min-w-0 overflow-hidden bg-field-panel sm:h-[calc(100dvh-10rem)]"
    >
      {asset ? (
        <iframe
          key={asset.id}
          src={asset.publicUrl}
          title={`${asset.filename} PDF`}
          className="block h-full w-full border-0 bg-white"
        />
      ) : (
        <EmptyState canEdit={canEdit} hasAsset={false} />
      )}
    </section>
  );
}

function EmptyState({
  canEdit,
  hasAsset,
  onAdd
}: {
  canEdit: boolean;
  hasAsset: boolean;
  onAdd?: () => void;
}) {
  return (
    <div className="grid min-h-[18rem] place-items-center px-4 text-center text-sm text-field-muted">
      <div>
        <p>{hasAsset ? "저장된 씬이 없습니다." : canEdit ? "PDF를 업로드해 씬별로 읽을 수 있습니다." : "등록된 시나리오 PDF가 없습니다."}</p>
        {canEdit && onAdd ? (
          <button type="button" onClick={onAdd} className="mt-3 border border-field-primary bg-field-primary px-3 py-2 text-xs font-bold text-field-accent-foreground transition hover:border-field-secondary hover:bg-field-secondary">
            수동 씬 추가
          </button>
        ) : null}
      </div>
    </div>
  );
}

function createBlankScene(index: number): ProjectScenarioScene {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `scene-${Date.now()}-${index}`,
    sceneNo: String(index),
    title: `Scene ${index}`,
    pageStart: null,
    pageEnd: null,
    text: "",
    imageSegments: []
  };
}

function formatPageRange(scene: ProjectScenarioScene) {
  if (!scene.pageStart) return "";
  return scene.pageEnd && scene.pageEnd !== scene.pageStart
    ? `${scene.pageStart}–${scene.pageEnd}`
    : String(scene.pageStart);
}

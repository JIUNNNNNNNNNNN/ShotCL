"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useParams } from "next/navigation";
import { PageLoader, SectionLoader } from "@/components/PixelDogLoader";
import { AutosaveStatus } from "@/components/AutosaveStatus";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import {
  useAutoContextualGuide,
  useContextualGuideBlocker
} from "@/components/guides/ContextualGuideProvider";
import {
  useProjectPageActionMenu,
  type ProjectPageActionMenuRegistration
} from "@/components/ProjectPageActions";
import {
  ScenarioUploadProgress,
  type ScenarioUploadProgressState,
  type ScenarioUploadStage
} from "@/components/ScenarioUploadProgress";
import { MotionPresence } from "@/components/ui/MotionPresence";
import {
  deleteProjectReferenceAsset,
  listProjectReferenceAssets,
  updateProjectReferenceAsset,
  updateProjectScenarioScenes,
  uploadProjectReferenceAsset
} from "@/lib/data/projectReferenceAssets";
import { AutosaveConflictError } from "@/lib/data/autosaveConflict";
import { getProject } from "@/lib/data/projects";
import { auditQuery } from "@/lib/queryAudit";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useAutosave } from "@/hooks/useAutosave";
import { SCENARIO_MARKER_NOT_FOUND_MESSAGE } from "@/lib/scenarioSceneMarker";
import type { ProjectReferenceAsset, ProjectScenarioScene } from "@/lib/types";

type ViewMode = "scenes" | "pdf";

type ScenarioConfirmation =
  | { kind: "asset-delete"; asset: ProjectReferenceAsset }
  | { kind: "scene-delete"; sceneId: string; title: string };

const MAX_SCENARIO_PDF_BYTES = 50 * 1024 * 1024;

const ScenarioPdfSceneSegments = dynamic(
  () => import("@/components/ScenarioPdfSceneSegments").then((module) => module.ScenarioPdfSceneSegments),
  { ssr: false, loading: () => <SectionLoader /> }
);

export default function ProjectScenarioPage() {
  const params = useParams<{ id: string | string[] }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedAssetIdRef = useRef("");
  const uploadInFlightRef = useRef(false);
  const uploadSuccessTimerRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const [projectName, setProjectName] = useState("");
  const [assets, setAssets] = useState<ProjectReferenceAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("scenes");
  const [query, setQuery] = useState("");
  const [draftScenes, setDraftScenes] = useState<ProjectScenarioScene[]>([]);
  const [expandedSceneIds, setExpandedSceneIds] = useState<Set<string>>(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [hasStructuralChanges, setHasStructuralChanges] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<ScenarioUploadProgressState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<ScenarioConfirmation | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const scenarioUpdatedAtRef = useRef("");
  const actionHandlersRef = useRef({
    viewScenes: () => {},
    viewPdf: () => {},
    edit: () => {},
    share: () => {},
    refresh: () => {},
    delete: () => {}
  });
  // Persisted text is flushed by the autosave queue and must not block route
  // changes. Only create/delete/reorder drafts still require an explicit save.
  useUnsavedChangesGuard(hasStructuralChanges);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedId) ?? null,
    [assets, selectedId]
  );
  const scenarioAutosave = useAutosave<ProjectScenarioScene[], ProjectReferenceAsset>({
    value: draftScenes,
    enabled: canEdit
      && isEditing
      && Boolean(selectedAsset)
      && !hasStructuralChanges
      && !isSaving
      && !isComposing,
    scopeKey: `scenario:${projectId ?? "unknown"}:${selectedAsset?.id ?? "empty"}`,
    delayMs: 750,
    initialSavedFingerprint: JSON.stringify(selectedAsset?.scenarioScenes ?? []),
    restoreDraft: (scenes) => {
      setDraftScenes(scenes.map((scene) => ({ ...scene })));
      setHasChanges(true);
    },
    save: async (scenes) => {
      if (!projectId || !selectedAsset) throw new Error("시나리오 PDF를 찾을 수 없습니다.");
      const saved = await updateProjectScenarioScenes(projectId, selectedAsset.id, {
        scenarioScenes: scenes,
        expectedUpdatedAt: scenarioUpdatedAtRef.current || selectedAsset.updatedAt
      });
      scenarioUpdatedAtRef.current = saved.updatedAt;
      return { ...selectedAsset, ...saved };
    },
    onSaved: (saved, _scenes, meta) => {
      replaceAsset(saved);
      if (meta.isLatest && !hasStructuralChanges) {
        setHasChanges(false);
      }
    },
    onError: (error) => {
      if (error instanceof AutosaveConflictError && error.kind === "scenario-asset") {
        const latestAsset = error.latest as ProjectReferenceAsset | null;
        if (latestAsset?.updatedAt) scenarioUpdatedAtRef.current = latestAsset.updatedAt;
      }
      setErrorMessage(error instanceof Error ? error.message : "씬 정보를 자동 저장하지 못했습니다.");
    }
  });
  const isUploadFeedbackVisible = uploadProgress !== null;
  useAutoContextualGuide("scenario.intro", !isLoading && !isUploadFeedbackVisible);
  useContextualGuideBlocker("scenario-upload-processing", isUploadFeedbackVisible);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (uploadSuccessTimerRef.current !== null) {
        window.clearTimeout(uploadSuccessTimerRef.current);
      }
    };
  }, []);

  const load = useCallback(async ({ withLoader = true }: { withLoader?: boolean } = {}) => {
    if (!projectId) return false;
    if (withLoader && isMountedRef.current) setIsLoading(true);
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
      if (!isMountedRef.current) return false;
      setProjectName(project?.name ?? "프로젝트");
      setAssets(scenarioAssets);
      setSelectedId((current) => scenarioAssets.some((asset) => asset.id === current)
        ? current
        : scenarioAssets[0]?.id ?? "");
      setErrorMessage("");
      return true;
    } catch (error) {
      console.error("[scenario:load]", error);
      if (isMountedRef.current) {
        setErrorMessage("시나리오 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      return false;
    } finally {
      if (withLoader && isMountedRef.current) setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const scenes = selectedAsset?.scenarioScenes ?? [];
    const nextSelectedAssetId = selectedAsset?.id ?? "";
    const selectedAssetChanged = selectedAssetIdRef.current !== nextSelectedAssetId;
    if (!selectedAssetChanged && (isEditing || hasChanges)) {
      // An autosave updates the asset timestamp. Rebase only the CAS token;
      // never rehydrate/close the focused editor from that local echo.
      scenarioUpdatedAtRef.current = selectedAsset?.updatedAt ?? scenarioUpdatedAtRef.current;
      return;
    }
    setDraftScenes(scenes.map((scene) => ({ ...scene })));
    setExpandedSceneIds((current) => {
      if (selectedAssetChanged) return new Set();
      const validIds = new Set(scenes.map((scene) => scene.id));
      return new Set(Array.from(current).filter((id) => validIds.has(id)));
    });
    selectedAssetIdRef.current = nextSelectedAssetId;
    scenarioUpdatedAtRef.current = selectedAsset?.updatedAt ?? "";
    if (selectedAssetChanged) setIsEditing(false);
    setHasChanges(false);
    setHasStructuralChanges(false);
    setQuery("");
    scenarioAutosave.markSaved(scenes);
  }, [hasChanges, isEditing, scenarioAutosave.markSaved, selectedAsset?.id, selectedAsset?.updatedAt]);

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
  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!projectId || files.length === 0 || uploadInFlightRef.current) return;
    const uploadedIds: string[] = [];
    const analysisWarnings: string[] = [];
    let uploadedId = "";
    uploadInFlightRef.current = true;
    if (uploadSuccessTimerRef.current !== null) {
      window.clearTimeout(uploadSuccessTimerRef.current);
      uploadSuccessTimerRef.current = null;
    }
    setIsUploading(true);
    setErrorMessage("");
    setStatusMessage("");
    setUploadProgress(createUploadProgress("validating", files[0], 0, files.length));
    try {
      const validationError = validateScenarioUploadFiles(files);
      if (validationError) throw new ScenarioUploadValidationError(validationError);

      for (let index = 0; index < files.length; index += 1) {
        if (!isMountedRef.current) return;
        const file = files[index];
        if (isMountedRef.current) {
          setUploadProgress(createUploadProgress("uploading", file, index, files.length));
        }
        const assetId = await createScenarioUploadAssetId(projectId, file);
        if (!isMountedRef.current) return;
        const uploadedAsset = await uploadProjectReferenceAsset(
          projectId,
          "scenario",
          file,
          assetId ? { assetId } : {}
        );
        uploadedId = uploadedAsset.id;
        uploadedIds.push(uploadedAsset.id);
        if (!isMountedRef.current) return;
        if (isMountedRef.current) {
          setUploadProgress(createUploadProgress("analyzing", file, index, files.length));
        }

        let imageScenes: ProjectScenarioScene[] = uploadedAsset.scenarioScenes ?? [];
        let analysisWarning = "";
        try {
          const { analyzeScenarioPdfImages } = await import("@/lib/client/scenarioPdfImages");
          imageScenes = await analyzeScenarioPdfImages(uploadedAsset.publicUrl);
        } catch (analysisError) {
          console.error("[scenario:pdf-analysis]", { filename: file.name, error: analysisError });
          analysisWarning = getSafeScenarioAnalysisWarning(analysisError);
          analysisWarnings.push(`${file.name}: ${analysisWarning}`);
        }
        if (!isMountedRef.current) return;
        if (isMountedRef.current) {
          setUploadProgress(createUploadProgress("saving", file, index, files.length));
        }
        await updateProjectReferenceAsset(projectId, uploadedAsset.id, {
          scenarioScenes: imageScenes,
          scenarioParseError: analysisWarning || null
        });
      }
      const finalFile = files[files.length - 1];
      if (!isMountedRef.current) return;
      setUploadProgress(createUploadProgress("refreshing", finalFile, files.length - 1, files.length));
      const reloaded = await load({ withLoader: false });
      if (!isMountedRef.current) return;
      if (reloaded && uploadedId) setSelectedId(uploadedId);
      setViewMode("scenes");
      const completionMessage = !reloaded
        ? "PDF 처리는 완료되었지만 목록을 새로고침하지 못했습니다."
        : analysisWarnings.length > 0
          ? "PDF 업로드는 완료되었습니다. 씬 구성을 확인해주세요."
          : "PDF 업로드와 씬 이미지 분석이 완료되었습니다.";
      setStatusMessage(completionMessage);
      if (!reloaded) {
        setErrorMessage("업로드한 시나리오 목록을 다시 불러오지 못했습니다. 새로고침 후 확인해 주세요.");
      } else if (analysisWarnings.length > 0) {
        setErrorMessage(analysisWarnings.join(" · "));
      }
      setUploadProgress({
        ...createUploadProgress(
          reloaded && analysisWarnings.length === 0 ? "success" : "warning",
          finalFile,
          files.length - 1,
          files.length
        ),
        detail: !reloaded
          ? "업로드는 끝났지만 목록을 다시 불러오지 못했습니다."
          : analysisWarnings.length > 0
            ? "업로드는 끝났지만 씬 구성을 확인해야 합니다."
            : undefined
      });
      uploadSuccessTimerRef.current = window.setTimeout(() => {
        if (isMountedRef.current) setUploadProgress(null);
        uploadSuccessTimerRef.current = null;
      }, 450);
    } catch (error) {
      console.error("[scenario:upload-processing]", error);
      if (uploadedIds.length > 0 && isMountedRef.current) {
        const lastUploadedFile = files[Math.min(uploadedIds.length - 1, files.length - 1)];
        setUploadProgress(createUploadProgress(
          "refreshing",
          lastUploadedFile,
          uploadedIds.length - 1,
          files.length
        ));
        await load({ withLoader: false });
      }
      if (isMountedRef.current) {
        setUploadProgress(null);
        setStatusMessage(uploadedIds.length > 0
          ? `${uploadedIds.length}개 PDF는 업로드되었지만 나머지 처리를 완료하지 못했습니다.`
          : "");
        setErrorMessage(getSafeScenarioUploadError(error));
      }
    } finally {
      uploadInFlightRef.current = false;
      if (isMountedRef.current) setIsUploading(false);
    }
  }

  async function deleteAsset(asset: ProjectReferenceAsset) {
    if (!projectId) return;
    setIsDeleting(true);
    setConfirmationError("");
    try {
      await deleteProjectReferenceAsset(projectId, asset.id);
      const remainingAssets = assets.filter((item) => item.id !== asset.id);
      setAssets(remainingAssets);
      setSelectedId((current) => current === asset.id ? remainingAssets[0]?.id ?? "" : current);
      setPendingConfirmation(null);
      const reloaded = await load({ withLoader: false });
      setStatusMessage(reloaded
        ? "시나리오 PDF를 삭제했습니다."
        : "시나리오 PDF는 삭제했지만 목록을 새로고침하지 못했습니다.");
    } catch (error) {
      setConfirmationError(error instanceof Error ? error.message : "PDF를 삭제하지 못했습니다.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleSaveScenes() {
    if (!projectId || !selectedAsset || !canEdit) return;
    setIsSaving(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      if (!await scenarioAutosave.flush()) {
        setErrorMessage("자동 저장에 실패한 입력값을 먼저 확인해주세요.");
        return;
      }
      const savedPatch = await updateProjectScenarioScenes(projectId, selectedAsset.id, {
        scenarioScenes: draftScenes,
        expectedUpdatedAt: scenarioUpdatedAtRef.current || selectedAsset.updatedAt
      });
      const saved = { ...selectedAsset, ...savedPatch };
      scenarioUpdatedAtRef.current = saved.updatedAt;
      replaceAsset(saved);
      setIsEditing(false);
      setHasChanges(false);
      setHasStructuralChanges(false);
      scenarioAutosave.markSaved(saved.scenarioScenes ?? []);
      setStatusMessage("씬 구성이 저장되었습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "씬 구성을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRefresh() {
    if (!projectId || isRefreshing) return;
    setIsRefreshing(true);
    setErrorMessage("");
    setStatusMessage("");
    const refreshed = await load({ withLoader: false });
    if (refreshed) setStatusMessage("시나리오 자료를 새로고침했습니다.");
    setIsRefreshing(false);
  }

  async function handleShare() {
    if (!projectId || !selectedAsset || isSharing) return;
    setIsSharing(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const scenarioUrl = new URL(
        `/projects/${encodeURIComponent(projectId)}/scenario`,
        window.location.origin
      ).toString();
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: `${projectName} 시나리오`,
          text: `${projectName} 시나리오`,
          url: scenarioUrl
        });
        setStatusMessage("시나리오 페이지 공유를 완료했습니다.");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(scenarioUrl);
        setStatusMessage("시나리오 페이지 링크를 복사했습니다.");
      } else {
        throw new Error("이 브라우저에서는 공유 링크 복사를 지원하지 않습니다.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setErrorMessage(error instanceof Error ? error.message : "시나리오 페이지를 공유하지 못했습니다.");
    } finally {
      setIsSharing(false);
    }
  }

  function handleDownload() {
    if (!selectedAsset || isDownloading) return;
    setIsDownloading(true);
    setErrorMessage("");
    setStatusMessage("");
    const anchor = document.createElement("a");
    anchor.href = selectedAsset.publicUrl;
    anchor.download = selectedAsset.filename;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setStatusMessage("다운로드를 시작했습니다.");
    window.setTimeout(() => setIsDownloading(false), 500);
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
    setHasStructuralChanges(true);
  }

  function requestRemoveScene(id: string) {
    const target = draftScenes.find((scene) => scene.id === id);
    if (!target) return;
    setConfirmationError("");
    setPendingConfirmation({ kind: "scene-delete", sceneId: id, title: target.title });
  }

  function removeScene(id: string) {
    setDraftScenes((current) => current.filter((scene) => scene.id !== id));
    setExpandedSceneIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setHasChanges(true);
    setHasStructuralChanges(true);
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
    setHasStructuralChanges(true);
  }

  function cancelEditing() {
    const scenes = selectedAsset?.scenarioScenes ?? [];
    setDraftScenes(scenes.map((scene) => ({ ...scene })));
    const validIds = new Set(scenes.map((scene) => scene.id));
    setExpandedSceneIds((current) => new Set(Array.from(current).filter((id) => validIds.has(id))));
    setIsEditing(false);
    setHasChanges(false);
    setHasStructuralChanges(false);
    setErrorMessage("");
    scenarioAutosave.markSaved(scenes);
  }

  function toggleScene(sceneId: string) {
    setExpandedSceneIds((current) => {
      const next = new Set(current);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  }

  async function confirmPendingAction() {
    const pending = pendingConfirmation;
    if (!pending) return;
    if (pending.kind === "asset-delete") {
      await deleteAsset(pending.asset);
      return;
    }
    if (pending.kind === "scene-delete") {
      removeScene(pending.sceneId);
      setPendingConfirmation(null);
      return;
    }
  }

  actionHandlersRef.current = {
    viewScenes: () => setViewMode("scenes"),
    viewPdf: () => setViewMode("pdf"),
    edit: () => {
      setViewMode("scenes");
      setIsEditing(true);
    },
    share: () => void handleShare(),
    refresh: () => void handleRefresh(),
    delete: () => {
      if (!selectedAsset) return;
      setConfirmationError("");
      setPendingConfirmation({ kind: "asset-delete", asset: selectedAsset });
    }
  };

  const scenarioActionMenu = useMemo<ProjectPageActionMenuRegistration>(() => ({
    key: "scenario",
    scopeKey: `scenario:${projectId ?? "unknown"}:${selectedAsset?.id ?? "empty"}`,
    actions: {
      scenarioScenesView: {
        active: viewMode === "scenes",
        onSelect: () => actionHandlersRef.current.viewScenes(),
        disabled: !selectedAsset
      },
      scenarioFullView: {
        active: viewMode === "pdf",
        onSelect: () => actionHandlersRef.current.viewPdf(),
        disabled: !selectedAsset
      },
      scenarioEdit: {
        active: isEditing,
        onSelect: () => actionHandlersRef.current.edit(),
        hidden: !canEdit,
        disabled: !selectedAsset || isSaving || isDeleting || isUploading || isRefreshing
      },
      scenarioShare: {
        onSelect: () => actionHandlersRef.current.share(),
        disabled: !selectedAsset || isSharing || isDeleting,
        pending: isSharing
      },
      scenarioDownload: {
        onSelect: handleDownload,
        disabled: !selectedAsset || isDownloading || isDeleting,
        pending: isDownloading,
        closeDrawerOnSelect: false
      },
      scenarioRefresh: {
        onSelect: () => actionHandlersRef.current.refresh(),
        disabled: hasStructuralChanges || isRefreshing || isSaving || isDeleting || isUploading,
        pending: isRefreshing,
        closeDrawerOnSelect: false
      },
      scenarioDelete: {
        onSelect: () => actionHandlersRef.current.delete(),
        hidden: !canEdit,
        disabled: !selectedAsset || isDeleting || isSaving || isUploading || isRefreshing,
        pending: isDeleting
      }
    }
  }), [
    canEdit,
    isDeleting,
    isDownloading,
    isEditing,
    isRefreshing,
    isSaving,
    isSharing,
    isUploading,
    hasStructuralChanges,
    projectId,
    selectedAsset,
    viewMode
  ]);
  useProjectPageActionMenu(scenarioActionMenu);

  if (isLoading) return <PageLoader />;

  return (
    <div
      className="grid w-full min-w-0 gap-2"
      onCompositionStartCapture={() => setIsComposing(true)}
      onCompositionEndCapture={() => setIsComposing(false)}
      onBlurCapture={() => {
        if (!isComposing) void scenarioAutosave.flush();
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-field-border pb-2">
        <div className="mr-1 min-w-0 flex-[0_1_14rem]">
          <h1 className="ui-density-heading font-display font-bold leading-normal text-field-text">
            시나리오
          </h1>
          <p className="break-words text-[11px] leading-normal text-field-muted [overflow-wrap:anywhere]">
            {projectName}
          </p>
          <AutosaveStatus status={scenarioAutosave.status} onRetry={scenarioAutosave.retry} />
        </div>

        {assets.length > 0 ? (
          <label className="min-w-[9.5rem] flex-1 sm:max-w-sm">
            <span className="sr-only">시나리오 PDF 선택</span>
            <select
              value={selectedId}
              disabled={hasStructuralChanges || isSaving || isUploading || isRefreshing || isDeleting}
              title={hasStructuralChanges ? "씬 추가·삭제·순서 변경을 저장하거나 취소한 뒤 다른 PDF를 선택하세요." : undefined}
              onChange={(event) => {
                void scenarioAutosave.flush();
                setSelectedId(event.target.value);
                setErrorMessage("");
                setStatusMessage("");
              }}
              aria-label="시나리오 PDF 선택"
              className="min-h-9 w-full min-w-0 truncate border border-field-border bg-field-input px-3 text-xs text-field-text outline-none transition focus:border-field-primary focus:ring-2 focus:ring-field-primary/30 disabled:cursor-not-allowed disabled:text-field-disabled"
            >
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.filename}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="min-w-0 flex-1 break-words text-xs text-field-muted [overflow-wrap:anywhere]">
            등록된 PDF가 없습니다.
          </p>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {canEdit ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void scenarioAutosave.flush();
                  fileInputRef.current?.click();
                }}
                disabled={isUploading || isSaving || isDeleting || isRefreshing || hasStructuralChanges}
                aria-label={isUploading ? "시나리오 처리 중" : "PDF 업로드"}
                aria-busy={isUploading}
                title="PDF 업로드"
                className="inline-flex min-h-9 items-center gap-1 border border-field-primary bg-field-primary px-2.5 text-[11px] font-bold text-field-accent-foreground transition hover:border-field-secondary hover:bg-field-secondary active:scale-95 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden />
                <span>{isUploading ? "처리 중" : "+ PDF"}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                disabled={isUploading || isSaving || isDeleting || isRefreshing || hasStructuralChanges}
                className="sr-only"
                onChange={handleUpload}
              />
            </>
          ) : null}
        </div>
      </div>

      <ScenarioUploadProgress progress={uploadProgress} />

      {selectedAsset && viewMode === "scenes" ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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

          {canEdit && isEditing ? (
            <div className="ml-auto flex items-center gap-1">
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
            </div>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="min-w-0 break-words border-l-2 border-field-danger bg-field-danger/10 px-2.5 py-1.5 text-xs font-bold text-field-danger [overflow-wrap:anywhere]">
          {errorMessage}
        </p>
      ) : null}
      {statusMessage ? (
        <p role="status" className="border-l-2 border-field-divider bg-field-soft px-2.5 py-1.5 text-xs font-bold text-field-subtle">
          {statusMessage}
        </p>
      ) : null}
      {hasStructuralChanges ? (
        <p className="text-right text-[11px] font-bold text-field-primary">
          씬 구성 변경사항은 저장 버튼으로 확정해 주세요.
        </p>
      ) : null}

      <div key={viewMode} className="scenario-mode-content min-w-0">
        {viewMode === "pdf" ? (
          <FullPdfView asset={selectedAsset} canEdit={canEdit} />
        ) : (
          <section aria-label="씬별 시나리오 읽기" className="min-w-0">
          {!selectedAsset ? (
            <EmptyState canEdit={canEdit} hasAsset={false} />
          ) : draftScenes.length === 0 ? (
            <div className="grid min-h-[18rem] place-items-center border-y border-field-border px-4 py-8 text-center">
              <div className="max-w-lg">
                <p className="text-sm font-bold text-field-text">
                  {selectedAsset.scenarioParseError
                    || SCENARIO_MARKER_NOT_FOUND_MESSAGE}
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
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
                const expanded = expandedSceneIds.has(scene.id);
                const panelId = `scenario-scene-${scene.id}`;
                return (
                  <article
                    key={scene.id}
                    className={`ui-motion-surface min-w-0 overflow-hidden rounded-[var(--radius-card)] border bg-field-panel ${expanded ? "border-field-border border-l-2 border-l-field-primary" : "border-field-border"}`}
                  >
                    <div className="flex min-w-0 items-center gap-1.5 px-2.5 py-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        onClick={() => toggleScene(scene.id)}
                        className="flex min-h-8 min-w-0 flex-1 items-center justify-center gap-2 text-center"
                      >
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-field-muted transition-transform ${expanded ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                        <span className="shrink-0 rounded-md border border-field-border bg-field-soft px-2 py-0.5 text-xs font-semibold text-field-subtle">
                          S#{scene.sceneNo || index + 1}
                        </span>
                        <span className="min-w-0 flex-1 break-words text-center text-sm font-bold leading-normal text-field-text [overflow-wrap:anywhere]">
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
                            onClick={() => requestRemoveScene(scene.id)}
                            icon={Trash2}
                          />
                        </div>
                      ) : null}
                    </div>

                    <MotionPresence show={expanded} id={panelId} className="border-t border-field-border">
                      <div className="px-3 py-3 sm:px-4">
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
                    </MotionPresence>
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

      {pendingConfirmation ? (
        <ScenarioConfirmationDialog
          pending={pendingConfirmation}
          error={confirmationError}
          busy={isDeleting}
          onCancel={() => {
            if (isDeleting) return;
            setConfirmationError("");
            setPendingConfirmation(null);
          }}
          onConfirm={() => void confirmPendingAction()}
        />
      ) : null}
    </div>
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

function ScenarioConfirmationDialog({
  pending,
  error,
  busy,
  onCancel,
  onConfirm
}: {
  pending: ScenarioConfirmation;
  error: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelHandlerRef = useRef(onCancel);
  const busyRef = useRef(busy);
  cancelHandlerRef.current = onCancel;
  busyRef.current = busy;
  const title = pending.kind === "asset-delete"
    ? "시나리오 PDF 삭제"
    : "씬 삭제";
  const description = pending.kind === "asset-delete"
    ? `“${pending.asset.filename}” 파일을 삭제합니다. 삭제한 파일은 복구할 수 없습니다.`
    : `“${pending.title}” 씬을 편집 목록에서 삭제합니다. 저장하기 전까지 서버 데이터에는 반영되지 않습니다.`;
  const confirmLabel = busy ? "삭제 중" : "삭제";

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    const shellChildren = Array.from(
      document.querySelectorAll<HTMLElement>("[data-project-shell] > *")
    );
    const previousInert = shellChildren.map((element) => element.inert);
    shellChildren.forEach((element) => {
      element.inert = true;
    });
    document.body.style.overflow = "hidden";
    let nestedFocusFrame = 0;
    const focusFrame = window.requestAnimationFrame(() => {
      nestedFocusFrame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    });

    function handleKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        if (busyRef.current) return;
        event.preventDefault();
        cancelHandlerRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.cancelAnimationFrame(nestedFocusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      shellChildren.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      window.requestAnimationFrame(() => {
        if (isVisibleFocusTarget(previousActiveElement)) {
          previousActiveElement.focus();
          if (document.activeElement === previousActiveElement) return;
        }
        const actionId = pending.kind === "asset-delete"
          ? "scenarioDelete"
          : "scenarioEdit";
        const targets = Array.from(document.querySelectorAll<HTMLElement>(
          `[data-project-action-id="${actionId}"]`
        ));
        const visibleAction = targets.find(isVisibleFocusTarget);
        if (visibleAction) {
          visibleAction.focus();
          if (document.activeElement === visibleAction) return;
        }
        document.querySelector<HTMLElement>(
          'button[aria-label="페이지 작업 열기"], button[aria-label="페이지 작업 닫기"]'
        )?.focus();
        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) return;
        const fallbackTargets = Array.from(document.querySelectorAll<HTMLElement>(
          '.project-shell__action-panel [data-project-action-id], #project-main-content button, #project-main-content a[href], #project-main-content input, #project-main-content select'
        ));
        fallbackTargets.find(isVisibleFocusTarget)?.focus();
      });
    };
  }, [pending.kind]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      data-project-shell-portal
      role="presentation"
      className="fixed inset-0 z-[120] grid place-items-center bg-black/70 p-4"
      onPointerDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="scenario-confirmation-title"
        aria-describedby="scenario-confirmation-description"
        aria-busy={busy}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-[var(--radius-dialog)] border border-field-divider bg-field-elevated p-4 shadow-dialog"
      >
        <h2 id="scenario-confirmation-title" className="text-base font-black text-field-text">
          {title}
        </h2>
        <p id="scenario-confirmation-description" className="mt-2 text-sm leading-6 text-field-muted">
          {description}
        </p>
        {error ? (
          <p role="alert" className="mt-3 border border-field-danger bg-field-danger/10 px-3 py-2 text-sm font-bold text-field-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-11 rounded-[var(--radius-control)] border border-field-divider bg-field-panel px-3 py-2 text-sm font-bold text-field-text transition hover:bg-field-hover disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="min-h-11 rounded-[var(--radius-control)] border border-field-danger bg-field-danger px-3 py-2 text-sm font-black text-white transition hover:brightness-95 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function isVisibleFocusTarget(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.getClientRects().length === 0) return false;
  if (element.matches(":disabled, [aria-disabled=\"true\"]")) return false;
  if (element.closest("[inert], [aria-hidden=\"true\"]")) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
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

function createUploadProgress(
  stage: ScenarioUploadStage,
  file: File,
  fileIndex: number,
  totalFiles: number
): ScenarioUploadProgressState {
  return {
    stage,
    filename: file.name,
    currentFile: fileIndex + 1,
    totalFiles
  };
}

function validateScenarioUploadFiles(files: File[]) {
  for (const file of files) {
    const filename = file.name.toLocaleLowerCase("ko-KR");
    const isPdf = file.type === "application/pdf" || filename.endsWith(".pdf");
    if (!isPdf) return `${file.name}: PDF 파일만 업로드할 수 있습니다.`;
    if (file.size === 0) return `${file.name}: 비어 있는 PDF는 업로드할 수 없습니다.`;
    if (file.size > MAX_SCENARIO_PDF_BYTES) {
      return `${file.name}: PDF 파일은 50MB 이하만 업로드할 수 있습니다.`;
    }
  }
  return "";
}

class ScenarioUploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioUploadValidationError";
  }
}

function getSafeScenarioAnalysisWarning(error: unknown) {
  if (error instanceof Error && error.message === SCENARIO_MARKER_NOT_FOUND_MESSAGE) {
    return SCENARIO_MARKER_NOT_FOUND_MESSAGE;
  }
  return "씬 분석을 완료하지 못했습니다. 파일을 확인한 뒤 다시 시도해 주세요.";
}

function getSafeScenarioUploadError(error: unknown) {
  if (error instanceof ScenarioUploadValidationError) return error.message;
  const message = error instanceof Error ? error.message : "";
  if (/권한|key staff/i.test(message)) {
    return "시나리오를 업로드할 권한이 없습니다.";
  }
  return "시나리오를 처리하지 못했습니다. 파일을 확인한 뒤 다시 시도해 주세요.";
}

async function createScenarioUploadAssetId(projectId: string, file: File) {
  if (typeof crypto === "undefined" || !crypto.subtle) return "";
  const fingerprint = [
    "scenario",
    projectId,
    file.name.normalize("NFC"),
    file.size,
    file.lastModified,
    file.type
  ].join("\u001f");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
  const bytes = new Uint8Array(digest.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { PageLoader, SectionLoader } from "@/components/PixelDogLoader";
import { AutosaveStatus } from "@/components/AutosaveStatus";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { useProjectDeleteUndo } from "@/components/ProjectDeleteUndoProvider";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import {
  useAutoContextualGuide,
  useContextualGuideBlocker
} from "@/components/guides/ContextualGuideProvider";
import type { ProjectPageActionMenuRegistration } from "@/components/ProjectPageActions";
import { ProjectPageActionsMenu } from "@/components/ProjectPageActionsMenu";
import {
  ScenarioUploadProgress,
  type ScenarioUploadProgressState,
  type ScenarioUploadStage
} from "@/components/ScenarioUploadProgress";
import { MotionPresence } from "@/components/ui/MotionPresence";
import {
  deleteProjectScenarioScene,
  deleteProjectReferenceAsset,
  finalizeDeletedProjectReferenceAssets,
  finalizeDeletedProjectScenarioScene,
  listProjectReferenceAssets,
  restoreDeletedProjectReferenceAssets,
  restoreDeletedProjectScenarioScene,
  updateProjectReferenceAsset,
  updateProjectScenarioScenes,
  uploadProjectReferenceAsset
} from "@/lib/data/projectReferenceAssets";
import { AutosaveConflictError } from "@/lib/data/autosaveConflict";
import type { ProjectScenarioSceneClassificationResult } from "@/lib/data/sceneList";
import { auditQuery } from "@/lib/queryAudit";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useAutosave } from "@/hooks/useAutosave";
import { SCENARIO_MARKER_NOT_FOUND_MESSAGE } from "@/lib/scenarioSceneMarker";
import type { ProjectReferenceAsset, ProjectScenarioScene } from "@/lib/types";

type ViewMode = "scenes" | "pdf";

const MAX_SCENARIO_PDF_BYTES = 50 * 1024 * 1024;

const ScenarioPdfSceneSegments = dynamic(
  () => import("@/components/ScenarioPdfSceneSegments").then((module) => module.ScenarioPdfSceneSegments),
  { ssr: false, loading: () => <SectionLoader /> }
);

export default function ProjectScenarioPage() {
  const { projectId, projectName } = useProjectWorkspace();
  const { role, isGuest, accessMode, editorEligible } = useProjectAccess();
  const { deleteWithUndo } = useProjectDeleteUndo();
  const canEdit = role === "admin" && !isGuest;
  const canClassifySceneList = canEdit && accessMode === "member" && editorEligible;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedAssetIdRef = useRef("");
  const uploadInFlightRef = useRef(false);
  const sceneListClassificationInFlightRef = useRef(false);
  const uploadSuccessTimerRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
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
  const [isClassifyingSceneList, setIsClassifyingSceneList] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const scenarioUpdatedAtRef = useRef("");
  const assetsRef = useRef(assets);
  const draftScenesRef = useRef(draftScenes);
  assetsRef.current = assets;
  draftScenesRef.current = draftScenes;
  const actionHandlersRef = useRef({
    viewScenes: () => {},
    viewPdf: () => {},
    edit: () => {},
    classifySceneList: () => {},
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
      const scenarioAssets = await auditQuery(
        "scenario.loadFilesAndSceneMetadata",
        "app/projects/[id]/scenario/page.tsx:load",
        () => listProjectReferenceAssets(projectId, "scenario")
      );
      if (!isMountedRef.current) return false;
      assetsRef.current = scenarioAssets;
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

        let mergedScenes: ProjectScenarioScene[] = uploadedAsset.scenarioScenes ?? [];
        let analysisWarning = "";
        try {
          const { analyzeScenarioPdfImages } = await import("@/lib/client/scenarioPdfImages");
          const imageScenes = await analyzeScenarioPdfImages(uploadedAsset.publicUrl);
          mergedScenes = mergeScenarioSceneImages(uploadedAsset.scenarioScenes ?? [], imageScenes);
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
          scenarioScenes: mergedScenes,
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

  function deleteAsset(asset: ProjectReferenceAsset) {
    if (!projectId || !canEdit) return;
    const currentAssets = assetsRef.current;
    const originalIndex = currentAssets.findIndex((item) => item.id === asset.id);
    if (originalIndex < 0) return;
    const beforeId = currentAssets[originalIndex - 1]?.id ?? "";
    const afterId = currentAssets[originalIndex + 1]?.id ?? "";
    const wasSelected = selectedAssetIdRef.current === asset.id || selectedId === asset.id;
    let receipt = "";
    deleteWithUndo({
      key: `scenario-asset:${asset.id}`,
      label: asset.filename || "시나리오 PDF",
      removeLocal: () => {
        if (!assetsRef.current.some((item) => item.id === asset.id)) return;
        const nextAssets = assetsRef.current.filter((item) => item.id !== asset.id);
        assetsRef.current = nextAssets;
        setAssets(nextAssets);
        setSelectedId((current) => current === asset.id ? nextAssets[0]?.id ?? "" : current);
        setErrorMessage("");
        setStatusMessage("시나리오 PDF를 삭제했습니다. Command/Ctrl+Z로 되돌릴 수 있습니다.");
      },
      restoreLocal: () => {
        if (assetsRef.current.some((item) => item.id === asset.id)) return;
        const nextAssets = insertScenarioAssetByAnchors(
          assetsRef.current,
          asset,
          beforeId,
          afterId,
          originalIndex
        );
        assetsRef.current = nextAssets;
        setAssets(nextAssets);
        if (wasSelected) setSelectedId(asset.id);
        setStatusMessage("시나리오 PDF 삭제를 되돌렸습니다.");
      },
      deleteRemote: async () => {
        const result = await deleteProjectReferenceAsset(projectId, asset.id);
        receipt = result.receipt;
        if (result.storageCleanupWarning) setErrorMessage(result.storageCleanupWarning);
      },
      restoreRemote: async () => {
        const restored = await restoreDeletedProjectReferenceAssets(projectId, receipt);
        const canonicalAsset = restored.assets.find((item) => item.id === asset.id);
        if (canonicalAsset) replaceAsset(canonicalAsset);
        if (restored.orderNormalizationWarning) setErrorMessage(restored.orderNormalizationWarning);
      },
      finalize: async () => {
        await finalizeDeletedProjectReferenceAssets(projectId, receipt);
      }
    });
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

  async function handleClassifySceneList() {
    if (
      !projectId
      || !selectedAsset
      || !canClassifySceneList
      || selectedAsset.scenarioScenes.length === 0
      || hasStructuralChanges
      || sceneListClassificationInFlightRef.current
    ) return;

    sceneListClassificationInFlightRef.current = true;
    setIsClassifyingSceneList(true);
    setErrorMessage("");
    setStatusMessage("씬리스트를 분류하고 있습니다…");
    try {
      if (isEditing && !await scenarioAutosave.flush()) {
        setStatusMessage("");
        setErrorMessage("자동 저장에 실패한 씬 입력값을 먼저 확인해주세요.");
        return;
      }
      const { classifyProjectScenarioScenes } = await import("@/lib/data/sceneList");
      const result = await classifyProjectScenarioScenes(projectId, selectedAsset.id);
      if (!isMountedRef.current) return;
      setStatusMessage(formatScenarioClassificationResult(result));
    } catch (error) {
      if (!isMountedRef.current) return;
      setStatusMessage("");
      setErrorMessage(error instanceof Error
        ? error.message
        : "씬리스트 자동 분류를 완료하지 못했습니다.");
    } finally {
      sceneListClassificationInFlightRef.current = false;
      if (isMountedRef.current) setIsClassifyingSceneList(false);
    }
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
    const nextAssets = assetsRef.current.map((item) => item.id === asset.id ? asset : item);
    assetsRef.current = nextAssets;
    setAssets(nextAssets);
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
    if (!projectId || !selectedAsset || !canEdit) return;
    const currentScenes = draftScenesRef.current;
    const index = currentScenes.findIndex((scene) => scene.id === id);
    const target = currentScenes[index];
    if (!target) return;
    const beforeId = index > 0 ? currentScenes[index - 1].id : "";
    const afterId = index + 1 < currentScenes.length ? currentScenes[index + 1].id : "";
    const assetId = selectedAsset.id;
    const wasPersisted = selectedAsset.scenarioScenes.some((scene) => scene.id === id);
    const wasExpanded = expandedSceneIds.has(id);
    const hadChanges = hasChanges;
    const hadStructuralChanges = hasStructuralChanges;
    let deleteFailed = false;
    let receipt = "";
    deleteWithUndo({
      key: `scenario-scene:${assetId}:${id}`,
      label: target.title.trim() || `씬 ${target.sceneNo || index + 1}`,
      removeLocal: () => {
        if (!draftScenesRef.current.some((scene) => scene.id === id)) return;
        const nextScenes = draftScenesRef.current.filter((scene) => scene.id !== id);
        draftScenesRef.current = nextScenes;
        setDraftScenes(nextScenes);
        setExpandedSceneIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setHasChanges(true);
        // Pause the whole-array autosave before the deleted draft can be
        // scheduled. The server mutation below targets only this stable ID.
        setHasStructuralChanges(true);
      },
      restoreLocal: () => {
        if (draftScenesRef.current.some((scene) => scene.id === id)) return;
        const nextScenes = insertScenarioSceneByAnchors(
          draftScenesRef.current,
          target,
          beforeId,
          afterId,
          index
        );
        draftScenesRef.current = nextScenes;
        setDraftScenes(nextScenes);
        if (wasExpanded) setExpandedSceneIds((current) => new Set([...current, id]));
        setHasChanges(deleteFailed ? hadChanges : true);
        setHasStructuralChanges(deleteFailed ? hadStructuralChanges : true);
      },
      deleteRemote: async () => {
        try {
          if (!await scenarioAutosave.flush()) {
            throw new Error("삭제할 시나리오 씬의 자동 저장에 실패했습니다.");
          }
          if (wasPersisted) {
            const result = await deleteProjectScenarioScene(
              projectId,
              assetId,
              id,
              scenarioUpdatedAtRef.current || selectedAsset.updatedAt
            );
            receipt = result.receipt;
            scenarioUpdatedAtRef.current = result.asset.updatedAt;
            replaceAsset({ ...selectedAsset, ...result.asset });
            if (!hadStructuralChanges) {
              scenarioAutosave.markSaved(result.asset.scenarioScenes ?? []);
            }
          } else if (!hadStructuralChanges) {
            scenarioAutosave.markSaved(draftScenesRef.current);
          }
          if (!hadStructuralChanges) {
            setHasChanges(false);
          } else {
            setHasChanges(true);
          }
          setHasStructuralChanges(hadStructuralChanges);
        } catch (error) {
          deleteFailed = true;
          setHasChanges(hadChanges);
          setHasStructuralChanges(hadStructuralChanges);
          throw error;
        }
      },
      restoreRemote: async () => {
        if (wasPersisted) {
          const restored = await restoreDeletedProjectScenarioScene(projectId, receipt);
          scenarioUpdatedAtRef.current = restored.updatedAt;
          replaceAsset({ ...selectedAsset, ...restored });
          if (!hadStructuralChanges) {
            scenarioAutosave.markSaved(restored.scenarioScenes ?? []);
          }
        } else if (!hadStructuralChanges) {
          scenarioAutosave.markSaved(draftScenesRef.current);
        }
        if (!hadStructuralChanges) {
          setHasChanges(false);
        } else {
          setHasChanges(true);
        }
        setHasStructuralChanges(hadStructuralChanges);
      },
      finalize: wasPersisted
        ? () => finalizeDeletedProjectScenarioScene(projectId, receipt)
        : undefined
    });
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

  actionHandlersRef.current = {
    viewScenes: () => setViewMode("scenes"),
    viewPdf: () => setViewMode("pdf"),
    edit: () => {
      setViewMode("scenes");
      setIsEditing(true);
    },
    classifySceneList: () => void handleClassifySceneList(),
    share: () => void handleShare(),
    refresh: () => void handleRefresh(),
    delete: () => {
      if (!selectedAsset) return;
      deleteAsset(selectedAsset);
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
        disabled: !selectedAsset || isSaving || isUploading || isRefreshing
      },
      scenarioClassifySceneList: {
        onSelect: () => actionHandlersRef.current.classifySceneList(),
        hidden: !canClassifySceneList,
        disabled: !selectedAsset
          || selectedAsset.scenarioScenes.length === 0
          || hasStructuralChanges
          || isSaving
          || isUploading
          || isRefreshing
          || isClassifyingSceneList,
        pending: isClassifyingSceneList
      },
      scenarioShare: {
        onSelect: () => actionHandlersRef.current.share(),
        hidden: isGuest,
        disabled: !selectedAsset || isSharing,
        pending: isSharing
      },
      scenarioDownload: {
        onSelect: handleDownload,
        hidden: isGuest,
        disabled: !selectedAsset || isDownloading,
        pending: isDownloading
      },
      scenarioRefresh: {
        onSelect: () => actionHandlersRef.current.refresh(),
        hidden: isGuest,
        disabled: hasStructuralChanges || isRefreshing || isSaving || isUploading,
        pending: isRefreshing
      },
      scenarioDelete: {
        onSelect: () => actionHandlersRef.current.delete(),
        hidden: !canEdit,
        disabled: !selectedAsset || isSaving || isUploading || isRefreshing
      }
    }
  }), [
    canClassifySceneList,
    canEdit,
    isDownloading,
    isEditing,
    isClassifyingSceneList,
    isRefreshing,
    isSaving,
    isSharing,
    isUploading,
    hasStructuralChanges,
    isGuest,
    projectId,
    selectedAsset,
    viewMode
  ]);
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
              disabled={hasStructuralChanges || isSaving || isUploading || isRefreshing}
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
                disabled={isUploading || isSaving || isRefreshing || hasStructuralChanges}
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
                disabled={isUploading || isSaving || isRefreshing || hasStructuralChanges}
                className="sr-only"
                onChange={handleUpload}
              />
            </>
          ) : null}
          <ProjectPageActionsMenu registration={isGuest ? null : scenarioActionMenu} />
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

/**
 * 좌표 기반 브라우저 분석의 기존 split/문서 순서를 유지하면서, 같은 번호의
 * 서버 scene이 있으면 stable id/title/text만 보존합니다. 브라우저 분석이 비면
 * 서버 결과를 fallback으로 사용합니다.
 */
function mergeScenarioSceneImages(
  canonicalScenes: ProjectScenarioScene[],
  imageScenes: ProjectScenarioScene[]
): ProjectScenarioScene[] {
  if (imageScenes.length === 0) return canonicalScenes.map(cloneScenarioScene);
  if (canonicalScenes.length === 0) return imageScenes.map(cloneScenarioScene);

  const canonicalScenesByNumber = new Map<string, ProjectScenarioScene[]>();
  canonicalScenes.forEach((scene) => {
    const sceneNo = scene.sceneNo.trim();
    const matches = canonicalScenesByNumber.get(sceneNo) ?? [];
    matches.push(scene);
    canonicalScenesByNumber.set(sceneNo, matches);
  });
  return imageScenes.map((imageScene) => {
    const matches = canonicalScenesByNumber.get(imageScene.sceneNo.trim());
    const canonicalScene = matches?.shift();
    if (!canonicalScene) return cloneScenarioScene(imageScene);
    return {
      ...imageScene,
      ...canonicalScene,
      pageStart: imageScene.pageStart ?? canonicalScene.pageStart,
      pageEnd: imageScene.pageEnd ?? canonicalScene.pageEnd,
      imageSegments: imageScene.imageSegments.length > 0
        ? imageScene.imageSegments.map((segment) => ({ ...segment }))
        : canonicalScene.imageSegments.map((segment) => ({ ...segment }))
    };
  });
}

function cloneScenarioScene(scene: ProjectScenarioScene): ProjectScenarioScene {
  return {
    ...scene,
    imageSegments: scene.imageSegments.map((segment) => ({ ...segment }))
  };
}

function formatScenarioClassificationResult(
  result: ProjectScenarioSceneClassificationResult
) {
  const changes = result.createdCount + result.enrichedCount;
  if (
    changes === 0
    && result.actorLinkCount === 0
    && result.conflictCount === 0
    && result.skippedDuplicateCount === 0
  ) {
    return `${result.totalProcessedCount}개 씬을 확인했습니다. 씬리스트가 이미 최신 상태입니다.`;
  }
  const details = [
    result.createdCount > 0 ? `신규 ${result.createdCount}개` : "",
    result.enrichedCount > 0 ? `기존 ${result.enrichedCount}개 보완` : "",
    result.actorLinkCount > 0
      ? `${result.actorLinkedSceneCount}개 씬에 등장인물 ${result.actorLinkCount}건 연결`
      : "",
    result.conflictCount > 0 ? `동시 수정 ${result.conflictCount}개 보존` : "",
    result.skippedDuplicateCount > 0
      ? `중복 씬 번호 ${result.skippedDuplicateCount}개 제외`
      : ""
  ].filter(Boolean);
  return `${result.totalProcessedCount}개 씬을 확인했습니다. ${details.join(" · ")}`;
}

function insertScenarioSceneByAnchors(
  scenes: ProjectScenarioScene[],
  scene: ProjectScenarioScene,
  beforeId: string,
  afterId: string,
  fallbackIndex: number
) {
  if (scenes.some((candidate) => candidate.id === scene.id)) return scenes;
  const beforeIndex = beforeId ? scenes.findIndex((candidate) => candidate.id === beforeId) : -1;
  const afterIndex = afterId ? scenes.findIndex((candidate) => candidate.id === afterId) : -1;
  const insertionIndex = beforeIndex >= 0
    ? beforeIndex + 1
    : afterIndex >= 0
      ? afterIndex
      : Math.max(0, Math.min(fallbackIndex, scenes.length));
  const next = [...scenes];
  next.splice(insertionIndex, 0, scene);
  return next;
}

function insertScenarioAssetByAnchors(
  assets: ProjectReferenceAsset[],
  asset: ProjectReferenceAsset,
  beforeId: string,
  afterId: string,
  fallbackIndex: number
) {
  if (assets.some((candidate) => candidate.id === asset.id)) return assets;
  const beforeIndex = beforeId ? assets.findIndex((candidate) => candidate.id === beforeId) : -1;
  const afterIndex = afterId ? assets.findIndex((candidate) => candidate.id === afterId) : -1;
  const insertionIndex = beforeIndex >= 0
    ? beforeIndex + 1
    : afterIndex >= 0
      ? afterIndex
      : Math.max(0, Math.min(fallbackIndex, assets.length));
  const next = [...assets];
  next.splice(insertionIndex, 0, asset);
  return next;
}

function formatPageRange(scene: ProjectScenarioScene) {
  if (!scene.pageStart) return "";
  return scene.pageEnd && scene.pageEnd !== scene.pageStart
    ? `${scene.pageStart}–${scene.pageEnd}`
    : String(scene.pageStart);
}

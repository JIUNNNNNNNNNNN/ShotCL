"use client";

import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Clapperboard,
  ChevronDown,
  ChevronRight,
  Crop,
  FileImage,
  FileText,
  FolderUp,
  ImagePlus,
  Info,
  Map as MapIcon,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useParams } from "next/navigation";
import type {
  ArchiveImportCommit,
  ArchiveImportProgressState,
  ArchiveImportSaveFailure,
  ArchiveImportSaveReport
} from "@/components/ArchiveImportDialog";
import { ArchiveDeleteDropZone } from "@/components/ArchiveDeleteDropZone";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { PageLoader, SectionLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import {
  useProjectPageActionMenu,
  type ProjectPageActionMenuRegistration
} from "@/components/ProjectPageActions";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import { Card } from "@/components/ui/Card";
import { MotionPresence } from "@/components/ui/MotionPresence";
import {
  createArchiveCropSession,
  createArchiveCropSource,
  createCroppedArchiveFile,
  createArchiveThumbnail,
  detectArchiveCropSourceKind,
  loadArchiveImagePages,
  mapSettledWithConcurrency,
  mapWithConcurrency,
  optimizeArchiveImage,
  releaseArchivePages,
  renderArchivePdfPages,
  type ArchiveImportPage,
  type StoryboardCropTemplate
} from "@/lib/client/archiveMedia";
import {
  scanArchiveDrop,
  scanArchiveFileList,
  type ArchiveFolderScanResult
} from "@/lib/client/archiveFolderDrop";
import { KeyedMutationQueue } from "@/lib/client/keyedMutationQueue";
import {
  deleteProjectReferenceAssets,
  inspectProjectReferenceAssets,
  listProjectReferenceAssetsByTypes,
  ProjectReferenceAssetReorderError,
  ProjectReferenceAssetSceneCutError,
  reorderProjectReferenceAssets,
  updateProjectReferenceAsset,
  updateProjectReferenceAssetSceneCut,
  uploadProjectReferenceAsset,
  uploadStoryboardCropAssetsBulk,
  type ProjectReferenceAssetOrderUpdate,
  type ProjectReferenceAssetSceneCutUpdateResult,
  type StoryboardCropBulkUploadItem
} from "@/lib/data/projectReferenceAssets";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { getProject } from "@/lib/data/projects";
import { getProjectSceneList } from "@/lib/data/sceneList";
import { auditQuery } from "@/lib/queryAudit";
import {
  deleteOverheadDiagramArchives,
  listOverheadDiagramArchive,
  saveOverheadDiagramArchive
} from "@/lib/data/shotMediaArchive";
import { createEmptyShotOverheadDiagram } from "@/lib/shotOverhead";
import type {
  OverheadDiagramArchiveItem,
  ProjectReferenceAsset,
  ProjectReferenceAssetType,
  ProjectSceneItem,
  Shot,
  ShotOverheadDiagram
} from "@/lib/types";

const ShotOverheadEditor = dynamic(
  () => import("@/components/ShotOverheadEditor").then((module) => module.ShotOverheadEditor),
  { ssr: false, loading: () => <SectionLoader /> }
);
const ArchiveImportDialog = dynamic(
  () => import("@/components/ArchiveImportDialog").then((module) => module.ArchiveImportDialog),
  { ssr: false, loading: () => <SectionLoader /> }
);

type ArchiveType = Extract<ProjectReferenceAssetType, "overhead" | "storyboard">;
type ArchiveViewType = "all" | ArchiveType;
type DeferredArchiveImageSource = {
  file: File;
  metadata: { originalFolderName: string; relativePath: string };
  sourceOrderIndex: number;
};
type PendingImport = {
  assetType: ArchiveType;
  sourceKind: "pdf" | "images" | "mixed";
  sourceFiles: File[];
  sourceLabel: string;
  pages: ArchiveImportPage[];
  importBatchId: string;
  baseSortOrder: number;
  fileMetadata: Array<{ originalFolderName: string; relativePath: string }>;
  sourceOrderIndexes?: number[];
  deferredImageSources?: DeferredArchiveImageSource[];
  existingSourceAssetIds?: string[];
  inheritedAssets?: Array<ProjectReferenceAsset | null>;
};

type PendingConfirm = {
  assetIds: string[];
  diagrams: OverheadDiagramArchiveItem[];
  linkedAssetCount: number;
  label: string;
  message?: string;
};

type PendingDeleteAsset = {
  id: string;
  label: string;
};

type DiagramDraft = {
  item: OverheadDiagramArchiveItem | null;
  title: string;
  memo: string;
  sceneNo: string;
  cutNo: string;
  shot: Shot;
};

type MetadataDraft = {
  sceneId: string;
  sceneNo: string;
  cutNo: string;
};

type MetadataAnchor = {
  clientX: number;
  clientY: number;
};

type ArchiveUploadFailure = {
  path: string;
  message: string;
};

type ArchiveGroupItem =
  | {
    kind: "asset";
    id: string;
    asset: ProjectReferenceAsset;
    cutLabel: string;
    cutSortValue: number | null;
    sortOrder: number;
    createdAt: string;
  }
  | {
    kind: "diagram";
    id: string;
    diagram: OverheadDiagramArchiveItem;
    cutLabel: string;
    cutSortValue: number | null;
    sortOrder: number;
    createdAt: string;
  };

type ArchiveSceneGroup = {
  key: string;
  label: string;
  sceneId: string | null;
  scene: ProjectSceneItem | null;
  items: ArchiveGroupItem[];
};

type ArchiveCutGroup = {
  key: string;
  label: string;
  cutNumber: number | null;
  items: ArchiveGroupItem[];
};

type ArchiveAssetPlacement = {
  sceneNo: string | null;
  cutNo: string | null;
  sortOrder: number;
  sceneId: string | null;
  sceneNumber: string;
  cutNumber: number | null;
  updatedAt: string;
};

type ArchiveReorderSession = {
  pointerId: number;
  assetId: string;
  groupKey: string;
  sceneId: string | null;
  cutNumber: number | null;
  allowReorder: boolean;
  originalIds: string[];
  currentIds: string[];
  completeOriginalIds: string[];
  visualTargetId: string | null;
  moved: boolean;
  validDrop: boolean;
  handle: HTMLButtonElement;
  previousTouchAction: string;
  overlayOffsetX: number;
  overlayOffsetY: number;
  pointerX: number;
  pointerY: number;
  activationX: number;
  activationY: number;
  hasDraggedAfterActivation: boolean;
  isOverDeleteZone: boolean;
  autoScrollFrame: number | null;
};

type ArchiveReorderOverlay = {
  imageUrl: string;
  width: number;
  height: number;
  left: number;
  top: number;
};

type PreparedStoryboardCrop = {
  displayFile: File;
  thumbnailFile: File;
  timings?: {
    cropDrawMs: number;
    imageEncodeMs: number;
  };
};

type StoryboardImportTimings = {
  sourcePrepareMs: number;
  cropPipelineMs: number;
  cropDrawMs: number;
  imageEncodeMs: number;
  requestMs: number;
  storageUploadMs: number;
  databaseMs: number;
  archiveUpdateMs: number;
  totalMs: number;
  sourceDecodeCount: number;
  cropCount: number;
  requestCount: number;
  cropConcurrency: number;
  uploadWindowSize: number;
};

type ArchiveSelectionKind = "asset" | "diagram";
type ArchiveSelectionKey = `${ArchiveSelectionKind}:${string}`;

type ArchivePointerSession = {
  key: ArchiveSelectionKey;
  assetId: string;
  groupKey: string;
  sceneId: string | null;
  cutNumber: number | null;
  orderedAssetIds: string[];
  completeOrderedAssetIds: string[];
  allowReorder: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  longPressed: boolean;
  timeoutId: number;
  target: HTMLButtonElement;
  previousTouchAction: string;
};
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE = 9;
const ARCHIVE_DELETE_DRAG_THRESHOLD = 10;
const ARCHIVE_NATURAL_COLLATOR = new Intl.Collator("ko-KR", {
  numeric: true,
  sensitivity: "base"
});

export default function ProjectStoryboardOverheadPage() {
  const params = useParams<{ id: string | string[] }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const [projectName, setProjectName] = useState("");
  const [activeType, setActiveType] = useState<ArchiveViewType>("overhead");
  const [overheads, setOverheads] = useState<ProjectReferenceAsset[]>([]);
  const [storyboards, setStoryboards] = useState<ProjectReferenceAsset[]>([]);
  const [sceneItems, setSceneItems] = useState<ProjectSceneItem[]>([]);
  const [diagramArchives, setDiagramArchives] = useState<OverheadDiagramArchiveItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<ArchiveSelectionKey>>(new Set());
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importSaveReport, setImportSaveReport] = useState<ArchiveImportSaveReport | null>(null);
  const [importProgress, setImportProgress] = useState<ArchiveImportProgressState | null>(null);
  const [diagramDraft, setDiagramDraft] = useState<DiagramDraft | null>(null);
  const [editingAsset, setEditingAsset] = useState<ProjectReferenceAsset | null>(null);
  const [metadataAnchor, setMetadataAnchor] = useState<MetadataAnchor | null>(null);
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft>({
    sceneId: "",
    sceneNo: "",
    cutNo: ""
  });
  const [metadataError, setMetadataError] = useState("");
  const [renamingAsset, setRenamingAsset] = useState<ProjectReferenceAsset | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [preview, setPreview] = useState<{ url: string; title: string; assetId?: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedArchiveProjectId, setLoadedArchiveProjectId] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [supportsDesktopDrop, setSupportsDesktopDrop] = useState(false);
  const [supportsDirectoryPicker, setSupportsDirectoryPicker] = useState(false);
  const [uploadFailures, setUploadFailures] = useState<ArchiveUploadFailure[]>([]);
  const [dragDepth, setDragDepth] = useState<Record<ArchiveType, number>>({ overhead: 0, storyboard: 0 });
  const [pressedSelectionKey, setPressedSelectionKey] = useState<ArchiveSelectionKey | null>(null);
  const [pendingMetadataAssetIds, setPendingMetadataAssetIds] = useState<Set<string>>(new Set());
  const [pendingReorderGroupKeys, setPendingReorderGroupKeys] = useState<Set<string>>(new Set());
  const [collapsedSceneKeys, setCollapsedSceneKeys] = useState<Set<string>>(new Set());
  const [reorderModeGroupKey, setReorderModeGroupKey] = useState<string | null>(null);
  const [reorderVisual, setReorderVisual] = useState<{ assetId: string; targetId: string | null } | null>(null);
  const [reorderOverlay, setReorderOverlay] = useState<ArchiveReorderOverlay | null>(null);
  const [isOverDeleteZone, setIsOverDeleteZone] = useState(false);
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState<PendingDeleteAsset | null>(null);
  const archiveActionMenu = useMemo<ProjectPageActionMenuRegistration>(() => ({
    key: "archive",
    scopeKey: `archive:${projectId ?? "unknown"}`,
    actions: {
      archiveDiagram: {
        active: activeType === "overhead",
        onSelect: () => setActiveType("overhead")
      },
      archiveStoryboard: {
        active: activeType === "storyboard",
        onSelect: () => setActiveType("storyboard")
      }
    }
  }), [activeType, projectId]);
  useProjectPageActionMenu(archiveActionMenu);
  const preparingRef = useRef(false);
  const folderScanRef = useRef(false);
  const longPressRef = useRef<ArchivePointerSession | null>(null);
  const assetPressCleanupRef = useRef<(() => void) | null>(null);
  const suppressArchiveClickRef = useRef<ArchiveSelectionKey | null>(null);
  const selectedKeysRef = useRef<Set<ArchiveSelectionKey>>(new Set());
  const pendingImportRef = useRef<PendingImport | null>(null);
  const savedImportResultIdsRef = useRef(new Set<string>());
  const importResultAssetIdsRef = useRef(new Map<string, string>());
  const preparedStoryboardCropsRef = useRef(new Map<string, PreparedStoryboardCrop>());
  const importProcessingRef = useRef(false);
  const importProgressRef = useRef<ArchiveImportProgressState | null>(null);
  const importProgressTimerRef = useRef<number | null>(null);
  const importAbortControllerRef = useRef<AbortController | null>(null);
  const archiveAssetsRef = useRef<ProjectReferenceAsset[]>([]);
  const pendingMetadataAssetIdsRef = useRef(new Set<string>());
  const pendingReorderGroupKeysRef = useRef(new Set<string>());
  const pendingMetadataVersionByAssetIdRef = useRef(new Map<string, number>());
  const pendingReorderVersionByGroupKeyRef = useRef(new Map<string, number>());
  const assetOperationVersionRef = useRef(new Map<string, number>());
  const renameOperationVersionRef = useRef(new Map<string, number>());
  const groupOperationVersionRef = useRef(new Map<string, number>());
  const deletedAssetIdsRef = useRef(new Set<string>());
  const committedPlacementByAssetIdRef = useRef(new Map<string, ArchiveAssetPlacement>());
  const archiveMutationQueueRef = useRef(new KeyedMutationQueue());
  const archiveProjectEpochRef = useRef(0);
  const activeProjectIdRef = useRef(projectId);
  activeProjectIdRef.current = projectId;
  const collapsedSceneKeysRef = useRef(new Set<string>());
  const hasInitializedCollapseRef = useRef(false);
  const knownArchiveSceneKeysRef = useRef(new Set<string>());
  const metadataSceneRevealKeysRef = useRef(new Set<string>());
  const reorderModeGroupKeyRef = useRef<string | null>(null);
  const reorderSessionRef = useRef<ArchiveReorderSession | null>(null);
  const reorderPointerCleanupRef = useRef<(() => void) | null>(null);
  const reorderOverlayRef = useRef<HTMLDivElement | null>(null);
  const deleteDropZoneRef = useRef<HTMLDivElement | null>(null);
  const pendingDeleteAssetRef = useRef<PendingDeleteAsset | null>(null);
  const deleteInspectionInFlightRef = useRef(false);
  const deleteActionInFlightRef = useRef(false);

  useUnsavedChangesGuard(isActiveArchiveImportProgress(importProgress));

  const enterReorderMode = useCallback((groupKey: string) => {
    reorderModeGroupKeyRef.current = groupKey;
    setReorderModeGroupKey(groupKey);
  }, []);

  const exitReorderMode = useCallback((expectedGroupKey?: string) => {
    if (expectedGroupKey && reorderModeGroupKeyRef.current !== expectedGroupKey) return;
    reorderModeGroupKeyRef.current = null;
    setReorderModeGroupKey(null);
    setReorderVisual(null);
    setReorderOverlay(null);
    setIsOverDeleteZone(false);
  }, []);

  const flushImportProgress = useCallback(() => {
    if (importProgressTimerRef.current !== null) {
      window.clearTimeout(importProgressTimerRef.current);
      importProgressTimerRef.current = null;
    }
    setImportProgress(importProgressRef.current);
  }, []);

  const updateImportProgress = useCallback((
    patch: Partial<ArchiveImportProgressState>,
    immediate = false
  ) => {
    const current = importProgressRef.current;
    if (!current) return;
    const next = deriveArchiveImportProgress(current, patch);
    importProgressRef.current = next;
    if (immediate) {
      flushImportProgress();
      return;
    }
    if (importProgressTimerRef.current !== null) return;
    importProgressTimerRef.current = window.setTimeout(() => {
      importProgressTimerRef.current = null;
      setImportProgress(importProgressRef.current);
    }, 140);
  }, [flushImportProgress]);

  const startImportProgress = useCallback((
    totalCount: number,
    importBatchId: string,
    savedCount: number
  ) => {
    const initial = deriveArchiveImportProgress({
      phase: "preparing",
      totalCount,
      preparedCount: savedCount,
      croppedCount: savedCount,
      uploadedCount: savedCount,
      savedCount,
      failedCount: 0,
      overallPercent: 0,
      importBatchId,
      startedAt: Date.now()
    }, {});
    importProgressRef.current = initial;
    if (importProgressTimerRef.current !== null) {
      window.clearTimeout(importProgressTimerRef.current);
      importProgressTimerRef.current = null;
    }
    setImportProgress(initial);
  }, []);

  const loadArchive = useCallback(async () => {
    if (!projectId) return;
    const requestedProjectId = projectId;
    setLoadedArchiveProjectId("");
    setIsLoading(true);
    try {
      const [project, archiveAssets, diagrams, sceneResult] = await Promise.all([
        auditQuery(
          "archive.loadProject",
          "app/projects/[id]/storyboard-overhead/page.tsx:loadArchive",
          () => getProject(projectId)
        ),
        auditQuery(
          "archive.loadReferenceAssets",
          "app/projects/[id]/storyboard-overhead/page.tsx:loadArchive",
          () => listProjectReferenceAssetsByTypes(projectId, ["overhead", "storyboard"])
        ),
        auditQuery(
          "archive.loadOverheadDiagrams",
          "app/projects/[id]/storyboard-overhead/page.tsx:loadArchive",
          () => listOverheadDiagramArchive(projectId)
        ),
        auditQuery(
          "archive.loadSceneList",
          "app/projects/[id]/storyboard-overhead/page.tsx:loadArchive",
          () => getProjectSceneList(projectId)
        )
          .then((value) => ({ value: value.items, error: "" }))
          .catch((error: unknown) => ({
            value: [] as ProjectSceneItem[],
            error: error instanceof Error ? error.message : "씬리스트를 불러오지 못했습니다."
          }))
      ]);
      if (activeProjectIdRef.current !== requestedProjectId) return;
      const overheadAssets = archiveAssets.filter((asset) => asset.assetType === "overhead");
      const storyboardAssets = archiveAssets.filter((asset) => asset.assetType === "storyboard");
      setProjectName(project?.name ?? "프로젝트");
      setOverheads(overheadAssets);
      setStoryboards(storyboardAssets);
      replaceCommittedArchivePlacements([...overheadAssets, ...storyboardAssets]);
      setDiagramArchives(diagrams);
      setSceneItems(sceneResult.value);
      setErrorMessage(sceneResult.error);
      setLoadedArchiveProjectId(requestedProjectId);
    } catch (error) {
      if (activeProjectIdRef.current !== requestedProjectId) return;
      setErrorMessage(error instanceof Error ? error.message : "부감도와 콘티 아카이브를 불러오지 못했습니다.");
    } finally {
      if (activeProjectIdRef.current === requestedProjectId) setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadArchive();
  }, [loadArchive]);

  useEffect(() => {
    archiveProjectEpochRef.current += 1;
    pendingMetadataAssetIdsRef.current.clear();
    pendingReorderGroupKeysRef.current.clear();
    pendingMetadataVersionByAssetIdRef.current.clear();
    pendingReorderVersionByGroupKeyRef.current.clear();
    assetOperationVersionRef.current.clear();
    renameOperationVersionRef.current.clear();
    groupOperationVersionRef.current.clear();
    deletedAssetIdsRef.current.clear();
    committedPlacementByAssetIdRef.current.clear();
    setPendingMetadataAssetIds(new Set());
    setPendingReorderGroupKeys(new Set());
    deleteActionInFlightRef.current = false;
    deleteInspectionInFlightRef.current = false;
    pendingDeleteAssetRef.current = null;
    setPendingDeleteAsset(null);
    setPendingConfirm(null);
    selectedKeysRef.current = new Set();
    setSelectedKeys(new Set());
    setSelectionMode(false);
    setEditingAsset(null);
    setMetadataAnchor(null);
    setRenamingAsset(null);
    hasInitializedCollapseRef.current = false;
    knownArchiveSceneKeysRef.current = new Set();
    metadataSceneRevealKeysRef.current = new Set();
    collapsedSceneKeysRef.current = new Set();
    setCollapsedSceneKeys(new Set());
  }, [projectId]);

  useEffect(() => {
    archiveAssetsRef.current = [...overheads, ...storyboards];
  }, [overheads, storyboards]);

  useEffect(() => {
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setSupportsDesktopDrop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const input = document.createElement("input");
    setSupportsDirectoryPicker("webkitdirectory" in input);
  }, []);

  useEffect(() => {
    selectedKeysRef.current = new Set();
    setSelectedKeys(new Set());
    setSelectionMode(false);
    cancelArchivePointerSession();
    cancelActiveReorderDrag();
    exitReorderMode();
  }, [activeType, query]);

  useEffect(() => {
    if (!reorderModeGroupKey) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancelActiveReorderDrag();
      exitReorderMode();
    };
    const handleOutsidePointer = (event: PointerEvent) => {
      if (reorderSessionRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      const zone = target?.closest<HTMLElement>("[data-archive-reorder-zone]");
      const control = target?.closest<HTMLElement>("[data-archive-reorder-control]");
      if (control || zone?.dataset.archiveReorderZone === reorderModeGroupKey) return;
      exitReorderMode();
    };
    const handleOrientationChange = () => {
      cancelActiveReorderDrag();
      exitReorderMode();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    window.addEventListener("orientationchange", handleOrientationChange);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
      window.removeEventListener("orientationchange", handleOrientationChange);
    };
  }, [exitReorderMode, reorderModeGroupKey]);

  useEffect(() => {
    if (!pendingConfirm || isSaving) return;
    const handleConfirmEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPendingConfirm(null);
      setErrorMessage("");
    };
    document.addEventListener("keydown", handleConfirmEscape);
    return () => document.removeEventListener("keydown", handleConfirmEscape);
  }, [isSaving, pendingConfirm]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(""), 5_000);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  useEffect(() => () => {
    importAbortControllerRef.current?.abort();
    importAbortControllerRef.current = null;
    if (importProgressTimerRef.current !== null) {
      window.clearTimeout(importProgressTimerRef.current);
      importProgressTimerRef.current = null;
    }
    preparedStoryboardCropsRef.current.clear();
    assetPressCleanupRef.current?.();
    reorderPointerCleanupRef.current?.();
    const longPress = longPressRef.current;
    if (longPress) {
      window.clearTimeout(longPress.timeoutId);
      longPress.target.style.touchAction = longPress.previousTouchAction;
      longPressRef.current = null;
    }
    const reorder = reorderSessionRef.current;
    if (reorder) {
      if (reorder.autoScrollFrame !== null) window.cancelAnimationFrame(reorder.autoScrollFrame);
      reorder.handle.style.touchAction = reorder.previousTouchAction;
      try {
        if (reorder.handle.hasPointerCapture(reorder.pointerId)) {
          reorder.handle.releasePointerCapture(reorder.pointerId);
        }
      } catch {
        // The browser may have already released pointer capture while navigating.
      }
      reorderSessionRef.current = null;
    }
    pendingDeleteAssetRef.current = null;
    if (pendingImportRef.current) releaseArchivePages(pendingImportRef.current.pages);
  }, []);

  useEffect(() => {
    pendingImportRef.current = pendingImport;
  }, [pendingImport]);

  useEffect(() => {
    if (!editingAsset) return;
    const stillExists = [...overheads, ...storyboards].some((asset) => asset.id === editingAsset.id);
    if (!stillExists || !canEdit) {
      setEditingAsset(null);
      setMetadataAnchor(null);
      setMetadataError("");
    }
  }, [canEdit, editingAsset, overheads, storyboards]);

  const selectedArchiveType: ArchiveType | null = activeType === "all" ? null : activeType;
  const activeAssets = useMemo(
    () => selectedArchiveType === "overhead"
      ? overheads
      : selectedArchiveType === "storyboard"
        ? storyboards
        : [...overheads, ...storyboards],
    [overheads, selectedArchiveType, storyboards]
  );
  const sourceAssets = useMemo(
    () => dedupeArchiveAssets(activeAssets).filter((asset) => {
      const sourceKind = detectArchiveCropSourceKind({
        mimeType: asset.mimeType,
        filename: asset.filename
      });
      const isSource = sourceKind === "pdf" || asset.groupId?.startsWith("source:");
      return isSource && matchesAssetQuery(asset, query);
    }),
    [activeAssets, query]
  );
  const imageAssets = useMemo(
    () => dedupeArchiveAssets(activeAssets).filter((asset) => (
      detectArchiveCropSourceKind({
        mimeType: asset.mimeType,
        filename: asset.filename
      }) === "image"
      && !asset.groupId?.startsWith("source:")
    )),
    [activeAssets]
  );
  const filteredAssets = useMemo(
    () => imageAssets.filter((asset) => matchesAssetQuery(asset, query)),
    [imageAssets, query]
  );
  const filteredDiagrams = useMemo(
    () => activeType !== "storyboard"
      ? diagramArchives.filter((item) => matchesDiagramQuery(item, query))
      : [],
    [activeType, diagramArchives, query]
  );
  const archiveGroups = useMemo(
    () => groupArchiveItemsByScene(filteredAssets, filteredDiagrams, sceneItems),
    [filteredAssets, filteredDiagrams, sceneItems]
  );
  const archiveGroupsForCollapse = useMemo(
    () => groupArchiveItemsByScene(
      dedupeArchiveAssets([...overheads, ...storyboards]).filter((asset) => (
        detectArchiveCropSourceKind({
          mimeType: asset.mimeType,
          filename: asset.filename
        }) === "image"
        && !asset.groupId?.startsWith("source:")
      )),
      diagramArchives,
      sceneItems
    ),
    [diagramArchives, overheads, sceneItems, storyboards]
  );
  const completeArchiveOrderByGroupKey = useMemo(() => {
    const assetsByGroup = new Map<string, ProjectReferenceAsset[]>();
    for (const asset of dedupeArchiveAssets([...overheads, ...storyboards])) {
      if (!isOrderableArchiveAsset(asset)) continue;
      const groupKey = archiveAssetOrderGroupKey(asset);
      const groupedAssets = assetsByGroup.get(groupKey);
      if (groupedAssets) groupedAssets.push(asset);
      else assetsByGroup.set(groupKey, [asset]);
    }
    return new Map(
      [...assetsByGroup.entries()].map(([groupKey, assets]) => [
        groupKey,
        assets.sort(compareArchiveAssetsForOrder).map((asset) => asset.id)
      ])
    );
  }, [overheads, storyboards]);

  useLayoutEffect(() => {
    if (!projectId || loadedArchiveProjectId !== projectId) return;

    const currentSceneKeys = new Set(archiveGroupsForCollapse.map((group) => group.key));
    if (!hasInitializedCollapseRef.current) {
      hasInitializedCollapseRef.current = true;
      knownArchiveSceneKeysRef.current = currentSceneKeys;
      metadataSceneRevealKeysRef.current.clear();
      collapsedSceneKeysRef.current = new Set(currentSceneKeys);
      setCollapsedSceneKeys(new Set(currentSceneKeys));
      return;
    }

    const previousSceneKeys = knownArchiveSceneKeysRef.current;
    const metadataSceneRevealKeys = metadataSceneRevealKeysRef.current;
    knownArchiveSceneKeysRef.current = currentSceneKeys;

    updateCollapsedScenes((current) => {
      const next = new Set(
        [...current].filter((sceneKey) => currentSceneKeys.has(sceneKey))
      );
      for (const sceneKey of currentSceneKeys) {
        if (!previousSceneKeys.has(sceneKey) && !metadataSceneRevealKeys.has(sceneKey)) {
          next.add(sceneKey);
        }
        if (metadataSceneRevealKeys.has(sceneKey)) next.delete(sceneKey);
      }
      const unchanged = next.size === current.size
        && [...next].every((sceneKey) => current.has(sceneKey));
      return unchanged ? current : next;
    });

    metadataSceneRevealKeysRef.current = new Set(
      [...metadataSceneRevealKeys].filter((sceneKey) => !currentSceneKeys.has(sceneKey))
    );
  }, [archiveGroupsForCollapse, loadedArchiveProjectId, projectId]);

  const scopeSelectionKeys = useMemo(
    () => [...new Set([
      ...archiveGroups.flatMap((group) => group.items.flatMap((item) => (
        item.kind === "diagram" && item.diagram.legacy
          ? []
          : [archiveSelectionKey(item.kind, item.id)]
      ))),
      ...sourceAssets.map((asset) => archiveSelectionKey("asset", asset.id))
    ])],
    [archiveGroups, sourceAssets]
  );
  const allScopeAssetsSelected = scopeSelectionKeys.length > 0
    && scopeSelectionKeys.every((key) => selectedKeys.has(key));
  const selectedReferenceAssetIds = useMemo(
    () => [...overheads, ...storyboards]
      .filter((asset) => selectedKeys.has(archiveSelectionKey("asset", asset.id)))
      .map((asset) => asset.id),
    [overheads, selectedKeys, storyboards]
  );
  const selectedDiagramItems = useMemo(
    () => diagramArchives.filter((item) => (
      !item.legacy && selectedKeys.has(archiveSelectionKey("diagram", item.id))
    )),
    [diagramArchives, selectedKeys]
  );
  const selectedCount = selectedReferenceAssetIds.length + selectedDiagramItems.length;
  const singleSelectedReferenceAsset = selectedCount === 1
    ? [...overheads, ...storyboards].find((asset) => (
      selectedKeys.has(archiveSelectionKey("asset", asset.id))
    )) ?? null
    : null;
  const canCropSingleSelection = Boolean(
    canEdit
    && singleSelectedReferenceAsset
    && singleSelectedReferenceAsset.assetType === "storyboard"
    && detectArchiveCropSourceKind({
      mimeType: singleSelectedReferenceAsset.mimeType,
      filename: singleSelectedReferenceAsset.filename
    })
  );

  function mergeUploadedAssets(uploaded: ProjectReferenceAsset[]) {
    if (uploaded.length === 0) return;
    const byId = new Map(archiveAssetsRef.current.map((asset) => [asset.id, asset]));
    for (const asset of uploaded) byId.set(asset.id, asset);
    commitArchiveAssetPlacements(uploaded);
    setCombinedArchiveAssets([...byId.values()]);
  }

  function removeAssetsFromLocalState(assetIds: Iterable<string>) {
    const ids = new Set(assetIds);
    for (const id of ids) committedPlacementByAssetIdRef.current.delete(id);
    setCombinedArchiveAssets(archiveAssetsRef.current.filter((asset) => !ids.has(asset.id)));
    updateSelectedKeys((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(archiveSelectionKey("asset", id));
      return next;
    });
    setPreview((current) => current?.assetId && ids.has(current.assetId) ? null : current);
    setEditingAsset((current) => current && ids.has(current.id) ? null : current);
    setRenamingAsset((current) => current && ids.has(current.id) ? null : current);
  }

  function removeDiagramsFromLocalState(diagramIds: Iterable<string>) {
    const ids = new Set(diagramIds);
    setDiagramArchives((current) => current.filter((item) => !ids.has(item.id)));
    updateSelectedKeys((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(archiveSelectionKey("diagram", id));
      return next;
    });
  }

  function applyArchiveAssetNameUpdate(updated: ProjectReferenceAsset) {
    const committed = committedPlacementByAssetIdRef.current.get(updated.id);
    if (committed) {
      committedPlacementByAssetIdRef.current.set(updated.id, {
        ...committed,
        updatedAt: updated.updatedAt || committed.updatedAt
      });
    }
    setCombinedArchiveAssets(archiveAssetsRef.current.map((asset) => asset.id === updated.id
      ? {
          ...asset,
          updatedAt: updated.updatedAt || asset.updatedAt,
          crop: {
            ...asset.crop,
            title: updated.crop.title,
            displayName: updated.crop.displayName
          }
        }
      : asset));
  }

  function setCombinedArchiveAssets(next: ProjectReferenceAsset[]) {
    archiveAssetsRef.current = next;
    setOverheads(next.filter((asset) => asset.assetType === "overhead"));
    setStoryboards(next.filter((asset) => asset.assetType === "storyboard"));
  }

  function replaceCommittedArchivePlacements(assets: ProjectReferenceAsset[]) {
    committedPlacementByAssetIdRef.current = new Map(
      assets.map((asset) => [asset.id, archiveAssetPlacement(asset)])
    );
  }

  function commitArchiveAssetPlacements(assets: ProjectReferenceAsset[]) {
    for (const asset of assets) {
      committedPlacementByAssetIdRef.current.set(asset.id, archiveAssetPlacement(asset));
    }
  }

  function commitOrderUpdates(updates: ProjectReferenceAssetOrderUpdate[]) {
    for (const update of updates) {
      const placement = committedPlacementByAssetIdRef.current.get(update.id);
      if (!placement) continue;
      committedPlacementByAssetIdRef.current.set(update.id, {
        ...placement,
        sortOrder: update.sortOrder,
        updatedAt: update.updatedAt || placement.updatedAt
      });
    }
  }

  function commitSceneCutUpdate(result: ProjectReferenceAssetSceneCutUpdateResult) {
    const placement = committedPlacementByAssetIdRef.current.get(result.asset.id);
    if (placement) {
      committedPlacementByAssetIdRef.current.set(result.asset.id, {
        ...placement,
        sceneNo: result.asset.sceneNumber || null,
        cutNo: result.asset.cutNumber === null ? null : String(result.asset.cutNumber),
        sceneId: result.asset.sceneId,
        sceneNumber: result.asset.sceneNumber,
        cutNumber: result.asset.cutNumber,
        sortOrder: result.asset.sortOrder,
        updatedAt: result.asset.updatedAt || placement.updatedAt
      });
    }
    commitOrderUpdates(result.orders);
  }

  function restoreCommittedArchivePlacements(
    assets: ProjectReferenceAsset[],
    initialGroupKeys: Iterable<string>,
    focusAssetId?: string
  ) {
    const affectedGroupKeys = new Set(initialGroupKeys);
    if (focusAssetId) {
      const currentAsset = assets.find((asset) => asset.id === focusAssetId);
      if (currentAsset) affectedGroupKeys.add(archiveAssetOrderGroupKey(currentAsset));
      const committed = committedPlacementByAssetIdRef.current.get(focusAssetId);
      if (committed) {
        affectedGroupKeys.add(archiveOrderGroupKey(committed.sceneId, committed.cutNumber));
      }
    }
    return assets.map((asset) => {
      const committed = committedPlacementByAssetIdRef.current.get(asset.id);
      if (!committed) return asset;
      const currentGroupKey = archiveAssetOrderGroupKey(asset);
      const committedGroupKey = archiveOrderGroupKey(committed.sceneId, committed.cutNumber);
      if (
        asset.id !== focusAssetId
        && !affectedGroupKeys.has(currentGroupKey)
        && !affectedGroupKeys.has(committedGroupKey)
      ) return asset;
      return applyArchiveAssetPlacement(asset, committed);
    });
  }

  function nextAssetOperationVersion(assetId: string) {
    const version = (assetOperationVersionRef.current.get(assetId) ?? 0) + 1;
    assetOperationVersionRef.current.set(assetId, version);
    return version;
  }

  function nextRenameOperationVersion(assetId: string) {
    const version = (renameOperationVersionRef.current.get(assetId) ?? 0) + 1;
    renameOperationVersionRef.current.set(assetId, version);
    return version;
  }

  function archiveOperationIsCurrent(operationProjectId: string, operationEpoch: number) {
    return activeProjectIdRef.current === operationProjectId
      && archiveProjectEpochRef.current === operationEpoch;
  }

  function nextGroupOperationVersions(groupKeys: Iterable<string>) {
    const versions = new Map<string, number>();
    for (const groupKey of new Set(groupKeys)) {
      const version = (groupOperationVersionRef.current.get(groupKey) ?? 0) + 1;
      groupOperationVersionRef.current.set(groupKey, version);
      versions.set(groupKey, version);
    }
    return versions;
  }

  function groupOperationVersionsAreCurrent(versions: ReadonlyMap<string, number>) {
    for (const [groupKey, version] of versions) {
      if (groupOperationVersionRef.current.get(groupKey) !== version) return false;
    }
    return true;
  }

  function markMetadataPending(assetId: string, version: number) {
    pendingMetadataVersionByAssetIdRef.current.set(assetId, version);
    pendingMetadataAssetIdsRef.current.add(assetId);
    setPendingMetadataAssetIds(new Set(pendingMetadataAssetIdsRef.current));
  }

  function clearMetadataPending(assetId: string, version: number) {
    if (pendingMetadataVersionByAssetIdRef.current.get(assetId) !== version) return;
    pendingMetadataVersionByAssetIdRef.current.delete(assetId);
    pendingMetadataAssetIdsRef.current.delete(assetId);
    setPendingMetadataAssetIds(new Set(pendingMetadataAssetIdsRef.current));
  }

  function markReorderPending(groupKey: string, version: number) {
    pendingReorderVersionByGroupKeyRef.current.set(groupKey, version);
    pendingReorderGroupKeysRef.current.add(groupKey);
    setPendingReorderGroupKeys(new Set(pendingReorderGroupKeysRef.current));
  }

  function clearReorderPending(groupKey: string, version: number) {
    if (pendingReorderVersionByGroupKeyRef.current.get(groupKey) !== version) return;
    pendingReorderVersionByGroupKeyRef.current.delete(groupKey);
    pendingReorderGroupKeysRef.current.delete(groupKey);
    setPendingReorderGroupKeys(new Set(pendingReorderGroupKeysRef.current));
  }

  function applyOrderUpdates(updates: ProjectReferenceAssetOrderUpdate[]) {
    if (updates.length === 0) return;
    commitOrderUpdates(updates);
    const updateById = new Map(updates.map((entry) => [entry.id, entry]));
    setCombinedArchiveAssets(archiveAssetsRef.current.map((asset) => {
      const update = updateById.get(asset.id);
      return update === undefined
        ? asset
        : { ...asset, sortOrder: update.sortOrder, updatedAt: update.updatedAt || asset.updatedAt };
    }));
  }

  function applySceneCutUpdate(
    result: ProjectReferenceAssetSceneCutUpdateResult,
    applyOrders = true
  ) {
    commitSceneCutUpdate(result);
    const orderById = applyOrders
      ? new Map(result.orders.map((entry) => [entry.id, entry]))
      : new Map<string, ProjectReferenceAssetOrderUpdate>();
    setCombinedArchiveAssets(archiveAssetsRef.current.map((asset) => {
      const orderUpdate = orderById.get(asset.id);
      const sortOrder = orderUpdate?.sortOrder ?? asset.sortOrder;
      if (asset.id !== result.asset.id) {
        if (!orderUpdate) return asset;
        return {
          ...asset,
          sortOrder,
          updatedAt: orderUpdate.updatedAt || asset.updatedAt
        };
      }
      return {
        ...asset,
        sceneNo: result.asset.sceneNumber || null,
        cutNo: result.asset.cutNumber === null ? null : String(result.asset.cutNumber),
        sortOrder: applyOrders ? result.asset.sortOrder : asset.sortOrder,
        updatedAt: result.asset.updatedAt || asset.updatedAt,
        crop: {
          ...asset.crop,
          sceneId: result.asset.sceneId,
          sceneNumber: result.asset.sceneNumber,
          cutNumber: result.asset.cutNumber
        }
      };
    }));
  }

  async function preparePdf(assetType: ArchiveType, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await prepareFiles(assetType, files, "pdf");
  }

  async function prepareImages(assetType: ArchiveType, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await prepareFiles(assetType, files, "images", assetType === "overhead");
  }

  async function prepareMixedUpload(assetType: ArchiveType, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await prepareFiles(
      assetType,
      files,
      undefined,
      assetType === "overhead"
    );
  }

  async function prepareFolderUpload(
    assetType: ArchiveType,
    event: ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    await scanAndPrepareFolderBatch(assetType, async () => scanArchiveFileList(files));
  }

  async function scanAndPrepareFolderBatch(
    assetType: ArchiveType,
    scan: () => Promise<ArchiveFolderScanResult>,
    batchLabel = "폴더"
  ) {
    const batchAssetType = assetType;
    if (
      !projectId
      || !canEdit
      || folderScanRef.current
      || preparingRef.current
      || isSaving
    ) return;

    folderScanRef.current = true;
    setIsPreparing(true);
    setErrorMessage("");
    setStatusMessage("");
    setUploadFailures([]);
    setProgressMessage(`${batchLabel} 확인 중…`);
    let result: ArchiveFolderScanResult | null = null;
    try {
      result = await scan();
      setProgressMessage(`${result.files.length}개 파일 발견`);
      await yieldArchiveProcessingTask();
    } catch (error) {
      setErrorMessage(errorMessageOf(error, "폴더를 확인하지 못했습니다."));
      setProgressMessage("");
    } finally {
      folderScanRef.current = false;
      setIsPreparing(false);
    }

    if (!result) return;
    const scanFailures = result.skipped
      .filter((issue) => issue.reason.includes("실패"))
      .map((issue) => ({ path: issue.path, message: issue.reason }));
    const excludedCount = Math.max(0, result.excludedCount - scanFailures.length);
    if (result.files.length === 0) {
      setProgressMessage("");
      setUploadFailures(scanFailures);
      setErrorMessage("폴더에서 업로드 가능한 PDF 또는 이미지를 찾지 못했습니다.");
      if (result.excludedCount > 0) {
        setStatusMessage(`${result.discoveredCount}개 확인 · ${result.excludedCount}개 제외`);
      }
      return;
    }

    await prepareFiles(
      batchAssetType,
      result.files.map((entry) => entry.file),
      undefined,
      batchAssetType === "overhead",
      {
        fileMetadata: result.files.map((entry) => ({
          originalFolderName: entry.originalFolderName,
          relativePath: entry.relativePath
        })),
        initialExcludedCount: excludedCount,
        initialFailures: scanFailures,
        batchLabel
      }
    );
  }

  async function prepareFiles(
    assetType: ArchiveType,
    rawFiles: File[],
    expectedKind?: PendingImport["sourceKind"],
    directImageUpload = false,
    context?: {
      fileMetadata?: Array<{ originalFolderName: string; relativePath: string }>;
      existingSourceAssetIds?: string[];
      inheritedAssets?: Array<ProjectReferenceAsset | null>;
      initialExcludedCount?: number;
      initialFailures?: ArchiveUploadFailure[];
      batchLabel?: string;
    }
  ) {
    if (
      !projectId
      || rawFiles.length === 0
      || folderScanRef.current
      || preparingRef.current
      || isSaving
    ) return;
    const seenSources = new Set<string>();
    const candidates = rawFiles.flatMap((file, index) => {
      const metadata = context?.fileMetadata?.[index] ?? {
        originalFolderName: "",
        relativePath: file.name
      };
      const key = `${metadata.relativePath}:${file.name}:${file.size}:${file.lastModified}`;
      if (seenSources.has(key)) return [];
      seenSources.add(key);
      return [{
        file,
        metadata,
        sourceAssetId: context?.existingSourceAssetIds?.[index] ?? "",
        inheritedAsset: context?.inheritedAssets?.[index] ?? null
      }];
    });
    const acceptedSources = candidates
      .filter(({ file }) => {
        if (!isAcceptedArchiveFile(file) || file.size <= 0) return false;
        if (expectedKind === "pdf") return isPdfFile(file);
        if (expectedKind === "images") return isImageFile(file);
        return true;
      })
      .map((source, sourceOrderIndex) => ({ ...source, sourceOrderIndex }));
    let excludedCount = (context?.initialExcludedCount ?? 0)
      + candidates.length
      - acceptedSources.length;
    const failures = [...(context?.initialFailures ?? [])];
    if (acceptedSources.length === 0) {
      setErrorMessage("PDF, JPG, JPEG, PNG, WebP 중 읽을 수 있는 파일을 선택해주세요.");
      setUploadFailures(failures);
      return;
    }
    const directImageSources = directImageUpload
      ? acceptedSources.filter(({ file }) => isImageFile(file))
      : [];
    const importSources = directImageUpload
      ? acceptedSources.filter(({ file }) => !isImageFile(file))
      : acceptedSources;
    preparingRef.current = true;
    setIsPreparing(true);
    setErrorMessage("");
    setUploadFailures([]);
    setActiveType(assetType);
    try {
      let directUploadCount = 0;
      if (directImageSources.length > 0 && importSources.length === 0) {
        const batchId = typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}`;
        const existingCount = (assetType === "overhead" ? overheads : storyboards)
          .filter((asset) => asset.mimeType.startsWith("image/") && !asset.groupId?.startsWith("source:"))
          .length;
        const uploadedAssets: ProjectReferenceAsset[] = [];
        let directProcessedCount = 0;
        await mapWithConcurrency(directImageSources, 3, async (source, directIndex) => {
          const { file, metadata } = source;
          try {
            setProgressMessage(`이미지 최적화 중 · ${file.name}`);
            const optimized = await optimizeArchiveImage(file);
            setProgressMessage(`${directProcessedCount + 1} / ${directImageSources.length} 업로드 중`);
            const uploaded = await uploadProjectReferenceAsset(projectId, assetType, optimized.displayFile, {
              thumbnailFile: optimized.thumbnailFile,
              sourceType: "upload_image",
              groupId: batchId,
              folderId: null,
              displayName: stripArchiveExtension(file.name),
              originalFilename: file.name,
              originalFolderName: metadata?.originalFolderName,
              relativePath: metadata?.relativePath,
              sortOrder: existingCount + directIndex
            });
            uploadedAssets.push(uploaded);
            directUploadCount += 1;
          } catch (error) {
            failures.push({
              path: metadata.relativePath || file.name,
              message: errorMessageOf(error, "이미지를 업로드하지 못했습니다.")
            });
          } finally {
            directProcessedCount += 1;
            setProgressMessage(`저장 중 ${directProcessedCount}/${directImageSources.length}`);
          }
        });
        mergeUploadedAssets(uploadedAssets);
        if (importSources.length === 0) {
          setProgressMessage("");
          setUploadFailures(sortArchiveUploadFailures(failures));
          setStatusMessage(archiveUploadSummary(
            directUploadCount,
            excludedCount,
            failures.length,
            context?.batchLabel
          ));
          if (directUploadCount === 0) {
            setErrorMessage("이미지를 업로드하지 못했습니다.");
          }
          return;
        }
      }

      const files = importSources.map(({ file }) => file);
      const pdfFiles = files.filter(isPdfFile);
      const imageFiles = files.filter(isImageFile);
      const sourceKind: PendingImport["sourceKind"] = pdfFiles.length > 0 && imageFiles.length > 0
        ? "mixed"
        : pdfFiles.length > 0
          ? "pdf"
          : "images";
      const pages: ArchiveImportPage[] = [];
      const readableFiles: File[] = [];
      const readableMetadata: Array<{ originalFolderName: string; relativePath: string }> = [];
      const readableSourceIds: string[] = [];
      const readableInheritedAssets: Array<ProjectReferenceAsset | null> = [];
      const readableSourceOrderIndexes: number[] = [];
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        try {
          const sourceFileIndex = readableFiles.length;
          let rendered: ArchiveImportPage[];
          if (isPdfFile(file)) {
            if (!await hasPdfSignature(file)) throw new Error("Invalid PDF");
            rendered = await renderArchivePdfPages(file, (current, total) => {
              setProgressMessage(`PDF ${fileIndex + 1}/${files.length} · 페이지 ${current}/${total}`);
            }, sourceFileIndex);
          } else {
            setProgressMessage(`이미지 ${fileIndex + 1}/${files.length} 준비 중`);
            rendered = (await loadArchiveImagePages([file])).map((page) => ({
              ...page,
              id: `image-${sourceFileIndex}-${file.lastModified}`,
              index: 0,
              sourceFileIndex
            }));
          }
          if (rendered.length === 0) throw new Error("Empty source");
          readableFiles.push(file);
          readableMetadata.push(importSources[fileIndex]?.metadata ?? {
            originalFolderName: "",
            relativePath: file.name
          });
          readableSourceIds.push(importSources[fileIndex]?.sourceAssetId ?? "");
          readableInheritedAssets.push(importSources[fileIndex]?.inheritedAsset ?? null);
          readableSourceOrderIndexes.push(
            importSources[fileIndex]?.sourceOrderIndex ?? sourceFileIndex
          );
          pages.push(...rendered);
        } catch (error) {
          failures.push({
            path: importSources[fileIndex]?.metadata.relativePath || file.name,
            message: errorMessageOf(error, "자료를 읽지 못했습니다.")
          });
        }
      }
      if (pages.length === 0 || readableFiles.length === 0) {
        if (directImageSources.length > 0) {
          const batchId = typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}`;
          const existingCount = (assetType === "overhead" ? overheads : storyboards)
            .filter((asset) => asset.mimeType.startsWith("image/") && !asset.groupId?.startsWith("source:"))
            .length;
          const uploadedAssets: ProjectReferenceAsset[] = [];
          let processed = 0;
          await mapWithConcurrency(directImageSources, 3, async (source, directIndex) => {
            const { file, metadata } = source;
            try {
              setProgressMessage(`이미지 최적화 중 · ${file.name}`);
              const optimized = await optimizeArchiveImage(file);
              const uploaded = await uploadProjectReferenceAsset(projectId, assetType, optimized.displayFile, {
                thumbnailFile: optimized.thumbnailFile,
                sourceType: "upload_image",
                groupId: batchId,
                folderId: null,
                displayName: stripArchiveExtension(file.name),
                originalFilename: file.name,
                originalFolderName: metadata.originalFolderName,
                relativePath: metadata.relativePath,
                sortOrder: existingCount + directIndex
              });
              uploadedAssets.push(uploaded);
              directUploadCount += 1;
            } catch (error) {
              failures.push({
                path: metadata.relativePath || file.name,
                message: errorMessageOf(error, "이미지를 업로드하지 못했습니다.")
              });
            } finally {
              processed += 1;
              setProgressMessage(`저장 중 ${processed}/${directImageSources.length}`);
            }
          });
          mergeUploadedAssets(uploadedAssets);
          setProgressMessage("");
          setUploadFailures(sortArchiveUploadFailures(failures));
          setStatusMessage(archiveUploadSummary(
            directUploadCount,
            excludedCount,
            failures.length,
            context?.batchLabel
          ));
          if (failures.length > 0) {
            setErrorMessage(
              `${directUploadCount}개 이미지는 저장했지만 ${failures.length}개 자료를 처리하지 못했습니다.`
            );
          }
          return;
        }
        setErrorMessage(
          directUploadCount > 0
            ? `${directUploadCount}개 이미지는 저장했지만 읽을 수 있는 나머지 자료가 없습니다.`
            : "읽을 수 있는 자료가 없습니다."
        );
        setProgressMessage("");
        setUploadFailures(sortArchiveUploadFailures(failures));
        return;
      }
      const targetImageCount = (assetType === "overhead" ? overheads : storyboards)
        .filter((asset) => (
          asset.mimeType.startsWith("image/")
          && !asset.groupId?.startsWith("source:")
        ))
        .length;
      beginImport({
        assetType,
        sourceKind,
        sourceFiles: readableFiles,
        sourceLabel: readableFiles.length === 1
          ? readableFiles[0].name
          : `${readableFiles[0].name} 외 ${readableFiles.length - 1}개`,
        pages,
        importBatchId: createArchiveSessionId(),
        baseSortOrder: targetImageCount,
        fileMetadata: readableMetadata,
        sourceOrderIndexes: readableSourceOrderIndexes,
        deferredImageSources: directImageSources.map(({ file, metadata, sourceOrderIndex }) => ({
          file,
          metadata,
          sourceOrderIndex
        })),
        existingSourceAssetIds: readableSourceIds.some(Boolean) ? readableSourceIds : undefined,
        inheritedAssets: readableInheritedAssets.some(Boolean) ? readableInheritedAssets : undefined
      });
      setProgressMessage("");
      setUploadFailures(sortArchiveUploadFailures(failures));
      setStatusMessage([
        context?.batchLabel ? `${context.batchLabel} 확인 완료` : "자료 준비 완료",
        `${readableFiles.length + directImageSources.length}개 준비`,
        ...(excludedCount > 0 ? [`${excludedCount}개 제외`] : []),
        ...(failures.length > 0 ? [`${failures.length}개 실패`] : [])
      ].join(" · "));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "자료를 준비하지 못했습니다.");
      setProgressMessage("");
    } finally {
      preparingRef.current = false;
      setIsPreparing(false);
    }
  }

  function updateDragDepth(assetType: ArchiveType, delta: number) {
    setDragDepth((current) => ({
      ...current,
      [assetType]: Math.max(0, current[assetType] + delta)
    }));
  }

  async function handleDrop(assetType: ArchiveType, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragDepth((current) => ({ ...current, [assetType]: 0 }));
    if (!supportsDesktopDrop || !canEdit) return;
    const dataTransfer = event.dataTransfer;
    await scanAndPrepareFolderBatch(
      assetType,
      () => scanArchiveDrop(dataTransfer),
      "드롭한 자료"
    );
  }

  function beginImport(nextImport: PendingImport) {
    if (importProcessingRef.current) return;
    if (pendingImport) releaseArchivePages(pendingImport.pages);
    savedImportResultIdsRef.current = new Set();
    importResultAssetIdsRef.current = new Map();
    preparedStoryboardCropsRef.current.clear();
    importProgressRef.current = null;
    setImportProgress(null);
    setImportSaveReport(null);
    setPendingImport(nextImport);
  }

  function closeImport(force = false) {
    if (importProcessingRef.current && !force) return;
    if (pendingImport) releaseArchivePages(pendingImport.pages);
    importAbortControllerRef.current?.abort();
    importAbortControllerRef.current = null;
    if (importProgressTimerRef.current !== null) {
      window.clearTimeout(importProgressTimerRef.current);
      importProgressTimerRef.current = null;
    }
    pendingImportRef.current = null;
    savedImportResultIdsRef.current = new Set();
    importResultAssetIdsRef.current = new Map();
    preparedStoryboardCropsRef.current.clear();
    importProgressRef.current = null;
    setImportProgress(null);
    setImportSaveReport(null);
    setPendingImport(null);
  }

  function stableImportAssetId(resultId: string) {
    const existing = importResultAssetIdsRef.current.get(resultId);
    if (existing) return existing;
    const assetId = createArchiveUuid();
    importResultAssetIdsRef.current.set(resultId, assetId);
    return assetId;
  }

  async function saveStoryboardImport(
    value: ArchiveImportCommit,
    currentImport: PendingImport
  ): Promise<ArchiveImportSaveReport> {
    if (!projectId) {
      return {
        total: value.results.length,
        succeededResultIds: [],
        failures: value.results.map((result) => ({
          resultId: result.id,
          cropIndex: result.orderIndex + 1,
          label: result.page.name,
          message: "프로젝트를 찾을 수 없습니다."
        }))
      };
    }

    const operationStartedAt = archivePerformanceNow();
    const pendingResults = value.results.filter(
      (result) => !savedImportResultIdsRef.current.has(result.id)
    );
    const isMobile = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
    const hardwareConcurrency = Math.max(1, navigator.hardwareConcurrency || 4);
    const cropConcurrency = Math.max(
      1,
      Math.min(isMobile ? 2 : 3, Math.floor(hardwareConcurrency / 2))
    );
    const uploadWindowSize = isMobile ? 4 : 8;
    const abortController = new AbortController();
    importAbortControllerRef.current?.abort();
    importAbortControllerRef.current = abortController;

    const failuresById = new Map<string, ArchiveImportSaveFailure>();
    const uploadedAssets: ProjectReferenceAsset[] = [];
    const preparedIds = new Set(savedImportResultIdsRef.current);
    const croppedIds = new Set(savedImportResultIdsRef.current);
    const uploadedIds = new Set(savedImportResultIdsRef.current);
    const savedIds = new Set(savedImportResultIdsRef.current);
    for (const result of pendingResults) {
      if (!preparedStoryboardCropsRef.current.has(result.id)) continue;
      preparedIds.add(result.id);
      croppedIds.add(result.id);
    }
    const timings: StoryboardImportTimings = {
      sourcePrepareMs: 0,
      cropPipelineMs: 0,
      cropDrawMs: 0,
      imageEncodeMs: 0,
      requestMs: 0,
      storageUploadMs: 0,
      databaseMs: 0,
      archiveUpdateMs: 0,
      totalMs: 0,
      sourceDecodeCount: 0,
      cropCount: pendingResults.length,
      requestCount: 0,
      cropConcurrency,
      uploadWindowSize
    };
    startImportProgress(value.results.length, currentImport.importBatchId, savedIds.size);
    updateImportProgress({
      preparedCount: preparedIds.size,
      croppedCount: croppedIds.size,
      uploadedCount: uploadedIds.size,
      savedCount: savedIds.size
    }, true);
    setProgressMessage("");
    await yieldArchiveProcessingTask();

    const pageGroups = new Map<string, typeof pendingResults>();
    for (const result of pendingResults) {
      const key = `${result.page.sourceFileIndex}:${result.page.id}`;
      pageGroups.set(key, [...(pageGroups.get(key) ?? []), result]);
    }

    function failureFor(
      result: (typeof pendingResults)[number],
      message: string
    ): ArchiveImportSaveFailure {
      const inherited = inheritedArchiveMetadata(currentImport, result.page.sourceFileIndex);
      return {
        resultId: result.id,
        cropIndex: result.orderIndex + 1,
        label: pageTitle(
          value.title || inherited.displayName,
          result.orderIndex,
          value.results.length
        ) || result.page.name,
        message
      };
    }

    try {
      for (const groupResults of pageGroups.values()) {
        if (abortController.signal.aborted) throw new DOMException("작업이 취소되었습니다.", "AbortError");
        const uncachedResults = groupResults.filter(
          (result) => !preparedStoryboardCropsRef.current.has(result.id)
        );
        let session: Awaited<ReturnType<typeof createArchiveCropSession>> | null = null;

        try {
          if (uncachedResults.length > 0) {
            const sourceStartedAt = archivePerformanceNow();
            updateImportProgress({ phase: "preparing" });
            try {
              session = await createArchiveCropSession(groupResults[0].page);
              timings.sourceDecodeCount += 1;
              for (const result of uncachedResults) preparedIds.add(result.id);
              updateImportProgress({
                preparedCount: preparedIds.size,
                failedCount: failuresById.size
              });
            } catch (error) {
              const message = errorMessageOf(error, "원본 이미지를 준비하지 못했습니다.");
              for (const result of uncachedResults) {
                failuresById.set(result.id, failureFor(result, message));
              }
            } finally {
              timings.sourcePrepareMs += archivePerformanceNow() - sourceStartedAt;
            }
          }

          for (let offset = 0; offset < groupResults.length; offset += uploadWindowSize) {
            if (abortController.signal.aborted) {
              throw new DOMException("작업이 취소되었습니다.", "AbortError");
            }
            const windowResults = groupResults.slice(offset, offset + uploadWindowSize)
              .filter((result) => !failuresById.has(result.id));
            if (windowResults.length === 0) continue;

            updateImportProgress({ phase: "cropping" });
            const cropStartedAt = archivePerformanceNow();
            const preparation = await mapSettledWithConcurrency(
              windowResults,
              cropConcurrency,
              async (result) => {
                if (abortController.signal.aborted) {
                  throw new DOMException("작업이 취소되었습니다.", "AbortError");
                }
                const cached = preparedStoryboardCropsRef.current.get(result.id);
                if (cached) return { result, files: cached, wasCached: true };
                if (!result.crop) throw new Error("crop 범위가 없습니다.");
                if (!session) throw new Error("crop 원본을 준비하지 못했습니다.");
                const inherited = inheritedArchiveMetadata(currentImport, result.page.sourceFileIndex);
                const baseTitle = value.title || inherited.displayName || "콘티";
                const displayName = pageTitle(baseTitle, result.orderIndex, value.results.length)
                  || `콘티_${String(result.orderIndex + 1).padStart(2, "0")}`;
                const files = await session.createFiles(result.crop, `${displayName}.jpg`);
                preparedStoryboardCropsRef.current.set(result.id, files);
                return { result, files, wasCached: false };
              }
            );
            timings.cropPipelineMs += archivePerformanceNow() - cropStartedAt;

            const preparedWindow: Array<{
              result: (typeof pendingResults)[number];
              files: PreparedStoryboardCrop;
            }> = [];
            for (const item of preparation) {
              if (item.status === "fulfilled") {
                croppedIds.add(item.value.result.id);
                preparedWindow.push(item.value);
                if (!item.value.wasCached) {
                  timings.cropDrawMs += item.value.files.timings?.cropDrawMs ?? 0;
                  timings.imageEncodeMs += item.value.files.timings?.imageEncodeMs ?? 0;
                }
                failuresById.delete(item.value.result.id);
                continue;
              }
              const result = windowResults[item.index];
              failuresById.set(
                result.id,
                failureFor(result, errorMessageOf(item.reason, "crop 이미지를 만들지 못했습니다."))
              );
            }
            updateImportProgress({
              phase: "optimizing",
              croppedCount: croppedIds.size,
              failedCount: failuresById.size
            });
            if (preparedWindow.length === 0) continue;

            const bulkItems: StoryboardCropBulkUploadItem[] = preparedWindow.map(({ result, files }) => {
              const inherited = inheritedArchiveMetadata(currentImport, result.page.sourceFileIndex);
              const baseTitle = value.title || inherited.displayName || "콘티";
              const displayName = pageTitle(baseTitle, result.orderIndex, value.results.length)
                || `콘티_${String(result.orderIndex + 1).padStart(2, "0")}`;
              const sourceFile = currentImport.sourceFiles[result.page.sourceFileIndex];
              const sourceIsPdf = sourceFile
                ? isPdfFile(sourceFile)
                : currentImport.sourceKind === "pdf";
              return {
                clientResultId: result.id,
                file: files.displayFile,
                thumbnailFile: files.thumbnailFile,
                metadata: {
                  assetId: stableImportAssetId(result.id),
                  sourceType: sourceIsPdf ? "pdf_crop" : "image_crop",
                  sourceAssetId: currentImport.existingSourceAssetIds?.[result.page.sourceFileIndex] || undefined,
                  pageIndex: result.page.index,
                  groupId: currentImport.importBatchId,
                  folderId: null,
                  originalFolderName: currentImport.fileMetadata[result.page.sourceFileIndex]?.originalFolderName,
                  relativePath: currentImport.fileMetadata[result.page.sourceFileIndex]?.relativePath,
                  ...cropMetadata(result.crop, result.page, value.cropTemplate),
                  cropOrderIndex: result.orderIndex,
                  cropIndex: result.orderIndex + 1,
                  displayName,
                  originalFilename: files.displayFile.name,
                  sourceFilename: sourceFile?.name || inherited.originalFilename || result.page.name,
                  sourceKind: sourceIsPdf ? "pdf" : "image",
                  sourcePageNumber: result.page.index + 1,
                  importBatchId: currentImport.importBatchId,
                  templateId: result.templateId || value.cropTemplate?.templateId,
                  manuallyPositioned: result.manuallyPositioned,
                  customSize: result.customSize,
                  title: displayName,
                  memo: value.memo,
                  episodeNumber: inherited.episodeNumber ?? undefined,
                  sceneId: undefined,
                  sceneNumber: "",
                  sceneNo: "",
                  cutNo: "",
                  sortOrder: currentImport.baseSortOrder + result.orderIndex
                }
              };
            });

            updateImportProgress({ phase: "uploading" });
            const bulkResult = await uploadStoryboardCropAssetsBulk(projectId, bulkItems, {
              signal: abortController.signal
            });
            timings.requestMs += bulkResult.timings.requestMs;
            timings.storageUploadMs += bulkResult.timings.uploadMs;
            timings.databaseMs += bulkResult.timings.databaseMs;
            timings.requestCount += bulkResult.timings.requestCount;
            updateImportProgress({ phase: "saving" });

            for (const result of bulkResult.results) {
              const sourceResult = windowResults.find((entry) => entry.id === result.clientResultId);
              if (!sourceResult) continue;
              if ((result.status === "saved" || result.status === "existing") && result.asset) {
                savedImportResultIdsRef.current.add(sourceResult.id);
                savedIds.add(sourceResult.id);
                uploadedIds.add(sourceResult.id);
                uploadedAssets.push(result.asset);
                failuresById.delete(sourceResult.id);
                preparedStoryboardCropsRef.current.delete(sourceResult.id);
                continue;
              }
              failuresById.set(
                sourceResult.id,
                failureFor(
                  sourceResult,
                  result.error || "crop 결과를 업로드하거나 저장하지 못했습니다."
                )
              );
            }
            if (bulkResult.storageCleanupWarning) {
              setErrorMessage(bulkResult.storageCleanupWarning);
            }
            updateImportProgress({
              uploadedCount: uploadedIds.size,
              savedCount: savedIds.size,
              failedCount: failuresById.size
            });
          }
        } finally {
          session?.close();
        }
      }
    } catch (error) {
      const message = errorMessageOf(error, "콘티 crop 묶음 처리를 완료하지 못했습니다.");
      for (const result of pendingResults) {
        if (savedImportResultIdsRef.current.has(result.id) || failuresById.has(result.id)) continue;
        failuresById.set(result.id, failureFor(result, message));
      }
    }

    updateImportProgress({
      phase: "finalizing",
      uploadedCount: uploadedIds.size,
      savedCount: savedIds.size,
      failedCount: failuresById.size
    }, true);
    const archiveUpdateStartedAt = archivePerformanceNow();
    mergeUploadedAssets(uploadedAssets);
    timings.archiveUpdateMs += archivePerformanceNow() - archiveUpdateStartedAt;
    timings.totalMs = archivePerformanceNow() - operationStartedAt;

    const failures = [...failuresById.values()]
      .sort((left, right) => left.cropIndex - right.cropIndex);
    const report: ArchiveImportSaveReport = {
      total: value.results.length,
      succeededResultIds: [...savedImportResultIdsRef.current],
      failures
    };
    setImportSaveReport(report);
    setProgressMessage("");
    logStoryboardImportTimings(timings, report);

    if (report.succeededResultIds.length === report.total && failures.length === 0) {
      updateImportProgress({
        phase: "complete",
        preparedCount: report.total,
        croppedCount: report.total,
        uploadedCount: report.total,
        savedCount: report.total,
        failedCount: 0,
        overallPercent: 100
      }, true);
      setStatusMessage(`${report.total}개 콘티를 추출했습니다.`);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
      closeImport(true);
    } else {
      updateImportProgress({
        phase: "error",
        savedCount: report.succeededResultIds.length,
        failedCount: failures.length
      }, true);
      setErrorMessage(
        `콘티 ${report.succeededResultIds.length}/${report.total}개 저장 · ${failures.length}개 실패`
      );
    }
    return report;
  }

  async function saveImport(value: ArchiveImportCommit): Promise<ArchiveImportSaveReport> {
    if (!projectId || !pendingImport || isSaving || importProcessingRef.current) {
      return { total: value.results.length, succeededResultIds: [], failures: [] };
    }
    importProcessingRef.current = true;
    setIsSaving(true);
    setErrorMessage("");
    if (pendingImport.assetType === "storyboard") {
      try {
        return await saveStoryboardImport(value, pendingImport);
      } finally {
        importAbortControllerRef.current = null;
        importProcessingRef.current = false;
        setIsSaving(false);
      }
    }
    const batchId = pendingImport.importBatchId;
    const savedAssets: ProjectReferenceAsset[] = [];
    try {
      if (pendingImport.sourceKind === "pdf") {
        const sourceAssetsByIndex = new Map<number, string>();
        const sourceUploadFailures: ArchiveUploadFailure[] = [];
        for (let fileIndex = 0; fileIndex < pendingImport.sourceFiles.length; fileIndex += 1) {
          const sourceFile = pendingImport.sourceFiles[fileIndex];
          const existingSourceId = pendingImport.existingSourceAssetIds?.[fileIndex];
          if (existingSourceId) {
            sourceAssetsByIndex.set(fileIndex, existingSourceId);
            continue;
          }
          const sourceMetadata = pendingImport.fileMetadata[fileIndex];
          setProgressMessage(`원본 PDF 보존 ${fileIndex + 1}/${pendingImport.sourceFiles.length}`);
          try {
            const original = await uploadProjectReferenceAsset(projectId, pendingImport.assetType, sourceFile, {
              sourceType: "upload_pdf",
              groupId: `source:${batchId}`,
              folderId: null,
              displayName: value.title || stripArchiveExtension(sourceFile.name),
              originalFilename: sourceFile.name,
              originalFolderName: sourceMetadata?.originalFolderName,
              relativePath: sourceMetadata?.relativePath,
              title: value.title,
              memo: value.memo,
              sceneId: undefined,
              sceneNumber: "",
              sceneNo: "",
              cutNo: ""
            });
            sourceAssetsByIndex.set(fileIndex, original.id);
            savedAssets.push(original);
          } catch (error) {
            sourceUploadFailures.push({
              path: sourceMetadata?.relativePath || sourceFile.name,
              message: errorMessageOf(error, "원본 PDF를 보존하지 못했습니다.")
            });
          }
        }
        const visibleTasks = [
          ...value.results.map((result) => ({
            kind: "pdf-result" as const,
            sourceOrderIndex: pendingImport.sourceOrderIndexes?.[result.page.sourceFileIndex]
              ?? result.page.sourceFileIndex,
            withinSourceOrder: result.page.index,
            result
          })),
          ...(pendingImport.deferredImageSources ?? []).map((source) => ({
            kind: "image" as const,
            sourceOrderIndex: source.sourceOrderIndex,
            withinSourceOrder: 0,
            source
          }))
        ].sort((left, right) => (
          left.sourceOrderIndex - right.sourceOrderIndex
          || left.withinSourceOrder - right.withinSourceOrder
        ));
        let completed = 0;
        const settled = await mapSettledWithConcurrency(visibleTasks, 3, async (task, taskIndex) => {
          if (task.kind === "image") {
            const { file, metadata } = task.source;
            setProgressMessage(`이미지 최적화 중 · ${file.name}`);
            const optimized = await optimizeArchiveImage(file);
            const saved = await uploadProjectReferenceAsset(projectId, pendingImport.assetType, optimized.displayFile, {
              thumbnailFile: optimized.thumbnailFile,
              sourceType: "upload_image",
              groupId: batchId,
              folderId: null,
              displayName: stripArchiveExtension(file.name),
              originalFilename: file.name,
              originalFolderName: metadata.originalFolderName,
              relativePath: metadata.relativePath,
              sortOrder: pendingImport.baseSortOrder + taskIndex
            });
            completed += 1;
            setProgressMessage(`저장 중 ${completed}/${visibleTasks.length}`);
            return { kind: task.kind, saved, source: task.source };
          }

          const { result } = task;
          const { page, crop } = result;
          setProgressMessage(`crop 이미지 생성 중 ${taskIndex + 1}/${visibleTasks.length}`);
          const resultFile = crop
            ? await createCroppedArchiveFile(page, crop, page.name)
            : new File([page.blob], page.name, { type: "image/jpeg" });
          setProgressMessage(`썸네일 생성 중 ${taskIndex + 1}/${visibleTasks.length}`);
          const thumbnailFile = await createArchiveThumbnail(resultFile);
          const inherited = inheritedArchiveMetadata(pendingImport, page.sourceFileIndex);
          const saved = await uploadProjectReferenceAsset(projectId, pendingImport.assetType, resultFile, {
            thumbnailFile,
            sourceType: crop ? "pdf_crop" : "pdf_page",
            sourceAssetId: sourceAssetsByIndex.get(page.sourceFileIndex),
            pageIndex: page.index,
            groupId: batchId,
            folderId: null,
            originalFolderName: pendingImport.fileMetadata[page.sourceFileIndex]?.originalFolderName,
            relativePath: pendingImport.fileMetadata[page.sourceFileIndex]?.relativePath,
            ...cropMetadata(crop, page, value.cropTemplate),
            cropOrderIndex: taskIndex,
            cropIndex: taskIndex + 1,
            displayName: pageTitle(value.title || inherited.displayName, taskIndex, visibleTasks.length),
            originalFilename: inherited.originalFilename || pendingImport.sourceFiles[page.sourceFileIndex]?.name,
            title: pageTitle(value.title || inherited.displayName, taskIndex, visibleTasks.length),
            memo: value.memo,
            episodeNumber: inherited.episodeNumber ?? undefined,
            sceneId: undefined,
            sceneNumber: "",
            sceneNo: "",
            cutNo: "",
            sortOrder: pendingImport.baseSortOrder + taskIndex
          });
          completed += 1;
          setProgressMessage(`저장 중 ${completed}/${visibleTasks.length}`);
          return { kind: task.kind, saved, result };
        });

        const succeededResultIds: string[] = [];
        const resultFailures: ArchiveImportSaveFailure[] = [];
        const imageUploadFailures: ArchiveUploadFailure[] = [];
        let visibleSuccessCount = 0;
        settled.forEach((outcome, taskIndex) => {
          const task = visibleTasks[taskIndex];
          if (outcome.status === "fulfilled") {
            savedAssets.push(outcome.value.saved);
            visibleSuccessCount += 1;
            if (outcome.value.kind === "pdf-result") {
              succeededResultIds.push(outcome.value.result.id);
            }
            return;
          }
          if (task.kind === "image") {
            imageUploadFailures.push({
              path: task.source.metadata.relativePath || task.source.file.name,
              message: errorMessageOf(outcome.reason, "이미지를 업로드하지 못했습니다.")
            });
            return;
          }
          resultFailures.push({
            resultId: task.result.id,
            cropIndex: task.result.orderIndex + 1,
            label: task.result.page.name,
            message: errorMessageOf(outcome.reason, "PDF 페이지를 저장하지 못했습니다.")
          });
        });

        mergeUploadedAssets(savedAssets);
        closeImport(true);
        setProgressMessage("");
        const allUploadFailures = [
          ...sourceUploadFailures,
          ...imageUploadFailures,
          ...resultFailures.map((failure) => ({
            path: failure.label,
            message: failure.message
          }))
        ];
        if (allUploadFailures.length > 0) {
          setUploadFailures((current) => sortArchiveUploadFailures([
            ...current,
            ...allUploadFailures
          ]));
        }
        const report: ArchiveImportSaveReport = {
          total: value.results.length,
          succeededResultIds,
          failures: resultFailures
        };
        const totalFailures = allUploadFailures.length;
        setStatusMessage(
          `업로드 완료 · ${visibleSuccessCount}개 성공`
          + (totalFailures > 0 ? ` · ${totalFailures}개 실패` : "")
        );
        if (totalFailures > 0) {
          setErrorMessage(`${visibleSuccessCount}개는 저장됐지만 ${totalFailures}개를 저장하지 못했습니다.`);
        }
        return report;
      } else if (value.results.some((result) => result.crop)) {
        const sourceAssetsByIndex = new Map<number, string>();
        for (let sourceIndex = 0; sourceIndex < pendingImport.sourceFiles.length; sourceIndex += 1) {
          const existingSourceId = pendingImport.existingSourceAssetIds?.[sourceIndex];
          if (existingSourceId) {
            sourceAssetsByIndex.set(sourceIndex, existingSourceId);
            continue;
          }
          const page = pendingImport.pages.find((entry) => entry.sourceFileIndex === sourceIndex);
          const sourceFile = page?.originalFile ?? pendingImport.sourceFiles[sourceIndex];
          if (!sourceFile) continue;
          setProgressMessage(`원본 이미지 보존 ${sourceIndex + 1}/${pendingImport.sourceFiles.length}`);
          const source = await uploadProjectReferenceAsset(projectId, pendingImport.assetType, sourceFile, {
            sourceType: "upload_image",
            groupId: `source:${batchId}`,
            folderId: null,
            displayName: value.title || stripArchiveExtension(sourceFile.name),
            originalFilename: sourceFile.name,
            originalFolderName: pendingImport.fileMetadata[sourceIndex]?.originalFolderName,
            relativePath: pendingImport.fileMetadata[sourceIndex]?.relativePath,
            title: value.title,
            memo: value.memo,
            sceneId: undefined,
            sceneNumber: "",
            sceneNo: "",
            cutNo: ""
          });
          sourceAssetsByIndex.set(sourceIndex, source.id);
          savedAssets.push(source);
        }
        const cropResults = value.results.filter((result) => result.crop);
        let completed = 0;
        await mapWithConcurrency(cropResults, 3, async (result, index) => {
          const { page, crop } = result;
          if (!crop) return;
          setProgressMessage(`crop 이미지 생성 중 ${index + 1}/${cropResults.length}`);
          const resultFile = await createCroppedArchiveFile(page, crop, page.name);
          const thumbnailFile = await createArchiveThumbnail(resultFile);
          const inherited = inheritedArchiveMetadata(pendingImport, page.sourceFileIndex);
          const saved = await uploadProjectReferenceAsset(projectId, pendingImport.assetType, resultFile, {
            thumbnailFile,
            sourceType: "image_crop",
            sourceAssetId: sourceAssetsByIndex.get(page.sourceFileIndex),
            pageIndex: page.index,
            groupId: batchId,
            folderId: null,
            originalFolderName: pendingImport.fileMetadata[page.sourceFileIndex]?.originalFolderName,
            relativePath: pendingImport.fileMetadata[page.sourceFileIndex]?.relativePath,
            ...cropMetadata(crop, page, value.cropTemplate),
            cropOrderIndex: index,
            cropIndex: index + 1,
            displayName: pageTitle(value.title || inherited.displayName, index, cropResults.length),
            originalFilename: inherited.originalFilename || pendingImport.sourceFiles[page.sourceFileIndex]?.name,
            title: pageTitle(value.title || inherited.displayName, index, cropResults.length),
            memo: value.memo,
            episodeNumber: inherited.episodeNumber ?? undefined,
            sceneId: undefined,
            sceneNumber: "",
            sceneNo: "",
            cutNo: "",
            sortOrder: pendingImport.baseSortOrder + index
          });
          savedAssets.push(saved);
          completed += 1;
          setProgressMessage(`저장 중 ${completed}/${cropResults.length}`);
        });
      } else {
        let completed = 0;
        await mapWithConcurrency(value.results, 3, async (result, index) => {
          const page = result.page;
          const displayFile = new File([page.blob], page.name, { type: "image/jpeg" });
          const thumbnailFile = await createArchiveThumbnail(displayFile);
          setProgressMessage(`업로드 중 ${index + 1}/${value.results.length}`);
          const saved = await uploadProjectReferenceAsset(projectId, pendingImport.assetType, displayFile, {
            thumbnailFile,
            sourceType: "upload_image",
            groupId: batchId,
            folderId: null,
            originalFolderName: pendingImport.fileMetadata[page.sourceFileIndex]?.originalFolderName,
            relativePath: pendingImport.fileMetadata[page.sourceFileIndex]?.relativePath,
            displayName: pageTitle(value.title || stripArchiveExtension(page.name), index, value.results.length),
            originalFilename: pendingImport.sourceFiles[page.sourceFileIndex]?.name || page.name,
            title: pageTitle(value.title, index, value.results.length),
            memo: value.memo,
            sceneId: undefined,
            sceneNumber: "",
            sceneNo: "",
            cutNo: "",
            sortOrder: pendingImport.baseSortOrder + index
          });
          savedAssets.push(saved);
          completed += 1;
          setProgressMessage(`저장 중 ${completed}/${value.results.length}`);
        });
      }
      closeImport();
      setProgressMessage("");
      mergeUploadedAssets(savedAssets);
      return {
        total: value.results.length,
        succeededResultIds: value.results.map((result) => result.id),
        failures: []
      };
    } catch (error) {
      if (savedAssets.length > 0) {
        mergeUploadedAssets(savedAssets);
        closeImport();
      }
      const detail = error instanceof Error ? error.message : "아카이브 자료를 저장하지 못했습니다.";
      setErrorMessage(
        savedAssets.length > 0
          ? `${savedAssets.length}개 자료는 저장됐지만 나머지를 저장하지 못했습니다. ${detail}`
          : detail
      );
      setProgressMessage("");
      return {
        total: value.results.length,
        succeededResultIds: [],
        failures: value.results.map((result) => ({
          resultId: result.id,
          cropIndex: result.orderIndex + 1,
          label: result.page.name,
          message: errorMessageOf(error, "아카이브 자료를 저장하지 못했습니다.")
        }))
      };
    } finally {
      importProcessingRef.current = false;
      setIsSaving(false);
    }
  }

  async function confirmPendingAction() {
    if (!projectId || !pendingConfirm || !canEdit || deleteActionInFlightRef.current) return;
    const action = pendingConfirm;
    const operationProjectId = projectId;
    const operationEpoch = archiveProjectEpochRef.current;
    deleteActionInFlightRef.current = true;
    setIsSaving(true);
    setErrorMessage("");
    let deletedCount = 0;
    const failures: string[] = [];
    let remainingAssetIds: string[] = [];
    const remainingDiagrams: OverheadDiagramArchiveItem[] = [];
    const warnings: string[] = [];
    try {
      if (action.assetIds.length > 0) {
        for (const assetId of action.assetIds) deletedAssetIdsRef.current.add(assetId);
        const assetMutationKeys = action.assetIds.map((assetId) => (
          archiveAssetMutationKey(operationProjectId, assetId)
        ));
        // Tombstone first, then wait for older metadata/reorder work on these assets.
        // This lets deletion lock the group that is actually committed on the server.
        await archiveMutationQueueRef.current.enqueue(assetMutationKeys, async () => undefined);
        if (!archiveOperationIsCurrent(operationProjectId, operationEpoch)) return;
        const deletingGroupKeys = new Set(action.assetIds.flatMap((assetId) => {
          const committed = committedPlacementByAssetIdRef.current.get(assetId);
          if (committed) return [archiveOrderGroupKey(committed.sceneId, committed.cutNumber)];
          const asset = archiveAssetsRef.current.find((entry) => entry.id === assetId);
          return asset ? [archiveAssetOrderGroupKey(asset)] : [];
        }));
        const deleteGroupVersions = nextGroupOperationVersions(deletingGroupKeys);
        try {
          const result = await archiveMutationQueueRef.current.enqueue(
            [
              ...assetMutationKeys,
              ...[...deletingGroupKeys].map((groupKey) => archiveGroupMutationKey(operationProjectId, groupKey))
            ],
            () => deleteProjectReferenceAssets(operationProjectId, action.assetIds)
          );
          if (!archiveOperationIsCurrent(operationProjectId, operationEpoch)) return;
          removeAssetsFromLocalState(action.assetIds);
          commitOrderUpdates(result.orders);
          if (groupOperationVersionsAreCurrent(deleteGroupVersions)) applyOrderUpdates(result.orders);
          deletedCount += action.assetIds.length;
          if (result.storageCleanupWarning) warnings.push(result.storageCleanupWarning);
          if (result.orderNormalizationWarning) warnings.push(result.orderNormalizationWarning);
        } catch (error) {
          if (!archiveOperationIsCurrent(operationProjectId, operationEpoch)) return;
          for (const assetId of action.assetIds) deletedAssetIdsRef.current.delete(assetId);
          if (groupOperationVersionsAreCurrent(deleteGroupVersions)) {
            setCombinedArchiveAssets(restoreCommittedArchivePlacements(
              archiveAssetsRef.current,
              deletingGroupKeys
            ));
          }
          remainingAssetIds = [...action.assetIds];
          failures.push(error instanceof Error ? error.message : "선택한 이미지를 삭제하지 못했습니다.");
        }
      }
      if (action.diagrams.length > 0) {
        try {
          await deleteOverheadDiagramArchives(operationProjectId, action.diagrams.map((item) => item.id));
          if (!archiveOperationIsCurrent(operationProjectId, operationEpoch)) return;
          removeDiagramsFromLocalState(action.diagrams.map((item) => item.id));
          deletedCount += action.diagrams.length;
        } catch (error) {
          if (!archiveOperationIsCurrent(operationProjectId, operationEpoch)) return;
          remainingDiagrams.push(...action.diagrams);
          failures.push(error instanceof Error ? error.message : "부감도를 삭제하지 못했습니다.");
        }
      }
      if (!archiveOperationIsCurrent(operationProjectId, operationEpoch)) return;
      if (failures.length === 0) {
        setPendingConfirm(null);
        clearSelection();
        setStatusMessage(`${deletedCount}개 항목을 삭제했습니다.`);
        if (warnings.length > 0) setErrorMessage(warnings.join(" · "));
      } else {
        setPendingConfirm({
          ...action,
          assetIds: remainingAssetIds,
          diagrams: remainingDiagrams,
          linkedAssetCount: remainingAssetIds.length > 0 ? action.linkedAssetCount : 0,
          label: remainingAssetIds.length + remainingDiagrams.length === 1
            ? action.label
            : `삭제하지 못한 ${remainingAssetIds.length + remainingDiagrams.length}개 항목`
        });
        setSelectionMode(selectedKeysRef.current.size > 0);
        setErrorMessage([
          deletedCount > 0 ? `${deletedCount}개 삭제됨` : "",
          `${failures.length}개 삭제 실패`,
          failures[0]
        ].filter(Boolean).join(" · "));
      }
    } finally {
      if (archiveOperationIsCurrent(operationProjectId, operationEpoch)) {
        deleteActionInFlightRef.current = false;
        setIsSaving(false);
      }
    }
  }

  async function requestDraggedAssetDelete(assetId: string) {
    if (!projectId || !canEdit || pendingDeleteAssetRef.current || pendingConfirm) return;
    const operationProjectId = projectId;
    const operationEpoch = archiveProjectEpochRef.current;
    const asset = archiveAssetsRef.current.find((entry) => entry.id === assetId);
    if (!asset) {
      setErrorMessage("삭제할 이미지를 찾을 수 없습니다.");
      return;
    }
    const pending = { id: asset.id, label: archiveDisplayName(asset) };
    pendingDeleteAssetRef.current = pending;
    setPendingDeleteAsset(pending);
    setErrorMessage("");
    try {
      const inspection = await inspectProjectReferenceAssets(operationProjectId, [pending.id]);
      if (!archiveOperationIsCurrent(operationProjectId, operationEpoch)) return;
      if (pendingDeleteAssetRef.current?.id !== pending.id) return;
      setPendingConfirm({
        assetIds: [pending.id],
        diagrams: [],
        linkedAssetCount: inspection.linkedAssetCount,
        label: pending.label,
        message: [
          "이 이미지를 삭제하시겠습니까? 삭제한 이미지는 복구할 수 없습니다.",
          inspection.linkedAssetCount > 0
            ? "진행도에 연결된 파일의 연결도 함께 해제됩니다."
            : ""
        ].filter(Boolean).join(" ")
      });
    } catch (error) {
      if (!archiveOperationIsCurrent(operationProjectId, operationEpoch)) return;
      if (pendingDeleteAssetRef.current?.id === pending.id) {
        setErrorMessage(error instanceof Error ? error.message : "삭제할 이미지를 확인하지 못했습니다.");
      }
    } finally {
      if (
        archiveOperationIsCurrent(operationProjectId, operationEpoch)
        && pendingDeleteAssetRef.current?.id === pending.id
      ) {
        pendingDeleteAssetRef.current = null;
        setPendingDeleteAsset(null);
      }
    }
  }

  function updateSelectedKeys(
    update: (current: Set<ArchiveSelectionKey>) => Set<ArchiveSelectionKey>
  ) {
    const next = update(selectedKeysRef.current);
    selectedKeysRef.current = next;
    setSelectedKeys(next);
  }

  function toggleArchiveSelection(
    kind: ArchiveSelectionKind,
    id: string,
    additive = true
  ) {
    const key = archiveSelectionKey(kind, id);
    updateSelectedKeys((current) => {
      const next = additive ? new Set(current) : new Set<ArchiveSelectionKey>();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleCurrentAssetScope() {
    if (scopeSelectionKeys.length === 0) return;
    updateSelectedKeys((current) => {
      const next = new Set(current);
      if (scopeSelectionKeys.every((key) => current.has(key))) {
        for (const key of scopeSelectionKeys) next.delete(key);
      } else {
        for (const key of scopeSelectionKeys) next.add(key);
      }
      return next;
    });
    setSelectionMode(true);
  }

  async function deleteSelectedAssets() {
    if (!projectId || selectedKeys.size === 0 || deleteInspectionInFlightRef.current) return;
    const operationProjectId = projectId;
    const operationEpoch = archiveProjectEpochRef.current;
    setErrorMessage("");
    deleteInspectionInFlightRef.current = true;
    try {
      const assetInspection = selectedReferenceAssetIds.length > 0
        ? await inspectProjectReferenceAssets(operationProjectId, selectedReferenceAssetIds)
        : null;
      if (!archiveOperationIsCurrent(operationProjectId, operationEpoch)) return;
      setPendingConfirm({
        assetIds: selectedReferenceAssetIds,
        diagrams: selectedDiagramItems,
        linkedAssetCount: assetInspection?.linkedAssetCount ?? 0,
        label: selectedCount ? `선택한 ${selectedCount}개 항목` : "선택한 항목"
      });
    } catch (error) {
      if (!archiveOperationIsCurrent(operationProjectId, operationEpoch)) return;
      setErrorMessage(error instanceof Error ? error.message : "삭제할 자료를 확인하지 못했습니다.");
    } finally {
      if (archiveOperationIsCurrent(operationProjectId, operationEpoch)) {
        deleteInspectionInFlightRef.current = false;
      }
    }
  }

  function clearSelection() {
    selectedKeysRef.current = new Set();
    setSelectedKeys(new Set());
    setSelectionMode(false);
  }

  function editSingleSelectedItem() {
    if (selectedCount !== 1) return;
    const selectedAsset = [...overheads, ...storyboards]
      .find((asset) => selectedKeys.has(archiveSelectionKey("asset", asset.id)));
    if (selectedAsset) {
      openMetadata(selectedAsset);
      return;
    }
    const selectedDiagram = diagramArchives.find((item) => (
      !item.legacy && selectedKeys.has(archiveSelectionKey("diagram", item.id))
    ));
    if (selectedDiagram) {
      clearSelection();
      openDiagram(selectedDiagram, true);
    }
  }

  function renameSingleSelectedAsset() {
    if (!singleSelectedReferenceAsset) return;
    setRenamingAsset(singleSelectedReferenceAsset);
    setRenameDraft(archiveDisplayName(singleSelectedReferenceAsset));
    setRenameError("");
  }

  function toggleSelectionMode() {
    cancelArchivePointerSession();
    cancelActiveReorderDrag();
    exitReorderMode();
    if (selectionMode) {
      clearSelection();
      return;
    }
    setSelectionMode(true);
  }

  function updateCollapsedScenes(
    update: (current: Set<string>) => Set<string>
  ) {
    const next = update(collapsedSceneKeysRef.current);
    collapsedSceneKeysRef.current = next;
    setCollapsedSceneKeys(next);
  }

  function toggleSceneCollapsed(sceneKey: string) {
    if (
      reorderModeGroupKey
      && archiveSceneKeyFromOrderGroupKey(reorderModeGroupKey) === sceneKey
    ) {
      cancelActiveReorderDrag();
      exitReorderMode();
    }
    updateCollapsedScenes((current) => {
      const next = new Set(current);
      if (next.has(sceneKey)) next.delete(sceneKey);
      else next.add(sceneKey);
      return next;
    });
  }

  function expandScene(sceneKey: string) {
    if (!collapsedSceneKeysRef.current.has(sceneKey)) return;
    updateCollapsedScenes((current) => {
      const next = new Set(current);
      next.delete(sceneKey);
      return next;
    });
  }

  function openNewDiagram() {
    setDiagramDraft({
      item: null,
      title: "새 부감도",
      memo: "",
      sceneNo: "",
      cutNo: "",
      shot: createArchiveShot(projectId, null)
    });
  }

  function openDiagram(item: OverheadDiagramArchiveItem, edit: boolean) {
    if (edit && item.legacy) return;
    setDiagramDraft({
      item,
      title: item.title,
      memo: item.memo,
      sceneNo: item.sceneNo,
      cutNo: item.cutNo,
      shot: createArchiveShot(projectId, item)
    });
  }

  async function saveDiagram(diagram: ShotOverheadDiagram) {
    if (!diagramDraft || !projectId) return;
    setIsSaving(true);
    try {
      const saved = await saveOverheadDiagramArchive(projectId, diagram, {
        id: diagramDraft.item?.legacy ? undefined : diagramDraft.item?.id,
        title: diagramDraft.title,
        memo: diagramDraft.memo,
        sceneNo: diagramDraft.sceneNo,
        cutNo: diagramDraft.cutNo
      });
      setDiagramArchives((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setDiagramDraft(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "부감도를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  function cancelArchivePointerSession() {
    const current = longPressRef.current;
    if (current) {
      window.clearTimeout(current.timeoutId);
      try {
        if (current.target.hasPointerCapture(current.pointerId)) {
          current.target.releasePointerCapture(current.pointerId);
        }
      } catch {
        // The browser may already have released capture after pointercancel.
      }
      current.target.style.touchAction = current.previousTouchAction;
    }
    longPressRef.current = null;
    setPressedSelectionKey(null);
    assetPressCleanupRef.current?.();
  }

  function scheduleArchiveClickSuppressionRelease(assetId: string) {
    const suppressedKey = archiveSelectionKey("asset", assetId);
    window.setTimeout(() => {
      if (suppressArchiveClickRef.current === suppressedKey) {
        suppressArchiveClickRef.current = null;
      }
    }, 700);
  }

  function cancelActiveReorderDrag() {
    const current = reorderSessionRef.current;
    if (!current) {
      setIsOverDeleteZone(false);
      return;
    }
    reorderSessionRef.current = null;
    reorderPointerCleanupRef.current?.();
    try {
      if (current.handle.hasPointerCapture(current.pointerId)) {
        current.handle.releasePointerCapture(current.pointerId);
      }
    } catch {
      // The browser may release capture before pointercancel or orientation changes.
    }
    current.handle.style.touchAction = current.previousTouchAction;
    if (current.autoScrollFrame !== null) window.cancelAnimationFrame(current.autoScrollFrame);
    if (current.moved) {
      setCombinedArchiveAssets(reorderArchiveAssetsByIds(
        archiveAssetsRef.current,
        current.completeOriginalIds
      ));
    }
    setReorderVisual(null);
    setReorderOverlay(null);
    setIsOverDeleteZone(false);
    scheduleArchiveClickSuppressionRelease(current.assetId);
  }

  function beginAssetReorderPress(
    assetId: string,
    sceneId: string | null,
    cutNumber: number | null,
    orderedAssetIds: string[],
    completeOrderedAssetIds: string[],
    allowReorder: boolean,
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    if (
      !canEdit
      || !projectId
      || !event.isPrimary
      || event.button !== 0
      || selectionMode
      || selectedKeysRef.current.size > 0
      || orderedAssetIds.length < 1
      || pendingDeleteAssetRef.current !== null
      || reorderSessionRef.current !== null
    ) return;
    const groupKey = archiveOrderGroupKey(sceneId, cutNumber);
    if (pendingReorderGroupKeysRef.current.has(groupKey)) return;

    cancelArchivePointerSession();
    assetPressCleanupRef.current?.();
    if (editingAsset) closeMetadata();

    const key = archiveSelectionKey("asset", assetId);
    const press: ArchivePointerSession = {
      key,
      assetId,
      groupKey,
      sceneId,
      cutNumber,
      orderedAssetIds: [...orderedAssetIds],
      completeOrderedAssetIds: [...completeOrderedAssetIds],
      allowReorder,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
      longPressed: false,
      timeoutId: 0,
      target: event.currentTarget,
      previousTouchAction: event.currentTarget.style.touchAction
    };

    if (reorderModeGroupKey === groupKey) {
      event.preventDefault();
      event.stopPropagation();
      suppressArchiveClickRef.current = key;
      startAssetOrderDrag(press);
      return;
    }

    setPressedSelectionKey(key);
    press.timeoutId = window.setTimeout(() => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== press.pointerId) return;
      current.longPressed = true;
      suppressArchiveClickRef.current = current.key;
      enterReorderMode(current.groupKey);
      if (navigator.vibrate) navigator.vibrate(18);
      startAssetOrderDrag(current);
    }, LONG_PRESS_MS);
    longPressRef.current = press;

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      current.latestX = pointerEvent.clientX;
      current.latestY = pointerEvent.clientY;
      const distance = Math.hypot(
        pointerEvent.clientX - current.startX,
        pointerEvent.clientY - current.startY
      );
      if (distance > LONG_PRESS_MOVE_TOLERANCE) cancelArchivePointerSession();
    };
    const finishPointerPress = (pointerEvent: PointerEvent) => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      cancelArchivePointerSession();
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishPointerPress);
      document.removeEventListener("pointercancel", finishPointerPress);
      window.removeEventListener("blur", cancelArchivePointerSession);
      assetPressCleanupRef.current = null;
    };
    assetPressCleanupRef.current = cleanup;
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", finishPointerPress);
    document.addEventListener("pointercancel", finishPointerPress);
    window.addEventListener("blur", cancelArchivePointerSession);
  }

  function startAssetOrderDrag(press: ArchivePointerSession) {
    if (!projectId || reorderSessionRef.current) return;
    window.clearTimeout(press.timeoutId);
    assetPressCleanupRef.current?.();
    longPressRef.current = null;
    setPressedSelectionKey(null);
    reorderPointerCleanupRef.current?.();
    const handle = press.target;
    const rect = handle.getBoundingClientRect();
    handle.style.touchAction = "none";
    const session: ArchiveReorderSession = {
      pointerId: press.pointerId,
      assetId: press.assetId,
      groupKey: press.groupKey,
      sceneId: press.sceneId,
      cutNumber: press.cutNumber,
      allowReorder: press.allowReorder,
      originalIds: [...press.orderedAssetIds],
      currentIds: [...press.orderedAssetIds],
      completeOriginalIds: [...press.completeOrderedAssetIds],
      visualTargetId: press.assetId,
      moved: false,
      validDrop: true,
      handle,
      previousTouchAction: press.previousTouchAction,
      overlayOffsetX: Math.max(0, Math.min(rect.width, press.latestX - rect.left)),
      overlayOffsetY: Math.max(0, Math.min(rect.height, press.latestY - rect.top)),
      pointerX: press.latestX,
      pointerY: press.latestY,
      activationX: press.latestX,
      activationY: press.latestY,
      hasDraggedAfterActivation: false,
      isOverDeleteZone: false,
      autoScrollFrame: null
    };
    reorderSessionRef.current = session;
    enterReorderMode(press.groupKey);
    setIsOverDeleteZone(false);
    setReorderVisual({ assetId: press.assetId, targetId: press.assetId });
    const movingAsset = archiveAssetsRef.current.find((asset) => asset.id === press.assetId);
    if (movingAsset) {
      setReorderOverlay({
        imageUrl: movingAsset.crop.thumbnailUrl || movingAsset.publicUrl,
        width: rect.width,
        height: rect.height,
        left: press.latestX - session.overlayOffsetX,
        top: press.latestY - session.overlayOffsetY
      });
    }
    try {
      handle.setPointerCapture(press.pointerId);
    } catch {
      // Document listeners keep the drag active when pointer capture is unavailable.
    }

    const updateReorderTarget = (current: ArchiveReorderSession) => {
      if (!current.allowReorder) {
        current.validDrop = false;
        if (current.visualTargetId !== null) {
          current.visualTargetId = null;
          setReorderVisual({ assetId: current.assetId, targetId: null });
        }
        return;
      }
      const targetId = findArchiveGridInsertionTarget(
        current.groupKey,
        current.currentIds,
        current.pointerX,
        current.pointerY
      );
      if (!targetId) {
        current.validDrop = false;
        if (current.visualTargetId !== null) {
          current.visualTargetId = null;
          setReorderVisual({ assetId: current.assetId, targetId: null });
        }
        return;
      }
      current.validDrop = true;
      const fromIndex = current.currentIds.indexOf(current.assetId);
      const toIndex = current.currentIds.indexOf(targetId);
      if (fromIndex === toIndex) {
        if (current.visualTargetId !== targetId) {
          current.visualTargetId = targetId;
          setReorderVisual({ assetId: current.assetId, targetId });
        }
        return;
      }
      const nextIds = moveArchiveId(current.currentIds, fromIndex, toIndex);
      const previousRects = captureArchiveCardRects(current.groupKey, current.currentIds);
      current.currentIds = nextIds;
      current.moved = true;
      current.visualTargetId = targetId;
      setCombinedArchiveAssets(reorderArchiveAssetsByIds(
        archiveAssetsRef.current,
        mergeVisibleArchiveOrderIntoCompleteGroup(current.completeOriginalIds, nextIds)
      ));
      animateArchiveGridReflow(current.groupKey, previousRects, current.assetId);
      setReorderVisual({ assetId: current.assetId, targetId });
    };

    const runAutoScroll = () => {
      const current = reorderSessionRef.current;
      if (!current) return;
      if (current.isOverDeleteZone) {
        current.autoScrollFrame = null;
        return;
      }
      const step = archiveViewportScrollStep(current.pointerY);
      if (step === 0) {
        current.autoScrollFrame = null;
        return;
      }
      window.scrollBy(0, step);
      updateReorderTarget(current);
      current.autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const current = reorderSessionRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      if (pointerEvent.cancelable) pointerEvent.preventDefault();
      moveArchiveReorderOverlay(
        reorderOverlayRef.current,
        pointerEvent.clientX - current.overlayOffsetX,
        pointerEvent.clientY - current.overlayOffsetY
      );
      current.pointerX = pointerEvent.clientX;
      current.pointerY = pointerEvent.clientY;
      if (!current.hasDraggedAfterActivation) {
        current.hasDraggedAfterActivation = Math.hypot(
          current.pointerX - current.activationX,
          current.pointerY - current.activationY
        ) >= ARCHIVE_DELETE_DRAG_THRESHOLD;
      }
      const nextOverDeleteZone = current.hasDraggedAfterActivation
        && isPointInsideArchiveDeleteDropZone(
          deleteDropZoneRef.current,
          current.pointerX,
          current.pointerY
        );
      if (current.isOverDeleteZone !== nextOverDeleteZone) {
        current.isOverDeleteZone = nextOverDeleteZone;
        setIsOverDeleteZone(nextOverDeleteZone);
      }
      if (nextOverDeleteZone) {
        if (current.autoScrollFrame !== null) {
          window.cancelAnimationFrame(current.autoScrollFrame);
          current.autoScrollFrame = null;
        }
        if (current.visualTargetId !== null) {
          current.visualTargetId = null;
          setReorderVisual({ assetId: current.assetId, targetId: null });
        }
        return;
      }
      if (current.autoScrollFrame === null && archiveViewportScrollStep(current.pointerY) !== 0) {
        current.autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
      }
      updateReorderTarget(current);
    };

    const finishPointerDrag = (pointerEvent: PointerEvent) => {
      const current = reorderSessionRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      const droppedOnDeleteZone = pointerEvent.type === "pointerup"
        && current.hasDraggedAfterActivation
        && isPointInsideArchiveDeleteDropZone(
          deleteDropZoneRef.current,
          pointerEvent.clientX,
          pointerEvent.clientY
        );
      const shouldSave = !droppedOnDeleteZone
        && pointerEvent.type === "pointerup"
        && current.validDrop
        && current.moved;
      const snapshot = {
        ...current,
        originalIds: [...current.originalIds],
        currentIds: [...current.currentIds],
        completeOriginalIds: [...current.completeOriginalIds],
        completeCurrentIds: mergeVisibleArchiveOrderIntoCompleteGroup(
          current.completeOriginalIds,
          current.currentIds
        )
      };
      reorderSessionRef.current = null;
      reorderPointerCleanupRef.current?.();
      try {
        if (current.handle.hasPointerCapture(current.pointerId)) {
          current.handle.releasePointerCapture(current.pointerId);
        }
      } catch {
        // The browser may release capture before pointercancel is delivered.
      }
      if (current.autoScrollFrame !== null) window.cancelAnimationFrame(current.autoScrollFrame);
      current.handle.style.touchAction = current.previousTouchAction;
      setReorderVisual(null);
      setReorderOverlay(null);
      setIsOverDeleteZone(false);
      scheduleArchiveClickSuppressionRelease(current.assetId);
      if (droppedOnDeleteZone) {
        if (snapshot.moved) {
          setCombinedArchiveAssets(reorderArchiveAssetsByIds(
            archiveAssetsRef.current,
            snapshot.completeOriginalIds
          ));
        }
        exitReorderMode(snapshot.groupKey);
        void requestDraggedAssetDelete(snapshot.assetId);
        return;
      }
      if (!shouldSave) {
        if (snapshot.moved) {
          setCombinedArchiveAssets(reorderArchiveAssetsByIds(
            archiveAssetsRef.current,
            snapshot.completeOriginalIds
          ));
        }
        if (!snapshot.allowReorder) exitReorderMode(snapshot.groupKey);
        return;
      }
      const groupVersion = nextGroupOperationVersions([snapshot.groupKey]).get(snapshot.groupKey)!;
      const operationProjectId = projectId;
      markReorderPending(snapshot.groupKey, groupVersion);
      void archiveMutationQueueRef.current.enqueue(
        [
          archiveGroupMutationKey(operationProjectId, snapshot.groupKey),
          ...snapshot.completeCurrentIds.map((assetId) => archiveAssetMutationKey(operationProjectId, assetId))
        ],
        async () => {
          try {
            let expectedUpdatedAtById = archiveExpectedUpdatedAtById(
              snapshot.completeCurrentIds,
              committedPlacementByAssetIdRef.current,
              archiveAssetsRef.current
            );
            let orders: ProjectReferenceAssetOrderUpdate[] | null = null;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                orders = await reorderProjectReferenceAssets(operationProjectId, {
                  sceneId: snapshot.sceneId,
                  cutNumber: snapshot.cutNumber,
                  orderedAssetIds: snapshot.completeCurrentIds,
                  expectedUpdatedAtById
                });
                break;
              } catch (error) {
                if (error instanceof ProjectReferenceAssetReorderError) {
                  commitArchiveAssetPlacements(error.assets);
                  commitOrderUpdates(error.orders);
                }
                const retryTimestamps = error instanceof ProjectReferenceAssetReorderError
                  ? archiveRetryTimestamps(snapshot.completeCurrentIds, error)
                  : null;
                if (
                  attempt === 0
                  && retryTimestamps
                  && activeProjectIdRef.current === operationProjectId
                ) {
                  expectedUpdatedAtById = retryTimestamps;
                  continue;
                }
                throw error;
              }
            }
            if (!orders) throw new Error("자료 순서 저장 결과를 확인하지 못했습니다.");
            if (activeProjectIdRef.current !== operationProjectId) return;
            commitOrderUpdates(orders);
            if (groupOperationVersionRef.current.get(snapshot.groupKey) !== groupVersion) return;
            applyOrderUpdates(orders);
            exitReorderMode(snapshot.groupKey);
          } catch (error: unknown) {
            if (activeProjectIdRef.current !== operationProjectId) return;
            if (error instanceof ProjectReferenceAssetReorderError) {
              commitArchiveAssetPlacements(error.assets);
              commitOrderUpdates(error.orders);
            }
            if (groupOperationVersionRef.current.get(snapshot.groupKey) !== groupVersion) return;
            const reconciledServerGroup = error instanceof ProjectReferenceAssetReorderError
              && error.hasGroupSnapshot;
            const reconciledServerOrder = error instanceof ProjectReferenceAssetReorderError
              && error.orders.length > 0;
            if (reconciledServerGroup) {
              const serverAssetIds = new Set(error.assets.map((asset) => asset.id));
              setCombinedArchiveAssets([
                ...archiveAssetsRef.current.filter((asset) => (
                  !serverAssetIds.has(asset.id)
                  && (
                    !isOrderableArchiveAsset(asset)
                    || archiveAssetOrderGroupKey(asset) !== snapshot.groupKey
                  )
                )),
                ...error.assets
              ]);
            } else if (reconciledServerOrder) {
              applyOrderUpdates(error.orders);
            } else {
              setCombinedArchiveAssets(restoreCommittedArchivePlacements(
                archiveAssetsRef.current,
                new Set([snapshot.groupKey])
              ));
            }
            setErrorMessage(`${error instanceof Error ? error.message : "자료 순서를 저장하지 못했습니다."} ${
              reconciledServerGroup || reconciledServerOrder
                ? "서버의 현재 순서로 맞췄습니다."
                : "이전 순서로 되돌렸습니다."
            }`);
            exitReorderMode(snapshot.groupKey);
          }
        }
      ).finally(() => {
        if (activeProjectIdRef.current === operationProjectId) {
          clearReorderPending(snapshot.groupKey, groupVersion);
        }
      });
    };

    const preventActiveTouchScroll = (touchEvent: TouchEvent) => {
      if (reorderSessionRef.current && touchEvent.cancelable) touchEvent.preventDefault();
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishPointerDrag);
      document.removeEventListener("pointercancel", finishPointerDrag);
      document.removeEventListener("touchmove", preventActiveTouchScroll);
      window.removeEventListener("blur", cancelActiveReorderDrag);
      handle.removeEventListener("lostpointercapture", cancelActiveReorderDrag);
      reorderPointerCleanupRef.current = null;
    };
    reorderPointerCleanupRef.current = cleanup;
    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", finishPointerDrag);
    document.addEventListener("pointercancel", finishPointerDrag);
    document.addEventListener("touchmove", preventActiveTouchScroll, { passive: false });
    window.addEventListener("blur", cancelActiveReorderDrag);
    handle.addEventListener("lostpointercapture", cancelActiveReorderDrag);
  }

  async function cropStoredAsset(asset: ProjectReferenceAsset) {
    if (!canEdit || asset.assetType !== "storyboard") return;
    const sourceKind = detectArchiveCropSourceKind({
      mimeType: asset.mimeType,
      filename: asset.filename
    });
    if (!sourceKind) {
      setErrorMessage("PDF, JPG, JPEG, PNG 또는 WebP 콘티만 crop할 수 있습니다.");
      return;
    }
    setIsPreparing(true);
    setErrorMessage("");
    setProgressMessage(sourceKind === "pdf" ? "PDF를 준비하는 중" : "이미지를 준비하는 중");
    try {
      const response = await fetch(asset.publicUrl);
      if (!response.ok) throw new Error("원본 콘티를 불러오지 못했습니다.");
      const blob = await response.blob();
      const file = new File([blob], asset.crop.originalFilename || asset.filename, {
        type: asset.mimeType || blob.type || (sourceKind === "pdf" ? "application/pdf" : "image/jpeg")
      });
      const source = await createArchiveCropSource(file, {
        sourceAssetId: asset.id,
        onProgress: (current, total) => {
          setProgressMessage(`${sourceKind === "pdf" ? "PDF" : "이미지"} ${current}/${total}`);
        }
      });
      beginImport({
        assetType: "storyboard",
        sourceKind: source.kind === "pdf" ? "pdf" : "images",
        sourceFiles: [file],
        sourceLabel: archiveDisplayName(asset),
        pages: source.pages,
        importBatchId: createArchiveSessionId(),
        baseSortOrder: imageAssets.length,
        fileMetadata: [{
          originalFolderName: asset.crop.originalFolderName ?? "",
          relativePath: asset.crop.relativePath ?? asset.filename
        }],
        existingSourceAssetIds: [asset.id],
        inheritedAssets: [asset]
      });
      setProgressMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "원본 콘티를 준비하지 못했습니다.");
      setProgressMessage("");
    } finally {
      setIsPreparing(false);
    }
  }

  function closeMetadata() {
    setEditingAsset(null);
    setMetadataAnchor(null);
    setMetadataError("");
  }

  function openMetadata(asset: ProjectReferenceAsset, anchor?: { clientX: number; clientY: number }) {
    if (!canEdit) return;
    if (deletedAssetIdsRef.current.has(asset.id)) {
      setErrorMessage("삭제 중인 자료는 수정할 수 없습니다.");
      return;
    }
    const currentSceneId = asset.crop.sceneId || "";
    setEditingAsset(asset);
    setMetadataAnchor(anchor ? { clientX: anchor.clientX, clientY: anchor.clientY } : null);
    setMetadataError("");
    setMetadataDraft({
      sceneId: currentSceneId,
      sceneNo: asset.crop.sceneNumber || asset.sceneNo || "",
      cutNo: asset.crop.cutNumber ? String(asset.crop.cutNumber) : asset.cutNo || ""
    });
  }

  function saveMetadata() {
    if (!projectId || !editingAsset || !canEdit) return;
    if (deletedAssetIdsRef.current.has(editingAsset.id)) {
      setMetadataError("삭제 중인 자료는 수정할 수 없습니다.");
      return;
    }
    const cutNumber = metadataDraft.cutNo.trim() ? Number(metadataDraft.cutNo) : null;
    if (cutNumber !== null && (!Number.isInteger(cutNumber) || cutNumber < 1)) {
      setMetadataError("컷은 1 이상의 정수로 입력해주세요.");
      return;
    }
    if (cutNumber !== null && !metadataDraft.sceneId) {
      setMetadataError("컷을 설정하려면 씬을 먼저 선택해주세요.");
      return;
    }
    const selectedScene = sceneItems.find((scene) => scene.id === metadataDraft.sceneId);
    if (metadataDraft.sceneId && !selectedScene) {
      setMetadataError("연결된 씬이 삭제되었습니다. 다른 씬을 선택하거나 연결을 해제해주세요.");
      return;
    }
    if (cutNumber !== null && selectedScene && (!selectedScene.cutCount || cutNumber > selectedScene.cutCount)) {
      if (!selectedScene.cutCount) {
        setMetadataError("씬리스트에 총 컷수를 먼저 입력해주세요.");
        return;
      }
      setMetadataError(`선택한 씬의 총 컷수 ${selectedScene.cutCount}를 초과했습니다.`);
      return;
    }
    const currentAsset = archiveAssetsRef.current.find((asset) => asset.id === editingAsset.id);
    if (!currentAsset) {
      setMetadataError("수정할 이미지 자료를 찾을 수 없습니다.");
      return;
    }
    const previousGroupKey = archiveAssetOrderGroupKey(currentAsset);
    const previousSceneKey = archiveSceneKeyFromOrderGroupKey(previousGroupKey);
    const previousSceneWasCollapsed = collapsedSceneKeysRef.current.has(previousSceneKey);
    const nextGroupKey = archiveOrderGroupKey(selectedScene?.id || null, cutNumber);
    const targetSceneKey = archiveSceneCollapseKey(selectedScene?.id || null);
    const targetWasCollapsed = collapsedSceneKeysRef.current.has(targetSceneKey);
    setMetadataError("");
    const assetId = editingAsset.id;
    const optimistic = moveArchiveAssetToOrderGroup(
      archiveAssetsRef.current,
      assetId,
      {
        sceneId: selectedScene?.id || null,
        sceneNumber: selectedScene?.sceneNo || "",
        cutNumber
      }
    );
    if (!optimistic) {
      setMetadataError("수정할 이미지 자료를 찾을 수 없습니다.");
      return;
    }
    const assetVersion = nextAssetOperationVersion(assetId);
    const groupVersions = nextGroupOperationVersions([previousGroupKey, nextGroupKey]);
    const operationProjectId = projectId;
    markMetadataPending(assetId, assetVersion);
    metadataSceneRevealKeysRef.current.add(targetSceneKey);
    expandScene(targetSceneKey);
    setCombinedArchiveAssets(optimistic.assets);
    closeMetadata();
    void archiveMutationQueueRef.current.enqueue(
      [
        archiveAssetMutationKey(operationProjectId, assetId),
        archiveGroupMutationKey(operationProjectId, previousGroupKey),
        archiveGroupMutationKey(operationProjectId, nextGroupKey)
      ],
      async () => {
        try {
          let expectedUpdatedAt = committedPlacementByAssetIdRef.current.get(assetId)?.updatedAt
            || currentAsset.updatedAt;
          let result: ProjectReferenceAssetSceneCutUpdateResult | null = null;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              result = await updateProjectReferenceAssetSceneCut(operationProjectId, assetId, {
                sceneId: selectedScene?.id || null,
                cutNumber,
                expectedUpdatedAt
              });
              break;
            } catch (error) {
              if (error instanceof ProjectReferenceAssetSceneCutError && error.asset) {
                commitSceneCutUpdate({ asset: error.asset, orders: error.orders });
              } else if (error instanceof ProjectReferenceAssetSceneCutError) {
                commitOrderUpdates(error.orders);
              }
              if (
                attempt === 0
                && error instanceof ProjectReferenceAssetSceneCutError
                && error.asset?.updatedAt
                && activeProjectIdRef.current === operationProjectId
                && !deletedAssetIdsRef.current.has(assetId)
              ) {
                expectedUpdatedAt = error.asset.updatedAt;
                continue;
              }
              throw error;
            }
          }
          if (!result) throw new Error("자료의 씬·컷 저장 결과를 확인하지 못했습니다.");
          if (activeProjectIdRef.current !== operationProjectId) return;
          commitSceneCutUpdate(result);
          if (assetOperationVersionRef.current.get(assetId) !== assetVersion) return;
          applySceneCutUpdate(result, groupOperationVersionsAreCurrent(groupVersions));
        } catch (error) {
          if (activeProjectIdRef.current !== operationProjectId) return;
          if (error instanceof ProjectReferenceAssetSceneCutError && error.asset) {
            commitSceneCutUpdate({ asset: error.asset, orders: error.orders });
          } else if (error instanceof ProjectReferenceAssetSceneCutError) {
            commitOrderUpdates(error.orders);
          }
          const operationIsCurrent = assetOperationVersionRef.current.get(assetId) === assetVersion;
          const groupsAreCurrent = groupOperationVersionsAreCurrent(groupVersions);
          if (!operationIsCurrent || !groupsAreCurrent) return;

          if (error instanceof ProjectReferenceAssetSceneCutError && error.asset) {
            if (
              !previousSceneWasCollapsed
              && archiveSceneCollapseKey(error.asset.sceneId) === previousSceneKey
            ) {
              metadataSceneRevealKeysRef.current.add(previousSceneKey);
            }
            applySceneCutUpdate({ asset: error.asset, orders: error.orders });
            if (targetWasCollapsed && error.asset.sceneId !== (selectedScene?.id || null)) {
              updateCollapsedScenes((current) => new Set(current).add(targetSceneKey));
            }
            setErrorMessage(`${error.message} 서버의 현재 상태로 맞췄습니다.`);
          } else if (error instanceof ProjectReferenceAssetSceneCutError && error.orders.length > 0) {
            removeAssetsFromLocalState([assetId]);
            applyOrderUpdates(error.orders);
            setErrorMessage(`${error.message} 서버의 현재 상태로 맞췄습니다.`);
          } else {
            if (!previousSceneWasCollapsed) {
              metadataSceneRevealKeysRef.current.add(previousSceneKey);
            }
            setCombinedArchiveAssets(restoreCommittedArchivePlacements(
              archiveAssetsRef.current,
              new Set([previousGroupKey, nextGroupKey]),
              assetId
            ));
            if (targetWasCollapsed) {
              updateCollapsedScenes((current) => new Set(current).add(targetSceneKey));
            }
            setErrorMessage(`${error instanceof Error ? error.message : "자료 정보를 저장하지 못했습니다."} 변경을 되돌렸습니다.`);
          }
        }
      }
    ).finally(() => {
      if (activeProjectIdRef.current === operationProjectId) {
        clearMetadataPending(assetId, assetVersion);
      }
    });
  }

  async function saveAssetName() {
    if (!projectId || !renamingAsset || !canEdit) return;
    const displayName = renameDraft.trim();
    if (!displayName) {
      setRenameError("이름을 입력해주세요.");
      return;
    }
    setRenameError("");
    const assetId = renamingAsset.id;
    const renameVersion = nextRenameOperationVersion(assetId);
    const operationProjectId = projectId;
    setIsSaving(true);
    try {
      const updated = await archiveMutationQueueRef.current.enqueue(
        [archiveAssetMutationKey(operationProjectId, assetId)],
        () => updateProjectReferenceAsset(operationProjectId, assetId, {
          title: displayName,
          displayName
        })
      );
      if (activeProjectIdRef.current !== operationProjectId) return;
      setRenamingAsset((current) => current?.id === assetId ? null : current);
      if (renameOperationVersionRef.current.get(assetId) !== renameVersion) return;
      applyArchiveAssetNameUpdate(updated);
    } catch (error) {
      if (activeProjectIdRef.current !== operationProjectId) return;
      setRenameError(error instanceof Error ? error.message : "이름을 변경하지 못했습니다.");
    } finally {
      if (activeProjectIdRef.current === operationProjectId) setIsSaving(false);
    }
  }

  function openAssetContextMenu(
    asset: ProjectReferenceAsset,
    event: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number }
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (
      !canEdit
      || !projectId
      || !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      return;
    }
    cancelArchivePointerSession();
    cancelActiveReorderDrag();
    exitReorderMode();
    openMetadata(asset, event);
  }

  if (isLoading) return <PageLoader />;

  return (
    <>
      <div
        className="mx-auto grid w-full max-w-6xl select-none gap-4 [&_input]:select-text [&_textarea]:select-text"
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="ui-density-heading font-display break-words font-bold text-field-text [overflow-wrap:anywhere]">부감도&콘티 아카이브</h1>
            <p className="break-words text-xs text-field-muted [overflow-wrap:anywhere]">{projectName} · 컷에 연결하기 전 프로젝트 공통 자료</p>
          </div>
          {!canEdit ? <span className="rounded-md border border-field-border bg-field-panel px-3 py-2 text-xs font-semibold text-field-muted">읽기 전용</span> : null}
        </div>

        {errorMessage ? <p role="alert" className=" border border-field-danger bg-field-danger/10 px-3 py-2 text-sm font-bold text-field-danger">{errorMessage}</p> : null}
        {statusMessage ? (
          <p role="status" aria-live="polite" className="border border-field-border bg-field-panel px-3 py-2 text-xs text-field-muted">
            {statusMessage}
          </p>
        ) : null}
        {isPreparing || progressMessage ? (
          <div className="grid justify-items-center gap-2 py-2" role="status" aria-live="polite" aria-atomic="true">
            <SectionLoader className="!min-h-16" />
            <p className="text-xs text-field-muted">{progressMessage}</p>
          </div>
        ) : null}
        {uploadFailures.length > 0 ? (
          <details className="border border-field-danger/50 bg-field-danger/10 px-3 py-2 text-xs text-field-text">
            <summary className="cursor-pointer font-bold text-field-danger">
              {uploadFailures.length}개 파일 실패
            </summary>
            <ul className="mt-2 grid max-h-32 gap-1 overflow-y-auto" aria-label="업로드 실패 파일">
              {uploadFailures.slice(0, 30).map((failure, index) => (
                <li key={`${failure.path}-${index}`} className="break-all leading-5">
                  <span className="font-semibold">{failure.path}</span>
                  <span className="text-field-muted"> · {failure.message}</span>
                </li>
              ))}
              {uploadFailures.length > 30 ? (
                <li className="text-field-muted">외 {uploadFailures.length - 30}개</li>
              ) : null}
            </ul>
          </details>
        ) : null}
        {canEdit && supportsDesktopDrop ? (
          <div className="hidden grid-cols-2 gap-3 md:grid" aria-label="데스크탑 자료 드롭 영역">
            {(["overhead", "storyboard"] as const).map((type) => {
              const active = dragDepth[type] > 0;
              const label = type === "overhead" ? "부감도" : "콘티";
              return (
                <div
                  key={type}
                  className={`grid min-h-28 place-items-center border-2 border-dashed px-4 py-5 text-center transition-colors ${
                    active
                      ? "border-field-primary bg-field-primary/15 text-field-primary"
                      : "border-field-divider bg-field-soft/45 text-field-subtle"
                  }`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    updateDragDepth(type, 1);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    updateDragDepth(type, -1);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(event) => handleDrop(type, event)}
                >
                  <div className="pointer-events-none grid justify-items-center gap-1.5">
                    {type === "overhead" ? <MapIcon className="h-6 w-6" aria-hidden /> : <Clapperboard className="h-6 w-6" aria-hidden />}
                    <p className="text-sm font-bold">{label} 파일·폴더 놓기</p>
                    <p className="text-[11px] text-field-muted">PDF · JPG · JPEG · PNG · WebP</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <Card className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-center">
            <label className="relative block min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-field-muted" aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-10 w-full border border-field-divider bg-field-input pl-9 pr-3 text-sm text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/30" placeholder="제목, 메모, 씬, 컷 검색" />
            </label>
            {canEdit ? (
              <div className="flex flex-wrap justify-end gap-2">
                {activeType !== "storyboard" ? (
                  <button type="button" onClick={openNewDiagram} className="inline-flex min-h-10 items-center gap-1.5 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover">
                    <MapIcon className="h-4 w-4" aria-hidden />
                    직접 만들기
                  </button>
                ) : null}
                {selectedArchiveType ? (
                  <>
                    <label className="neon-primary inline-flex min-h-10 cursor-pointer items-center gap-1.5 border px-3 text-xs font-bold transition-colors">
                      <ImagePlus className="h-4 w-4" aria-hidden />
                      이미지
                      <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple className="sr-only" disabled={isPreparing || isSaving} onChange={(event) => prepareImages(selectedArchiveType, event)} />
                    </label>
                    <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition hover:border-field-subtle hover:bg-field-hover">
                      <Upload className="h-4 w-4" aria-hidden />
                      PDF
                      <input type="file" accept="application/pdf,.pdf" multiple className="sr-only" disabled={isPreparing || isSaving} onChange={(event) => preparePdf(selectedArchiveType, event)} />
                    </label>
                    {supportsDirectoryPicker ? (
                      <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition hover:border-field-subtle hover:bg-field-hover focus-within:ring-2 focus-within:ring-field-primary/40">
                        <FolderUp className="h-4 w-4" aria-hidden />
                        폴더 업로드
                        <input
                          ref={(node) => {
                            if (node && "webkitdirectory" in node) node.webkitdirectory = true;
                          }}
                          type="file"
                          accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
                          multiple
                          className="sr-only"
                          aria-label={`${selectedArchiveType === "overhead" ? "부감도" : "콘티"} 폴더 업로드`}
                          disabled={isPreparing || isSaving}
                          onChange={(event) => prepareFolderUpload(selectedArchiveType, event)}
                        />
                      </label>
                    ) : null}
                  </>
                ) : (
                  (["overhead", "storyboard"] as const).flatMap((type) => [
                    <label key={`${type}-files`} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover">
                      <Upload className="h-4 w-4" aria-hidden />
                      {type === "overhead" ? "부감도 업로드" : "콘티 업로드"}
                      <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" multiple className="sr-only" disabled={isPreparing || isSaving} onChange={(event) => prepareMixedUpload(type, event)} />
                    </label>,
                    supportsDirectoryPicker ? (
                      <label key={`${type}-folder`} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover focus-within:ring-2 focus-within:ring-field-primary/40">
                        <FolderUp className="h-4 w-4" aria-hidden />
                        {type === "overhead" ? "부감도 폴더 업로드" : "콘티 폴더 업로드"}
                        <input
                          ref={(node) => {
                            if (node && "webkitdirectory" in node) node.webkitdirectory = true;
                          }}
                          type="file"
                          accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
                          multiple
                          className="sr-only"
                          aria-label={type === "overhead" ? "부감도 폴더 업로드" : "콘티 폴더 업로드"}
                          disabled={isPreparing || isSaving}
                          onChange={(event) => prepareFolderUpload(type, event)}
                        />
                      </label>
                    ) : null
                  ])
                )}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-field-border pt-3">
            <span className="text-xs text-field-muted">
              자료 {archiveGroups.reduce((count, group) => count + group.items.length, sourceAssets.length)}개
            </span>
            {canEdit ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={scopeSelectionKeys.length === 0 || isSaving}
                  onClick={toggleSelectionMode}
                  className={`min-h-9 border px-3 text-xs font-bold transition-colors disabled:opacity-40 ${selectionMode ? "border-field-primary/80 bg-field-primary/10 text-field-primary" : "border-field-divider bg-field-panel text-field-text hover:border-field-subtle hover:bg-field-hover"}`}
                  aria-pressed={selectionMode}
                >
                  {selectionMode ? "선택 종료" : "선택"}
                </button>
                {selectionMode ? (
                  <button
                    type="button"
                    disabled={scopeSelectionKeys.length === 0 || isSaving}
                    onClick={toggleCurrentAssetScope}
                    className={`min-h-9 border px-3 text-xs font-bold transition-colors disabled:opacity-40 ${allScopeAssetsSelected ? "border-field-primary/80 bg-field-primary/10 text-field-primary" : "border-field-divider bg-field-panel text-field-text hover:border-field-subtle hover:bg-field-hover"}`}
                    aria-pressed={allScopeAssetsSelected}
                  >
                    {allScopeAssetsSelected ? "전체 해제" : "전체 선택"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {canEdit && selectedCount > 0 ? (
            <div className="fixed inset-x-3 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 border border-field-divider bg-field-floating px-3 py-2 shadow-floating">
              <span className="text-xs font-bold text-field-primary">
                {selectedCount}개 선택
              </span>
              {canCropSingleSelection && singleSelectedReferenceAsset ? (
                <button
                  type="button"
                  disabled={isPreparing || isSaving}
                  onClick={() => {
                    const asset = singleSelectedReferenceAsset;
                    clearSelection();
                    void cropStoredAsset(asset);
                  }}
                  className="inline-flex min-h-9 items-center gap-1 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover disabled:opacity-50"
                >
                  <Crop className="h-3.5 w-3.5" aria-hidden />
                  크롭
                </button>
              ) : null}
              {selectedCount === 1 ? (
                <button type="button" onClick={editSingleSelectedItem} className="inline-flex min-h-9 items-center gap-1 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover">
                  <Info className="h-3.5 w-3.5" aria-hidden />
                  {singleSelectedReferenceAsset ? "정보 수정" : "정보"}
                </button>
              ) : null}
              {singleSelectedReferenceAsset ? (
                <button type="button" onClick={renameSingleSelectedAsset} className="inline-flex min-h-9 items-center gap-1 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover">
                  이름 변경
                </button>
              ) : null}
              <button type="button" disabled={isSaving || selectedCount === 0} onClick={() => void deleteSelectedAssets()} className="inline-flex min-h-9 items-center gap-1 border border-field-danger bg-field-panel px-3 text-xs font-bold text-field-danger transition-colors hover:bg-field-danger/10 disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                삭제
              </button>
              <button type="button" onClick={clearSelection} className="min-h-9 border border-transparent px-3 text-xs font-bold text-field-muted transition-colors hover:border-field-border hover:text-field-text">
                선택 해제
              </button>
            </div>
          ) : null}
          <p className="text-xs text-field-muted">업로드한 자료는 진행도에 자동 적용되지 않습니다. 진행도 컷 카드에서 명시적으로 선택해야 표시됩니다.</p>
        </Card>

        <Card className="grid gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-field-text">{activeType === "all" ? "전체" : activeType === "overhead" ? "부감도" : "콘티"} 자료</h2>
            <p className="text-xs text-field-muted">이미지 원본 비율을 유지하며 모서리를 자르지 않습니다.</p>
          </div>
          {archiveGroups.length === 0 ? (
            <p className="py-10 text-center text-sm text-field-muted">등록된 {activeType === "all" ? "아카이브" : activeType === "overhead" ? "부감도" : "콘티"} 자료가 없습니다.</p>
          ) : (
            <div className="grid min-w-0 gap-5">
              {archiveGroups.map((group) => {
                const collapsed = collapsedSceneKeys.has(group.key);
                const scenePanelId = archiveScenePanelId(group.key);
                return (
                <section key={group.key} className="grid min-w-0 gap-2" aria-labelledby={`${scenePanelId}-header`}>
                  <h3 id={`${scenePanelId}-header`} className="border-b border-field-border">
                    <button
                      type="button"
                      onClick={() => toggleSceneCollapsed(group.key)}
                      className="flex min-h-9 w-full items-center justify-center gap-1.5 px-1 text-center text-sm font-bold text-field-text hover:text-field-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary/35"
                      aria-expanded={!collapsed}
                      aria-controls={scenePanelId}
                    >
                      {collapsed
                        ? <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
                        : <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />}
                      <span>{group.label}</span>
                    </button>
                  </h3>
                  <MotionPresence show={!collapsed} id={scenePanelId} className="min-w-0">
                  <div className="grid min-w-0 gap-2">
                  {groupArchiveItemsByCut(group.items).map((cutGroup) => {
                    const orderedAssets = cutGroup.items.flatMap((item) => item.kind === "asset" ? [item.asset] : []);
                    const orderedAssetIds = orderedAssets.map((asset) => asset.id);
                    const visibleOrderByAssetId = new Map(orderedAssetIds.map((assetId, index) => [assetId, index + 1]));
                    const orderGroupKey = archiveOrderGroupKey(group.sceneId, cutGroup.cutNumber);
                    const completeOrderedAssetIds = completeArchiveOrderByGroupKey.get(orderGroupKey) ?? orderedAssetIds;
                    const groupInReorderMode = reorderModeGroupKey === orderGroupKey;
                    const groupReorderEnabled = canEdit
                      && !query.trim()
                      && !selectionMode
                      && selectedKeys.size === 0
                      && !isSaving
                      && !pendingConfirm
                      && !pendingDeleteAsset
                      && !(group.sceneId && !group.scene)
                      && !(group.sceneId === null && cutGroup.cutNumber !== null)
                      && orderedAssets.every((asset) => archiveAssetOrderGroupKey(asset) === orderGroupKey)
                      && orderedAssetIds.every((assetId) => completeOrderedAssetIds.includes(assetId))
                      && orderedAssetIds.length > 1;
                    return (
                      <div
                        key={`${group.key}-${cutGroup.key}`}
                        data-archive-reorder-zone={orderGroupKey}
                        className="grid min-w-0 gap-1.5"
                      >
                        <div className="relative flex min-h-8 items-center justify-center gap-2 text-center">
                          <h4 className="flex items-center justify-center gap-1.5 text-center text-xs font-bold text-field-muted">
                            <span>{cutGroup.label}</span>
                            {pendingReorderGroupKeys.has(orderGroupKey) ? (
                              <span className="h-2 w-2 bg-field-primary" title="순서 저장 중" aria-label="순서 저장 중" />
                            ) : null}
                          </h4>
                          {groupInReorderMode ? (
                            <button
                              type="button"
                              data-archive-reorder-control="done"
                              onClick={() => {
                                cancelActiveReorderDrag();
                                exitReorderMode(orderGroupKey);
                              }}
                              className="min-h-8 border border-field-primary bg-field-panel px-3 text-[11px] font-bold text-field-primary transition-colors hover:bg-field-hover hover:text-field-text sm:absolute sm:right-0"
                            >
                              완료
                            </button>
                          ) : null}
                        </div>
                        <div className="grid min-w-0 select-none grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {cutGroup.items.map((item) => {
                      const key = archiveSelectionKey(item.kind, item.id);
                      const selected = selectedKeys.has(key);
                      if (item.kind === "diagram") {
                        const diagram = item.diagram;
                        return (
                          <article
                            key={key}
                            onContextMenu={(event) => event.preventDefault()}
                            className={`ui-motion-surface relative grid min-w-0 select-none grid-rows-[minmax(0,1fr)_auto] gap-1.5 rounded-[var(--radius-card)] border bg-field-panel p-2 text-center transition ${
                              selected
                                ? "border-field-primary bg-field-primary/10 ring-2 ring-field-primary/45"
                                : "border-field-border"
                            } ${pressedSelectionKey === key ? "scale-[0.92] border-field-primary" : ""}`}
                          >
                            <button
                              type="button"
                              onClick={(event) => {
                                if (selectionMode && !diagram.legacy) {
                                  event.preventDefault();
                                  toggleArchiveSelection("diagram", diagram.id);
                                  return;
                                }
                                openDiagram(diagram, false);
                              }}
                              className="grid min-w-0 aspect-[4/3] touch-pan-y place-items-center overflow-hidden rounded-[var(--radius-control)] bg-field-soft"
                              aria-pressed={selectionMode && !diagram.legacy ? selected : undefined}
                            >
                              <ShotOverheadPreview diagram={diagram.diagram} label="부감도 미리보기" />
                            </button>
                            <ArchiveCutText cutNo={item.cutLabel} typeLabel={activeType === "all" ? "부감도" : undefined} />
                          </article>
                        );
                      }

                      const asset = item.asset;
                      const dragDeleteEnabled = canEdit
                        && !selectionMode
                        && selectedKeys.size === 0
                        && !isSaving
                        && !pendingConfirm
                        && !pendingDeleteAsset
                        && !deletedAssetIdsRef.current.has(asset.id);
                      const assetReorderEnabled = dragDeleteEnabled && groupReorderEnabled;
                      const visibleOrderNumber = visibleOrderByAssetId.get(asset.id) ?? 1;
                      const orderNumber = activeType === "all" && !query.trim()
                        ? visibleOrderNumber
                        : positiveArchiveSortOrder(asset.sortOrder) ?? visibleOrderNumber;
                      return (
                        <article
                          key={key}
                          data-archive-reorder-item={asset.id}
                          data-archive-reorder-group={orderGroupKey}
                          className={`ui-motion-surface relative grid min-w-0 max-w-full select-none grid-rows-[minmax(0,1fr)_auto] gap-1.5 rounded-[var(--radius-card)] border bg-field-panel p-2 text-center transition-[transform,border-color,background-color,opacity] ${
                            selected
                              ? "border-field-primary bg-field-primary/10 ring-2 ring-field-primary/45"
                              : "border-field-border"
                          } ${pressedSelectionKey === key ? "scale-[0.98] border-field-primary" : ""} ${
                            reorderVisual?.assetId === asset.id ? "opacity-25" : ""
                          } ${reorderVisual?.targetId === asset.id ? "ring-2 ring-field-primary/55" : ""} ${
                            pendingMetadataAssetIds.has(asset.id) ? "border-field-primary" : ""
                          }`}
                        >
                          {pendingMetadataAssetIds.has(asset.id) ? (
                            <span className="pointer-events-none absolute left-1 top-1 z-20 h-2 w-2 bg-field-primary" title="정보 저장 중" aria-label="정보 저장 중" />
                          ) : null}
                          <span aria-hidden="true" className="pointer-events-none absolute right-1 top-1 z-20 grid h-7 min-w-7 place-items-center border border-field-divider bg-field-elevated px-1 text-[11px] font-bold text-field-subtle">
                            {orderNumber}
                          </span>
                          <button
                            type="button"
                            onPointerDown={(event) => {
                              if (dragDeleteEnabled) beginAssetReorderPress(
                                asset.id,
                                group.sceneId,
                                cutGroup.cutNumber,
                                orderedAssetIds,
                                completeOrderedAssetIds,
                                assetReorderEnabled,
                                event
                              );
                            }}
                            onClick={(event) => {
                              if (suppressArchiveClickRef.current === key) {
                                suppressArchiveClickRef.current = null;
                                event.preventDefault();
                                return;
                              }
                              if (selectionMode) {
                                event.preventDefault();
                                toggleArchiveSelection("asset", asset.id);
                                return;
                              }
                              if (groupInReorderMode) {
                                event.preventDefault();
                                return;
                              }
                              setPreview({
                                url: asset.publicUrl,
                                title: archiveDisplayName(asset),
                                assetId: asset.id
                              });
                            }}
                            onContextMenu={(event) => openAssetContextMenu(asset, event)}
                            className={`grid min-w-0 max-w-full aspect-[4/3] touch-pan-y place-items-center overflow-hidden rounded-[var(--radius-control)] bg-field-soft p-1 ${
                              dragDeleteEnabled ? "cursor-grab active:cursor-grabbing" : ""
                            } ${groupInReorderMode ? "archive-reorder-jiggle" : ""}`}
                            style={{ WebkitTouchCallout: "none" }}
                            aria-pressed={selectionMode ? selected : undefined}
                            aria-label={`${archiveDisplayName(asset)}, ${orderNumber}번째 자료${
                              dragDeleteEnabled
                                ? assetReorderEnabled
                                  ? ", 길게 눌러 순서 이동 또는 삭제"
                                  : ", 길게 눌러 삭제"
                                : ""
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={asset.crop.thumbnailUrl || asset.publicUrl}
                              alt={archiveDisplayName(asset)}
                              loading="lazy"
                              decoding="async"
                              draggable={false}
                              onDragStart={(event) => event.preventDefault()}
                              className="block h-full w-full  object-contain"
                            />
                          </button>
                          <ArchiveCutText
                            cutNo={item.cutLabel}
                            typeLabel={activeType === "all" ? (asset.assetType === "overhead" ? "부감도" : "콘티") : undefined}
                          />
                        </article>
                      );
                    })}
                        </div>
                      </div>
                    );
                  })}
                  </div>
                  </MotionPresence>
                </section>
                );
              })}
            </div>
          )}
        </Card>

        {sourceAssets.length > 0 ? (
          <Card className="grid gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-field-text">보존된 원본</h2>
              <p className="text-xs text-field-muted">PDF와 crop 전 이미지입니다. 추출 결과를 삭제해도 원본은 별도 자료로 남습니다.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sourceAssets.map((asset) => {
                const key = archiveSelectionKey("asset", asset.id);
                const selected = selectedKeys.has(key);
                return (
                  <article
                    key={asset.id}
                    className={`ui-motion-surface flex min-w-0 items-center gap-2 rounded-[var(--radius-card)] border bg-field-panel p-2 text-center transition-[transform,border-color,background-color] ${
                      selected
                        ? "border-field-primary bg-field-primary/10 ring-2 ring-field-primary/45"
                        : "border-field-border"
                    } ${pressedSelectionKey === key ? "scale-[0.92]" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        if (selectionMode) {
                          event.preventDefault();
                          toggleArchiveSelection("asset", asset.id);
                          return;
                        }
                        if (detectArchiveCropSourceKind({
                          mimeType: asset.mimeType,
                          filename: asset.filename
                        }) === "image") {
                          setPreview({
                            url: asset.publicUrl,
                            title: archiveDisplayName(asset),
                            assetId: asset.id
                          });
                        } else {
                          window.open(asset.publicUrl, "_blank", "noopener,noreferrer");
                        }
                      }}
                      className="flex min-w-0 flex-1 touch-pan-y items-center justify-center gap-3 p-1 text-center"
                      aria-pressed={selectionMode ? selected : undefined}
                    >
                      {detectArchiveCropSourceKind({
                        mimeType: asset.mimeType,
                        filename: asset.filename
                      }) === "pdf"
                        ? <FileText className="h-7 w-7 shrink-0 text-field-subtle" aria-hidden />
                        : <FileImage className="h-7 w-7 shrink-0 text-field-subtle" aria-hidden />}
                      <span className="min-w-0 flex-1 text-center">
                        <span className="block truncate text-center text-xs font-bold text-field-text">{archiveDisplayName(asset)}</span>
                        <span className="block text-center text-[11px] text-field-subtle underline underline-offset-2">원본 보기</span>
                      </span>
                    </button>
                    {canEdit && asset.assetType === "storyboard" && detectArchiveCropSourceKind({ mimeType: asset.mimeType, filename: asset.filename }) ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void cropStoredAsset(asset);
                        }}
                        className="min-h-9 shrink-0 border border-field-divider bg-field-panel px-3 text-[11px] font-bold text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover"
                      >
                        crop
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </Card>
        ) : null}
      </div>

      {reorderOverlay && typeof document !== "undefined" ? createPortal(
        <div
          ref={reorderOverlayRef}
          className="pointer-events-none fixed z-[100] grid place-items-center overflow-hidden rounded-[var(--radius-card)] border-2 border-field-primary bg-field-soft p-1"
          style={{
            width: reorderOverlay.width,
            height: reorderOverlay.height,
            left: reorderOverlay.left,
            top: reorderOverlay.top
          }}
          aria-hidden="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={reorderOverlay.imageUrl}
            alt=""
            draggable={false}
            className="block h-full w-full object-contain"
          />
        </div>,
        document.body
      ) : null}

      {reorderOverlay
        && canEdit
        && !selectionMode
        && !pendingConfirm
        && !pendingDeleteAsset
        && typeof document !== "undefined"
        ? createPortal(
          <ArchiveDeleteDropZone
            ref={deleteDropZoneRef}
            isActive={isOverDeleteZone}
          />,
          document.body
        )
        : null}

      {pendingImport ? (
        <ArchiveImportDialog
          assetType={pendingImport.assetType}
          sourceLabel={pendingImport.sourceLabel}
          pages={pendingImport.pages}
          scenes={sceneItems}
          allowSceneCutMetadata={false}
          initialMetadata={archiveImportInitialMetadata(pendingImport)}
          isSaving={isSaving}
          saveReport={importSaveReport}
          progress={importProgress}
          onClose={closeImport}
          onSave={saveImport}
        />
      ) : null}
      {diagramDraft ? (
        <>
          {!diagramDraft.item?.legacy && canEdit ? (
            <DiagramMetadataBar value={diagramDraft} onChange={setDiagramDraft} />
          ) : null}
          <ShotOverheadEditor shot={diagramDraft.shot} readOnly={Boolean(diagramDraft.item?.legacy) || !canEdit} isSaving={isSaving} onClose={() => setDiagramDraft(null)} onSave={saveDiagram} />
        </>
      ) : null}
      {editingAsset ? (
        <MetadataPopover
          value={metadataDraft}
          scenes={sceneItems}
          anchor={metadataAnchor}
          errorMessage={metadataError}
          isSaving={false}
          onChange={(value) => {
            setMetadataDraft(value);
            setMetadataError("");
          }}
          onClose={closeMetadata}
          onSave={saveMetadata}
        />
      ) : null}
      {renamingAsset ? (
        <AssetRenameEditor
          value={renameDraft}
          errorMessage={renameError}
          isSaving={isSaving}
          onChange={(value) => {
            setRenameDraft(value);
            setRenameError("");
          }}
          onClose={() => {
            setRenamingAsset(null);
            setRenameError("");
          }}
          onSave={saveAssetName}
        />
      ) : null}
      {pendingConfirm ? (
        <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[95] mx-auto max-w-lg">
          <CompactConfirm
            message={pendingConfirm.message ?? [
              `${pendingConfirm.label}을 삭제할까요?`,
              pendingConfirm.linkedAssetCount > 0
                ? `진행도에 연결된 파일 ${pendingConfirm.linkedAssetCount}개의 연결도 해제됩니다.`
                : "",
              pendingConfirm.diagrams.length > 0
                ? "선택한 직접 만든 부감도의 연결 정보도 함께 삭제됩니다."
                : ""
            ].filter(Boolean).join(" ")}
            errorMessage={errorMessage}
            isSaving={isSaving}
            onConfirm={() => void confirmPendingAction()}
            onCancel={() => {
              setPendingConfirm(null);
              setErrorMessage("");
            }}
          />
        </div>
      ) : null}
      <ImagePreviewModal imageUrl={preview?.url ?? null} title={preview?.title ?? "자료"} onClose={() => setPreview(null)} />
      <style jsx global>{`
        @keyframes archive-reorder-jiggle {
          0%, 100% { transform: rotate(-1deg); }
          50% { transform: rotate(1deg); }
        }
        .archive-reorder-jiggle {
          animation: archive-reorder-jiggle 180ms ease-in-out infinite;
          transform-origin: center;
        }
        @media (prefers-reduced-motion: reduce) {
          .archive-reorder-jiggle {
            animation: none;
            outline: 2px solid var(--field-accent);
            outline-offset: -2px;
          }
        }
      `}</style>
    </>
  );
}

function ArchiveCutText({ cutNo, typeLabel }: { cutNo: string; typeLabel?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-center gap-1 px-1 text-center">
      <p className="truncate text-center text-[11px] font-bold text-field-muted">
        {cutNo ? `C#${cutNo}` : "컷 미지정"}
      </p>
      {typeLabel ? <span className="shrink-0 text-[10px] text-field-muted">{typeLabel}</span> : null}
    </div>
  );
}

function CompactConfirm({
  message,
  errorMessage,
  isSaving,
  onConfirm,
  onCancel
}: {
  message: string;
  errorMessage: string;
  isSaving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="flex flex-wrap items-center gap-2 border border-field-divider bg-field-elevated p-3" role="alertdialog" aria-label="삭제 확인">
      <p className="min-w-0 flex-1 text-xs leading-5 text-field-text">{message}</p>
      {errorMessage ? (
        <p className="basis-full text-xs font-bold leading-5 text-field-danger" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <button type="button" disabled={isSaving} onClick={onCancel} className="min-h-9 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-muted transition-colors hover:border-field-subtle hover:bg-field-hover disabled:opacity-50">
        취소
      </button>
      <button type="button" disabled={isSaving} onClick={onConfirm} className="min-h-9 border border-field-danger bg-field-danger px-3 text-xs font-bold text-field-text disabled:opacity-50">
        {isSaving ? "처리 중" : "삭제"}
      </button>
    </section>
  );
}

function MetadataPopover({
  value,
  scenes,
  anchor,
  errorMessage,
  isSaving,
  onChange,
  onClose,
  onSave
}: {
  value: MetadataDraft;
  scenes: ProjectSceneItem[];
  anchor: MetadataAnchor | null;
  errorMessage: string;
  isSaving: boolean;
  onChange: (value: MetadataDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const popoverRef = useRef<HTMLElement | null>(null);
  const [anchoredPosition, setAnchoredPosition] = useState<{ left: number; top: number } | null>(null);
  const selectedScene = scenes.find((scene) => scene.id === value.sceneId);
  const selectedCut = value.cutNo ? Number(value.cutNo) : null;
  const maxCut = selectedScene?.cutCount ?? 0;
  const missingScene = Boolean(value.sceneId && !selectedScene);
  const invalidCut = Boolean(
    selectedCut !== null
    && (!Number.isInteger(selectedCut) || selectedCut < 1 || !maxCut || selectedCut > maxCut)
  );

  useLayoutEffect(() => {
    if (!anchor || !popoverRef.current) {
      setAnchoredPosition(null);
      return;
    }
    const collisionPadding = 12;
    const pointerGap = 8;
    const rect = popoverRef.current.getBoundingClientRect();
    const preferredLeft = anchor.clientX + pointerGap;
    const preferredTop = anchor.clientY + pointerGap;
    const left = preferredLeft + rect.width <= window.innerWidth - collisionPadding
      ? preferredLeft
      : anchor.clientX - rect.width - pointerGap;
    const top = preferredTop + rect.height <= window.innerHeight - collisionPadding
      ? preferredTop
      : anchor.clientY - rect.height - pointerGap;
    setAnchoredPosition({
      left: Math.max(
        collisionPadding,
        Math.min(left, window.innerWidth - rect.width - collisionPadding)
      ),
      top: Math.max(
        collisionPadding,
        Math.min(top, window.innerHeight - rect.height - collisionPadding)
      )
    });
  }, [anchor, errorMessage, invalidCut, maxCut, missingScene]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!popoverRef.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onViewportChange(event: Event) {
      if (event.type === "scroll") {
        const target = event.target;
        if (target instanceof Node && popoverRef.current?.contains(target)) return;
      }
      onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <section
      ref={popoverRef}
      className={`fixed z-[140] grid max-h-[min(70dvh,22rem)] gap-3 overflow-y-auto border border-field-divider bg-field-elevated p-3 ${
        anchor
          ? "w-64 max-w-[calc(100vw-24px)]"
          : "inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] mx-auto max-w-sm sm:inset-x-auto sm:left-1/2 sm:w-[19rem] sm:-translate-x-1/2"
      }`}
      style={anchor
        ? anchoredPosition
          ? { left: anchoredPosition.left, top: anchoredPosition.top }
          : { left: 12, top: 12, visibility: "hidden" }
        : undefined}
      role="dialog"
      aria-label="자료 정보 수정"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold text-field-text">정보 수정</h2>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center border border-field-divider bg-field-panel text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover" aria-label="정보 수정 닫기">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <label className="grid gap-1 text-xs font-bold text-field-muted">
        씬
        <select
          value={value.sceneId}
          onChange={(event) => {
            const scene = scenes.find((entry) => entry.id === event.target.value);
            onChange({
              sceneId: scene?.id || "",
              sceneNo: scene?.sceneNo || "",
              cutNo: ""
            });
          }}
          className="min-h-10 border border-field-divider bg-field-input px-3 text-sm text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-primary/30"
        >
          <option value="">미지정</option>
          {missingScene ? (
            <option value={value.sceneId}>{value.sceneNo}</option>
          ) : null}
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>
              {scene.sceneNo}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-bold text-field-muted">
        컷
        <select
          disabled={!selectedScene || maxCut < 1}
          value={value.cutNo}
          onChange={(event) => onChange({ ...value, cutNo: event.target.value })}
          className="min-h-10 border border-field-divider bg-field-input px-3 text-sm text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-primary/30 disabled:bg-field-input disabled:text-field-disabled"
        >
          <option value="">미지정</option>
          {invalidCut && value.cutNo ? (
            <option value={value.cutNo}>{value.cutNo}</option>
          ) : null}
          {Array.from({ length: maxCut }, (_, index) => index + 1).map((cutNumber) => (
            <option key={cutNumber} value={String(cutNumber)}>{cutNumber}</option>
          ))}
        </select>
      </label>
      {selectedScene && maxCut < 1 ? (
        <p className="text-[11px] font-bold text-field-muted">씬리스트에 총 컷수를 먼저 입력해주세요.</p>
      ) : null}
      {missingScene ? (
        <p className="text-[11px] font-bold text-field-danger">연결된 씬이 삭제되었습니다. 다른 씬을 선택하거나 미지정으로 바꿔주세요.</p>
      ) : null}
      {invalidCut && selectedScene && maxCut > 0 ? (
        <p className="text-[11px] font-bold text-field-danger">컷은 1부터 {maxCut}까지만 선택할 수 있습니다.</p>
      ) : null}
      {errorMessage ? <p role="alert" className="text-xs font-bold text-field-danger">{errorMessage}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={isSaving} onClick={onClose} className="min-h-10 border border-field-divider bg-field-panel px-3 text-sm font-bold text-field-muted transition-colors hover:border-field-subtle hover:bg-field-hover disabled:opacity-50">취소</button>
        <button type="button" disabled={isSaving} onClick={onSave} className="min-h-10 border border-field-primary bg-field-primary px-3 text-sm font-bold text-field-accent-foreground transition hover:border-field-secondary hover:bg-field-secondary disabled:opacity-50">{isSaving ? "저장 중" : "저장"}</button>
      </div>
    </section>,
    document.body
  );
}

function AssetRenameEditor({
  value,
  errorMessage,
  isSaving,
  onChange,
  onClose,
  onSave
}: {
  value: string;
  errorMessage: string;
  isSaving: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <section
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[86] mx-auto grid max-w-sm gap-3 border border-field-divider bg-field-overlay p-3 shadow-dialog sm:inset-x-auto sm:left-1/2 sm:w-[19rem] sm:-translate-x-1/2"
      role="dialog"
      aria-label="자료 이름 변경"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold text-field-text">이름 변경</h2>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center border border-field-divider bg-field-panel text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover" aria-label="이름 변경 닫기">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <label className="grid gap-1 text-xs font-bold text-field-muted">
        이름
        <input
          autoFocus
          value={value}
          maxLength={240}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-10 border border-field-divider bg-field-input px-3 text-sm text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-primary/30"
        />
      </label>
      {errorMessage ? <p role="alert" className="text-xs font-bold text-field-danger">{errorMessage}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={isSaving} onClick={onClose} className="min-h-10 border border-field-divider bg-field-panel px-3 text-sm font-bold text-field-muted transition-colors hover:border-field-subtle hover:bg-field-hover disabled:opacity-50">취소</button>
        <button type="button" disabled={isSaving} onClick={onSave} className="min-h-10 border border-field-primary bg-field-primary px-3 text-sm font-bold text-field-accent-foreground transition hover:border-field-secondary hover:bg-field-secondary disabled:opacity-50">{isSaving ? "저장 중" : "저장"}</button>
      </div>
    </section>
  );
}

function DiagramMetadataBar({ value, onChange }: { value: DiagramDraft; onChange: (value: DiagramDraft) => void }) {
  return (
    <div className="fixed left-1/2 top-[max(0.5rem,env(safe-area-inset-top))] z-[90] flex w-[min(92vw,44rem)] -translate-x-1/2 flex-wrap gap-1 border border-field-divider bg-field-floating p-2 shadow-floating">
      <input value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} className="min-h-9 min-w-0 flex-[2] border border-field-divider bg-field-input px-2 text-xs text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/30" placeholder="부감도 제목" />
      <input value={value.sceneNo} onChange={(event) => onChange({ ...value, sceneNo: event.target.value })} className="min-h-9 w-16 border border-field-divider bg-field-input px-2 text-xs text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/30" placeholder="씬" />
      <input value={value.cutNo} onChange={(event) => onChange({ ...value, cutNo: event.target.value })} className="min-h-9 w-16 border border-field-divider bg-field-input px-2 text-xs text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/30" placeholder="컷" />
      <input value={value.memo} onChange={(event) => onChange({ ...value, memo: event.target.value })} className="min-h-9 min-w-0 flex-[3] border border-field-divider bg-field-input px-2 text-xs text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/30" placeholder="메모" />
    </div>
  );
}

function createArchiveShot(projectId: string, item: OverheadDiagramArchiveItem | null): Shot {
  const now = new Date().toISOString();
  return {
    id: item?.id || `archive-${Date.now()}`,
    projectId,
    dailyPlanId: null,
    analysisRunId: null,
    sceneNumber: item?.sceneNo || "",
    cutNumber: item?.cutNo || "",
    title: item?.title || "새 부감도",
    description: item?.memo || "",
    location: "",
    characters: [],
    memo: "",
    orderIndex: 0,
    status: "pending",
    storyboardImageUrl: null,
    overheadImageUrl: null,
    overheadDiagram: item?.diagram || createEmptyShotOverheadDiagram(),
    sourceFileId: null,
    sourcePage: null,
    sourceRow: null,
    createdAt: item?.createdAt || now,
    updatedAt: item?.updatedAt || now
  };
}

function dedupeArchiveAssets(assets: ProjectReferenceAsset[]) {
  const byId = new Map<string, ProjectReferenceAsset>();
  for (const asset of assets) byId.set(asset.id, asset);
  return [...byId.values()];
}

function groupArchiveItemsByScene(
  assets: ProjectReferenceAsset[],
  diagrams: OverheadDiagramArchiveItem[],
  scenes: ProjectSceneItem[]
): ArchiveSceneGroup[] {
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const groupsBySceneId = new Map<string, ArchiveSceneGroup>();
  const unassigned: ArchiveSceneGroup = {
    key: archiveSceneCollapseKey(null),
    label: "미지정",
    sceneId: null,
    scene: null,
    items: []
  };

  for (const asset of dedupeArchiveAssets(assets)) {
    const rawSceneId = asset.crop.sceneId?.trim() || null;
    const scene = rawSceneId ? sceneById.get(rawSceneId) ?? null : null;
    const group = rawSceneId && scene
      ? groupsBySceneId.get(rawSceneId) ?? {
          key: archiveSceneCollapseKey(rawSceneId),
          label: `S#${scene.sceneNo}`,
          sceneId: rawSceneId,
          scene,
          items: []
        }
      : unassigned;
    if (rawSceneId && scene && !groupsBySceneId.has(rawSceneId)) groupsBySceneId.set(rawSceneId, group);
    group.items.push(toArchiveAssetGroupItem(asset, scene));
  }

  const uniqueDiagrams = new Map(diagrams.map((diagram) => [diagram.id, diagram]));
  for (const diagram of uniqueDiagrams.values()) {
    // 직접 만든 기존 부감도에는 stable sceneId가 없으므로 sceneNo로 관계를 추측하지 않습니다.
    unassigned.items.push(toArchiveDiagramGroupItem(diagram));
  }

  const groups = [...groupsBySceneId.values()].sort((left, right) => {
    if (Boolean(left.scene) !== Boolean(right.scene)) return left.scene ? -1 : 1;
    const sceneOrder = ARCHIVE_NATURAL_COLLATOR.compare(
      left.scene?.sceneNo ?? "",
      right.scene?.sceneNo ?? ""
    );
    if (sceneOrder !== 0) return sceneOrder;
    const sortOrder = (left.scene?.sortOrder ?? 0) - (right.scene?.sortOrder ?? 0);
    if (sortOrder !== 0) return sortOrder;
    return left.key.localeCompare(right.key);
  });

  for (const group of groups) group.items.sort(compareArchiveGroupItems);
  if (unassigned.items.length > 0) {
    unassigned.items.sort(compareArchiveGroupItems);
    groups.push(unassigned);
  }
  return groups;
}

function groupArchiveItemsByCut(items: ArchiveGroupItem[]): ArchiveCutGroup[] {
  const groups = new Map<string, ArchiveCutGroup>();
  for (const item of items) {
    const cutNumber = item.cutSortValue;
    const key = cutNumber === null ? "unassigned" : `cut-${cutNumber}`;
    const group = groups.get(key) ?? {
      key,
      label: cutNumber === null ? "컷 미지정" : `C#${cutNumber}`,
      cutNumber,
      items: []
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.cutNumber === null) return right.cutNumber === null ? 0 : 1;
    if (right.cutNumber === null) return -1;
    return left.cutNumber - right.cutNumber;
  });
}

function archiveOrderGroupKey(sceneId: string | null, cutNumber: number | null) {
  return `${sceneId || "unassigned"}::${cutNumber ?? "unassigned"}`;
}

function archiveAssetMutationKey(projectId: string, assetId: string) {
  return `project:${projectId}:asset:${assetId}`;
}

function archiveGroupMutationKey(projectId: string, groupKey: string) {
  return `project:${projectId}:group:${groupKey}`;
}

function archiveExpectedUpdatedAtById(
  assetIds: string[],
  committedPlacements: ReadonlyMap<string, ArchiveAssetPlacement>,
  assets: ProjectReferenceAsset[]
) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return Object.fromEntries(assetIds.map((assetId) => {
    const updatedAt = committedPlacements.get(assetId)?.updatedAt
      || assetsById.get(assetId)?.updatedAt
      || "";
    if (!updatedAt) throw new Error("자료 순서를 저장할 최신 버전을 확인하지 못했습니다.");
    return [assetId, updatedAt];
  }));
}

function archiveRetryTimestamps(
  assetIds: string[],
  error: ProjectReferenceAssetReorderError
) {
  if (error.hasGroupSnapshot || error.orders.length !== assetIds.length) return null;
  const requestedIds = new Set(assetIds);
  const timestamps = new Map<string, string>();
  for (const order of error.orders) {
    if (!requestedIds.has(order.id) || !order.updatedAt || timestamps.has(order.id)) return null;
    timestamps.set(order.id, order.updatedAt);
  }
  if (timestamps.size !== requestedIds.size) return null;
  return Object.fromEntries(assetIds.map((assetId) => [assetId, timestamps.get(assetId)!]));
}

function archiveSceneCollapseKey(sceneId: string | null) {
  return sceneId ? `scene:${sceneId}` : "unassigned";
}

function archiveSceneKeyFromOrderGroupKey(groupKey: string) {
  const sceneId = groupKey.split("::", 1)[0] ?? "";
  return archiveSceneCollapseKey(sceneId === "unassigned" ? null : sceneId);
}

function archiveScenePanelId(sceneKey: string) {
  return `archive-scene-${sceneKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function moveArchiveReorderOverlay(element: HTMLDivElement | null, left: number, top: number) {
  if (!element) return;
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
}

function isPointInsideArchiveDeleteDropZone(
  element: HTMLDivElement | null,
  clientX: number,
  clientY: number
) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom;
}

function archiveViewportScrollStep(pointerY: number) {
  const edge = 72;
  const maximumStep = 16;
  if (pointerY < edge) {
    const ratio = Math.min(1, Math.max(0, (edge - pointerY) / edge));
    return -Math.max(4, Math.round(maximumStep * ratio));
  }
  if (pointerY > window.innerHeight - edge) {
    const ratio = Math.min(1, Math.max(0, (pointerY - (window.innerHeight - edge)) / edge));
    return Math.max(4, Math.round(maximumStep * ratio));
  }
  return 0;
}

function findArchiveGridInsertionTarget(
  groupKey: string,
  currentIds: string[],
  pointerX: number,
  pointerY: number
) {
  const pointedElement = document.elementFromPoint(pointerX, pointerY);
  const pointedCard = pointedElement instanceof Element
    ? pointedElement.closest<HTMLElement>("[data-archive-reorder-item]")
    : null;
  if (pointedCard && pointedCard.dataset.archiveReorderGroup !== groupKey) return null;

  const zones = Array.from(document.querySelectorAll<HTMLElement>("[data-archive-reorder-zone]"));
  const zone = zones.find((candidate) => candidate.dataset.archiveReorderZone === groupKey && !candidate.hidden);
  if (!zone) return null;
  const zoneRect = zone.getBoundingClientRect();
  if (
    pointerX < zoneRect.left
    || pointerX > zoneRect.right
    || pointerY < zoneRect.top
    || pointerY > zoneRect.bottom
  ) return null;

  const idSet = new Set(currentIds);
  const cards = Array.from(zone.querySelectorAll<HTMLElement>("[data-archive-reorder-item]"))
    .filter((card) => (
      card.dataset.archiveReorderGroup === groupKey
      && Boolean(card.dataset.archiveReorderItem)
      && idSet.has(card.dataset.archiveReorderItem ?? "")
      && card.getClientRects().length > 0
    ));
  let closestId = "";
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const distance = Math.hypot(
      pointerX - (rect.left + rect.width / 2),
      pointerY - (rect.top + rect.height / 2)
    );
    if (distance >= closestDistance) continue;
    closestDistance = distance;
    closestId = card.dataset.archiveReorderItem ?? "";
  }
  return closestId || null;
}

function captureArchiveCardRects(groupKey: string, ids: string[]) {
  const idSet = new Set(ids);
  const rects = new Map<string, DOMRect>();
  for (const card of document.querySelectorAll<HTMLElement>("[data-archive-reorder-item]")) {
    const id = card.dataset.archiveReorderItem ?? "";
    if (card.dataset.archiveReorderGroup !== groupKey || !idSet.has(id)) continue;
    rects.set(id, card.getBoundingClientRect());
  }
  return rects;
}

function animateArchiveGridReflow(
  groupKey: string,
  previousRects: Map<string, DOMRect>,
  movingAssetId: string
) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  window.requestAnimationFrame(() => {
    for (const card of document.querySelectorAll<HTMLElement>("[data-archive-reorder-item]")) {
      const id = card.dataset.archiveReorderItem ?? "";
      if (card.dataset.archiveReorderGroup !== groupKey || id === movingAssetId) continue;
      const previous = previousRects.get(id);
      if (!previous) continue;
      const next = card.getBoundingClientRect();
      const deltaX = previous.left - next.left;
      const deltaY = previous.top - next.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
      card.getAnimations().forEach((animation) => animation.cancel());
      card.animate(
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: "translate3d(0, 0, 0)" }
        ],
        { duration: 150, easing: "ease-out" }
      );
    }
  });
}

function archiveAssetOrderGroupKey(asset: ProjectReferenceAsset) {
  return archiveOrderGroupKey(
    asset.crop.sceneId?.trim() || null,
    nullableArchiveCutNumber(asset.crop.cutNumber ?? asset.cutNo)
  );
}

function isOrderableArchiveAsset(asset: ProjectReferenceAsset) {
  return (asset.assetType === "overhead" || asset.assetType === "storyboard")
    && detectArchiveCropSourceKind({ mimeType: asset.mimeType, filename: asset.filename }) === "image"
    && !asset.groupId?.startsWith("source:");
}

function moveArchiveAssetToOrderGroup(
  assets: ProjectReferenceAsset[],
  assetId: string,
  nextGroup: { sceneId: string | null; sceneNumber: string; cutNumber: number | null }
) {
  const moving = assets.find((asset) => asset.id === assetId && isOrderableArchiveAsset(asset));
  if (!moving) return null;
  const previousGroupKey = archiveAssetOrderGroupKey(moving);
  const nextGroupKey = archiveOrderGroupKey(nextGroup.sceneId, nextGroup.cutNumber);
  const affectedIds = new Set<string>();
  const orderById = new Map<string, number>();
  const previousAssets = assets
    .filter((asset) => (
      asset.id !== assetId
      && isOrderableArchiveAsset(asset)
      && archiveAssetOrderGroupKey(asset) === previousGroupKey
    ))
    .sort(compareArchiveAssetsForOrder);
  previousAssets.forEach((asset, index) => {
    affectedIds.add(asset.id);
    orderById.set(asset.id, index + 1);
  });

  if (previousGroupKey === nextGroupKey) {
    const sameGroupAssets = [...previousAssets, moving].sort(compareArchiveAssetsForOrder);
    sameGroupAssets.forEach((asset, index) => {
      affectedIds.add(asset.id);
      orderById.set(asset.id, index + 1);
    });
  } else {
    const nextAssets = assets
      .filter((asset) => (
        asset.id !== assetId
        && isOrderableArchiveAsset(asset)
        && archiveAssetOrderGroupKey(asset) === nextGroupKey
      ))
      .sort(compareArchiveAssetsForOrder);
    nextAssets.forEach((asset, index) => {
      affectedIds.add(asset.id);
      orderById.set(asset.id, index + 1);
    });
    affectedIds.add(moving.id);
    orderById.set(moving.id, nextAssets.length + 1);
  }

  return {
    assets: assets.map((asset) => {
      if (!affectedIds.has(asset.id)) return asset;
      const sortOrder = orderById.get(asset.id) ?? asset.sortOrder;
      if (asset.id !== assetId) {
        return sortOrder === asset.sortOrder ? asset : { ...asset, sortOrder };
      }
      return {
        ...asset,
        sceneNo: nextGroup.sceneNumber || null,
        cutNo: nextGroup.cutNumber === null ? null : String(nextGroup.cutNumber),
        sortOrder,
        crop: {
          ...asset.crop,
          sceneId: nextGroup.sceneId,
          sceneNumber: nextGroup.sceneNumber,
          cutNumber: nextGroup.cutNumber
        }
      };
    })
  };
}

function archiveAssetPlacement(asset: ProjectReferenceAsset): ArchiveAssetPlacement {
  return {
    sceneNo: asset.sceneNo,
    cutNo: asset.cutNo,
    sortOrder: asset.sortOrder,
    sceneId: asset.crop.sceneId?.trim() || null,
    sceneNumber: asset.crop.sceneNumber || "",
    cutNumber: nullableArchiveCutNumber(asset.crop.cutNumber ?? asset.cutNo),
    updatedAt: asset.updatedAt
  };
}

function applyArchiveAssetPlacement(
  asset: ProjectReferenceAsset,
  placement: ArchiveAssetPlacement
) {
  return {
    ...asset,
    sceneNo: placement.sceneNo,
    cutNo: placement.cutNo,
    sortOrder: placement.sortOrder,
    updatedAt: placement.updatedAt || asset.updatedAt,
    crop: {
      ...asset.crop,
      sceneId: placement.sceneId,
      sceneNumber: placement.sceneNumber,
      cutNumber: placement.cutNumber
    }
  };
}

function compareArchiveAssetsForOrder(left: ProjectReferenceAsset, right: ProjectReferenceAsset) {
  const sortOrder = (positiveArchiveSortOrder(left.sortOrder) ?? 0)
    - (positiveArchiveSortOrder(right.sortOrder) ?? 0);
  if (sortOrder !== 0) return sortOrder;
  const createdOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (Number.isFinite(createdOrder) && createdOrder !== 0) return createdOrder;
  return left.id.localeCompare(right.id);
}

function reorderArchiveAssetsByIds(assets: ProjectReferenceAsset[], orderedIds: string[]) {
  const orderById = new Map(orderedIds.map((id, index) => [id, index + 1]));
  return assets.map((asset) => {
    const sortOrder = orderById.get(asset.id);
    return sortOrder === undefined ? asset : { ...asset, sortOrder };
  });
}

function mergeVisibleArchiveOrderIntoCompleteGroup(
  completeIds: string[],
  visibleIds: string[]
) {
  const visibleIdSet = new Set(visibleIds);
  if (
    visibleIdSet.size !== visibleIds.length
    || visibleIds.some((id) => !completeIds.includes(id))
  ) return completeIds;

  let visibleIndex = 0;
  return completeIds.map((id) => (
    visibleIdSet.has(id) ? visibleIds[visibleIndex++] : id
  ));
}

function moveArchiveId(ids: string[], fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return ids;
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function positiveArchiveSortOrder(value: unknown) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function nullableArchiveCutNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function toArchiveAssetGroupItem(
  asset: ProjectReferenceAsset,
  scene: ProjectSceneItem | null
): ArchiveGroupItem {
  const cutLabel = asset.crop.cutNumber !== null && asset.crop.cutNumber !== undefined
    ? String(asset.crop.cutNumber)
    : (asset.cutNo ?? "").trim();
  return {
    kind: "asset",
    id: asset.id,
    asset,
    cutLabel,
    cutSortValue: validArchiveCutNumber(cutLabel, scene),
    sortOrder: positiveArchiveSortOrder(asset.sortOrder) ?? 0,
    createdAt: asset.createdAt
  };
}

function toArchiveDiagramGroupItem(diagram: OverheadDiagramArchiveItem): ArchiveGroupItem {
  const cutLabel = diagram.cutNo.trim();
  return {
    kind: "diagram",
    id: diagram.id,
    diagram,
    cutLabel,
    cutSortValue: validArchiveCutNumber(cutLabel, null),
    sortOrder: Number.MAX_SAFE_INTEGER,
    createdAt: diagram.createdAt
  };
}

function validArchiveCutNumber(value: string, scene: ProjectSceneItem | null) {
  if (!/^\d+$/.test(value)) return null;
  const cutNumber = Number(value);
  if (!Number.isSafeInteger(cutNumber) || cutNumber < 1) return null;
  if (scene && (!scene.cutCount || cutNumber > scene.cutCount)) return null;
  return cutNumber;
}

function compareArchiveGroupItems(left: ArchiveGroupItem, right: ArchiveGroupItem) {
  const leftHasValidCut = left.cutSortValue !== null;
  const rightHasValidCut = right.cutSortValue !== null;
  if (leftHasValidCut !== rightHasValidCut) return leftHasValidCut ? -1 : 1;
  if (left.cutSortValue !== null && right.cutSortValue !== null) {
    const cutOrder = left.cutSortValue - right.cutSortValue;
    if (cutOrder !== 0) return cutOrder;
  }
  const sortOrder = left.sortOrder - right.sortOrder;
  if (sortOrder !== 0) return sortOrder;
  const createdOrder = safeArchiveTimestamp(left.createdAt) - safeArchiveTimestamp(right.createdAt);
  if (createdOrder !== 0) return createdOrder;
  return left.id.localeCompare(right.id);
}

function safeArchiveTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function matchesAssetQuery(asset: ProjectReferenceAsset, query: string) {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  if (!normalized) return true;
  return [
    asset.crop.displayName,
    asset.crop.title,
    asset.crop.originalFilename,
    asset.crop.memo,
    asset.filename,
    asset.crop.sceneNumber,
    asset.crop.cutNumber,
    asset.sceneNo,
    asset.cutNo
  ].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR").includes(normalized);
}

function matchesDiagramQuery(item: OverheadDiagramArchiveItem, query: string) {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  if (!normalized) return true;
  return [item.title, item.memo, item.sceneNo, item.cutNo].join(" ").toLocaleLowerCase("ko-KR").includes(normalized);
}

function pageTitle(base: string, pageIndex: number, count: number) {
  const title = base.trim();
  if (!title) return "";
  return count > 1 ? `${title}_${String(pageIndex + 1).padStart(2, "0")}` : title;
}

function stripArchiveExtension(value: string) {
  const filename = value.trim().split(/[\\/]/).at(-1) ?? "";
  return filename.replace(/\.[^.]+$/, "").trim() || "자료";
}

function archiveDisplayName(asset: ProjectReferenceAsset) {
  return (
    asset.crop.displayName?.trim()
    || asset.crop.title?.trim()
    || stripArchiveExtension(asset.crop.originalFilename || asset.filename)
  );
}

function inheritedArchiveMetadata(
  pending: PendingImport,
  sourceFileIndex: number
) {
  const asset = pending.inheritedAssets?.[sourceFileIndex] ?? null;
  const sourceFile = pending.sourceFiles[sourceFileIndex];
  return {
    displayName: asset
      ? archiveDisplayName(asset)
      : stripArchiveExtension(sourceFile?.name || pending.sourceLabel),
    originalFilename: asset?.crop.originalFilename || asset?.filename || sourceFile?.name || "",
    episodeNumber: asset?.crop.episodeNumber ?? null,
    sceneId: asset?.crop.sceneId || "",
    sceneNumber: asset?.crop.sceneNumber || asset?.sceneNo || ""
  };
}

function archiveImportInitialMetadata(pending: PendingImport) {
  const inherited = inheritedArchiveMetadata(pending, 0);
  const sourceAsset = pending.inheritedAssets?.[0] ?? null;
  return {
    title: pending.sourceFiles.length === 1 ? inherited.displayName : "",
    memo: sourceAsset?.crop.memo || "",
    sceneId: "",
    sceneNo: "",
    cutNo: ""
  };
}

function cropPixelRatio(crop: NonNullable<ArchiveImportCommit["results"][number]["crop"]>, page: ArchiveImportPage) {
  const width = crop.width * page.width;
  const height = crop.height * page.height;
  return height > 0 ? width / height : null;
}

function cropMetadata(
  crop: ArchiveImportCommit["results"][number]["crop"],
  page: ArchiveImportPage,
  template: StoryboardCropTemplate | null
) {
  if (!crop) return {};
  return {
    cropX: crop.x,
    cropY: crop.y,
    cropWidth: crop.width,
    cropHeight: crop.height,
    cropRatio: cropPixelRatio(crop, page),
    centerX: crop.x + crop.width / 2,
    centerY: crop.y + crop.height / 2,
    ...(template ? {
      basePageWidth: template.basePageWidth,
      basePageHeight: template.basePageHeight,
      templateCropWidth: template.cropWidth,
      templateCropHeight: template.cropHeight,
      aspectRatio: template.aspectRatio,
      clickPlacementMode: template.clickPlacementMode,
      rowStep: template.rowStep,
      rowsPerPage: template.rowsPerPage,
      targetColumn: template.targetColumn,
      includeContext: template.includeContext
    } : {})
  };
}

function archiveSelectionKey(
  kind: ArchiveSelectionKind,
  id: string
): ArchiveSelectionKey {
  return `${kind}:${id}`;
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isImageFile(file: File) {
  return /^(?:image\/jpeg|image\/jpg|image\/png|image\/webp)$/i.test(file.type)
    || /\.(?:jpe?g|png|webp)$/i.test(file.name);
}

function isAcceptedArchiveFile(file: File) {
  return isPdfFile(file) || isImageFile(file);
}

async function hasPdfSignature(file: File) {
  if (file.size < 5) return false;
  const bytes = new Uint8Array(await file.slice(0, Math.min(1_024, file.size)).arrayBuffer());
  return String.fromCharCode(...bytes).includes("%PDF-");
}

function createArchiveUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20)
  ].join("-");
}

function createArchiveSessionId() {
  return createArchiveUuid();
}

function isActiveArchiveImportProgress(progress: ArchiveImportProgressState | null) {
  return Boolean(
    progress
    && progress.phase !== "idle"
    && progress.phase !== "complete"
    && progress.phase !== "error"
    && progress.phase !== "cancelled"
  );
}

function deriveArchiveImportProgress(
  current: ArchiveImportProgressState,
  patch: Partial<ArchiveImportProgressState>
): ArchiveImportProgressState {
  const totalCount = Math.max(0, Math.round(patch.totalCount ?? current.totalCount));
  const clampCount = (value: number) => Math.min(totalCount, Math.max(0, Math.round(value)));
  const next: ArchiveImportProgressState = {
    ...current,
    ...patch,
    totalCount,
    preparedCount: clampCount(patch.preparedCount ?? current.preparedCount),
    croppedCount: clampCount(patch.croppedCount ?? current.croppedCount),
    uploadedCount: clampCount(patch.uploadedCount ?? current.uploadedCount),
    savedCount: clampCount(patch.savedCount ?? current.savedCount),
    failedCount: clampCount(patch.failedCount ?? current.failedCount)
  };
  if (next.phase === "complete") {
    next.overallPercent = 100;
    return next;
  }
  const denominator = Math.max(1, totalCount);
  const measuredPercent = (
    (next.preparedCount / denominator) * 5
    + (next.croppedCount / denominator) * 45
    + (next.uploadedCount / denominator) * 40
    + (next.savedCount / denominator) * 8
  );
  const phaseFloor = next.phase === "finalizing" ? 98 : 0;
  next.overallPercent = Math.min(
    99,
    Math.max(
      current.overallPercent,
      Number.isFinite(patch.overallPercent) ? Number(patch.overallPercent) : 0,
      measuredPercent,
      phaseFloor
    )
  );
  return next;
}

async function yieldArchiveProcessingTask() {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (typeof scheduler?.yield === "function") {
    await scheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function archivePerformanceNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function logStoryboardImportTimings(
  timings: StoryboardImportTimings,
  report: ArchiveImportSaveReport
) {
  if (process.env.NODE_ENV === "production") return;
  const milliseconds = (value: number) => Math.round(value * 10) / 10;
  console.info("[storyboard-crop:bulk-timing]", {
    items: report.total,
    saved: report.succeededResultIds.length,
    failed: report.failures.length,
    sourcePrepareMs: milliseconds(timings.sourcePrepareMs),
    cropPipelineWallMs: milliseconds(timings.cropPipelineMs),
    cropDrawMs: milliseconds(timings.cropDrawMs),
    imageEncodeMs: milliseconds(timings.imageEncodeMs),
    requestMs: milliseconds(timings.requestMs),
    storageUploadMs: milliseconds(timings.storageUploadMs),
    databaseMs: milliseconds(timings.databaseMs),
    archiveUpdateMs: milliseconds(timings.archiveUpdateMs),
    totalMs: milliseconds(timings.totalMs),
    sourceDecodeCount: timings.sourceDecodeCount,
    cropCount: timings.cropCount,
    requestCount: timings.requestCount,
    cropConcurrency: timings.cropConcurrency,
    uploadWindowSize: timings.uploadWindowSize,
    legacyFlowEstimate: {
      sourceDecodes: timings.cropCount,
      thumbnailRedecodes: timings.cropCount,
      apiRequests: timings.cropCount
    }
  });
}

function sortArchiveUploadFailures(failures: ArchiveUploadFailure[]) {
  return [...failures].sort((left, right) => (
    ARCHIVE_NATURAL_COLLATOR.compare(left.path, right.path)
  ));
}

function archiveUploadSummary(
  succeededCount: number,
  excludedCount: number,
  failedCount: number,
  label?: string
) {
  return [
    label ? `${label} 업로드 완료` : "업로드 완료",
    `${succeededCount}개 성공`,
    ...(excludedCount > 0 ? [`${excludedCount}개 제외`] : []),
    ...(failedCount > 0 ? [`${failedCount}개 실패`] : [])
  ].join(" · ");
}

function errorMessageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

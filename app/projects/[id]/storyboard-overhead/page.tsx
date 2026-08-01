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
  Crop,
  FileImage,
  FileText,
  ImagePlus,
  Info,
  Map as MapIcon,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useParams } from "next/navigation";
import {
  ArchiveImportDialog,
  type ArchiveImportCommit,
  type ArchiveImportProgressState,
  type ArchiveImportSaveFailure,
  type ArchiveImportSaveReport
} from "@/components/ArchiveImportDialog";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import { Card } from "@/components/ui/Card";
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
  deleteProjectReferenceAssets,
  inspectProjectReferenceAssets,
  listProjectReferenceAssets,
  updateProjectReferenceAsset,
  uploadProjectReferenceAsset,
  uploadStoryboardCropAssetsBulk,
  type StoryboardCropBulkUploadItem
} from "@/lib/data/projectReferenceAssets";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { getProject } from "@/lib/data/projects";
import { getProjectSceneList } from "@/lib/data/sceneList";
import {
  deleteOverheadDiagramArchive,
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
  { ssr: false, loading: () => <PixelDogLoader size="md" /> }
);

type ArchiveType = Extract<ProjectReferenceAssetType, "overhead" | "storyboard">;
type ArchiveViewType = "all" | ArchiveType;
type PendingImport = {
  assetType: ArchiveType;
  sourceKind: "pdf" | "images" | "mixed";
  sourceFiles: File[];
  sourceLabel: string;
  pages: ArchiveImportPage[];
  importBatchId: string;
  baseSortOrder: number;
  fileMetadata: Array<{ originalFolderName: string; relativePath: string }>;
  existingSourceAssetIds?: string[];
  inheritedAssets?: Array<ProjectReferenceAsset | null>;
};

type PendingConfirm = {
  assetIds: string[];
  diagrams: OverheadDiagramArchiveItem[];
  linkedAssetCount: number;
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
  scene: ProjectSceneItem | null;
  items: ArchiveGroupItem[];
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
  kind: ArchiveSelectionKind;
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  longPressed: boolean;
  timeoutId: number;
  target: HTMLButtonElement;
  previousTouchAction: string;
};
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE = 9;
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
  const [activeType, setActiveType] = useState<ArchiveViewType>("all");
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
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [supportsDesktopDrop, setSupportsDesktopDrop] = useState(false);
  const [dragDepth, setDragDepth] = useState<Record<ArchiveType, number>>({ overhead: 0, storyboard: 0 });
  const [pressedSelectionKey, setPressedSelectionKey] = useState<ArchiveSelectionKey | null>(null);
  const preparingRef = useRef(false);
  const longPressRef = useRef<ArchivePointerSession | null>(null);
  const selectionPointerCleanupRef = useRef<(() => void) | null>(null);
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

  useUnsavedChangesGuard(isActiveArchiveImportProgress(importProgress));

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
    setIsLoading(true);
    try {
      const [project, overheadAssets, storyboardAssets, diagrams, sceneResult] = await Promise.all([
        getProject(projectId),
        listProjectReferenceAssets(projectId, "overhead"),
        listProjectReferenceAssets(projectId, "storyboard"),
        listOverheadDiagramArchive(projectId),
        getProjectSceneList(projectId)
          .then((value) => ({ value: value.items, error: "" }))
          .catch((error: unknown) => ({
            value: [] as ProjectSceneItem[],
            error: error instanceof Error ? error.message : "씬리스트를 불러오지 못했습니다."
          }))
      ]);
      setProjectName(project?.name ?? "프로젝트");
      setOverheads(overheadAssets);
      setStoryboards(storyboardAssets);
      setDiagramArchives(diagrams);
      setSceneItems(sceneResult.value);
      setErrorMessage(sceneResult.error);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "부감도와 콘티 아카이브를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadArchive();
  }, [loadArchive]);

  useEffect(() => {
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setSupportsDesktopDrop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    selectedKeysRef.current = new Set();
    setSelectedKeys(new Set());
    setSelectionMode(false);
  }, [activeType, query]);

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
    selectionPointerCleanupRef.current?.();
    const longPress = longPressRef.current;
    if (longPress) window.clearTimeout(longPress.timeoutId);
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

  function mergeUploadedAssets(assetType: ArchiveType, uploaded: ProjectReferenceAsset[]) {
    if (uploaded.length === 0) return;
    const merge = (current: ProjectReferenceAsset[]) => {
      const byId = new Map(current.map((asset) => [asset.id, asset]));
      for (const asset of uploaded) byId.set(asset.id, asset);
      return [...byId.values()];
    };
    if (assetType === "overhead") setOverheads(merge);
    else setStoryboards(merge);
  }

  function removeAssetsFromLocalState(assetIds: Iterable<string>) {
    const ids = new Set(assetIds);
    setOverheads((current) => current.filter((asset) => !ids.has(asset.id)));
    setStoryboards((current) => current.filter((asset) => !ids.has(asset.id)));
    updateSelectedKeys((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(archiveSelectionKey("asset", id));
      return next;
    });
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

  function replaceAssetInLocalState(updated: ProjectReferenceAsset) {
    setOverheads((current) => {
      const without = current.filter((asset) => asset.id !== updated.id);
      return updated.assetType === "overhead" ? [...without, updated] : without;
    });
    setStoryboards((current) => {
      const without = current.filter((asset) => asset.id !== updated.id);
      return updated.assetType === "storyboard" ? [...without, updated] : without;
    });
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
      assetType === "overhead" && files.every(isImageFile)
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
    }
  ) {
    if (!projectId || rawFiles.length === 0 || preparingRef.current || isSaving) return;
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
    const acceptedSources = candidates.filter(({ file }) => {
      if (!isAcceptedArchiveFile(file) || file.size <= 0) return false;
      if (expectedKind === "pdf") return isPdfFile(file);
      if (expectedKind === "images") return isImageFile(file);
      return true;
    });
    const files = acceptedSources.map(({ file }) => file);
    let excludedCount = candidates.length - acceptedSources.length;
    if (files.length === 0) {
      setErrorMessage("PDF, JPG, JPEG, PNG, WebP 중 읽을 수 있는 파일을 선택해주세요.");
      return;
    }
    const pdfFiles = files.filter(isPdfFile);
    const imageFiles = files.filter(isImageFile);
    if (pdfFiles.length > 0 && imageFiles.length > 0 && assetType !== "storyboard") {
      setErrorMessage("PDF와 이미지는 각각의 가져오기 흐름으로 나누어 놓아주세요.");
      return;
    }
    const sourceKind: PendingImport["sourceKind"] = pdfFiles.length > 0 && imageFiles.length > 0
      ? "mixed"
      : pdfFiles.length > 0
        ? "pdf"
        : "images";
    preparingRef.current = true;
    setIsPreparing(true);
    setErrorMessage("");
    setActiveType(assetType);
    try {
      if (sourceKind === "images" && directImageUpload) {
        const batchId = typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}`;
        const existingCount = (assetType === "overhead" ? overheads : storyboards)
          .filter((asset) => asset.mimeType.startsWith("image/") && !asset.groupId?.startsWith("source:"))
          .length;
        let completed = 0;
        let failed = 0;
        const uploadedAssets: ProjectReferenceAsset[] = [];
        await mapWithConcurrency(files, 3, async (file, index) => {
          try {
            setProgressMessage(`이미지 최적화 중 · ${file.name}`);
            const optimized = await optimizeArchiveImage(file);
            setProgressMessage(`썸네일 생성 완료 · 업로드 중 ${completed + 1}/${files.length}`);
            const metadata = acceptedSources[index]?.metadata;
            const uploaded = await uploadProjectReferenceAsset(projectId, assetType, optimized.displayFile, {
              thumbnailFile: optimized.thumbnailFile,
              sourceType: "upload_image",
              groupId: batchId,
              folderId: null,
              displayName: stripArchiveExtension(file.name),
              originalFilename: file.name,
              originalFolderName: metadata?.originalFolderName,
              relativePath: metadata?.relativePath,
              sortOrder: existingCount + index
            });
            uploadedAssets.push(uploaded);
            completed += 1;
            setProgressMessage(`저장 중 ${completed}/${files.length}`);
          } catch {
            failed += 1;
          }
        });
        excludedCount += failed;
        mergeUploadedAssets(assetType, uploadedAssets);
        setProgressMessage("");
        if (completed === 0) {
          setErrorMessage(`이미지를 업로드하지 못했습니다. ${excludedCount}개 파일을 제외했습니다.`);
        } else if (excludedCount > 0) {
          setStatusMessage(`${completed}개 업로드됨 · ${excludedCount}개 제외`);
        }
        return;
      }
      const pages: ArchiveImportPage[] = [];
      const readableFiles: File[] = [];
      const readableMetadata: Array<{ originalFolderName: string; relativePath: string }> = [];
      const readableSourceIds: string[] = [];
      const readableInheritedAssets: Array<ProjectReferenceAsset | null> = [];
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
          readableMetadata.push(acceptedSources[fileIndex]?.metadata ?? {
            originalFolderName: "",
            relativePath: file.name
          });
          readableSourceIds.push(acceptedSources[fileIndex]?.sourceAssetId ?? "");
          readableInheritedAssets.push(acceptedSources[fileIndex]?.inheritedAsset ?? null);
          pages.push(...rendered);
        } catch {
          excludedCount += 1;
        }
      }
      if (pages.length === 0 || readableFiles.length === 0) {
        setErrorMessage("읽을 수 있는 자료가 없습니다.");
        setProgressMessage("");
        return;
      }
      beginImport({
        assetType,
        sourceKind,
        sourceFiles: readableFiles,
        sourceLabel: readableFiles.length === 1
          ? readableFiles[0].name
          : `${readableFiles[0].name} 외 ${readableFiles.length - 1}개`,
        pages,
        importBatchId: createArchiveSessionId(),
        baseSortOrder: imageAssets.length,
        fileMetadata: readableMetadata,
        existingSourceAssetIds: readableSourceIds.some(Boolean) ? readableSourceIds : undefined,
        inheritedAssets: readableInheritedAssets.some(Boolean) ? readableInheritedAssets : undefined
      });
      setProgressMessage("");
      if (excludedCount > 0) setStatusMessage(`${readableFiles.length}개 준비됨 · ${excludedCount}개 제외`);
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
    const files = Array.from(event.dataTransfer.files).filter(isAcceptedArchiveFile);
    if (files.length === 0) {
      setErrorMessage("PDF, JPG, JPEG, PNG, WebP 파일을 놓아주세요.");
      return;
    }
    await prepareFiles(assetType, files, undefined, assetType === "overhead");
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
    mergeUploadedAssets("storyboard", uploadedAssets);
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
        for (let fileIndex = 0; fileIndex < pendingImport.sourceFiles.length; fileIndex += 1) {
          const sourceFile = pendingImport.sourceFiles[fileIndex];
          const existingSourceId = pendingImport.existingSourceAssetIds?.[fileIndex];
          if (existingSourceId) {
            sourceAssetsByIndex.set(fileIndex, existingSourceId);
            continue;
          }
          const sourceMetadata = pendingImport.fileMetadata[fileIndex];
          setProgressMessage(`원본 PDF 보존 ${fileIndex + 1}/${pendingImport.sourceFiles.length}`);
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
        }
        let completed = 0;
        await mapWithConcurrency(value.results, 3, async (result, index) => {
          const { page, crop } = result;
          setProgressMessage(`crop 이미지 생성 중 ${index + 1}/${value.results.length}`);
          const resultFile = crop
            ? await createCroppedArchiveFile(page, crop, page.name)
            : new File([page.blob], page.name, { type: "image/jpeg" });
          setProgressMessage(`썸네일 생성 중 ${index + 1}/${value.results.length}`);
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
            cropOrderIndex: index,
            cropIndex: index + 1,
            displayName: pageTitle(value.title || inherited.displayName, index, value.results.length),
            originalFilename: inherited.originalFilename || pendingImport.sourceFiles[page.sourceFileIndex]?.name,
            title: pageTitle(value.title || inherited.displayName, index, value.results.length),
            memo: value.memo,
            episodeNumber: inherited.episodeNumber ?? undefined,
            sceneId: undefined,
            sceneNumber: "",
            sceneNo: "",
            cutNo: "",
            sortOrder: imageAssets.length + index
          });
          savedAssets.push(saved);
          completed += 1;
          setProgressMessage(`저장 중 ${completed}/${value.results.length}`);
        });
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
            sortOrder: imageAssets.length + index
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
            sortOrder: imageAssets.length + index
          });
          savedAssets.push(saved);
          completed += 1;
          setProgressMessage(`저장 중 ${completed}/${value.results.length}`);
        });
      }
      closeImport();
      setProgressMessage("");
      mergeUploadedAssets(pendingImport.assetType, savedAssets);
      return {
        total: value.results.length,
        succeededResultIds: value.results.map((result) => result.id),
        failures: []
      };
    } catch (error) {
      if (savedAssets.length > 0) {
        mergeUploadedAssets(pendingImport.assetType, savedAssets);
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
    if (!projectId || !pendingConfirm || !canEdit) return;
    setIsSaving(true);
    setErrorMessage("");
    let deletedCount = 0;
    const failures: string[] = [];
    try {
      if (pendingConfirm.assetIds.length > 0) {
        try {
          await deleteProjectReferenceAssets(projectId, pendingConfirm.assetIds);
          removeAssetsFromLocalState(pendingConfirm.assetIds);
          deletedCount += pendingConfirm.assetIds.length;
        } catch (error) {
          failures.push(error instanceof Error ? error.message : "선택한 이미지를 삭제하지 못했습니다.");
        }
      }
      for (const item of pendingConfirm.diagrams) {
        try {
          await deleteOverheadDiagramArchive(projectId, item.id);
          removeDiagramsFromLocalState([item.id]);
          deletedCount += 1;
        } catch (error) {
          failures.push(error instanceof Error ? error.message : "부감도를 삭제하지 못했습니다.");
        }
      }
      setPendingConfirm(null);
      if (failures.length === 0) {
        clearSelection();
      } else {
        setSelectionMode(selectedKeysRef.current.size > 0);
        setErrorMessage([
          deletedCount > 0 ? `${deletedCount}개 삭제됨` : "",
          `${failures.length}개 삭제 실패`,
          failures[0]
        ].filter(Boolean).join(" · "));
      }
    } finally {
      setIsSaving(false);
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
    let nextSize = 0;
    updateSelectedKeys((current) => {
      const next = new Set(current);
      if (scopeSelectionKeys.every((key) => current.has(key))) {
        for (const key of scopeSelectionKeys) next.delete(key);
      } else {
        for (const key of scopeSelectionKeys) next.add(key);
      }
      nextSize = next.size;
      return next;
    });
    setSelectionMode(nextSize > 0);
  }

  async function deleteSelectedAssets() {
    if (!projectId || selectedKeys.size === 0) return;
    try {
      const assetInspection = selectedReferenceAssetIds.length > 0
        ? await inspectProjectReferenceAssets(projectId, selectedReferenceAssetIds)
        : null;
      setPendingConfirm({
        assetIds: selectedReferenceAssetIds,
        diagrams: selectedDiagramItems,
        linkedAssetCount: assetInspection?.linkedAssetCount ?? 0,
        label: selectedCount ? `선택한 ${selectedCount}개 항목` : "선택한 항목"
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "삭제할 자료를 확인하지 못했습니다.");
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

  function beginArchiveSelectionPress(
    kind: ArchiveSelectionKind,
    id: string,
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    if (!canEdit || event.button !== 0) return;
    if (editingAsset) closeMetadata();
    cancelArchivePointerSession();
    selectionPointerCleanupRef.current?.();

    const key = archiveSelectionKey(kind, id);
    const state: ArchivePointerSession = {
      key,
      kind,
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      longPressed: false,
      timeoutId: 0,
      target: event.currentTarget,
      previousTouchAction: event.currentTarget.style.touchAction
    };

    try {
      state.target.setPointerCapture(state.pointerId);
    } catch {
      // Document listeners keep long press selection active when capture is unavailable.
    }

    state.timeoutId = window.setTimeout(() => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.longPressed = true;
      current.target.style.touchAction = "none";
      suppressArchiveClickRef.current = current.key;
      setSelectionMode(true);
      setPressedSelectionKey(current.key);
      updateSelectedKeys((selected) => new Set(selected).add(current.key));
      if (navigator.vibrate) navigator.vibrate(18);
    }, LONG_PRESS_MS);
    longPressRef.current = state;

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      const distance = Math.hypot(
        pointerEvent.clientX - current.startX,
        pointerEvent.clientY - current.startY
      );
      if (!current.longPressed && distance > LONG_PRESS_MOVE_TOLERANCE) {
        cancelArchivePointerSession();
        return;
      }
      if (current.longPressed && pointerEvent.cancelable) pointerEvent.preventDefault();
    };
    const finishPointerSession = (pointerEvent: PointerEvent) => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      const wasLongPressed = current.longPressed;
      const selectedKey = current.key;
      if (wasLongPressed) suppressArchiveClickRef.current = selectedKey;
      cancelArchivePointerSession();
      if (wasLongPressed) {
        window.setTimeout(() => {
          if (suppressArchiveClickRef.current === selectedKey) {
            suppressArchiveClickRef.current = null;
          }
        }, 700);
      }
    };
    const handleTouchMove = (touchEvent: TouchEvent) => {
      if (longPressRef.current?.longPressed && touchEvent.cancelable) {
        touchEvent.preventDefault();
      }
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishPointerSession);
      document.removeEventListener("pointercancel", finishPointerSession);
      document.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("blur", cancelArchivePointerSession);
      selectionPointerCleanupRef.current = null;
    };
    selectionPointerCleanupRef.current = cleanup;
    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", finishPointerSession);
    document.addEventListener("pointercancel", finishPointerSession);
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("blur", cancelArchivePointerSession);
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
    selectionPointerCleanupRef.current?.();
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

  async function saveMetadata() {
    if (!projectId || !editingAsset || !canEdit) return;
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
    setMetadataError("");
    setIsSaving(true);
    try {
      const updated = await updateProjectReferenceAsset(projectId, editingAsset.id, {
        sceneId: metadataDraft.sceneId || null,
        sceneNumber: selectedScene?.sceneNo || "",
        cutNumber,
        sceneNo: selectedScene?.sceneNo || "",
        cutNo: cutNumber ? String(cutNumber) : ""
      });
      replaceAssetInLocalState(updated);
      closeMetadata();
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : "자료 정보를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveAssetName() {
    if (!projectId || !renamingAsset || !canEdit) return;
    const displayName = renameDraft.trim();
    if (!displayName) {
      setRenameError("이름을 입력해주세요.");
      return;
    }
    setRenameError("");
    setIsSaving(true);
    try {
      const updated = await updateProjectReferenceAsset(projectId, renamingAsset.id, {
        title: displayName,
        displayName
      });
      replaceAssetInLocalState(updated);
      setRenamingAsset(null);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "이름을 변경하지 못했습니다.");
    } finally {
      setIsSaving(false);
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
      || !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      return;
    }
    cancelArchivePointerSession();
    openMetadata(asset, event);
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  return (
    <>
      <div
        className="mx-auto grid w-full max-w-6xl select-none gap-4 [&_input]:select-text [&_textarea]:select-text"
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display truncate text-xl font-black text-field-primary">부감도&콘티 아카이브</h1>
            <p className="truncate text-xs font-bold text-field-muted">{projectName} · 컷에 연결하기 전 프로젝트 공통 자료</p>
          </div>
          {!canEdit ? <span className="rounded-[3px] border border-field-border bg-white px-3 py-2 text-xs font-black text-field-muted">읽기 전용</span> : null}
        </div>

        {errorMessage ? <p role="alert" className="rounded-xl border border-field-danger bg-red-50 px-3 py-2 text-sm font-bold text-field-danger">{errorMessage}</p> : null}
        {statusMessage ? (
          <p role="status" className="rounded-xl border border-field-border bg-field-soft/55 px-3 py-2 text-xs font-bold text-field-muted">
            {statusMessage}
          </p>
        ) : null}
        {isPreparing || progressMessage ? (
          <div className="grid justify-items-center gap-2 py-2">
            <PixelDogLoader size="sm" />
            <p className="text-xs font-bold text-field-muted">{progressMessage}</p>
          </div>
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
                      ? "border-[#ef8f39] bg-[#fff3e7] text-[#a75412]"
                      : "border-field-border bg-field-soft/45 text-field-primary"
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
                    <p className="text-sm font-black">{label} 파일 놓기</p>
                    <p className="text-[11px] font-bold text-field-muted">PDF · JPG · JPEG · PNG · WebP</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <Card className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-[auto_minmax(12rem,1fr)_auto] sm:items-center">
            <div className="grid grid-cols-3 gap-2">
              {(["all", "overhead", "storyboard"] as const).map((type) => (
                <button key={type} type="button" onClick={() => setActiveType(type)} className={`min-h-10 rounded-[3px] border px-4 text-sm font-black ${activeType === type ? "border-field-primary bg-field-primary text-white" : "border-field-border bg-white text-field-primary"}`}>
                  {type === "all" ? "전체" : type === "overhead" ? "부감도" : "콘티"}
                </button>
              ))}
            </div>
            <label className="relative block min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-field-muted" aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-10 w-full rounded-[3px] border border-field-border bg-white pl-9 pr-3 text-sm" placeholder="제목, 메모, 씬, 컷 검색" />
            </label>
            {canEdit ? (
              <div className="flex flex-wrap justify-end gap-2">
                {activeType !== "storyboard" ? (
                  <button type="button" onClick={openNewDiagram} className="inline-flex min-h-10 items-center gap-1.5 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                    <MapIcon className="h-4 w-4" aria-hidden />
                    직접 만들기
                  </button>
                ) : null}
                {selectedArchiveType ? (
                  <>
                    <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                      <ImagePlus className="h-4 w-4" aria-hidden />
                      이미지
                      <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple className="sr-only" disabled={isPreparing || isSaving} onChange={(event) => prepareImages(selectedArchiveType, event)} />
                    </label>
                    <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[3px] bg-field-primary px-3 text-xs font-black text-white">
                      <Upload className="h-4 w-4" aria-hidden />
                      PDF
                      <input type="file" accept="application/pdf,.pdf" multiple className="sr-only" disabled={isPreparing || isSaving} onChange={(event) => preparePdf(selectedArchiveType, event)} />
                    </label>
                  </>
                ) : (
                  (["overhead", "storyboard"] as const).map((type) => (
                    <label key={type} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                      <Upload className="h-4 w-4" aria-hidden />
                      {type === "overhead" ? "부감도 업로드" : "콘티 업로드"}
                      <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" multiple className="sr-only" disabled={isPreparing || isSaving} onChange={(event) => prepareMixedUpload(type, event)} />
                    </label>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-field-border pt-3">
            <span className="text-xs font-bold text-field-muted">
              자료 {archiveGroups.reduce((count, group) => count + group.items.length, sourceAssets.length)}개
            </span>
            {canEdit ? (
              <button
                type="button"
                disabled={scopeSelectionKeys.length === 0 || isSaving}
                onClick={toggleCurrentAssetScope}
                className="min-h-9 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary disabled:opacity-40"
                aria-pressed={allScopeAssetsSelected}
              >
                {allScopeAssetsSelected ? "전체 해제" : "전체 선택"}
              </button>
            ) : null}
          </div>
          {canEdit && selectedCount > 0 ? (
            <div className="fixed inset-x-3 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-[3px] border border-field-border bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
              <span className="text-xs font-black text-field-primary">
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
                  className="inline-flex min-h-9 items-center gap-1 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary disabled:opacity-50"
                >
                  <Crop className="h-3.5 w-3.5" aria-hidden />
                  크롭
                </button>
              ) : null}
              {selectedCount === 1 ? (
                <button type="button" onClick={editSingleSelectedItem} className="inline-flex min-h-9 items-center gap-1 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                  <Info className="h-3.5 w-3.5" aria-hidden />
                  {singleSelectedReferenceAsset ? "정보 수정" : "정보"}
                </button>
              ) : null}
              {singleSelectedReferenceAsset ? (
                <button type="button" onClick={renameSingleSelectedAsset} className="inline-flex min-h-9 items-center gap-1 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                  이름 변경
                </button>
              ) : null}
              <button type="button" disabled={isSaving || selectedCount === 0} onClick={() => void deleteSelectedAssets()} className="inline-flex min-h-9 items-center gap-1 rounded-[3px] border border-field-danger bg-white px-3 text-xs font-black text-field-danger disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                삭제
              </button>
              <button type="button" onClick={clearSelection} className="min-h-9 rounded-[3px] px-3 text-xs font-black text-field-muted">
                선택 해제
              </button>
            </div>
          ) : null}
          <p className="text-xs font-bold text-field-muted">업로드한 자료는 진행도에 자동 적용되지 않습니다. 진행도 컷 카드에서 명시적으로 선택해야 표시됩니다.</p>
        </Card>

        <Card className="grid gap-3">
          <div>
            <h2 className="font-display text-lg font-black text-field-primary">{activeType === "all" ? "전체" : activeType === "overhead" ? "부감도" : "콘티"} 자료</h2>
            <p className="text-xs font-bold text-field-muted">이미지 원본 비율을 유지하며 모서리를 자르지 않습니다.</p>
          </div>
          {archiveGroups.length === 0 ? (
            <p className="py-10 text-center text-sm font-bold text-field-muted">등록된 {activeType === "all" ? "아카이브" : activeType === "overhead" ? "부감도" : "콘티"} 자료가 없습니다.</p>
          ) : (
            <div className="grid min-w-0 gap-5">
              {archiveGroups.map((group) => (
                <section key={group.key} className="grid min-w-0 gap-2" aria-labelledby={`archive-group-${group.key}`}>
                  <h3
                    id={`archive-group-${group.key}`}
                    className="border-b border-field-border pb-1 text-sm font-black text-field-primary"
                  >
                    {group.label}
                  </h3>
                  <div className="grid min-w-0 select-none grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {group.items.map((item) => {
                      const key = archiveSelectionKey(item.kind, item.id);
                      const selected = selectedKeys.has(key);
                      if (item.kind === "diagram") {
                        const diagram = item.diagram;
                        return (
                          <article
                            key={key}
                            onContextMenu={(event) => event.preventDefault()}
                            className={`relative grid min-w-0 select-none grid-rows-[minmax(0,1fr)_auto] gap-1.5 border bg-white p-2 transition ${
                              selected
                                ? "border-[#ef8f39] bg-[#fff8f0] ring-2 ring-[#ef8f39]/45"
                                : "border-field-border"
                            } ${pressedSelectionKey === key ? "scale-[0.92] border-[#ef8f39]" : ""}`}
                          >
                            <button
                              type="button"
                              onPointerDown={(event) => {
                                if (!diagram.legacy) beginArchiveSelectionPress("diagram", diagram.id, event);
                              }}
                              onClick={(event) => {
                                if (suppressArchiveClickRef.current === key) {
                                  suppressArchiveClickRef.current = null;
                                  event.preventDefault();
                                  return;
                                }
                                if (selectionMode && !diagram.legacy) {
                                  event.preventDefault();
                                  toggleArchiveSelection("diagram", diagram.id);
                                  return;
                                }
                                openDiagram(diagram, false);
                              }}
                              className="grid min-w-0 aspect-[4/3] touch-pan-y place-items-center bg-field-soft"
                              aria-pressed={selectionMode && !diagram.legacy ? selected : undefined}
                            >
                              <ShotOverheadPreview diagram={diagram.diagram} label="부감도 미리보기" />
                            </button>
                            <ArchiveCutText cutNo={item.cutLabel} typeLabel={activeType === "all" ? "부감도" : undefined} />
                          </article>
                        );
                      }

                      const asset = item.asset;
                      return (
                        <article
                          key={key}
                          className={`relative grid min-w-0 max-w-full select-none grid-rows-[minmax(0,1fr)_auto] gap-1.5 border bg-white p-2 transition ${
                            selected
                              ? "border-[#ef8f39] bg-[#fff8f0] ring-2 ring-[#ef8f39]/45"
                              : "border-field-border"
                          } ${pressedSelectionKey === key ? "scale-[0.92] border-[#ef8f39]" : ""}`}
                        >
                          <button
                            type="button"
                            onPointerDown={(event) => beginArchiveSelectionPress("asset", asset.id, event)}
                            onClick={(event) => {
                              if (suppressArchiveClickRef.current === key) {
                                suppressArchiveClickRef.current = null;
                                event.preventDefault();
                                return;
                              }
                              if (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) {
                                event.preventDefault();
                                toggleArchiveSelection("asset", asset.id);
                                return;
                              }
                              setPreview({ url: asset.publicUrl, title: archiveDisplayName(asset) });
                            }}
                            className="grid min-w-0 max-w-full aspect-[4/3] touch-pan-y place-items-center overflow-hidden bg-field-soft p-1"
                            aria-pressed={selectionMode ? selected : undefined}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={asset.crop.thumbnailUrl || asset.publicUrl}
                              alt={archiveDisplayName(asset)}
                              loading="lazy"
                              decoding="async"
                              draggable={false}
                              onContextMenu={(event) => openAssetContextMenu(asset, event)}
                              onDragStart={(event) => event.preventDefault()}
                              className="block h-full w-full rounded-none object-contain"
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
                </section>
              ))}
            </div>
          )}
        </Card>

        {sourceAssets.length > 0 ? (
          <Card className="grid gap-3">
            <div>
              <h2 className="font-display text-base font-black text-field-primary">보존된 원본</h2>
              <p className="text-xs font-bold text-field-muted">PDF와 crop 전 이미지입니다. 추출 결과를 삭제해도 원본은 별도 자료로 남습니다.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sourceAssets.map((asset) => {
                const key = archiveSelectionKey("asset", asset.id);
                const selected = selectedKeys.has(key);
                return (
                  <article
                    key={asset.id}
                    className={`flex min-w-0 items-center gap-2 border bg-white p-2 transition-[transform,border-color,background-color,box-shadow] ${
                      selected
                        ? "border-[#ef8f39] bg-[#fff8f0] ring-2 ring-[#ef8f39]/45"
                        : "border-field-border"
                    } ${pressedSelectionKey === key ? "scale-[0.92]" : ""}`}
                  >
                    <button
                      type="button"
                      onPointerDown={(event) => beginArchiveSelectionPress("asset", asset.id, event)}
                      onClick={(event) => {
                        if (suppressArchiveClickRef.current === key) {
                          suppressArchiveClickRef.current = null;
                          event.preventDefault();
                          return;
                        }
                        if (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) {
                          event.preventDefault();
                          toggleArchiveSelection("asset", asset.id);
                          return;
                        }
                        if (detectArchiveCropSourceKind({
                          mimeType: asset.mimeType,
                          filename: asset.filename
                        }) === "image") {
                          setPreview({ url: asset.publicUrl, title: archiveDisplayName(asset) });
                        } else {
                          window.open(asset.publicUrl, "_blank", "noopener,noreferrer");
                        }
                      }}
                      className="flex min-w-0 flex-1 touch-pan-y items-center gap-3 p-1 text-left"
                      aria-pressed={selectionMode ? selected : undefined}
                    >
                      {detectArchiveCropSourceKind({
                        mimeType: asset.mimeType,
                        filename: asset.filename
                      }) === "pdf"
                        ? <FileText className="h-7 w-7 shrink-0 text-field-primary" aria-hidden />
                        : <FileImage className="h-7 w-7 shrink-0 text-field-primary" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-black text-field-text">{archiveDisplayName(asset)}</span>
                        <span className="block text-[11px] font-bold text-field-primary underline underline-offset-2">원본 보기</span>
                      </span>
                    </button>
                    {canEdit && asset.assetType === "storyboard" && detectArchiveCropSourceKind({ mimeType: asset.mimeType, filename: asset.filename }) ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void cropStoredAsset(asset);
                        }}
                        className="min-h-9 shrink-0 rounded-[3px] border border-field-border px-3 text-[11px] font-black text-field-primary"
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
          isSaving={isSaving}
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
            message={[
              `${pendingConfirm.label}을 삭제할까요?`,
              pendingConfirm.linkedAssetCount > 0
                ? `진행도에 연결된 파일 ${pendingConfirm.linkedAssetCount}개의 연결도 해제됩니다.`
                : "",
              pendingConfirm.diagrams.length > 0
                ? "선택한 직접 만든 부감도의 연결 정보도 함께 삭제됩니다."
                : ""
            ].filter(Boolean).join(" ")}
            isSaving={isSaving}
            onConfirm={() => void confirmPendingAction()}
            onCancel={() => setPendingConfirm(null)}
          />
        </div>
      ) : null}
      <ImagePreviewModal imageUrl={preview?.url ?? null} title={preview?.title ?? "자료"} onClose={() => setPreview(null)} />
    </>
  );
}

function ArchiveCutText({ cutNo, typeLabel }: { cutNo: string; typeLabel?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-1 px-1">
      <p className="truncate text-[11px] font-black text-field-muted">
        {cutNo ? `C#${cutNo}` : "컷 미지정"}
      </p>
      {typeLabel ? <span className="shrink-0 text-[10px] font-bold text-field-muted">{typeLabel}</span> : null}
    </div>
  );
}

function CompactConfirm({
  message,
  isSaving,
  onConfirm,
  onCancel
}: {
  message: string;
  isSaving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-[3px] border border-field-border bg-white p-3 shadow-lg" role="alertdialog" aria-label="삭제 확인">
      <p className="min-w-0 flex-1 text-xs font-bold leading-5 text-field-text">{message}</p>
      <button type="button" disabled={isSaving} onClick={onCancel} className="min-h-9 rounded-[3px] border border-field-border px-3 text-xs font-black text-field-muted disabled:opacity-50">
        취소
      </button>
      <button type="button" disabled={isSaving} onClick={onConfirm} className="min-h-9 rounded-[3px] bg-field-danger px-3 text-xs font-black text-white disabled:opacity-50">
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
      className={`fixed z-[140] grid max-h-[min(70dvh,22rem)] gap-3 overflow-y-auto rounded-[3px] border border-field-border bg-white p-3 shadow-lg ${
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
        <h2 className="font-display text-base font-black text-field-primary">정보 수정</h2>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center border border-field-border" aria-label="정보 수정 닫기">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <label className="grid gap-1 text-xs font-black text-field-muted">
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
          className="min-h-10 border border-field-border bg-white px-3 text-sm text-field-text"
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
      <label className="grid gap-1 text-xs font-black text-field-muted">
        컷
        <select
          disabled={!selectedScene || maxCut < 1}
          value={value.cutNo}
          onChange={(event) => onChange({ ...value, cutNo: event.target.value })}
          className="min-h-10 border border-field-border bg-white px-3 text-sm text-field-text disabled:bg-field-soft disabled:text-field-muted"
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
        <button type="button" disabled={isSaving} onClick={onClose} className="min-h-10 border border-field-border px-3 text-sm font-black text-field-muted disabled:opacity-50">취소</button>
        <button type="button" disabled={isSaving} onClick={onSave} className="min-h-10 bg-field-primary px-3 text-sm font-black text-white disabled:opacity-50">{isSaving ? "저장 중" : "저장"}</button>
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
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[86] mx-auto grid max-w-sm gap-3 border border-field-border bg-white p-3 shadow-lg sm:inset-x-auto sm:left-1/2 sm:w-[19rem] sm:-translate-x-1/2"
      role="dialog"
      aria-label="자료 이름 변경"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-black text-field-primary">이름 변경</h2>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center border border-field-border" aria-label="이름 변경 닫기">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <label className="grid gap-1 text-xs font-black text-field-muted">
        이름
        <input
          autoFocus
          value={value}
          maxLength={240}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-10 border border-field-border bg-white px-3 text-sm text-field-text"
        />
      </label>
      {errorMessage ? <p role="alert" className="text-xs font-bold text-field-danger">{errorMessage}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={isSaving} onClick={onClose} className="min-h-10 border border-field-border px-3 text-sm font-black text-field-muted disabled:opacity-50">취소</button>
        <button type="button" disabled={isSaving} onClick={onSave} className="min-h-10 bg-field-primary px-3 text-sm font-black text-white disabled:opacity-50">{isSaving ? "저장 중" : "저장"}</button>
      </div>
    </section>
  );
}

function DiagramMetadataBar({ value, onChange }: { value: DiagramDraft; onChange: (value: DiagramDraft) => void }) {
  return (
    <div className="fixed left-1/2 top-[max(0.5rem,env(safe-area-inset-top))] z-[90] flex w-[min(92vw,44rem)] -translate-x-1/2 flex-wrap gap-1 rounded-xl border border-field-border bg-white p-2 shadow-lg">
      <input value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} className="min-h-9 min-w-0 flex-[2] rounded-lg border border-field-border px-2 text-xs" placeholder="부감도 제목" />
      <input value={value.sceneNo} onChange={(event) => onChange({ ...value, sceneNo: event.target.value })} className="min-h-9 w-16 rounded-lg border border-field-border px-2 text-xs" placeholder="씬" />
      <input value={value.cutNo} onChange={(event) => onChange({ ...value, cutNo: event.target.value })} className="min-h-9 w-16 rounded-lg border border-field-border px-2 text-xs" placeholder="컷" />
      <input value={value.memo} onChange={(event) => onChange({ ...value, memo: event.target.value })} className="min-h-9 min-w-0 flex-[3] rounded-lg border border-field-border px-2 text-xs" placeholder="메모" />
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
    key: "unassigned",
    label: "미지정",
    scene: null,
    items: []
  };

  for (const asset of dedupeArchiveAssets(assets)) {
    const scene = asset.crop.sceneId ? sceneById.get(asset.crop.sceneId) ?? null : null;
    const group = scene
      ? groupsBySceneId.get(scene.id) ?? {
          key: `scene-${scene.id}`,
          label: `S#${scene.sceneNo}`,
          scene,
          items: []
        }
      : unassigned;
    if (scene && !groupsBySceneId.has(scene.id)) groupsBySceneId.set(scene.id, group);
    group.items.push(toArchiveAssetGroupItem(asset, scene));
  }

  const uniqueDiagrams = new Map(diagrams.map((diagram) => [diagram.id, diagram]));
  for (const diagram of uniqueDiagrams.values()) {
    // 직접 만든 기존 부감도에는 stable sceneId가 없으므로 sceneNo로 관계를 추측하지 않습니다.
    unassigned.items.push(toArchiveDiagramGroupItem(diagram));
  }

  const groups = [...groupsBySceneId.values()].sort((left, right) => {
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
    sortOrder: Number.isFinite(asset.sortOrder) ? asset.sortOrder : Number.MAX_SAFE_INTEGER,
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
  return /^(?:image\/jpeg|image\/png|image\/webp)$/i.test(file.type)
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

function errorMessageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

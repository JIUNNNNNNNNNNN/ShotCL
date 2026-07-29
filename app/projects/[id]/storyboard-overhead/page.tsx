"use client";

import dynamic from "next/dynamic";
import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ArrowUp,
  ChevronRight,
  Clapperboard,
  Crop,
  FileImage,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Home,
  ImagePlus,
  Info,
  Map as MapIcon,
  Move,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useParams } from "next/navigation";
import {
  ArchiveImportDialog,
  type ArchiveImportCommit,
  type ArchiveImportSaveFailure,
  type ArchiveImportSaveReport
} from "@/components/ArchiveImportDialog";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import { Card } from "@/components/ui/Card";
import {
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
  type ArchiveFolderIssue,
  type ArchiveFolderScanResult
} from "@/lib/client/archiveFolderDrop";
import {
  createProjectArchiveFolder,
  deleteProjectArchiveFolders,
  deleteProjectReferenceAssets,
  inspectProjectArchiveFolders,
  inspectProjectReferenceAssets,
  listProjectArchiveFolders,
  listProjectReferenceAssets,
  moveProjectArchiveSelection,
  renameProjectArchiveFolderTree,
  updateProjectReferenceAsset,
  uploadProjectReferenceAsset
} from "@/lib/data/projectReferenceAssets";
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
  ProjectArchiveFolder,
  ProjectArchiveFolderInspection,
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
type PendingImport = {
  assetType: ArchiveType;
  sourceKind: "pdf" | "images" | "mixed";
  sourceFiles: File[];
  sourceLabel: string;
  pages: ArchiveImportPage[];
  folderId: string | null;
  importBatchId: string;
  baseSortOrder: number;
  fileMetadata: Array<{ originalFolderName: string; relativePath: string }>;
  existingSourceAssetIds?: string[];
  inheritedAssets?: Array<ProjectReferenceAsset | null>;
};

type FolderEditor = {
  mode: "create" | "rename";
  folderPath?: string;
  value: string;
};

type PendingConfirm =
  | {
    kind: "folder";
    folderPath: string;
    folderIds: string[];
    folderInspection: ProjectArchiveFolderInspection;
  }
  | {
    kind: "selection";
    assetIds: string[];
    diagrams: OverheadDiagramArchiveItem[];
    folderIds: string[];
    folderInspection: ProjectArchiveFolderInspection | null;
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
  left: number;
  top: number;
};

type FolderUploadReport = {
  discoveredCount: number;
  supportedCount: number;
  uploadedCount: number;
  skipped: ArchiveFolderIssue[];
  failed: ArchiveFolderIssue[];
  verified: boolean;
};

type ArchiveSelectionKind = "asset" | "diagram" | "folder";
type ArchiveSelectionKey = `${ArchiveSelectionKind}:${string}`;

type ArchivePointerSession = {
  key: ArchiveSelectionKey;
  kind: ArchiveSelectionKind;
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  longPressed: boolean;
  dragging: boolean;
  timeoutId: number;
  target: HTMLButtonElement;
  clientX: number;
  clientY: number;
  dragKeys: ArchiveSelectionKey[];
  dropFolderId: string | null;
  previousTouchAction: string;
};

type ArchiveDragPreviewItem = {
  key: ArchiveSelectionKey;
  kind: "asset" | "folder";
  label: string;
  thumbnailUrl: string;
};

const PAGE_SIZE = 48;
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE = 9;
const DRAG_START_DISTANCE = 8;
const SELECTION_SCROLL_EDGE = 72;

export default function ProjectStoryboardOverheadPage() {
  const params = useParams<{ id: string | string[] }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const [projectName, setProjectName] = useState("");
  const [activeType, setActiveType] = useState<ArchiveType>("overhead");
  const [overheads, setOverheads] = useState<ProjectReferenceAsset[]>([]);
  const [storyboards, setStoryboards] = useState<ProjectReferenceAsset[]>([]);
  const [folders, setFolders] = useState<ProjectArchiveFolder[]>([]);
  const [sceneItems, setSceneItems] = useState<ProjectSceneItem[]>([]);
  const [diagramArchives, setDiagramArchives] = useState<OverheadDiagramArchiveItem[]>([]);
  const [query, setQuery] = useState("");
  const [currentFolderPath, setCurrentFolderPath] = useState("");
  const [sortMode, setSortMode] = useState<"newest" | "name" | "scene">("newest");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<ArchiveSelectionKey>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [moveFolderId, setMoveFolderId] = useState("");
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importSaveReport, setImportSaveReport] = useState<ArchiveImportSaveReport | null>(null);
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
  const [folderEditor, setFolderEditor] = useState<FolderEditor | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [supportsDesktopDrop, setSupportsDesktopDrop] = useState(false);
  const [dragDepth, setDragDepth] = useState<Record<ArchiveType, number>>({ overhead: 0, storyboard: 0 });
  const [pressedSelectionKey, setPressedSelectionKey] = useState<ArchiveSelectionKey | null>(null);
  const [dragPreviewKeys, setDragPreviewKeys] = useState<ArchiveSelectionKey[]>([]);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const [folderUploadReport, setFolderUploadReport] = useState<FolderUploadReport | null>(null);
  const preparingRef = useRef(false);
  const folderUploadRef = useRef<HTMLInputElement | null>(null);
  const longPressRef = useRef<ArchivePointerSession | null>(null);
  const selectionPointerCleanupRef = useRef<(() => void) | null>(null);
  const selectionScrollFrameRef = useRef<number | null>(null);
  const suppressArchiveClickRef = useRef<ArchiveSelectionKey | null>(null);
  const selectedKeysRef = useRef<Set<ArchiveSelectionKey>>(new Set());
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const dragPositionFrameRef = useRef<number | null>(null);
  const bodyUserSelectRef = useRef("");
  const pendingImportRef = useRef<PendingImport | null>(null);
  const savedImportResultIdsRef = useRef(new Set<string>());
  const importResultAssetIdsRef = useRef(new Map<string, string>());

  const loadArchive = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [project, overheadAssets, storyboardAssets, diagrams, folderResult, sceneResult] = await Promise.all([
        getProject(projectId),
        listProjectReferenceAssets(projectId, "overhead"),
        listProjectReferenceAssets(projectId, "storyboard"),
        listOverheadDiagramArchive(projectId),
        listProjectArchiveFolders(projectId)
          .then((value) => ({ value, error: "" }))
          .catch((error: unknown) => ({
            value: [] as ProjectArchiveFolder[],
            error: error instanceof Error ? error.message : "아카이브 폴더를 불러오지 못했습니다."
          })),
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
      setFolders(folderResult.value);
      setSceneItems(sceneResult.value);
      setErrorMessage(folderResult.error || sceneResult.error);
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
    setVisibleCount(PAGE_SIZE);
    selectedKeysRef.current = new Set();
    setSelectedKeys(new Set());
    setSelectionMode(false);
  }, [activeType, currentFolderPath, query, sortMode]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(""), 5_000);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  useEffect(() => {
    if (
      currentFolderPath
      && !folders.some((folder) => (
        isArchivePathWithin(normalizeArchiveFolderPath(folder.name), currentFolderPath)
      ))
    ) {
      setCurrentFolderPath("");
    }
  }, [currentFolderPath, folders]);

  useEffect(() => () => {
    selectionPointerCleanupRef.current?.();
    if (selectionScrollFrameRef.current !== null) cancelAnimationFrame(selectionScrollFrameRef.current);
    if (dragPositionFrameRef.current !== null) cancelAnimationFrame(dragPositionFrameRef.current);
    const longPress = longPressRef.current;
    if (longPress) window.clearTimeout(longPress.timeoutId);
    document.body.style.userSelect = bodyUserSelectRef.current;
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

  const activeAssets = activeType === "overhead" ? overheads : storyboards;
  const folderPathById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, normalizeArchiveFolderPath(folder.name)])),
    [folders]
  );
  const folderByPath = useMemo(
    () => new Map(folders.map((folder) => [normalizeArchiveFolderPath(folder.name), folder])),
    [folders]
  );
  const currentFolder = folderByPath.get(currentFolderPath) ?? null;
  const currentFolderId = currentFolder?.id ?? null;
  const childFolders = useMemo(
    () => getArchiveChildFolders(folders, activeAssets, currentFolderPath, folderPathById),
    [activeAssets, currentFolderPath, folderPathById, folders]
  );
  const breadcrumbs = useMemo(
    () => archiveBreadcrumbs(currentFolderPath),
    [currentFolderPath]
  );
  const sourceAssets = useMemo(
    () => activeAssets.filter((asset) => {
      const sourceKind = detectArchiveCropSourceKind({
        mimeType: asset.mimeType,
        filename: asset.filename
      });
      const isSource = sourceKind === "pdf" || asset.groupId?.startsWith("source:");
      const assetPath = folderPathById.get(asset.crop.folderId || "") ?? "";
      const folderMatches = assetPath === currentFolderPath;
      return isSource && folderMatches && matchesAssetQuery(asset, query);
    }),
    [activeAssets, currentFolderPath, folderPathById, query]
  );
  const imageAssets = useMemo(
    () => activeAssets.filter((asset) => (
      detectArchiveCropSourceKind({
        mimeType: asset.mimeType,
        filename: asset.filename
      }) === "image"
      && !asset.groupId?.startsWith("source:")
    )),
    [activeAssets]
  );
  const filteredAssets = useMemo(() => {
    const filtered = imageAssets.filter((asset) => {
      const assetPath = folderPathById.get(asset.crop.folderId || "") ?? "";
      const folderMatches = assetPath === currentFolderPath;
      return folderMatches && matchesAssetQuery(asset, query);
    });
    return [...filtered].sort((left, right) => {
      if (sortMode === "name") {
        return archiveDisplayName(left).localeCompare(archiveDisplayName(right), "ko-KR");
      }
      if (sortMode === "scene") {
        return `${left.sceneNo || ""}-${left.cutNo || ""}`.localeCompare(
          `${right.sceneNo || ""}-${right.cutNo || ""}`,
          "ko-KR",
          { numeric: true }
        );
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [currentFolderPath, folderPathById, imageAssets, query, sortMode]);
  const visibleAssets = filteredAssets.slice(0, visibleCount);
  const filteredDiagrams = useMemo(
    () => activeType === "overhead" && currentFolderPath === ""
      ? diagramArchives.filter((item) => matchesDiagramQuery(item, query))
      : [],
    [activeType, currentFolderPath, diagramArchives, query]
  );
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
  const selectedFolderIds = useMemo(
    () => folders
      .filter((folder) => selectedKeys.has(archiveSelectionKey("folder", folder.id)))
      .map((folder) => folder.id),
    [folders, selectedKeys]
  );
  const selectedCount = (
    selectedReferenceAssetIds.length
    + selectedDiagramItems.length
    + selectedFolderIds.length
  );
  const singleSelectedReferenceAsset = selectedCount === 1
    ? [...overheads, ...storyboards].find((asset) => (
      selectedKeys.has(archiveSelectionKey("asset", asset.id))
    )) ?? null
    : null;
  const canCropSingleSelection = Boolean(
    canEdit
    && activeType === "storyboard"
    && singleSelectedReferenceAsset
    && detectArchiveCropSourceKind({
      mimeType: singleSelectedReferenceAsset.mimeType,
      filename: singleSelectedReferenceAsset.filename
    })
  );
  const dragPreviewItems = useMemo<ArchiveDragPreviewItem[]>(() => {
    const allAssets = [...overheads, ...storyboards];
    return dragPreviewKeys.flatMap<ArchiveDragPreviewItem>((key) => {
      const parsed = parseArchiveSelectionKey(key);
      if (!parsed) return [];
      if (parsed.kind === "asset") {
        const asset = allAssets.find((entry) => entry.id === parsed.id);
        return asset ? [{
          key,
          kind: "asset" as const,
          label: archiveDisplayName(asset),
          thumbnailUrl: asset.crop.thumbnailUrl || asset.publicUrl
        }] : [];
      }
      if (parsed.kind === "folder") {
        const folder = folders.find((entry) => entry.id === parsed.id);
        return folder ? [{
          key,
          kind: "folder" as const,
          label: archiveBaseName(folder.name),
          thumbnailUrl: ""
        }] : [];
      }
      return [];
    });
  }, [dragPreviewKeys, folders, overheads, storyboards]);

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

  function updateAssetsInLocalState(
    assetIds: Iterable<string>,
    update: (asset: ProjectReferenceAsset) => ProjectReferenceAsset
  ) {
    const ids = new Set(assetIds);
    const apply = (current: ProjectReferenceAsset[]) => (
      current.map((asset) => ids.has(asset.id) ? update(asset) : asset)
    );
    setOverheads(apply);
    setStoryboards(apply);
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

  async function prepareFiles(
    assetType: ArchiveType,
    rawFiles: File[],
    expectedKind?: PendingImport["sourceKind"],
    directImageUpload = false,
    context?: {
      folderId?: string | null;
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
    const destinationFolderId = context?.folderId !== undefined
      ? context.folderId
      : currentFolderPath
        ? currentFolderId ?? (await ensureArchiveFolder(currentFolderPath))?.id ?? null
        : null;
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
              folderId: destinationFolderId,
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
        folderId: destinationFolderId,
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
    try {
      setProgressMessage("폴더 읽는 중");
      const scan = await scanArchiveDrop(event.dataTransfer);
      await uploadScannedFiles(assetType, scan);
    } catch (error) {
      setProgressMessage("");
      setErrorMessage(error instanceof Error ? error.message : "폴더를 읽지 못했습니다.");
    }
  }

  function beginImport(nextImport: PendingImport) {
    if (pendingImport) releaseArchivePages(pendingImport.pages);
    savedImportResultIdsRef.current = new Set();
    importResultAssetIdsRef.current = new Map();
    setImportSaveReport(null);
    setPendingImport(nextImport);
  }

  function closeImport() {
    if (pendingImport) releaseArchivePages(pendingImport.pages);
    pendingImportRef.current = null;
    savedImportResultIdsRef.current = new Set();
    importResultAssetIdsRef.current = new Map();
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

    const pendingResults = value.results.filter(
      (result) => !savedImportResultIdsRef.current.has(result.id)
    );
    const preparation = await mapSettledWithConcurrency(
      pendingResults,
      3,
      async (result) => {
        if (!result.crop) throw new Error("crop 범위가 없습니다.");
        const inherited = inheritedArchiveMetadata(currentImport, result.page.sourceFileIndex);
        const baseTitle = value.title || inherited.displayName || "콘티";
        const displayName = pageTitle(baseTitle, result.orderIndex, value.results.length)
          || `콘티_${String(result.orderIndex + 1).padStart(2, "0")}`;
        setProgressMessage(`crop 이미지 생성 중 ${result.orderIndex + 1}/${value.results.length}`);
        const resultFile = await createCroppedArchiveFile(
          result.page,
          result.crop,
          `${displayName}.jpg`
        );
        const thumbnailFile = await createArchiveThumbnail(resultFile);
        return {
          result,
          inherited,
          displayName,
          resultFile,
          thumbnailFile
        };
      }
    );

    const failures: ArchiveImportSaveFailure[] = preparation.flatMap((item) => {
      if (item.status === "fulfilled") return [];
      const result = pendingResults[item.index];
      return [{
        resultId: result.id,
        cropIndex: result.orderIndex + 1,
        label: pageTitle(
          value.title || inheritedArchiveMetadata(currentImport, result.page.sourceFileIndex).displayName,
          result.orderIndex,
          value.results.length
        ) || result.page.name,
        message: errorMessageOf(item.reason, "crop 이미지를 만들지 못했습니다.")
      }];
    });
    const preparedItems = preparation.flatMap((item) => (
      item.status === "fulfilled" ? [item.value] : []
    ));

    if (preparedItems.length > 0) {
      setProgressMessage(`crop Blob ${preparedItems.length}개 준비 완료 · 업로드 시작`);
    }
    const uploads = await mapSettledWithConcurrency(
      preparedItems,
      3,
      async ({ result, inherited, displayName, resultFile, thumbnailFile }, uploadIndex) => {
        const sourceFile = currentImport.sourceFiles[result.page.sourceFileIndex];
        const sourceIsPdf = sourceFile ? isPdfFile(sourceFile) : currentImport.sourceKind === "pdf";
        setProgressMessage(`crop 결과 업로드 중 ${uploadIndex + 1}/${preparedItems.length}`);
        const saved = await uploadProjectReferenceAsset(
          projectId,
          "storyboard",
          resultFile,
          {
            assetId: stableImportAssetId(result.id),
            thumbnailFile,
            sourceType: sourceIsPdf ? "pdf_crop" : "image_crop",
            sourceAssetId: currentImport.existingSourceAssetIds?.[result.page.sourceFileIndex] || undefined,
            pageIndex: result.page.index,
            groupId: currentImport.importBatchId,
            folderId: currentImport.folderId,
            originalFolderName: currentImport.fileMetadata[result.page.sourceFileIndex]?.originalFolderName,
            relativePath: currentImport.fileMetadata[result.page.sourceFileIndex]?.relativePath,
            ...cropMetadata(result.crop, result.page, value.cropTemplate),
            cropOrderIndex: result.orderIndex,
            cropIndex: result.orderIndex + 1,
            displayName,
            originalFilename: resultFile.name,
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
            sceneId: value.sceneId || inherited.sceneId || undefined,
            sceneNumber: value.sceneNo || inherited.sceneNumber,
            sceneNo: value.sceneNo || inherited.sceneNumber,
            cutNo: value.cutNo,
            sortOrder: currentImport.baseSortOrder + result.orderIndex
          }
        );
        return { result, saved };
      }
    );

    const uploadedAssets: ProjectReferenceAsset[] = [];
    for (const item of uploads) {
      if (item.status === "fulfilled") {
        savedImportResultIdsRef.current.add(item.value.result.id);
        uploadedAssets.push(item.value.saved);
        continue;
      }
      const prepared = preparedItems[item.index];
      failures.push({
        resultId: prepared.result.id,
        cropIndex: prepared.result.orderIndex + 1,
        label: prepared.displayName,
        message: errorMessageOf(item.reason, "crop 결과를 업로드하지 못했습니다.")
      });
    }
    mergeUploadedAssets("storyboard", uploadedAssets);

    const report: ArchiveImportSaveReport = {
      total: value.results.length,
      succeededResultIds: [...savedImportResultIdsRef.current],
      failures
    };
    setImportSaveReport(report);
    setProgressMessage("");

    if (report.succeededResultIds.length === report.total && failures.length === 0) {
      setStatusMessage(`${report.total}개 콘티를 추출했습니다.`);
      closeImport();
    } else {
      setErrorMessage(
        `콘티 ${report.succeededResultIds.length}/${report.total}개 저장 · ${failures.length}개 실패`
      );
    }
    return report;
  }

  async function saveImport(value: ArchiveImportCommit): Promise<ArchiveImportSaveReport> {
    if (!projectId || !pendingImport || isSaving) {
      return { total: value.results.length, succeededResultIds: [], failures: [] };
    }
    setIsSaving(true);
    setErrorMessage("");
    if (pendingImport.assetType === "storyboard") {
      try {
        return await saveStoryboardImport(value, pendingImport);
      } finally {
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
            folderId: pendingImport.folderId,
            displayName: value.title || stripArchiveExtension(sourceFile.name),
            originalFilename: sourceFile.name,
            originalFolderName: sourceMetadata?.originalFolderName,
            relativePath: sourceMetadata?.relativePath,
            title: value.title,
            memo: value.memo,
            sceneId: value.sceneId || undefined,
            sceneNumber: value.sceneNo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo
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
            folderId: pendingImport.folderId,
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
            sceneId: value.sceneId || inherited.sceneId || undefined,
            sceneNumber: value.sceneNo || inherited.sceneNumber,
            sceneNo: value.sceneNo || inherited.sceneNumber,
            cutNo: value.cutNo,
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
            folderId: pendingImport.folderId,
            displayName: value.title || stripArchiveExtension(sourceFile.name),
            originalFilename: sourceFile.name,
            originalFolderName: pendingImport.fileMetadata[sourceIndex]?.originalFolderName,
            relativePath: pendingImport.fileMetadata[sourceIndex]?.relativePath,
            title: value.title,
            memo: value.memo,
            sceneId: value.sceneId || undefined,
            sceneNumber: value.sceneNo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo
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
            folderId: pendingImport.folderId,
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
            sceneId: value.sceneId || inherited.sceneId || undefined,
            sceneNumber: value.sceneNo || inherited.sceneNumber,
            sceneNo: value.sceneNo || inherited.sceneNumber,
            cutNo: value.cutNo,
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
            folderId: pendingImport.folderId,
            originalFolderName: pendingImport.fileMetadata[page.sourceFileIndex]?.originalFolderName,
            relativePath: pendingImport.fileMetadata[page.sourceFileIndex]?.relativePath,
            displayName: pageTitle(value.title || stripArchiveExtension(page.name), index, value.results.length),
            originalFilename: pendingImport.sourceFiles[page.sourceFileIndex]?.name || page.name,
            title: pageTitle(value.title, index, value.results.length),
            memo: value.memo,
            sceneId: value.sceneId || undefined,
            sceneNumber: value.sceneNo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo,
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
      setIsSaving(false);
    }
  }

  async function ensureArchiveFolder(
    name: string,
    cache = new Map(
      folders.map((folder) => [
        normalizeArchiveFolderPath(folder.name).toLocaleLowerCase("ko-KR"),
        folder
      ])
    )
  ) {
    if (!projectId || !canEdit) return null;
    const normalizedPath = normalizeArchiveFolderPath(name).slice(0, 80);
    if (!normalizedPath) return null;
    const prefixes = archivePathPrefixes(normalizedPath);
    let finalFolder: ProjectArchiveFolder | null = null;

    for (const path of prefixes) {
      const key = path.toLocaleLowerCase("ko-KR");
      const existing = cache.get(key);
      if (existing) {
        finalFolder = existing;
        continue;
      }
      try {
        const folder = await createProjectArchiveFolder(projectId, path, folders.length + cache.size);
        cache.set(key, folder);
        finalFolder = folder;
        setFolders((current) => current.some((entry) => entry.id === folder.id) ? current : [...current, folder]);
      } catch (error) {
        if (error instanceof Error && /같은 이름/.test(error.message)) {
          const refreshed = await listProjectArchiveFolders(projectId);
          setFolders(refreshed);
          for (const folder of refreshed) {
            cache.set(
              normalizeArchiveFolderPath(folder.name).toLocaleLowerCase("ko-KR"),
              folder
            );
          }
          const duplicate = cache.get(key);
          if (duplicate) {
            finalFolder = duplicate;
            continue;
          }
        }
        setErrorMessage(error instanceof Error ? error.message : "폴더를 만들지 못했습니다.");
        return null;
      }
    }
    return finalFolder;
  }

  async function submitFolderEditor() {
    if (!projectId || !canEdit || !folderEditor) return;
    const parentPath = folderEditor.mode === "create"
      ? currentFolderPath
      : archiveParentPath(folderEditor.folderPath || "");
    const maxSegmentLength = Math.max(1, 80 - parentPath.length - (parentPath ? 1 : 0));
    const segment = cleanArchiveFolderSegment(folderEditor.value).slice(0, maxSegmentLength);
    if (!segment) return;
    try {
      if (folderEditor.mode === "create") {
        const path = joinArchiveFolderPath(currentFolderPath, segment);
        const duplicate = folderByPath.get(path);
        if (duplicate) {
          setCurrentFolderPath(path);
          setFolderEditor(null);
          return;
        }
        await ensureArchiveFolder(path);
      } else if (folderEditor.folderPath) {
        const oldPath = normalizeArchiveFolderPath(folderEditor.folderPath);
        const nextPath = joinArchiveFolderPath(parentPath, segment);
        const updatedFolders = await renameProjectArchiveFolderTree(
          projectId,
          folderByPath.get(oldPath)?.id ?? null,
          oldPath,
          nextPath
        );
        const updatedById = new Map(updatedFolders.map((folder) => [folder.id, folder]));
        setFolders((current) => current.map((folder) => updatedById.get(folder.id) ?? folder));
        if (currentFolderPath && isArchivePathWithin(currentFolderPath, oldPath)) {
          setCurrentFolderPath(replaceArchivePathPrefix(currentFolderPath, oldPath, nextPath));
        }
      }
      setFolderEditor(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "폴더를 저장하지 못했습니다.");
    }
  }

  async function confirmPendingAction() {
    if (!projectId || !pendingConfirm || !canEdit) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      if (pendingConfirm.kind === "folder") {
        const deleted = await deleteProjectArchiveFolders(
          projectId,
          pendingConfirm.folderIds,
          true
        );
        removeAssetsFromLocalState(deleted.inspection.assetIds);
        const removedIds = new Set(deleted.inspection.folderIds);
        setFolders((current) => current.filter((entry) => !removedIds.has(entry.id)));
        setCurrentFolderPath(archiveParentPath(pendingConfirm.folderPath));
        if (deleted.storageCleanupWarning) setStatusMessage(deleted.storageCleanupWarning);
      } else {
        if (pendingConfirm.assetIds.length > 0 && pendingConfirm.folderIds.length === 0) {
          await deleteProjectReferenceAssets(projectId, pendingConfirm.assetIds);
          removeAssetsFromLocalState(pendingConfirm.assetIds);
        }
        for (const item of pendingConfirm.diagrams) {
          await deleteOverheadDiagramArchive(projectId, item.id);
          setDiagramArchives((current) => current.filter((entry) => entry.id !== item.id));
          updateSelectedKeys((current) => {
            const next = new Set(current);
            next.delete(archiveSelectionKey("diagram", item.id));
            return next;
          });
        }
        if (pendingConfirm.folderIds.length > 0 && pendingConfirm.folderInspection) {
          const deleted = await deleteProjectArchiveFolders(
            projectId,
            pendingConfirm.folderIds,
            true,
            pendingConfirm.assetIds
          );
          removeAssetsFromLocalState(deleted.inspection.assetIds);
          const removedIds = new Set(deleted.inspection.folderIds);
          setFolders((current) => current.filter((folder) => !removedIds.has(folder.id)));
          if (deleted.storageCleanupWarning) setStatusMessage(deleted.storageCleanupWarning);
          const selectedRootPaths = deleted.inspection.selectedRootIds.flatMap((id) => {
            const path = folderPathById.get(id);
            return path ? [path] : [];
          });
          if (selectedRootPaths.some((path) => isArchivePathWithin(currentFolderPath, path))) {
            const fallbackPath = selectedRootPaths
              .map(archiveParentPath)
              .sort((left, right) => left.length - right.length)[0] ?? "";
            setCurrentFolderPath(fallbackPath);
          }
        }
        clearSelection();
      }
      setPendingConfirm(null);
    } catch (error) {
      if (pendingConfirm.kind === "selection") setPendingConfirm(null);
      setErrorMessage(error instanceof Error ? error.message : "삭제 작업을 완료하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadFolder(event: ChangeEvent<HTMLInputElement>) {
    if (!projectId || !canEdit) return;
    const scan = scanArchiveFileList(Array.from(event.target.files ?? []));
    event.target.value = "";
    await uploadScannedFiles(activeType, scan);
  }

  async function uploadScannedFiles(
    assetType: ArchiveType,
    scan: ArchiveFolderScanResult
  ) {
    if (!projectId || !canEdit || preparingRef.current || isSaving) return;
    const entries = scan.files;
    setFolderUploadReport(null);
    if (entries.length === 0) {
      setProgressMessage("");
      setFolderUploadReport({
        discoveredCount: scan.discoveredCount,
        supportedCount: 0,
        uploadedCount: 0,
        skipped: scan.skipped,
        failed: [],
        verified: false
      });
      setErrorMessage("선택한 폴더에 읽을 수 있는 PDF 또는 이미지가 없습니다.");
      return;
    }
    if (assetType === "storyboard") {
      // 콘티 폴더 선택도 원본 저장 작업이 아니라 현재 폴더에서 시작하는
      // 하나의 로컬 crop session으로 취급합니다. 원래 상대 경로는 metadata로만 보존합니다.
      await prepareFiles(
        assetType,
        entries.map((entry) => entry.file),
        undefined,
        false,
        {
          folderId: currentFolderPath ? currentFolderId ?? undefined : null,
          fileMetadata: entries.map((entry) => ({
            originalFolderName: entry.originalFolderName,
            relativePath: entry.relativePath
          }))
        }
      );
      if (scan.skipped.length > 0) {
        setStatusMessage(`${entries.length}개 준비됨 · ${scan.skipped.length}개 제외`);
      }
      return;
    }
    setIsPreparing(true);
    preparingRef.current = true;
    setErrorMessage("");
    setActiveType(assetType);
    try {
      setProgressMessage(`지원 파일 선별 중 · 발견 ${scan.discoveredCount}개 · 지원 ${entries.length}개`);
      const groups = new Map<string, typeof entries>();
      for (const entry of entries) {
        const folderPath = joinArchiveFolderPath(currentFolderPath, entry.folderPath || "");
        groups.set(folderPath, [...(groups.get(folderPath) ?? []), entry]);
      }

      const folderCache = new Map(
        folders.map((folder) => [
          normalizeArchiveFolderPath(folder.name).toLocaleLowerCase("ko-KR"),
          folder
        ])
      );
      const uploadedAssets: ProjectReferenceAsset[] = [];
      const failed: ArchiveFolderIssue[] = [];
      let firstFolderPath = "";
      const entryOrder = new Map(entries.map((entry, index) => [
        `${entry.relativePath}:${entry.file.size}:${entry.file.lastModified}`,
        index
      ]));

      for (const [folderPath, folderEntries] of groups) {
        const folder = folderPath ? await ensureArchiveFolder(folderPath, folderCache) : null;
        const folderId = folder?.id ?? currentFolderId;
        if (folderPath && !folder) {
          for (const entry of folderEntries) {
            failed.push({ path: entry.relativePath, reason: "아카이브 폴더 생성 실패" });
          }
          continue;
        }
        if (!firstFolderPath && folder) firstFolderPath = normalizeArchiveFolderPath(folder.name);
        await mapWithConcurrency(folderEntries, 3, async (entry) => {
          try {
            const sourceOrder = entryOrder.get(
              `${entry.relativePath}:${entry.file.size}:${entry.file.lastModified}`
            ) ?? 0;
            let uploaded: ProjectReferenceAsset;
            if (isPdfFile(entry.file)) {
              setProgressMessage(`PDF 확인 중 · ${entry.file.name}`);
              if (!await hasPdfSignature(entry.file)) throw new Error("Invalid PDF");
              uploaded = await uploadProjectReferenceAsset(projectId, assetType, entry.file, {
                sourceType: "upload_pdf",
                folderId,
                groupId: `source:folder:${folderId || "root"}`,
                displayName: stripArchiveExtension(entry.file.name),
                originalFilename: entry.file.name,
                originalFolderName: entry.originalFolderName,
                relativePath: entry.relativePath,
                sortOrder: imageAssets.length + sourceOrder
              });
            } else {
              setProgressMessage(`이미지 최적화 중 · ${entry.file.name}`);
              const optimized = await optimizeArchiveImage(entry.file);
              setProgressMessage(`업로드 중 ${uploadedAssets.length + 1}/${entries.length}`);
              uploaded = await uploadProjectReferenceAsset(projectId, assetType, optimized.displayFile, {
                thumbnailFile: optimized.thumbnailFile,
                sourceType: "upload_image",
                folderId,
                groupId: `folder:${folderId || "root"}`,
                displayName: stripArchiveExtension(entry.file.name),
                originalFilename: entry.file.name,
                originalFolderName: entry.originalFolderName,
                relativePath: entry.relativePath,
                sortOrder: imageAssets.length + sourceOrder
              });
            }
            uploadedAssets.push(uploaded);
            setProgressMessage(`저장 중 ${uploadedAssets.length}/${entries.length}`);
          } catch (error) {
            failed.push({
              path: entry.relativePath,
              reason: error instanceof Error ? error.message : "업로드 실패"
            });
          }
        });
      }
      setProgressMessage("검증 중");
      const uniqueUploadedIds = new Set(uploadedAssets.map((asset) => asset.id));
      const expectedUploadedCount = entries.length - failed.length;
      const verified = uploadedAssets.length === expectedUploadedCount
        && uniqueUploadedIds.size === uploadedAssets.length;
      if (!verified) {
        failed.push({
          path: "(업로드 검증)",
          reason: `지원 ${entries.length}개 중 응답 확인 ${uploadedAssets.length}개`
        });
      }
      mergeUploadedAssets(assetType, uploadedAssets);
      setProgressMessage("");
      if (firstFolderPath) setCurrentFolderPath(firstFolderPath);
      setFolderUploadReport({
        discoveredCount: scan.discoveredCount,
        supportedCount: entries.length,
        uploadedCount: uploadedAssets.length,
        skipped: scan.skipped,
        failed,
        verified
      });
      if (uploadedAssets.length === 0 || failed.length > 0 || !verified) {
        setErrorMessage(
          `폴더 업로드를 완전히 마치지 못했습니다. 성공 ${uploadedAssets.length}개 · 실패 ${failed.length}개 · 스킵 ${scan.skipped.length}개`
        );
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "폴더를 업로드하지 못했습니다.");
      setProgressMessage("");
    } finally {
      preparingRef.current = false;
      setIsPreparing(false);
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

  async function moveArchiveSelection(
    keys: Iterable<ArchiveSelectionKey>,
    destinationFolderId: string | null
  ) {
    if (!projectId || isSaving) return;
    const movingKeys = [...new Set(keys)];
    const movingAssetIds = movingKeys.flatMap((key) => {
      const parsed = parseArchiveSelectionKey(key);
      return parsed?.kind === "asset" ? [parsed.id] : [];
    });
    const movingFolderIds = movingKeys.flatMap((key) => {
      const parsed = parseArchiveSelectionKey(key);
      return parsed?.kind === "folder" ? [parsed.id] : [];
    });
    if (movingAssetIds.length === 0 && movingFolderIds.length === 0) return;
    if (!isValidArchiveDropTarget(destinationFolderId, movingFolderIds, folders)) {
      setErrorMessage("선택한 폴더 자신 또는 하위 폴더로는 이동할 수 없습니다.");
      return;
    }

    const movingFolderPaths = movingFolderIds.flatMap((id) => {
      const path = folderPathById.get(id);
      return path ? [path] : [];
    });
    const nestedFolderIds = new Set(
      folders
        .filter((folder) => movingFolderPaths.some((path) => (
          isArchivePathWithin(normalizeArchiveFolderPath(folder.name), path)
        )))
        .map((folder) => folder.id)
    );
    const independentAssetIds = movingAssetIds.filter((id) => {
      const asset = [...overheads, ...storyboards].find((entry) => entry.id === id);
      return !asset?.crop.folderId || !nestedFolderIds.has(asset.crop.folderId);
    });

    setIsSaving(true);
    setErrorMessage("");
    try {
      const result = await moveProjectArchiveSelection(
        projectId,
        independentAssetIds,
        movingFolderIds,
        destinationFolderId
      );
      if (result.movedAssetIds.length > 0) {
        updateAssetsInLocalState(result.movedAssetIds, (asset) => ({
          ...asset,
          crop: { ...asset.crop, folderId: destinationFolderId }
        }));
      }
      if (result.folders.length > 0) {
        const updatedById = new Map(result.folders.map((folder) => [folder.id, folder]));
        setFolders((current) => current.map((folder) => updatedById.get(folder.id) ?? folder));
      }
      clearSelection();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "선택한 자료를 이동하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function moveSelectedAssets() {
    await moveArchiveSelection(selectedKeysRef.current, moveFolderId || null);
  }

  async function deleteSelectedAssets() {
    if (!projectId || selectedKeys.size === 0) return;
    if (
      selectedDiagramItems.length > 0
      && selectedReferenceAssetIds.length + selectedFolderIds.length > 0
    ) {
      setErrorMessage("직접 만든 부감도는 파일·폴더와 분리해서 삭제해주세요.");
      return;
    }
    try {
      const folderOnlyInspection = selectedFolderIds.length > 0
        ? await inspectProjectArchiveFolders(projectId, selectedFolderIds)
        : null;
      const nestedAssetIds = new Set(folderOnlyInspection?.assetIds ?? []);
      const independentAssetIds = selectedReferenceAssetIds.filter((id) => !nestedAssetIds.has(id));
      const inspection = selectedFolderIds.length > 0
        ? await inspectProjectArchiveFolders(projectId, selectedFolderIds, independentAssetIds)
        : null;
      const assetInspection = !inspection && independentAssetIds.length > 0
        ? await inspectProjectReferenceAssets(projectId, independentAssetIds)
        : null;
      setPendingConfirm({
        kind: "selection",
        assetIds: independentAssetIds,
        diagrams: selectedDiagramItems,
        folderIds: selectedFolderIds,
        folderInspection: inspection,
        linkedAssetCount: inspection?.linkedAssetCount ?? assetInspection?.linkedAssetCount ?? 0,
        label: selectedCount ? `선택한 ${selectedCount}개 항목` : "선택한 항목"
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "삭제할 폴더 내용을 확인하지 못했습니다.");
    }
  }

  function clearSelection() {
    selectedKeysRef.current = new Set();
    setSelectedKeys(new Set());
    setSelectionMode(false);
    setMoveFolderId("");
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
      return;
    }
    const selectedFolder = folders.find((folder) => (
      selectedKeys.has(archiveSelectionKey("folder", folder.id))
    ));
    if (selectedFolder) {
      setFolderEditor({
        mode: "rename",
        folderPath: normalizeArchiveFolderPath(selectedFolder.name),
        value: archiveBaseName(selectedFolder.name)
      });
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
      clientX: event.clientX,
      clientY: event.clientY,
      longPressed: false,
      dragging: false,
      dragKeys: [],
      dropFolderId: null,
      previousTouchAction: event.currentTarget.style.touchAction,
      timeoutId: 0,
      target: event.currentTarget
    };

    try {
      state.target.setPointerCapture(state.pointerId);
    } catch {
      // Document listeners below keep the gesture alive when capture is unavailable.
    }

    const activateSelection = () => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.longPressed = true;
      current.target.style.touchAction = "none";
      suppressArchiveClickRef.current = current.key;
      setSelectionMode(true);
      setPressedSelectionKey(current.key);
      updateSelectedKeys((selected) => new Set(selected).add(current.key));
      if (navigator.vibrate) navigator.vibrate(18);
    };

    state.timeoutId = window.setTimeout(activateSelection, LONG_PRESS_MS);
    longPressRef.current = state;

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      current.clientX = pointerEvent.clientX;
      current.clientY = pointerEvent.clientY;
      const distance = Math.hypot(
        pointerEvent.clientX - current.startX,
        pointerEvent.clientY - current.startY
      );
      if (!current.longPressed) {
        if (distance > LONG_PRESS_MOVE_TOLERANCE) cancelArchivePointerSession();
        return;
      }
      if (pointerEvent.cancelable) pointerEvent.preventDefault();
      if (
        !current.dragging
        && distance > DRAG_START_DISTANCE
        && (current.kind === "asset" || current.kind === "folder")
      ) {
        current.dragging = true;
        current.dragKeys = [...selectedKeysRef.current].filter((selectionKey) => {
          const parsed = parseArchiveSelectionKey(selectionKey);
          return parsed?.kind === "asset" || parsed?.kind === "folder";
        });
        lockArchiveDragSelection();
        setDragPreviewKeys(current.dragKeys);
        updateDragPreviewPosition(pointerEvent.clientX, pointerEvent.clientY);
        updateDropFolderAtPoint(current, pointerEvent.clientX, pointerEvent.clientY);
        runArchiveDragAutoScroll();
      } else if (current.dragging) {
        updateDragPreviewPosition(pointerEvent.clientX, pointerEvent.clientY);
        updateDropFolderAtPoint(current, pointerEvent.clientX, pointerEvent.clientY);
      }
    };
    const handlePointerEnd = (pointerEvent: PointerEvent) => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      const wasLongPressed = current.longPressed;
      const wasDragging = current.dragging;
      const destinationFolderId = current.dropFolderId;
      const movingKeys = current.dragKeys;
      if (wasLongPressed) suppressArchiveClickRef.current = current.key;
      cancelArchivePointerSession();
      if (wasDragging && destinationFolderId) {
        void moveArchiveSelection(movingKeys, destinationFolderId);
      }
      if (wasLongPressed) {
        window.setTimeout(() => {
          if (suppressArchiveClickRef.current === key) suppressArchiveClickRef.current = null;
        }, 700);
      }
    };
    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      const cancelledKey = current.key;
      if (current.longPressed) {
        suppressArchiveClickRef.current = cancelledKey;
        window.setTimeout(() => {
          if (suppressArchiveClickRef.current === cancelledKey) {
            suppressArchiveClickRef.current = null;
          }
        }, 700);
      }
      cancelArchivePointerSession();
    };
    const handleWindowBlur = () => cancelArchivePointerSession();
    const handleTouchMove = (touchEvent: TouchEvent) => {
      if (longPressRef.current?.longPressed && touchEvent.cancelable) {
        touchEvent.preventDefault();
      }
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerCancel);
      document.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("blur", handleWindowBlur);
      if (selectionScrollFrameRef.current !== null) {
        cancelAnimationFrame(selectionScrollFrameRef.current);
        selectionScrollFrameRef.current = null;
      }
      selectionPointerCleanupRef.current = null;
    };
    selectionPointerCleanupRef.current = cleanup;
    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerCancel);
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("blur", handleWindowBlur);
  }

  function lockArchiveDragSelection() {
    bodyUserSelectRef.current = document.body.style.userSelect;
    document.body.style.userSelect = "none";
  }

  function restoreArchiveDragSelection() {
    document.body.style.userSelect = bodyUserSelectRef.current;
  }

  function updateDragPreviewPosition(clientX: number, clientY: number) {
    if (dragPositionFrameRef.current !== null) cancelAnimationFrame(dragPositionFrameRef.current);
    dragPositionFrameRef.current = requestAnimationFrame(() => {
      if (dragPreviewRef.current) {
        const { x, y } = archiveDragPreviewPosition(clientX, clientY);
        dragPreviewRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      dragPositionFrameRef.current = null;
    });
  }

  function updateDropFolderAtPoint(
    session: ArchivePointerSession,
    clientX: number,
    clientY: number
  ) {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(
      "[data-archive-folder-id]"
    );
    const candidateId = target?.dataset.archiveFolderId || null;
    const movingFolderIds = session.dragKeys.flatMap((key) => {
      const parsed = parseArchiveSelectionKey(key);
      return parsed?.kind === "folder" ? [parsed.id] : [];
    });
    const nextTarget = (
      candidateId
      && isValidArchiveDropTarget(candidateId, movingFolderIds, folders)
    ) ? candidateId : null;
    session.dropFolderId = nextTarget;
    setDropFolderId((current) => current === nextTarget ? current : nextTarget);
  }

  function runArchiveDragAutoScroll() {
    const current = longPressRef.current;
    if (!current?.dragging) return;
    let deltaY = 0;
    if (current.clientY < SELECTION_SCROLL_EDGE) {
      deltaY = -Math.ceil((SELECTION_SCROLL_EDGE - current.clientY) / 7);
    } else if (current.clientY > window.innerHeight - SELECTION_SCROLL_EDGE) {
      deltaY = Math.ceil(
        (current.clientY - (window.innerHeight - SELECTION_SCROLL_EDGE)) / 7
      );
    }
    if (deltaY !== 0) {
      window.scrollBy(0, deltaY);
      updateDropFolderAtPoint(current, current.clientX, current.clientY);
    }
    selectionScrollFrameRef.current = requestAnimationFrame(runArchiveDragAutoScroll);
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
      await saveOverheadDiagramArchive(projectId, diagram, {
        id: diagramDraft.item?.legacy ? undefined : diagramDraft.item?.id,
        title: diagramDraft.title,
        memo: diagramDraft.memo,
        sceneNo: diagramDraft.sceneNo,
        cutNo: diagramDraft.cutNo
      });
      setDiagramDraft(null);
      await loadArchive();
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
    setDragPreviewKeys([]);
    setDropFolderId(null);
    if (dragPositionFrameRef.current !== null) {
      cancelAnimationFrame(dragPositionFrameRef.current);
      dragPositionFrameRef.current = null;
    }
    restoreArchiveDragSelection();
    selectionPointerCleanupRef.current?.();
  }

  async function cropStoredAsset(asset: ProjectReferenceAsset) {
    if (!canEdit || activeType !== "storyboard") return;
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
        folderId: asset.crop.folderId ?? null,
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
    setMetadataAnchor(anchor
      ? {
          left: Math.max(8, Math.min(anchor.clientX + 8, window.innerWidth - 312)),
          top: Math.max(8, Math.min(anchor.clientY + 8, window.innerHeight - 284))
        }
      : null);
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
      || longPressRef.current?.dragging
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
      <div className="mx-auto grid w-full max-w-6xl select-none gap-4 [&_input]:select-text [&_textarea]:select-text">
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
        {folderUploadReport ? <FolderUploadSummary report={folderUploadReport} /> : null}

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
                    <p className="text-sm font-black">{label} 파일 또는 폴더 놓기</p>
                    <p className="text-[11px] font-bold text-field-muted">하위 폴더를 포함해 PDF · JPG · JPEG · PNG · WebP만 선별</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <Card className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-[auto_minmax(12rem,1fr)_auto] sm:items-center">
            <div className="grid grid-cols-2 gap-2">
              {(["overhead", "storyboard"] as const).map((type) => (
                <button key={type} type="button" onClick={() => setActiveType(type)} className={`min-h-10 rounded-[3px] border px-4 text-sm font-black ${activeType === type ? "border-field-primary bg-field-primary text-white" : "border-field-border bg-white text-field-primary"}`}>
                  {type === "overhead" ? "부감도" : "콘티"}
                </button>
              ))}
            </div>
            <label className="relative block min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-field-muted" aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-10 w-full rounded-[3px] border border-field-border bg-white pl-9 pr-3 text-sm" placeholder="제목, 메모, 씬, 컷 검색" />
            </label>
            {canEdit ? (
              <div className="flex flex-wrap justify-end gap-2">
                {activeType === "overhead" ? (
                  <button type="button" onClick={openNewDiagram} className="inline-flex min-h-10 items-center gap-1.5 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                    <MapIcon className="h-4 w-4" aria-hidden />
                    직접 만들기
                  </button>
                ) : null}
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                  <ImagePlus className="h-4 w-4" aria-hidden />
                  이미지
                  <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple className="sr-only" disabled={isPreparing || isSaving} onChange={(event) => prepareImages(activeType, event)} />
                </label>
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[3px] bg-field-primary px-3 text-xs font-black text-white">
                  <Upload className="h-4 w-4" aria-hidden />
                  PDF
                  <input type="file" accept="application/pdf,.pdf" multiple className="sr-only" disabled={isPreparing || isSaving} onChange={(event) => preparePdf(activeType, event)} />
                </label>
              </div>
            ) : null}
          </div>
          <div className="grid gap-2 border-t border-field-border pt-3" aria-label="아카이브 탐색기">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1" aria-label="현재 폴더 경로">
              <button
                type="button"
                onClick={() => setCurrentFolderPath("")}
                className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary"
                aria-label="아카이브 홈으로 이동"
              >
                <Home className="h-3.5 w-3.5" aria-hidden />
                홈
              </button>
              {breadcrumbs.map((crumb) => (
                <div key={crumb.path} className="flex shrink-0 items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 text-field-muted" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setCurrentFolderPath(crumb.path)}
                    className={`min-h-9 rounded-[3px] px-2.5 text-xs font-black ${
                      crumb.path === currentFolderPath
                        ? "bg-field-primary text-white"
                        : "text-field-primary hover:bg-field-soft"
                    }`}
                  >
                    {crumb.label}
                  </button>
                </div>
              ))}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!currentFolderPath}
                onClick={() => setCurrentFolderPath(archiveParentPath(currentFolderPath))}
                className="grid h-9 w-9 place-items-center rounded-[3px] border border-field-border bg-white text-field-primary disabled:opacity-35"
                aria-label="상위 폴더로 이동"
              >
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
              <span className="inline-flex min-w-0 items-center gap-1 text-xs font-black text-field-primary">
                <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{archiveBaseName(currentFolderPath) || "홈"}</span>
              </span>
              <span className="text-[11px] font-bold text-field-muted">
                폴더 {childFolders.length} · 자료 {filteredAssets.length + filteredDiagrams.length}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as typeof sortMode)}
              className="min-h-9 rounded-[3px] border border-field-border bg-white px-3 text-xs font-bold text-field-text"
              aria-label="아카이브 정렬"
            >
              <option value="newest">최신순</option>
              <option value="name">이름순</option>
              <option value="scene">씬/컷순</option>
            </select>
            {canEdit ? (
              <>
                <button type="button" onClick={() => setFolderEditor({ mode: "create", folderPath: currentFolderPath, value: "" })} className="inline-flex min-h-9 items-center gap-1 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                  <FolderPlus className="h-3.5 w-3.5" aria-hidden />
                  새 폴더
                </button>
                {currentFolderPath ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setFolderEditor({
                          mode: "rename",
                          folderPath: currentFolderPath,
                          value: archiveBaseName(currentFolderPath)
                        });
                      }}
                      className="min-h-9 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary"
                    >
                      이름 변경
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const affectedFolders = folders
                          .filter((folder) => (
                            isArchivePathWithin(
                              normalizeArchiveFolderPath(folder.name),
                              currentFolderPath
                            )
                          ))
                          .sort((left, right) => right.name.length - left.name.length);
                        if (affectedFolders.length === 0) return;
                        const folderIds = affectedFolders.map((folder) => folder.id);
                        void inspectProjectArchiveFolders(projectId, folderIds)
                          .then((folderInspection) => {
                            setPendingConfirm({
                              kind: "folder",
                              folderPath: currentFolderPath,
                              folderIds,
                              folderInspection
                            });
                          })
                          .catch((error: unknown) => {
                            setErrorMessage(
                              error instanceof Error
                                ? error.message
                                : "삭제할 폴더 내용을 확인하지 못했습니다."
                            );
                          });
                      }}
                      className="min-h-9 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-danger"
                    >
                      폴더 삭제
                    </button>
                  </>
                ) : null}
                {supportsDesktopDrop ? (
                  <>
                    <button type="button" onClick={() => folderUploadRef.current?.click()} className="inline-flex min-h-9 items-center gap-1 rounded-[3px] border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                      <FolderInput className="h-3.5 w-3.5" aria-hidden />
                      폴더 업로드
                    </button>
                    <input
                      ref={folderUploadRef}
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
                      multiple
                      className="sr-only"
                      disabled={isPreparing || isSaving}
                      onChange={(event) => void uploadFolder(event)}
                      {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                    />
                  </>
                ) : null}
              </>
            ) : null}
            </div>
            {folderEditor ? (
              <form
                className="flex max-w-md items-center gap-2 rounded-xl border border-field-border bg-field-soft/55 p-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitFolderEditor();
                }}
              >
                <input
                  autoFocus
                  value={folderEditor.value}
                  onChange={(event) => setFolderEditor({ ...folderEditor, value: event.target.value })}
                  className="min-h-9 min-w-0 flex-1 rounded-lg border border-field-border bg-white px-3 text-sm"
                  placeholder={folderEditor.mode === "create" ? "새 폴더 이름" : "폴더 이름"}
                  maxLength={80}
                />
                <button type="submit" className="min-h-9 rounded-[3px] bg-field-primary px-3 text-xs font-black text-white">확인</button>
                <button type="button" onClick={() => setFolderEditor(null)} className="grid h-9 w-9 place-items-center rounded-[3px] border border-field-border bg-white" aria-label="폴더 편집 취소">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </form>
            ) : null}
          </div>
          {canEdit && selectedCount > 0 ? (
            <div className="fixed inset-x-3 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-[3px] border border-field-border bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
              <span className="text-xs font-black text-field-primary">
                {selectedCount}개 선택
              </span>
              <select
                value={moveFolderId}
                onChange={(event) => setMoveFolderId(event.target.value)}
                className="min-h-9 rounded-[3px] border border-field-border bg-white px-3 text-xs font-bold"
                aria-label="선택 자료 이동 폴더"
              >
                <option value="">홈으로 이동</option>
                {folders.map((folder) => (
                  <option
                    key={folder.id}
                    value={folder.id}
                    disabled={!isValidArchiveDropTarget(folder.id, selectedFolderIds, folders)}
                  >
                    {folder.name}
                  </option>
                ))}
              </select>
              <button type="button" disabled={isSaving || selectedReferenceAssetIds.length + selectedFolderIds.length === 0 || selectedDiagramItems.length > 0 || !isValidArchiveDropTarget(moveFolderId || null, selectedFolderIds, folders)} onClick={() => void moveSelectedAssets()} className="inline-flex min-h-9 items-center gap-1 rounded-[3px] bg-field-primary px-3 text-xs font-black text-white disabled:opacity-50">
                <Move className="h-3.5 w-3.5" aria-hidden />
                이동
              </button>
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
                  {selectedFolderIds.length === 1
                    ? "이름 변경"
                    : singleSelectedReferenceAsset
                      ? "정보 수정"
                      : "정보"}
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
            <h2 className="font-display text-lg font-black text-field-primary">{activeType === "overhead" ? "부감도" : "콘티"} 자료</h2>
            <p className="text-xs font-bold text-field-muted">이미지 원본 비율을 유지하며 모서리를 자르지 않습니다.</p>
          </div>
          {childFolders.length + filteredDiagrams.length + filteredAssets.length === 0 ? (
            <p className="py-10 text-center text-sm font-bold text-field-muted">등록된 {activeType === "overhead" ? "부감도" : "콘티"} 자료가 없습니다.</p>
          ) : (
            <div
              className="grid min-w-0 select-none grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
            >
              {childFolders.map((folder) => {
                const key = folder.id ? archiveSelectionKey("folder", folder.id) : null;
                const selected = key ? selectedKeys.has(key) : false;
                const pressed = key ? pressedSelectionKey === key : false;
                const dropTarget = folder.id === dropFolderId;
                return (
                  <button
                    key={folder.path}
                    type="button"
                    data-archive-folder-id={folder.id || undefined}
                    onPointerDown={(event) => {
                      if (folder.id) beginArchiveSelectionPress("folder", folder.id, event);
                    }}
                    onClick={(event) => {
                      if (key && suppressArchiveClickRef.current === key) {
                        suppressArchiveClickRef.current = null;
                        event.preventDefault();
                        return;
                      }
                      if (selectionMode && folder.id) {
                        event.preventDefault();
                        toggleArchiveSelection("folder", folder.id);
                        return;
                      }
                      setCurrentFolderPath(folder.path);
                    }}
                    className={`grid min-w-0 aspect-[4/3] touch-pan-y place-items-center gap-2 border p-3 text-field-primary transition-[transform,border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary ${
                      selected
                        ? "border-[#ef8f39] bg-[#fff8f0] ring-2 ring-[#ef8f39]/45"
                        : "border-field-border bg-field-soft/45 hover:border-field-primary hover:bg-field-soft"
                    } ${pressed ? "scale-[0.92]" : ""} ${
                      dropTarget ? "border-[#ef8f39] bg-[#fff0df] ring-4 ring-[#ef8f39]/55" : ""
                    }`}
                    aria-label={`${folder.name} 폴더 ${selectionMode ? selected ? "선택 해제" : "선택" : "열기"}`}
                    aria-pressed={selectionMode && folder.id ? selected : undefined}
                  >
                    <Folder className="h-12 w-12 fill-[#e5bd55] text-[#a97813] sm:h-14 sm:w-14" aria-hidden />
                    <span className="min-w-0 max-w-full truncate text-xs font-black">{folder.name}</span>
                    <span className="text-[10px] font-bold text-field-muted">{folder.itemCount}개</span>
                  </button>
                );
              })}
              {filteredDiagrams.map((item) => {
                const key = archiveSelectionKey("diagram", item.id);
                const selected = selectedKeys.has(key);
                return (
                <article
                  key={item.id}
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
                      if (!item.legacy) beginArchiveSelectionPress("diagram", item.id, event);
                    }}
                    onClick={(event) => {
                      if (suppressArchiveClickRef.current === key) {
                        suppressArchiveClickRef.current = null;
                        event.preventDefault();
                        return;
                      }
                      if (selectionMode && !item.legacy) {
                        event.preventDefault();
                        toggleArchiveSelection("diagram", item.id);
                        return;
                      }
                      openDiagram(item, false);
                    }}
                    className="grid min-w-0 aspect-[4/3] touch-pan-y place-items-center bg-field-soft"
                    aria-pressed={selectionMode && !item.legacy ? selected : undefined}
                  >
                    <ShotOverheadPreview diagram={item.diagram} label={`${item.title} 부감도`} />
                  </button>
                  <ArchiveText title={item.title} sceneNo={item.sceneNo} cutNo={item.cutNo} />
                </article>
              )})}
              {visibleAssets.map((asset) => {
                const key = archiveSelectionKey("asset", asset.id);
                const selected = selectedKeys.has(key);
                return (
                <article
                  key={asset.id}
                  className={`relative grid min-w-0 max-w-full select-none grid-rows-[minmax(0,1fr)_auto] gap-1.5 border bg-white p-2 transition ${
                    selected
                      ? "border-[#ef8f39] bg-[#fff8f0] ring-2 ring-[#ef8f39]/45"
                      : "border-field-border"
                  } ${pressedSelectionKey === key ? "scale-[0.92] border-[#ef8f39]" : ""}`}
                  onContextMenu={(event) => openAssetContextMenu(asset, event)}
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
                      onDragStart={(event) => event.preventDefault()}
                      className="block h-full w-full rounded-none object-contain"
                    />
                  </button>
                  <ArchiveText title={archiveDisplayName(asset)} sceneNo={asset.crop.sceneNumber || asset.sceneNo || ""} cutNo={asset.crop.cutNumber ? String(asset.crop.cutNumber) : asset.cutNo || ""} />
                </article>
              )})}
            </div>
          )}
          {visibleAssets.length < filteredAssets.length ? (
            <button type="button" onClick={() => setVisibleCount((current) => current + PAGE_SIZE)} className="mx-auto min-h-9 rounded-[3px] border border-field-border bg-white px-4 text-xs font-black text-field-primary">
              더 보기 · {visibleAssets.length}/{filteredAssets.length}
            </button>
          ) : null}
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
                    onContextMenu={(event) => openAssetContextMenu(asset, event)}
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
                        {asset.crop.relativePath ? (
                          <span className="block truncate text-[10px] font-bold text-field-muted">{asset.crop.relativePath}</span>
                        ) : null}
                        <span className="block text-[11px] font-bold text-field-primary underline underline-offset-2">원본 보기</span>
                      </span>
                    </button>
                    {canEdit && activeType === "storyboard" && detectArchiveCropSourceKind({ mimeType: asset.mimeType, filename: asset.filename }) ? (
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

      {dragPreviewItems.length > 0 ? (
        <div
          ref={dragPreviewRef}
          className="pointer-events-none fixed left-0 top-0 z-[120] h-16 w-16 will-change-transform"
          style={{
            transform: (() => {
              const position = archiveDragPreviewPosition(
                longPressRef.current?.clientX ?? -200,
                longPressRef.current?.clientY ?? -200
              );
              return `translate3d(${position.x}px, ${position.y}px, 0)`;
            })()
          }}
          aria-hidden
        >
          {dragPreviewItems.slice(0, 3).map((item, index) => (
            <div
              key={item.key}
              className="absolute grid h-12 w-12 place-items-center overflow-hidden border-2 border-white bg-field-soft shadow-md"
              style={{
                left: index * 5,
                top: index * 5,
                zIndex: index + 1,
                transform: `rotate(${(index - 1) * 3}deg)`
              }}
            >
              {item.kind === "asset" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  draggable={false}
                  className="h-full w-full rounded-none object-cover"
                />
              ) : (
                <Folder className="h-8 w-8 fill-[#e5bd55] text-[#a97813]" aria-hidden />
              )}
            </div>
          ))}
          <span className="absolute right-0 top-0 z-10 grid min-h-6 min-w-6 place-items-center rounded-[3px] bg-[#ef8f39] px-1 text-[10px] font-black text-white shadow">
            {dragPreviewItems.length}
          </span>
        </div>
      ) : null}

      {pendingImport ? (
        <ArchiveImportDialog
          assetType={pendingImport.assetType}
          sourceLabel={pendingImport.sourceLabel}
          pages={pendingImport.pages}
          scenes={sceneItems}
          initialMetadata={archiveImportInitialMetadata(pendingImport)}
          isSaving={isSaving}
          saveReport={importSaveReport}
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
            message={pendingConfirm.kind === "folder"
              ? archiveFolderDeleteMessage(
                  pendingConfirm.folderInspection,
                  `"${archiveBaseName(pendingConfirm.folderPath)}" 폴더`
                )
              : pendingConfirm.folderInspection
                ? archiveFolderDeleteMessage(pendingConfirm.folderInspection, pendingConfirm.label)
                : [
                    `${pendingConfirm.label}을 삭제할까요?`,
                    pendingConfirm.linkedAssetCount > 0
                      ? `진행도에 연결된 파일 ${pendingConfirm.linkedAssetCount}개의 연결도 해제됩니다.`
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

function FolderUploadSummary({ report }: { report: FolderUploadReport }) {
  const issues = [
    ...report.failed.map((issue) => ({ ...issue, kind: "실패" })),
    ...report.skipped.map((issue) => ({ ...issue, kind: "스킵" }))
  ];
  return (
    <section className={`grid gap-2 border px-3 py-2 text-xs ${
      report.verified && report.failed.length === 0
        ? "border-field-border bg-field-soft/55 text-field-primary"
        : "border-field-danger bg-red-50 text-field-danger"
    }`} aria-label="폴더 업로드 결과">
      <p className="font-black">
        발견 {report.discoveredCount} · 지원 {report.supportedCount} · 성공 {report.uploadedCount}
        {" · "}스킵 {report.skipped.length} · 실패 {report.failed.length}
      </p>
      <p className="font-bold">
        {report.verified && report.failed.length === 0
          ? "지원 파일 수와 저장 응답 수가 일치합니다."
          : "지원 파일 수와 저장 결과를 확인해주세요."}
      </p>
      {issues.length > 0 ? (
        <details className="select-text">
          <summary className="cursor-pointer select-none font-black">실패·스킵 파일 보기 ({issues.length})</summary>
          <ul className="mt-2 grid max-h-44 gap-1 overflow-y-auto text-[11px] leading-5">
            {issues.map((issue, index) => (
              <li key={`${issue.kind}-${issue.path}-${index}`}>
                <strong>{issue.kind}</strong> · {issue.path} · {issue.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function ArchiveText({ title, sceneNo, cutNo }: { title: string; sceneNo: string; cutNo: string }) {
  return (
    <div className="min-w-0 px-1">
      <p className="truncate text-xs font-black text-field-text">{title}</p>
      {sceneNo || cutNo ? (
        <p className="truncate text-[10px] font-bold text-field-muted">
          {[sceneNo && `S#${sceneNo}`, cutNo && `C#${cutNo}`].filter(Boolean).join(" · ")}
        </p>
      ) : null}
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
  const selectedScene = scenes.find((scene) => scene.id === value.sceneId);
  const selectedCut = value.cutNo ? Number(value.cutNo) : null;
  const maxCut = selectedScene?.cutCount ?? 0;
  const missingScene = Boolean(value.sceneId && !selectedScene);
  const invalidCut = Boolean(
    selectedCut !== null
    && (!Number.isInteger(selectedCut) || selectedCut < 1 || !maxCut || selectedCut > maxCut)
  );

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!popoverRef.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <section
      ref={popoverRef}
      className={`fixed z-[85] grid max-h-[min(70dvh,22rem)] w-auto gap-3 overflow-y-auto border border-field-border bg-white p-3 shadow-lg ${
        anchor
          ? "max-w-[19rem]"
          : "inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] mx-auto max-w-sm sm:inset-x-auto sm:left-1/2 sm:w-[19rem] sm:-translate-x-1/2"
      }`}
      style={anchor ? { left: anchor.left, top: anchor.top, width: 304 } : undefined}
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
            <option value={value.sceneId}>삭제된 씬 · S#{value.sceneNo || "알 수 없음"}</option>
          ) : null}
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>
              S#{scene.sceneNo}{scene.sceneContent ? ` · ${scene.sceneContent.slice(0, 28)}` : ""}
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
            <option value={value.cutNo}>C#{value.cutNo} · 범위 초과</option>
          ) : null}
          {Array.from({ length: maxCut }, (_, index) => index + 1).map((cutNumber) => (
            <option key={cutNumber} value={String(cutNumber)}>C#{cutNumber}</option>
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
    </section>
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
    sceneId: inherited.sceneId,
    sceneNo: inherited.sceneNumber,
    // cropIndex는 컷 제안 토대일 뿐이며 컷 번호를 자동 확정하지 않습니다.
    cutNo: ""
  };
}

function archiveDragPreviewPosition(clientX: number, clientY: number) {
  const offset = 14;
  if (typeof window === "undefined") return { x: clientX + offset, y: clientY + offset };
  const previewSize = 72;
  return {
    x: Math.min(Math.max(8, clientX + offset), Math.max(8, window.innerWidth - previewSize)),
    y: Math.min(Math.max(8, clientY + offset), Math.max(8, window.innerHeight - previewSize))
  };
}

function archiveFolderDeleteMessage(
  inspection: ProjectArchiveFolderInspection,
  subject: string
) {
  return [
    `${subject}를 삭제할까요?`,
    `하위 폴더 ${inspection.descendantFolderCount}개, 파일 ${inspection.assetCount}개가 함께 삭제됩니다.`,
    inspection.linkedAssetCount > 0
      ? `진행도에 연결된 파일 ${inspection.linkedAssetCount}개의 연결도 해제됩니다.`
      : ""
  ].filter(Boolean).join(" ");
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

function normalizeArchiveFolderPath(value: string) {
  return value
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function cleanArchiveFolderSegment(value: string) {
  return value.trim().replace(/[\\/]+/g, " ").replace(/\s{2,}/g, " ").slice(0, 80);
}

function joinArchiveFolderPath(parent: string, child: string) {
  return normalizeArchiveFolderPath([parent, child].filter(Boolean).join("/"));
}

function archiveParentPath(path: string) {
  const segments = normalizeArchiveFolderPath(path).split("/").filter(Boolean);
  return segments.slice(0, -1).join("/");
}

function archiveBaseName(path: string) {
  return normalizeArchiveFolderPath(path).split("/").filter(Boolean).at(-1) ?? "";
}

function archivePathPrefixes(path: string) {
  const segments = normalizeArchiveFolderPath(path).split("/").filter(Boolean);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

function archiveBreadcrumbs(path: string) {
  return archivePathPrefixes(path).map((crumbPath) => ({
    path: crumbPath,
    label: archiveBaseName(crumbPath)
  }));
}

function isArchivePathWithin(path: string, parent: string) {
  const normalizedPath = normalizeArchiveFolderPath(path);
  const normalizedParent = normalizeArchiveFolderPath(parent);
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

function replaceArchivePathPrefix(path: string, previous: string, next: string) {
  const normalizedPath = normalizeArchiveFolderPath(path);
  const normalizedPrevious = normalizeArchiveFolderPath(previous);
  const suffix = normalizedPath.slice(normalizedPrevious.length).replace(/^\/+/, "");
  return joinArchiveFolderPath(next, suffix);
}

function getArchiveChildFolders(
  folders: ProjectArchiveFolder[],
  assets: ProjectReferenceAsset[],
  currentPath: string,
  folderPathById: Map<string, string>
) {
  const childPaths = new Set<string>();
  const prefix = currentPath ? `${currentPath}/` : "";
  for (const folder of folders) {
    const path = normalizeArchiveFolderPath(folder.name);
    if (currentPath && !path.startsWith(prefix)) continue;
    if (!currentPath && !path) continue;
    const remainder = currentPath ? path.slice(prefix.length) : path;
    const childName = remainder.split("/")[0];
    if (childName) childPaths.add(joinArchiveFolderPath(currentPath, childName));
  }
  return [...childPaths]
    .sort((left, right) => left.localeCompare(right, "ko-KR", { numeric: true }))
    .map((path) => {
      const folder = folders.find((entry) => normalizeArchiveFolderPath(entry.name) === path);
      return {
        id: folder?.id ?? "",
        path,
        name: archiveBaseName(path),
        itemCount: assets.filter((asset) => {
          const assetPath = folderPathById.get(asset.crop.folderId || "") ?? "";
          return isArchivePathWithin(assetPath, path);
        }).length
      };
    });
}

function archiveSelectionKey(
  kind: ArchiveSelectionKind,
  id: string
): ArchiveSelectionKey {
  return `${kind}:${id}`;
}

function parseArchiveSelectionKey(key: ArchiveSelectionKey) {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (
    !id
    || (kind !== "asset" && kind !== "diagram" && kind !== "folder")
  ) {
    return null;
  }
  return { kind: kind as ArchiveSelectionKind, id };
}

function isValidArchiveDropTarget(
  destinationFolderId: string | null,
  movingFolderIds: string[],
  folders: ProjectArchiveFolder[]
) {
  if (!destinationFolderId || movingFolderIds.length === 0) return true;
  if (movingFolderIds.includes(destinationFolderId)) return false;
  const destination = folders.find((folder) => folder.id === destinationFolderId);
  if (!destination) return false;
  const destinationPath = normalizeArchiveFolderPath(destination.name);
  return movingFolderIds.every((folderId) => {
    const source = folders.find((folder) => folder.id === folderId);
    if (!source) return false;
    return !isArchivePathWithin(destinationPath, normalizeArchiveFolderPath(source.name));
  });
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

function errorMessageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

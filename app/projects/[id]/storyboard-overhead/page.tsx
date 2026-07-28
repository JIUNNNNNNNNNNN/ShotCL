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
import { ArchiveImportDialog, type ArchiveImportCommit } from "@/components/ArchiveImportDialog";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import { Card } from "@/components/ui/Card";
import {
  createCroppedArchiveFile,
  createArchiveThumbnail,
  loadArchiveImagePages,
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
  deleteProjectArchiveFolder,
  deleteProjectReferenceAssets,
  listProjectArchiveFolders,
  listProjectReferenceAssets,
  moveProjectReferenceAssets,
  renameProjectArchiveFolder,
  updateProjectReferenceAsset,
  uploadProjectReferenceAsset
} from "@/lib/data/projectReferenceAssets";
import { getProject } from "@/lib/data/projects";
import {
  deleteOverheadDiagramArchive,
  listOverheadDiagramArchive,
  saveOverheadDiagramArchive
} from "@/lib/data/shotMediaArchive";
import { createEmptyShotOverheadDiagram } from "@/lib/shotOverhead";
import type {
  OverheadDiagramArchiveItem,
  ProjectArchiveFolder,
  ProjectReferenceAsset,
  ProjectReferenceAssetType,
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
  sourceKind: "pdf" | "images";
  sourceFiles: File[];
  sourceLabel: string;
  pages: ArchiveImportPage[];
  folderId: string | null;
  fileMetadata: Array<{ originalFolderName: string; relativePath: string }>;
  existingSourceAssetIds?: string[];
};

type FolderEditor = {
  mode: "create" | "rename";
  folderPath?: string;
  value: string;
};

type PendingConfirm =
  | { kind: "folder"; folderPath: string; folderIds: string[]; assetIds: string[] }
  | {
    kind: "selection";
    assetIds: string[];
    diagrams: OverheadDiagramArchiveItem[];
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
  title: string;
  memo: string;
  sceneNo: string;
  cutNo: string;
  folderId: string;
};

type FolderUploadReport = {
  discoveredCount: number;
  supportedCount: number;
  uploadedCount: number;
  skipped: ArchiveFolderIssue[];
  failed: ArchiveFolderIssue[];
  verified: boolean;
};

type AssetLongPress = {
  assetId: string;
  pointerId: number;
  startX: number;
  startY: number;
  triggered: boolean;
  timeoutId: number;
  target: HTMLButtonElement;
  clientX: number;
  clientY: number;
};

const PAGE_SIZE = 48;
const LONG_PRESS_MS = 600;
const LONG_PRESS_MOVE_TOLERANCE = 9;
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
  const [diagramArchives, setDiagramArchives] = useState<OverheadDiagramArchiveItem[]>([]);
  const [query, setQuery] = useState("");
  const [currentFolderPath, setCurrentFolderPath] = useState("");
  const [sortMode, setSortMode] = useState<"newest" | "name" | "scene">("newest");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [moveFolderId, setMoveFolderId] = useState("");
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [diagramDraft, setDiagramDraft] = useState<DiagramDraft | null>(null);
  const [editingAsset, setEditingAsset] = useState<ProjectReferenceAsset | null>(null);
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft>({
    title: "",
    memo: "",
    sceneNo: "",
    cutNo: "",
    folderId: ""
  });
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
  const [pressedAssetId, setPressedAssetId] = useState<string | null>(null);
  const [folderUploadReport, setFolderUploadReport] = useState<FolderUploadReport | null>(null);
  const preparingRef = useRef(false);
  const folderUploadRef = useRef<HTMLInputElement | null>(null);
  const longPressRef = useRef<AssetLongPress | null>(null);
  const selectionPointerCleanupRef = useRef<(() => void) | null>(null);
  const selectionScrollFrameRef = useRef<number | null>(null);
  const suppressAssetClickRef = useRef<string | null>(null);

  const loadArchive = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [project, overheadAssets, storyboardAssets, diagrams, folderResult] = await Promise.all([
        getProject(projectId),
        listProjectReferenceAssets(projectId, "overhead"),
        listProjectReferenceAssets(projectId, "storyboard"),
        listOverheadDiagramArchive(projectId),
        listProjectArchiveFolders(projectId)
          .then((value) => ({ value, error: "" }))
          .catch((error: unknown) => ({
            value: [] as ProjectArchiveFolder[],
            error: error instanceof Error ? error.message : "아카이브 폴더를 불러오지 못했습니다."
          }))
      ]);
      setProjectName(project?.name ?? "프로젝트");
      setOverheads(overheadAssets);
      setStoryboards(storyboardAssets);
      setDiagramArchives(diagrams);
      setFolders(folderResult.value);
      setErrorMessage(folderResult.error);
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
    setSelectedIds(new Set());
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
    const longPress = longPressRef.current;
    if (longPress) window.clearTimeout(longPress.timeoutId);
  }, []);

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
      const isSource = asset.mimeType === "application/pdf" || asset.groupId?.startsWith("source:");
      const assetPath = folderPathById.get(asset.crop.folderId || "") ?? "";
      const folderMatches = assetPath === currentFolderPath;
      return isSource && folderMatches && matchesAssetQuery(asset, query);
    }),
    [activeAssets, currentFolderPath, folderPathById, query]
  );
  const imageAssets = useMemo(
    () => activeAssets.filter((asset) => asset.mimeType.startsWith("image/") && !asset.groupId?.startsWith("source:")),
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
        return (left.crop.title || left.filename).localeCompare(right.crop.title || right.filename, "ko-KR");
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
      .filter((asset) => selectedIds.has(asset.id))
      .map((asset) => asset.id),
    [overheads, selectedIds, storyboards]
  );
  const selectedDiagramItems = useMemo(
    () => diagramArchives.filter((item) => !item.legacy && selectedIds.has(item.id)),
    [diagramArchives, selectedIds]
  );
  const selectedCount = selectedReferenceAssetIds.length + selectedDiagramItems.length;

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
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
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
    updateAssetsInLocalState([updated.id], () => updated);
  }

  async function preparePdf(assetType: ArchiveType, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await prepareFiles(assetType, files, "pdf");
  }

  async function prepareImages(assetType: ArchiveType, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await prepareFiles(assetType, files, "images", true);
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
    }
  ) {
    if (!projectId || rawFiles.length === 0 || preparingRef.current || isSaving) return;
    const candidates = uniqueFiles(rawFiles);
    const files = candidates.filter((file) => {
      if (!isAcceptedArchiveFile(file) || file.size <= 0) return false;
      if (expectedKind === "pdf") return isPdfFile(file);
      if (expectedKind === "images") return isImageFile(file);
      return true;
    });
    let excludedCount = candidates.length - files.length;
    if (files.length === 0) {
      setErrorMessage("PDF, JPG, JPEG, PNG, WebP 중 읽을 수 있는 파일을 선택해주세요.");
      return;
    }
    const pdfFiles = files.filter(isPdfFile);
    const imageFiles = files.filter(isImageFile);
    if (pdfFiles.length > 0 && imageFiles.length > 0) {
      setErrorMessage("PDF와 이미지는 각각의 가져오기 흐름으로 나누어 놓아주세요.");
      return;
    }
    const sourceKind: PendingImport["sourceKind"] = pdfFiles.length > 0 ? "pdf" : "images";
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
        await mapWithConcurrency(files, 3, async (file, index) => {
          try {
            setProgressMessage(`이미지 최적화 중 · ${file.name}`);
            const optimized = await optimizeArchiveImage(file);
            setProgressMessage(`썸네일 생성 완료 · 업로드 중 ${completed + 1}/${files.length}`);
            const metadata = context?.fileMetadata?.[index];
            await uploadProjectReferenceAsset(projectId, assetType, optimized.displayFile, {
              thumbnailFile: optimized.thumbnailFile,
              sourceType: "upload_image",
              groupId: batchId,
              folderId: destinationFolderId,
              originalFolderName: metadata?.originalFolderName,
              relativePath: metadata?.relativePath,
              sortOrder: existingCount + index
            });
            completed += 1;
            setProgressMessage(`저장 중 ${completed}/${files.length}`);
          } catch {
            failed += 1;
          }
        });
        excludedCount += failed;
        await loadArchive();
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
      if (sourceKind === "pdf") {
        for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
          const file = files[fileIndex];
          try {
            if (!await hasPdfSignature(file)) throw new Error("Invalid PDF");
            const sourceFileIndex = readableFiles.length;
            const rendered = await renderArchivePdfPages(file, (current, total) => {
              setProgressMessage(`PDF ${fileIndex + 1}/${files.length} · 페이지 ${current}/${total}`);
            }, sourceFileIndex);
            if (rendered.length === 0) throw new Error("Empty PDF");
            readableFiles.push(file);
            readableMetadata.push(context?.fileMetadata?.[fileIndex] ?? {
              originalFolderName: "",
              relativePath: file.name
            });
            readableSourceIds.push(context?.existingSourceAssetIds?.[fileIndex] ?? "");
            pages.push(...rendered);
          } catch {
            excludedCount += 1;
          }
        }
      } else {
        setProgressMessage("이미지 묶음을 준비하는 중입니다.");
        pages.push(...await loadArchiveImagePages(files));
        readableFiles.push(...files);
        readableMetadata.push(...files.map((file, index) => context?.fileMetadata?.[index] ?? {
          originalFolderName: "",
          relativePath: file.name
        }));
      }
      if (pages.length === 0 || readableFiles.length === 0) {
        setErrorMessage("읽을 수 있는 자료가 없습니다.");
        setProgressMessage("");
        return;
      }
      setPendingImport({
        assetType,
        sourceKind,
        sourceFiles: readableFiles,
        sourceLabel: readableFiles.length === 1
          ? readableFiles[0].name
          : `${readableFiles[0].name} 외 ${readableFiles.length - 1}개`,
        pages,
        folderId: destinationFolderId,
        fileMetadata: readableMetadata,
        existingSourceAssetIds: readableSourceIds.length > 0 ? readableSourceIds : undefined
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

  function closeImport() {
    if (pendingImport) releaseArchivePages(pendingImport.pages);
    setPendingImport(null);
  }

  async function saveImport(value: ArchiveImportCommit) {
    if (!projectId || !pendingImport || isSaving) return;
    setIsSaving(true);
    setErrorMessage("");
    const batchId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;
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
            originalFolderName: sourceMetadata?.originalFolderName,
            relativePath: sourceMetadata?.relativePath,
            title: value.title,
            memo: value.memo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo
          });
          sourceAssetsByIndex.set(fileIndex, original.id);
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
          await uploadProjectReferenceAsset(projectId, pendingImport.assetType, resultFile, {
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
            title: pageTitle(value.title, index, value.results.length),
            memo: value.memo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo,
            sortOrder: imageAssets.length + index
          });
          completed += 1;
          setProgressMessage(`저장 중 ${completed}/${value.results.length}`);
        });
      } else if (value.results.some((result) => result.crop)) {
        const sourceAssetsByIndex = new Map<number, string>();
        for (let index = 0; index < pendingImport.pages.length; index += 1) {
          const page = pendingImport.pages[index];
          const sourceFile = page.originalFile ?? pendingImport.sourceFiles[index];
          if (!sourceFile) continue;
          setProgressMessage(`원본 이미지 보존 ${index + 1}/${pendingImport.pages.length}`);
          const source = await uploadProjectReferenceAsset(projectId, pendingImport.assetType, sourceFile, {
            sourceType: "upload_image",
            groupId: `source:${batchId}`,
            folderId: pendingImport.folderId,
            originalFolderName: pendingImport.fileMetadata[page.sourceFileIndex]?.originalFolderName,
            relativePath: pendingImport.fileMetadata[page.sourceFileIndex]?.relativePath,
            title: value.title,
            memo: value.memo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo
          });
          sourceAssetsByIndex.set(page.sourceFileIndex, source.id);
        }
        const cropResults = value.results.filter((result) => result.crop);
        let completed = 0;
        await mapWithConcurrency(cropResults, 3, async (result, index) => {
          const { page, crop } = result;
          if (!crop) return;
          setProgressMessage(`crop 이미지 생성 중 ${index + 1}/${cropResults.length}`);
          const resultFile = await createCroppedArchiveFile(page, crop, page.name);
          const thumbnailFile = await createArchiveThumbnail(resultFile);
          await uploadProjectReferenceAsset(projectId, pendingImport.assetType, resultFile, {
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
            title: pageTitle(value.title, index, value.results.length),
            memo: value.memo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo,
            sortOrder: imageAssets.length + index
          });
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
          await uploadProjectReferenceAsset(projectId, pendingImport.assetType, displayFile, {
            thumbnailFile,
            sourceType: "upload_image",
            groupId: batchId,
            folderId: pendingImport.folderId,
            originalFolderName: pendingImport.fileMetadata[page.sourceFileIndex]?.originalFolderName,
            relativePath: pendingImport.fileMetadata[page.sourceFileIndex]?.relativePath,
            title: pageTitle(value.title, index, value.results.length),
            memo: value.memo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo,
            sortOrder: imageAssets.length + index
          });
          completed += 1;
          setProgressMessage(`저장 중 ${completed}/${value.results.length}`);
        });
      }
      closeImport();
      setProgressMessage("");
      await loadArchive();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "아카이브 자료를 저장하지 못했습니다.");
      setProgressMessage("");
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
        const affected = folders
          .filter((folder) => isArchivePathWithin(normalizeArchiveFolderPath(folder.name), oldPath))
          .sort((left, right) => left.name.length - right.name.length);
        const affectedIds = new Set(affected.map((folder) => folder.id));
        const collision = folders.some((folder) => {
          if (affectedIds.has(folder.id)) return false;
          const path = normalizeArchiveFolderPath(folder.name);
          return affected.some((entry) => (
            path === replaceArchivePathPrefix(normalizeArchiveFolderPath(entry.name), oldPath, nextPath)
          ));
        });
        if (collision) {
          setErrorMessage("같은 위치에 동일한 이름의 폴더가 있습니다.");
          return;
        }
        const updatedFolders: ProjectArchiveFolder[] = [];
        for (const folder of affected) {
          updatedFolders.push(await renameProjectArchiveFolder(
            projectId,
            folder.id,
            replaceArchivePathPrefix(normalizeArchiveFolderPath(folder.name), oldPath, nextPath)
          ));
        }
        const updatedById = new Map(updatedFolders.map((folder) => [folder.id, folder]));
        setFolders((current) => current.map((folder) => updatedById.get(folder.id) ?? folder));
        setCurrentFolderPath(nextPath);
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
        if (pendingConfirm.assetIds.length > 0) {
          await moveProjectReferenceAssets(projectId, pendingConfirm.assetIds, null);
          updateAssetsInLocalState(pendingConfirm.assetIds, (asset) => ({
            ...asset,
            crop: { ...asset.crop, folderId: null }
          }));
        }
        for (const folderId of pendingConfirm.folderIds) {
          await deleteProjectArchiveFolder(projectId, folderId);
        }
        const removedIds = new Set(pendingConfirm.folderIds);
        setFolders((current) => current.filter((entry) => !removedIds.has(entry.id)));
        setCurrentFolderPath(archiveParentPath(pendingConfirm.folderPath));
      } else {
        if (pendingConfirm.assetIds.length > 0) {
          await deleteProjectReferenceAssets(projectId, pendingConfirm.assetIds);
          removeAssetsFromLocalState(pendingConfirm.assetIds);
        }
        for (const item of pendingConfirm.diagrams) {
          await deleteOverheadDiagramArchive(projectId, item.id);
          setDiagramArchives((current) => current.filter((entry) => entry.id !== item.id));
          setSelectedIds((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
        }
        setSelectedIds(new Set());
        setSelectionMode(false);
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

  function toggleAssetSelection(assetId: string, additive = true) {
    setSelectedIds((current) => {
      const next = additive ? new Set(current) : new Set<string>();
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  async function moveSelectedAssets() {
    if (!projectId || selectedReferenceAssetIds.length === 0) return;
    try {
      setIsSaving(true);
      await moveProjectReferenceAssets(projectId, selectedReferenceAssetIds, moveFolderId || null);
      updateAssetsInLocalState(selectedReferenceAssetIds, (asset) => ({
        ...asset,
        crop: { ...asset.crop, folderId: moveFolderId || null }
      }));
      setSelectedIds(new Set());
      setSelectionMode(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "선택한 자료를 이동하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSelectedAssets() {
    if (!projectId || selectedIds.size === 0) return;
    setPendingConfirm({
      kind: "selection",
      assetIds: selectedReferenceAssetIds,
      diagrams: selectedDiagramItems,
      label: `선택한 자료 ${selectedReferenceAssetIds.length + selectedDiagramItems.length}개`
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  function editSingleSelectedItem() {
    if (selectedCount !== 1) return;
    const selectedAsset = [...overheads, ...storyboards]
      .find((asset) => selectedIds.has(asset.id));
    if (selectedAsset) {
      clearSelection();
      openMetadata(selectedAsset);
      return;
    }
    const selectedDiagram = diagramArchives.find(
      (item) => !item.legacy && selectedIds.has(item.id)
    );
    if (selectedDiagram) {
      clearSelection();
      openDiagram(selectedDiagram, true);
    }
  }

  function beginAssetSelectionPress(assetId: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!canEdit || event.button !== 0) return;
    const selectionWasActive = selectionMode;
    cancelAssetLongPress();
    selectionPointerCleanupRef.current?.();

    const state: AssetLongPress = {
      assetId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      triggered: false,
      timeoutId: 0,
      target: event.currentTarget
    };

    const activateSelection = () => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.triggered = true;
      suppressAssetClickRef.current = current.assetId;
      setSelectionMode(true);
      setPressedAssetId(null);
      setSelectedIds((selected) => new Set(selected).add(current.assetId));
      try {
        current.target.setPointerCapture(current.pointerId);
      } catch {
        // Some mobile browsers can reject capture after the native long-press delay.
      }
      if (navigator.vibrate) navigator.vibrate(18);
      runSelectionAutoScroll();
    };

    longPressRef.current = state;
    if (!selectionWasActive) {
      state.timeoutId = window.setTimeout(activateSelection, LONG_PRESS_MS);
      setPressedAssetId(assetId);
    }

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      current.clientX = pointerEvent.clientX;
      current.clientY = pointerEvent.clientY;
      if (!current.triggered) {
        const distance = Math.hypot(
          pointerEvent.clientX - current.startX,
          pointerEvent.clientY - current.startY
        );
        if (selectionWasActive && distance > 4) {
          activateSelection();
          addSelectionAtPoint(pointerEvent.clientX, pointerEvent.clientY);
          return;
        }
        if (!selectionWasActive && distance > LONG_PRESS_MOVE_TOLERANCE) {
          cancelAssetLongPress();
        }
        return;
      }
      if (pointerEvent.cancelable) pointerEvent.preventDefault();
      addSelectionAtPoint(pointerEvent.clientX, pointerEvent.clientY);
    };
    const handlePointerEnd = (pointerEvent: PointerEvent) => {
      const current = longPressRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      const wasTriggered = current.triggered;
      if (wasTriggered) suppressAssetClickRef.current = current.assetId;
      cancelAssetLongPress();
      if (wasTriggered) {
        window.setTimeout(() => {
          if (suppressAssetClickRef.current === assetId) suppressAssetClickRef.current = null;
        }, 700);
      }
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
      if (selectionScrollFrameRef.current !== null) {
        cancelAnimationFrame(selectionScrollFrameRef.current);
        selectionScrollFrameRef.current = null;
      }
      selectionPointerCleanupRef.current = null;
    };
    selectionPointerCleanupRef.current = cleanup;
    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerEnd);
  }

  function addSelectionAtPoint(clientX: number, clientY: number) {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(
      "[data-archive-select-id]"
    );
    const assetId = target?.dataset.archiveSelectId;
    if (!assetId) return;
    setSelectedIds((current) => current.has(assetId) ? current : new Set(current).add(assetId));
  }

  function runSelectionAutoScroll() {
    const current = longPressRef.current;
    if (!current?.triggered) return;
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
      addSelectionAtPoint(current.clientX, current.clientY);
    }
    selectionScrollFrameRef.current = requestAnimationFrame(runSelectionAutoScroll);
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

  function cancelAssetLongPress() {
    const current = longPressRef.current;
    if (current) {
      window.clearTimeout(current.timeoutId);
      if (current.target.hasPointerCapture(current.pointerId)) {
        current.target.releasePointerCapture(current.pointerId);
      }
    }
    longPressRef.current = null;
    setPressedAssetId(null);
    selectionPointerCleanupRef.current?.();
  }

  async function cropStoredPdf(asset: ProjectReferenceAsset) {
    if (!canEdit || asset.mimeType !== "application/pdf") return;
    setIsPreparing(true);
    setErrorMessage("");
    setProgressMessage("PDF를 준비하는 중");
    try {
      const response = await fetch(asset.publicUrl);
      if (!response.ok) throw new Error("원본 PDF를 불러오지 못했습니다.");
      const blob = await response.blob();
      const file = new File([blob], asset.filename, { type: "application/pdf" });
      setIsPreparing(false);
      await prepareFiles(activeType, [file], "pdf", false, {
        folderId: asset.crop.folderId ?? null,
        fileMetadata: [{
          originalFolderName: asset.crop.originalFolderName ?? "",
          relativePath: asset.crop.relativePath ?? asset.filename
        }],
        existingSourceAssetIds: [asset.id]
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "원본 PDF를 준비하지 못했습니다.");
      setProgressMessage("");
      setIsPreparing(false);
    }
  }

  function openMetadata(asset: ProjectReferenceAsset) {
    setEditingAsset(asset);
    setMetadataDraft({
      title: asset.crop.title || "",
      memo: asset.crop.memo || "",
      sceneNo: asset.sceneNo || "",
      cutNo: asset.cutNo || "",
      folderId: asset.crop.folderId || ""
    });
  }

  async function saveMetadata() {
    if (!projectId || !editingAsset || !canEdit) return;
    setIsSaving(true);
    try {
      const updated = await updateProjectReferenceAsset(projectId, editingAsset.id, {
        title: metadataDraft.title,
        memo: metadataDraft.memo,
        sceneNo: metadataDraft.sceneNo,
        cutNo: metadataDraft.cutNo,
        crop: { folderId: metadataDraft.folderId || null }
      });
      replaceAssetInLocalState(updated);
      setEditingAsset(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "자료 정보를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  return (
    <>
      <div className="mx-auto grid w-full max-w-6xl select-none gap-4 [&_input]:select-text [&_textarea]:select-text" onContextMenu={(event) => event.preventDefault()}>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display truncate text-xl font-black text-field-primary">부감도&콘티 아카이브</h1>
            <p className="truncate text-xs font-bold text-field-muted">{projectName} · 컷에 연결하기 전 프로젝트 공통 자료</p>
          </div>
          {!canEdit ? <span className="rounded-full border border-field-border bg-white px-3 py-2 text-xs font-black text-field-muted">읽기 전용</span> : null}
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
                <button key={type} type="button" onClick={() => setActiveType(type)} className={`min-h-10 rounded-full border px-4 text-sm font-black ${activeType === type ? "border-field-primary bg-field-primary text-white" : "border-field-border bg-white text-field-primary"}`}>
                  {type === "overhead" ? "부감도" : "콘티"}
                </button>
              ))}
            </div>
            <label className="relative block min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-field-muted" aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-10 w-full rounded-full border border-field-border bg-white pl-9 pr-3 text-sm" placeholder="제목, 메모, 씬, 컷 검색" />
            </label>
            {canEdit ? (
              <div className="flex flex-wrap justify-end gap-2">
                {activeType === "overhead" ? (
                  <button type="button" onClick={openNewDiagram} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                    <MapIcon className="h-4 w-4" aria-hidden />
                    직접 만들기
                  </button>
                ) : null}
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                  <ImagePlus className="h-4 w-4" aria-hidden />
                  이미지
                  <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple className="sr-only" disabled={isPreparing || isSaving} onChange={(event) => prepareImages(activeType, event)} />
                </label>
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full bg-field-primary px-3 text-xs font-black text-white">
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
                className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary"
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
                    className={`min-h-9 rounded-full px-2.5 text-xs font-black ${
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
                className="grid h-9 w-9 place-items-center rounded-full border border-field-border bg-white text-field-primary disabled:opacity-35"
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
              className="min-h-9 rounded-full border border-field-border bg-white px-3 text-xs font-bold text-field-text"
              aria-label="아카이브 정렬"
            >
              <option value="newest">최신순</option>
              <option value="name">이름순</option>
              <option value="scene">씬/컷순</option>
            </select>
            {canEdit ? (
              <>
                <button type="button" onClick={() => setFolderEditor({ mode: "create", folderPath: currentFolderPath, value: "" })} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary">
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
                      className="min-h-9 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary"
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
                        const affectedFolderIds = new Set(affectedFolders.map((folder) => folder.id));
                        const assetIds = [...overheads, ...storyboards]
                          .filter((asset) => (
                            Boolean(asset.crop.folderId)
                            && affectedFolderIds.has(asset.crop.folderId || "")
                          ))
                          .map((asset) => asset.id);
                        setPendingConfirm({
                          kind: "folder",
                          folderPath: currentFolderPath,
                          folderIds: affectedFolders.map((folder) => folder.id),
                          assetIds
                        });
                      }}
                      className="min-h-9 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-danger"
                    >
                      폴더 삭제
                    </button>
                  </>
                ) : null}
                {supportsDesktopDrop ? (
                  <>
                    <button type="button" onClick={() => folderUploadRef.current?.click()} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary">
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
                <button type="submit" className="min-h-9 rounded-full bg-field-primary px-3 text-xs font-black text-white">확인</button>
                <button type="button" onClick={() => setFolderEditor(null)} className="grid h-9 w-9 place-items-center rounded-full border border-field-border bg-white" aria-label="폴더 편집 취소">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </form>
            ) : null}
          </div>
          {canEdit && selectedCount > 0 ? (
            <div className="fixed inset-x-3 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-field-border bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
              <span className="text-xs font-black text-field-primary">
                {selectedCount}개 선택
              </span>
              <select
                value={moveFolderId}
                onChange={(event) => setMoveFolderId(event.target.value)}
                className="min-h-9 rounded-full border border-field-border bg-white px-3 text-xs font-bold"
                aria-label="선택 자료 이동 폴더"
              >
                <option value="">홈으로 이동</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
              <button type="button" disabled={isSaving || selectedReferenceAssetIds.length === 0 || selectedDiagramItems.length > 0} onClick={() => void moveSelectedAssets()} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-field-primary px-3 text-xs font-black text-white disabled:opacity-50">
                <Move className="h-3.5 w-3.5" aria-hidden />
                이동
              </button>
              {selectedCount === 1 ? (
                <button type="button" onClick={editSingleSelectedItem} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                  <Info className="h-3.5 w-3.5" aria-hidden />
                  정보
                </button>
              ) : null}
              <button type="button" disabled={isSaving || selectedCount === 0} onClick={() => void deleteSelectedAssets()} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-danger bg-white px-3 text-xs font-black text-field-danger disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                삭제
              </button>
              <button type="button" onClick={clearSelection} className="min-h-9 rounded-full px-3 text-xs font-black text-field-muted">
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
              className="grid min-w-0 select-none grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
              onContextMenu={(event) => event.preventDefault()}
            >
              {childFolders.map((folder) => (
                <button
                  key={folder.path}
                  type="button"
                  onClick={() => setCurrentFolderPath(folder.path)}
                  className="grid min-w-0 aspect-[4/3] place-items-center gap-2 border border-field-border bg-field-soft/45 p-3 text-field-primary transition-colors hover:border-field-primary hover:bg-field-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                  aria-label={`${folder.name} 폴더 열기`}
                >
                  <Folder className="h-12 w-12 fill-[#e5bd55] text-[#a97813] sm:h-14 sm:w-14" aria-hidden />
                  <span className="min-w-0 max-w-full truncate text-xs font-black">{folder.name}</span>
                  <span className="text-[10px] font-bold text-field-muted">{folder.itemCount}개</span>
                </button>
              ))}
              {filteredDiagrams.map((item) => {
                const selected = selectedIds.has(item.id);
                return (
                <article
                  key={item.id}
                  onContextMenu={(event) => event.preventDefault()}
                  className={`relative grid min-w-0 select-none grid-rows-[minmax(0,1fr)_auto] gap-1.5 border bg-white p-2 transition ${
                    selected
                      ? "border-[#ef8f39] bg-[#fff8f0] ring-2 ring-[#ef8f39]/45"
                      : "border-field-border"
                  } ${pressedAssetId === item.id ? "scale-[0.985] border-[#ef8f39]" : ""}`}
                >
                  <button
                    type="button"
                    data-archive-select-id={!item.legacy ? item.id : undefined}
                    onPointerDown={(event) => {
                      if (!item.legacy) beginAssetSelectionPress(item.id, event);
                    }}
                    onClick={(event) => {
                      if (suppressAssetClickRef.current === item.id) {
                        suppressAssetClickRef.current = null;
                        event.preventDefault();
                        return;
                      }
                      if (selectionMode && !item.legacy) {
                        event.preventDefault();
                        toggleAssetSelection(item.id);
                        return;
                      }
                      openDiagram(item, false);
                    }}
                    className={`grid min-w-0 aspect-[4/3] place-items-center bg-field-soft ${
                      selectionMode ? "touch-none" : "touch-pan-y"
                    }`}
                    aria-pressed={selectionMode && !item.legacy ? selected : undefined}
                  >
                    <ShotOverheadPreview diagram={item.diagram} label={`${item.title} 부감도`} />
                  </button>
                  <ArchiveText title={item.title} sceneNo={item.sceneNo} cutNo={item.cutNo} />
                </article>
              )})}
              {visibleAssets.map((asset) => {
                const selected = selectedIds.has(asset.id);
                return (
                <article
                  key={asset.id}
                  className={`relative grid min-w-0 max-w-full select-none grid-rows-[minmax(0,1fr)_auto] gap-1.5 border bg-white p-2 transition ${
                    selected
                      ? "border-[#ef8f39] bg-[#fff8f0] ring-2 ring-[#ef8f39]/45"
                      : "border-field-border"
                  } ${pressedAssetId === asset.id ? "scale-[0.985] border-[#ef8f39]" : ""}`}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <button
                    type="button"
                    data-archive-select-id={asset.id}
                    onPointerDown={(event) => beginAssetSelectionPress(asset.id, event)}
                    onClick={(event) => {
                      if (suppressAssetClickRef.current === asset.id) {
                        suppressAssetClickRef.current = null;
                        event.preventDefault();
                        return;
                      }
                      if (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) {
                        event.preventDefault();
                        toggleAssetSelection(asset.id);
                        return;
                      }
                      setPreview({ url: asset.publicUrl, title: asset.crop.title || asset.filename });
                    }}
                    className={`grid min-w-0 max-w-full aspect-[4/3] place-items-center bg-field-soft p-1 ${
                      selectionMode ? "touch-none" : "touch-pan-y"
                    }`}
                    aria-pressed={selectionMode ? selected : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.crop.thumbnailUrl || asset.publicUrl}
                      alt={asset.crop.title || asset.filename}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      onDragStart={(event) => event.preventDefault()}
                      className="block h-auto max-h-full w-auto max-w-full rounded-none object-contain"
                    />
                  </button>
                  <ArchiveText title={asset.crop.title || asset.filename} sceneNo={asset.sceneNo || ""} cutNo={asset.cutNo || ""} />
                </article>
              )})}
            </div>
          )}
          {visibleAssets.length < filteredAssets.length ? (
            <button type="button" onClick={() => setVisibleCount((current) => current + PAGE_SIZE)} className="mx-auto min-h-9 rounded-full border border-field-border bg-white px-4 text-xs font-black text-field-primary">
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
              {sourceAssets.map((asset) => (
                <article key={asset.id} className="flex min-w-0 items-center gap-3 border border-field-border bg-white p-3">
                  {asset.mimeType === "application/pdf" ? <FileText className="h-7 w-7 shrink-0 text-field-primary" aria-hidden /> : <FileImage className="h-7 w-7 shrink-0 text-field-primary" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-black text-field-text">{asset.filename}</p>
                    {asset.crop.relativePath ? (
                      <p className="truncate text-[10px] font-bold text-field-muted">{asset.crop.relativePath}</p>
                    ) : null}
                    <a href={asset.publicUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-field-primary underline underline-offset-2">원본 보기</a>
                  </div>
                  {canEdit && asset.mimeType === "application/pdf" ? (
                    <button type="button" onClick={() => void cropStoredPdf(asset)} className="min-h-9 shrink-0 rounded-full border border-field-border px-3 text-[11px] font-black text-field-primary">
                      crop
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      {pendingImport ? (
        <ArchiveImportDialog assetType={pendingImport.assetType} sourceLabel={pendingImport.sourceLabel} pages={pendingImport.pages} isSaving={isSaving} onClose={closeImport} onSave={saveImport} />
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
        <MetadataDialog
          value={metadataDraft}
          folders={folders}
          readOnly={!canEdit}
          isSaving={isSaving}
          onChange={setMetadataDraft}
          onClose={() => setEditingAsset(null)}
          onSave={saveMetadata}
        />
      ) : null}
      {pendingConfirm ? (
        <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[95] mx-auto max-w-lg">
          <CompactConfirm
            message={pendingConfirm.kind === "folder"
              ? `"${archiveBaseName(pendingConfirm.folderPath)}" 폴더를 삭제할까요? 안의 자료 ${pendingConfirm.assetIds.length}개는 홈으로 이동합니다.`
              : `${pendingConfirm.label}를 삭제할까요? 연결된 컷에서는 선택이 해제됩니다.`}
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
    <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-field-border bg-white p-3 shadow-lg" role="alertdialog" aria-label="삭제 확인">
      <p className="min-w-0 flex-1 text-xs font-bold leading-5 text-field-text">{message}</p>
      <button type="button" disabled={isSaving} onClick={onCancel} className="min-h-9 rounded-full border border-field-border px-3 text-xs font-black text-field-muted disabled:opacity-50">
        취소
      </button>
      <button type="button" disabled={isSaving} onClick={onConfirm} className="min-h-9 rounded-full bg-field-danger px-3 text-xs font-black text-white disabled:opacity-50">
        {isSaving ? "처리 중" : "삭제"}
      </button>
    </section>
  );
}

function MetadataDialog({
  value,
  folders,
  readOnly,
  isSaving,
  onChange,
  onClose,
  onSave
}: {
  value: MetadataDraft;
  folders: ProjectArchiveFolder[];
  readOnly: boolean;
  isSaving: boolean;
  onChange: (value: MetadataDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[85] grid select-text place-items-center bg-black/25 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={readOnly ? "자료 정보 보기" : "자료 정보 수정"}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="grid w-full max-w-md gap-3 rounded-2xl border border-field-border bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-black text-field-primary">자료 정보</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-field-border" aria-label="자료 정보 닫기"><X className="h-4 w-4" aria-hidden /></button>
        </div>
        {readOnly ? <p className="text-xs font-bold text-field-muted">읽기 전용 정보입니다.</p> : null}
        <label className="grid gap-1 text-xs font-black text-field-muted">제목<input readOnly={readOnly} value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} className="min-h-10 rounded-lg border border-field-border px-3 text-sm text-field-text read-only:bg-field-soft" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs font-black text-field-muted">씬<input readOnly={readOnly} value={value.sceneNo} onChange={(event) => onChange({ ...value, sceneNo: event.target.value })} className="min-h-10 rounded-lg border border-field-border px-3 text-sm text-field-text read-only:bg-field-soft" /></label>
          <label className="grid gap-1 text-xs font-black text-field-muted">컷<input readOnly={readOnly} value={value.cutNo} onChange={(event) => onChange({ ...value, cutNo: event.target.value })} className="min-h-10 rounded-lg border border-field-border px-3 text-sm text-field-text read-only:bg-field-soft" /></label>
        </div>
        <label className="grid gap-1 text-xs font-black text-field-muted">
          폴더
          <select disabled={readOnly} value={value.folderId} onChange={(event) => onChange({ ...value, folderId: event.target.value })} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text disabled:bg-field-soft">
            <option value="">홈</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-black text-field-muted">메모<textarea readOnly={readOnly} value={value.memo} onChange={(event) => onChange({ ...value, memo: event.target.value })} rows={4} className="rounded-lg border border-field-border px-3 py-2 text-sm leading-5 text-field-text read-only:bg-field-soft" /></label>
        {!readOnly ? (
          <button type="button" disabled={isSaving} onClick={onSave} className="min-h-11 rounded-full bg-field-primary px-4 text-sm font-black text-white disabled:opacity-50">{isSaving ? "저장 중" : "저장"}</button>
        ) : null}
      </section>
    </div>
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
    asset.crop.title,
    asset.crop.memo,
    asset.filename,
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
  return count > 1 ? `${title} ${pageIndex + 1}` : title;
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
    .map((path) => ({
      path,
      name: archiveBaseName(path),
      itemCount: assets.filter((asset) => {
        const assetPath = folderPathById.get(asset.crop.folderId || "") ?? "";
        return isArchivePathWithin(assetPath, path);
      }).length
    }));
}

function uniqueFiles(files: File[]) {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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

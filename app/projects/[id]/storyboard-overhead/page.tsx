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
  Check,
  CheckSquare,
  Clapperboard,
  FileImage,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  ImagePlus,
  Map as MapIcon,
  Move,
  Pencil,
  Search,
  Square,
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
  folderId?: string;
  value: string;
};

type PendingConfirm =
  | { kind: "folder"; folder: ProjectArchiveFolder; assetIds: string[] }
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

type LassoBox = {
  startPageX: number;
  startPageY: number;
  currentPageX: number;
  currentPageY: number;
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
};

const PAGE_SIZE = 48;
const LONG_PRESS_MS = 600;
const LONG_PRESS_MOVE_TOLERANCE = 9;

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
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [sortMode, setSortMode] = useState<"newest" | "name" | "scene" | "folder">("newest");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [moveFolderId, setMoveFolderId] = useState("");
  const [lasso, setLasso] = useState<LassoBox | null>(null);
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
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const lassoBaseSelectionRef = useRef<Set<string>>(new Set());
  const lassoMovedRef = useRef(false);
  const lassoRef = useRef<LassoBox | null>(null);
  const lassoPointerRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);
  const lassoCleanupRef = useRef<(() => void) | null>(null);
  const lassoAnimationRef = useRef<number | null>(null);
  const previousBodyUserSelectRef = useRef("");
  const longPressRef = useRef<AssetLongPress | null>(null);
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
  }, [activeType, activeFolderId, query, sortMode]);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(""), 5_000);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  useEffect(() => {
    if (
      activeFolderId !== "all"
      && activeFolderId !== "unfiled"
      && !folders.some((folder) => folder.id === activeFolderId)
    ) {
      setActiveFolderId("all");
    }
  }, [activeFolderId, folders]);

  useEffect(() => () => {
    lassoCleanupRef.current?.();
    if (lassoAnimationRef.current !== null) cancelAnimationFrame(lassoAnimationRef.current);
    const longPress = longPressRef.current;
    if (longPress) window.clearTimeout(longPress.timeoutId);
  }, []);

  const activeAssets = activeType === "overhead" ? overheads : storyboards;
  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders]
  );
  const sourceAssets = useMemo(
    () => activeAssets.filter((asset) => {
      const isSource = asset.mimeType === "application/pdf" || asset.groupId?.startsWith("source:");
      const folderMatches = activeFolderId === "all"
        || activeFolderId === "unfiled" && !asset.crop.folderId
        || asset.crop.folderId === activeFolderId;
      return isSource && folderMatches && matchesAssetQuery(asset, query);
    }),
    [activeAssets, activeFolderId, query]
  );
  const imageAssets = useMemo(
    () => activeAssets.filter((asset) => asset.mimeType.startsWith("image/") && !asset.groupId?.startsWith("source:")),
    [activeAssets]
  );
  const filteredAssets = useMemo(() => {
    const filtered = imageAssets.filter((asset) => {
      const folderMatches = activeFolderId === "all"
        || activeFolderId === "unfiled" && !asset.crop.folderId
        || asset.crop.folderId === activeFolderId;
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
      if (sortMode === "folder") {
        return (folderNameById.get(left.crop.folderId || "") || "미분류").localeCompare(
          folderNameById.get(right.crop.folderId || "") || "미분류",
          "ko-KR"
        );
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [activeFolderId, folderNameById, imageAssets, query, sortMode]);
  const visibleAssets = filteredAssets.slice(0, visibleCount);
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let unfiled = 0;
    activeAssets.forEach((asset) => {
      if (asset.groupId?.startsWith("source:") && asset.mimeType !== "application/pdf") return;
      const folderId = asset.crop.folderId;
      if (!folderId) unfiled += 1;
      else counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
    });
    const diagramCount = activeType === "overhead" ? diagramArchives.length : 0;
    return { all: activeAssets.length + diagramCount, unfiled: unfiled + diagramCount, byId: counts };
  }, [activeAssets, activeType, diagramArchives.length]);
  const filteredDiagrams = useMemo(
    () => activeType === "overhead" && (activeFolderId === "all" || activeFolderId === "unfiled")
      ? diagramArchives.filter((item) => matchesDiagramQuery(item, query))
      : [],
    [activeFolderId, activeType, diagramArchives, query]
  );
  const selectableFilteredIds = useMemo(
    () => [
      ...filteredDiagrams.filter((item) => !item.legacy).map((item) => item.id),
      ...filteredAssets.map((asset) => asset.id)
    ],
    [filteredAssets, filteredDiagrams]
  );
  const selectedReferenceAssetIds = useMemo(
    () => filteredAssets.filter((asset) => selectedIds.has(asset.id)).map((asset) => asset.id),
    [filteredAssets, selectedIds]
  );
  const selectedDiagramItems = useMemo(
    () => filteredDiagrams.filter((item) => !item.legacy && selectedIds.has(item.id)),
    [filteredDiagrams, selectedIds]
  );
  const allFilteredSelected = selectableFilteredIds.length > 0
    && selectableFilteredIds.every((id) => selectedIds.has(id));

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
              folderId: context?.folderId ?? selectedFolderValue(activeFolderId),
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
        folderId: context?.folderId ?? selectedFolderValue(activeFolderId),
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
    cache = new Map(folders.map((folder) => [folder.name.trim().toLocaleLowerCase("ko-KR"), folder]))
  ) {
    if (!projectId || !canEdit) return null;
    const normalizedName = name.trim().replace(/\/{2,}/g, "/").slice(0, 80);
    if (!normalizedName) return null;
    const key = normalizedName.toLocaleLowerCase("ko-KR");
    const existing = cache.get(key);
    if (existing) return existing;
    try {
      const folder = await createProjectArchiveFolder(projectId, normalizedName, folders.length + cache.size);
      cache.set(key, folder);
      setFolders((current) => current.some((entry) => entry.id === folder.id) ? current : [...current, folder]);
      return folder;
    } catch (error) {
      if (error instanceof Error && /같은 이름/.test(error.message)) {
        const refreshed = await listProjectArchiveFolders(projectId);
        setFolders(refreshed);
        const duplicate = refreshed.find(
          (folder) => folder.name.trim().toLocaleLowerCase("ko-KR") === key
        );
        if (duplicate) {
          cache.set(key, duplicate);
          return duplicate;
        }
      }
      setErrorMessage(error instanceof Error ? error.message : "폴더를 만들지 못했습니다.");
      return null;
    }
  }

  async function submitFolderEditor() {
    if (!projectId || !canEdit || !folderEditor) return;
    const name = folderEditor.value.trim().replace(/\/{2,}/g, "/").slice(0, 80);
    if (!name) return;
    const duplicate = folders.find(
      (folder) => folder.name.trim().toLocaleLowerCase("ko-KR") === name.toLocaleLowerCase("ko-KR")
        && folder.id !== folderEditor.folderId
    );
    if (duplicate) {
      setActiveFolderId(duplicate.id);
      setFolderEditor(null);
      return;
    }
    try {
      if (folderEditor.mode === "create") {
        const folder = await ensureArchiveFolder(name);
        if (folder) setActiveFolderId(folder.id);
      } else if (folderEditor.folderId) {
        const updated = await renameProjectArchiveFolder(projectId, folderEditor.folderId, name);
        setFolders((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
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
        await deleteProjectArchiveFolder(projectId, pendingConfirm.folder.id);
        setFolders((current) => current.filter((entry) => entry.id !== pendingConfirm.folder.id));
        setActiveFolderId("unfiled");
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
        const folderPath = entry.folderPath || "";
        groups.set(folderPath, [...(groups.get(folderPath) ?? []), entry]);
      }

      const folderCache = new Map(
        folders.map((folder) => [folder.name.trim().toLocaleLowerCase("ko-KR"), folder])
      );
      const uploadedAssets: ProjectReferenceAsset[] = [];
      const failed: ArchiveFolderIssue[] = [];
      let firstFolderId: string | null = null;
      const entryOrder = new Map(entries.map((entry, index) => [
        `${entry.relativePath}:${entry.file.size}:${entry.file.lastModified}`,
        index
      ]));

      for (const [folderPath, folderEntries] of groups) {
        const folder = folderPath ? await ensureArchiveFolder(folderPath, folderCache) : null;
        const folderId = folder?.id ?? selectedFolderValue(activeFolderId);
        if (folderPath && !folder) {
          for (const entry of folderEntries) {
            failed.push({ path: entry.relativePath, reason: "아카이브 폴더 생성 실패" });
          }
          continue;
        }
        if (!firstFolderId && folderId) firstFolderId = folderId;
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
                groupId: `source:folder:${folderId || "unfiled"}`,
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
                groupId: `folder:${folderId || "unfiled"}`,
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
      if (firstFolderId) setActiveFolderId(firstFolderId);
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

  function selectAllFilteredAssets() {
    setSelectionMode(true);
    setSelectedIds(new Set(selectableFilteredIds));
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

  function beginLasso(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canEdit || !supportsDesktopDrop || event.pointerType !== "mouse" || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("input,textarea,select,a,button,[contenteditable='true'],[data-no-lasso]")) return;
    event.preventDefault();
    lassoCleanupRef.current?.();
    lassoBaseSelectionRef.current = event.metaKey || event.ctrlKey || event.shiftKey
      ? new Set(selectedIds)
      : new Set();
    lassoMovedRef.current = false;
    lassoPointerRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY
    };
    const initial = {
      startPageX: event.clientX + window.scrollX,
      startPageY: event.clientY + window.scrollY,
      currentPageX: event.clientX + window.scrollX,
      currentPageY: event.clientY + window.scrollY
    };
    lassoRef.current = initial;
    setLasso(initial);
    previousBodyUserSelectRef.current = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== lassoPointerRef.current?.pointerId) return;
      if (pointerEvent.cancelable) pointerEvent.preventDefault();
      lassoPointerRef.current = {
        pointerId: pointerEvent.pointerId,
        clientX: pointerEvent.clientX,
        clientY: pointerEvent.clientY
      };
      updateLassoFromClient(pointerEvent.clientX, pointerEvent.clientY);
    };
    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== lassoPointerRef.current?.pointerId) return;
      finishLasso();
    };
    const handleScroll = () => {
      const pointer = lassoPointerRef.current;
      if (pointer) updateLassoFromClient(pointer.clientX, pointer.clientY);
    };
    const handleBlur = () => finishLasso();
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") finishLasso();
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("blur", handleBlur);
      document.body.style.userSelect = previousBodyUserSelectRef.current;
      if (lassoAnimationRef.current !== null) {
        cancelAnimationFrame(lassoAnimationRef.current);
        lassoAnimationRef.current = null;
      }
      lassoCleanupRef.current = null;
    };
    lassoCleanupRef.current = cleanup;
    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("blur", handleBlur);
    runLassoAutoScroll();
  }

  function updateLassoFromClient(clientX: number, clientY: number) {
    const current = lassoRef.current;
    if (!current) return;
    const next = {
      ...current,
      currentPageX: clientX + window.scrollX,
      currentPageY: clientY + window.scrollY
    };
    const bounds = pageBounds(next);
    if (
      Math.abs(next.currentPageX - next.startPageX) > 4
      || Math.abs(next.currentPageY - next.startPageY) > 4
    ) {
      lassoMovedRef.current = true;
      setSelectionMode(true);
    }
    const ids = new Set(lassoBaseSelectionRef.current);
    cardRefs.current.forEach((node, id) => {
      const rect = node.getBoundingClientRect();
      const pageRect = {
        left: rect.left + window.scrollX,
        right: rect.right + window.scrollX,
        top: rect.top + window.scrollY,
        bottom: rect.bottom + window.scrollY
      };
      if (rectanglesIntersect(bounds, pageRect)) ids.add(id);
    });
    lassoRef.current = next;
    setSelectedIds(ids);
    setLasso(next);
  }

  function runLassoAutoScroll() {
    if (!lassoRef.current || !lassoPointerRef.current) return;
    const pointer = lassoPointerRef.current;
    const edge = 72;
    let deltaY = 0;
    if (pointer.clientY < edge) deltaY = -Math.ceil((edge - pointer.clientY) / 6);
    else if (pointer.clientY > window.innerHeight - edge) {
      deltaY = Math.ceil((pointer.clientY - (window.innerHeight - edge)) / 6);
    }
    if (deltaY !== 0) {
      window.scrollBy(0, deltaY);
      updateLassoFromClient(pointer.clientX, pointer.clientY);
    }
    lassoAnimationRef.current = requestAnimationFrame(runLassoAutoScroll);
  }

  function finishLasso() {
    if (!lassoRef.current) return;
    lassoCleanupRef.current?.();
    lassoRef.current = null;
    lassoPointerRef.current = null;
    setLasso(null);
    window.setTimeout(() => {
      lassoMovedRef.current = false;
    }, 0);
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

  function beginAssetLongPress(asset: ProjectReferenceAsset, event: ReactPointerEvent<HTMLButtonElement>) {
    if (selectionMode || event.button !== 0) return;
    cancelAssetLongPress();
    const state: AssetLongPress = {
      assetId: asset.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      triggered: false,
      timeoutId: window.setTimeout(() => {
        const current = longPressRef.current;
        if (!current || current.assetId !== asset.id) return;
        current.triggered = true;
        suppressAssetClickRef.current = asset.id;
        longPressRef.current = null;
        setPressedAssetId(null);
        openMetadata(asset);
        window.setTimeout(() => {
          if (suppressAssetClickRef.current === asset.id) suppressAssetClickRef.current = null;
        }, 1_000);
      }, LONG_PRESS_MS)
    };
    longPressRef.current = state;
    setPressedAssetId(asset.id);
  }

  function moveAssetLongPress(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = longPressRef.current;
    if (!current || current.pointerId !== event.pointerId || current.triggered) return;
    if (
      Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
      > LONG_PRESS_MOVE_TOLERANCE
    ) {
      cancelAssetLongPress();
    }
  }

  function cancelAssetLongPress() {
    const current = longPressRef.current;
    if (current) window.clearTimeout(current.timeoutId);
    longPressRef.current = null;
    setPressedAssetId(null);
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
          <div className="grid gap-2 border-t border-field-border pt-3" aria-label="아카이브 폴더">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-black text-field-primary">
                <Folder className="h-4 w-4" aria-hidden />
                폴더
              </span>
              <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
                <FolderFilterChip
                  active={activeFolderId === "all"}
                  label="전체"
                  count={folderCounts.all}
                  onClick={() => setActiveFolderId("all")}
                />
                <FolderFilterChip
                  active={activeFolderId === "unfiled"}
                  label="미분류"
                  count={folderCounts.unfiled}
                  onClick={() => setActiveFolderId("unfiled")}
                />
                {folders.map((folder) => (
                  <FolderFilterChip
                    key={folder.id}
                    active={activeFolderId === folder.id}
                    label={folder.name}
                    count={folderCounts.byId.get(folder.id) ?? 0}
                    onClick={() => setActiveFolderId(folder.id)}
                  />
                ))}
              </div>
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
              <option value="folder">폴더순</option>
            </select>
            {canEdit ? (
              <>
                <button type="button" onClick={() => setFolderEditor({ mode: "create", value: "" })} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                  <FolderPlus className="h-3.5 w-3.5" aria-hidden />
                  새 폴더
                </button>
                {activeFolderId !== "all" && activeFolderId !== "unfiled" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const folder = folders.find((entry) => entry.id === activeFolderId);
                        if (folder) setFolderEditor({ mode: "rename", folderId: folder.id, value: folder.name });
                      }}
                      className="min-h-9 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary"
                    >
                      이름 변경
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const folder = folders.find((entry) => entry.id === activeFolderId);
                        if (!folder) return;
                        const assetIds = [...overheads, ...storyboards]
                          .filter((asset) => asset.crop.folderId === folder.id)
                          .map((asset) => asset.id);
                        setPendingConfirm({ kind: "folder", folder, assetIds });
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
                <button
                  type="button"
                  onClick={() => {
                    setSelectionMode((current) => !current);
                    setSelectedIds(new Set());
                  }}
                  className={`ml-auto inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-black ${
                    selectionMode
                      ? "border-field-primary bg-field-primary text-white"
                      : "border-field-border bg-white text-field-primary"
                  }`}
                >
                  <CheckSquare className="h-3.5 w-3.5" aria-hidden />
                  {selectionMode ? "선택 종료" : "선택"}
                </button>
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
          {canEdit && selectionMode ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-field-border bg-field-soft/55 px-2 py-2">
              <span className="text-xs font-black text-field-primary">
                {selectedReferenceAssetIds.length + selectedDiagramItems.length}개 선택
              </span>
              <button
                type="button"
                disabled={selectableFilteredIds.length === 0 || allFilteredSelected}
                onClick={selectAllFilteredAssets}
                className="min-h-9 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary disabled:opacity-45"
              >
                현재 결과 전체 선택 · {selectableFilteredIds.length}
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())} className="min-h-9 rounded-full px-3 text-xs font-black text-field-muted">
                선택 해제
              </button>
              <select
                value={moveFolderId}
                onChange={(event) => setMoveFolderId(event.target.value)}
                className="min-h-9 rounded-full border border-field-border bg-white px-3 text-xs font-bold"
                aria-label="선택 자료 이동 폴더"
              >
                <option value="">미분류로 이동</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
              <button type="button" disabled={isSaving || selectedReferenceAssetIds.length === 0} onClick={() => void moveSelectedAssets()} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-field-primary px-3 text-xs font-black text-white disabled:opacity-50">
                <Move className="h-3.5 w-3.5" aria-hidden />
                이동
              </button>
              <button type="button" disabled={isSaving || selectedReferenceAssetIds.length + selectedDiagramItems.length === 0} onClick={() => void deleteSelectedAssets()} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-danger bg-white px-3 text-xs font-black text-field-danger disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                일괄 삭제
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
          {filteredDiagrams.length + filteredAssets.length === 0 ? (
            <p className="py-10 text-center text-sm font-bold text-field-muted">등록된 {activeType === "overhead" ? "부감도" : "콘티"} 자료가 없습니다.</p>
          ) : (
            <div
              ref={gridRef}
              className="relative grid select-none grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
              onPointerDown={beginLasso}
              onContextMenu={(event) => event.preventDefault()}
            >
              {filteredDiagrams.map((item) => {
                const selected = selectedIds.has(item.id);
                return (
                <article
                  key={item.id}
                  ref={(node) => {
                    if (node && !item.legacy) cardRefs.current.set(item.id, node);
                    else cardRefs.current.delete(item.id);
                  }}
                  data-no-lasso
                  onContextMenu={(event) => event.preventDefault()}
                  className={`relative grid min-w-0 select-none gap-2 border bg-white p-2 ${
                    selected ? "border-[#ef8f39] ring-2 ring-[#ef8f39]/35" : "border-field-border"
                  }`}
                >
                  <button
                    type="button"
                    data-no-lasso
                    onClick={(event) => {
                      if (selectionMode && !item.legacy) {
                        event.preventDefault();
                        toggleAssetSelection(item.id);
                        return;
                      }
                      openDiagram(item, false);
                    }}
                    className="grid aspect-[4/3] place-items-center bg-field-soft"
                    aria-pressed={selectionMode && !item.legacy ? selected : undefined}
                  >
                    <ShotOverheadPreview diagram={item.diagram} label={`${item.title} 부감도`} />
                  </button>
                  {selectionMode && !item.legacy ? (
                    <span className={`pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border ${
                      selected ? "border-[#ef8f39] bg-[#ef8f39] text-white" : "border-field-border bg-white text-field-muted"
                    }`} aria-hidden>
                      {selected ? <Check className="h-4 w-4" /> : <Square className="h-3.5 w-3.5" />}
                    </span>
                  ) : null}
                  <ArchiveText title={item.title} sceneNo={item.sceneNo} cutNo={item.cutNo} memo={item.legacy ? `기존 컷 자료 · ${item.sourceShotRef || ""}` : item.memo} />
                  {canEdit && !item.legacy && !selectionMode ? (
                    <div className="grid">
                      <button type="button" data-no-lasso onClick={() => openDiagram(item, true)} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full border border-field-border text-[11px] font-black text-field-primary"><Pencil className="h-3.5 w-3.5" aria-hidden />수정</button>
                    </div>
                  ) : null}
                </article>
              )})}
              {visibleAssets.map((asset) => {
                const selected = selectedIds.has(asset.id);
                return (
                <article
                  key={asset.id}
                  ref={(node) => {
                    if (node) cardRefs.current.set(asset.id, node);
                    else cardRefs.current.delete(asset.id);
                  }}
                  className={`relative grid min-w-0 select-none gap-2 border bg-white p-2 ${
                    selected ? "border-[#ef8f39] ring-2 ring-[#ef8f39]/35" : "border-field-border"
                  } ${pressedAssetId === asset.id ? "scale-[0.985] border-[#ef8f39]" : ""}`}
                  onContextMenu={(event) => event.preventDefault()}
                  data-no-lasso
                >
                  <button
                    type="button"
                    data-no-lasso
                    onPointerDown={(event) => beginAssetLongPress(asset, event)}
                    onPointerMove={moveAssetLongPress}
                    onPointerUp={cancelAssetLongPress}
                    onPointerCancel={cancelAssetLongPress}
                    onPointerLeave={cancelAssetLongPress}
                    onClick={(event) => {
                      if (suppressAssetClickRef.current === asset.id) {
                        suppressAssetClickRef.current = null;
                        event.preventDefault();
                        return;
                      }
                      if (lassoMovedRef.current) return;
                      if (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) {
                        event.preventDefault();
                        toggleAssetSelection(asset.id);
                        return;
                      }
                      setPreview({ url: asset.publicUrl, title: asset.crop.title || asset.filename });
                    }}
                    className="grid aspect-[4/3] touch-pan-y place-items-center bg-field-soft"
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
                      className="block h-full w-full rounded-none object-contain"
                    />
                  </button>
                  {selectionMode || selected ? (
                    <span className={`pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border ${
                      selected ? "border-[#ef8f39] bg-[#ef8f39] text-white" : "border-field-border bg-white text-field-muted"
                    }`} aria-hidden>
                      {selected ? <Check className="h-4 w-4" /> : <Square className="h-3.5 w-3.5" />}
                    </span>
                  ) : null}
                  <ArchiveText title={asset.crop.title || asset.filename} sceneNo={asset.sceneNo || ""} cutNo={asset.cutNo || ""} memo={asset.crop.memo || ""} />
                  <p className="truncate px-1 text-[10px] font-bold text-field-muted">
                    {folderNameById.get(asset.crop.folderId || "") || "미분류"}
                  </p>
                </article>
              )})}
              {lasso && gridRef.current ? (
                <div
                  className="pointer-events-none absolute z-20 border border-[#ef8f39] bg-[#ef8f39]/15"
                  style={lassoStyle(lasso, gridRef.current.getBoundingClientRect())}
                  aria-hidden
                />
              ) : null}
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
              ? `"${pendingConfirm.folder.name}" 폴더를 삭제할까요? 안의 자료 ${pendingConfirm.assetIds.length}개는 미분류로 이동합니다.`
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

function ArchiveText({ title, sceneNo, cutNo, memo }: { title: string; sceneNo: string; cutNo: string; memo: string }) {
  return (
    <div className="min-w-0 px-1">
      <p className="truncate text-xs font-black text-field-text">{title}</p>
      <p className="truncate text-[10px] font-bold text-field-muted">{[sceneNo && `S#${sceneNo}`, cutNo && `C#${cutNo}`, memo].filter(Boolean).join(" · ") || "태그 없음"}</p>
    </div>
  );
}

function FolderFilterChip({
  active,
  label,
  count,
  onClick
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-black transition-colors ${
        active
          ? "border-field-primary bg-field-primary text-white"
          : "border-field-border bg-white text-field-primary"
      }`}
    >
      <span className="max-w-44 truncate">{label}</span>
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-white/20 text-white" : "bg-field-soft text-field-muted"}`}>
        {count}
      </span>
    </button>
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
      <section className="grid w-full max-w-md gap-3 rounded-2xl border border-field-border bg-white p-4" data-no-lasso>
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
            <option value="">미분류</option>
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

function selectedFolderValue(value: string) {
  return value === "all" || value === "unfiled" ? null : value;
}

function pageBounds(value: LassoBox) {
  return {
    left: Math.min(value.startPageX, value.currentPageX),
    right: Math.max(value.startPageX, value.currentPageX),
    top: Math.min(value.startPageY, value.currentPageY),
    bottom: Math.max(value.startPageY, value.currentPageY)
  };
}

function rectanglesIntersect(
  left: { left: number; right: number; top: number; bottom: number },
  right: { left: number; right: number; top: number; bottom: number }
) {
  return left.left <= right.right
    && left.right >= right.left
    && left.top <= right.bottom
    && left.bottom >= right.top;
}

function lassoStyle(value: LassoBox, grid: DOMRect) {
  const bounds = pageBounds(value);
  return {
    left: bounds.left - (grid.left + window.scrollX),
    top: bounds.top - (grid.top + window.scrollY),
    width: Math.max(1, bounds.right - bounds.left),
    height: Math.max(1, bounds.bottom - bounds.top)
  };
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

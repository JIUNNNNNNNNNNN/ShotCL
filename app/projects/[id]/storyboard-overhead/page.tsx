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
  createProjectArchiveFolder,
  deleteProjectArchiveFolder,
  deleteProjectReferenceAsset,
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
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

const PAGE_SIZE = 48;

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
  const [metadataDraft, setMetadataDraft] = useState({ title: "", memo: "", sceneNo: "", cutNo: "" });
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [supportsDesktopDrop, setSupportsDesktopDrop] = useState(false);
  const [dragDepth, setDragDepth] = useState<Record<ArchiveType, number>>({ overhead: 0, storyboard: 0 });
  const preparingRef = useRef(false);
  const folderUploadRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const lassoBaseSelectionRef = useRef<Set<string>>(new Set());
  const lassoMovedRef = useRef(false);

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

  const activeAssets = activeType === "overhead" ? overheads : storyboards;
  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders]
  );
  const sourceAssets = useMemo(
    () => activeAssets.filter((asset) => asset.mimeType === "application/pdf" || asset.groupId?.startsWith("source:")),
    [activeAssets]
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
  const filteredDiagrams = useMemo(
    () => activeType === "overhead" && (activeFolderId === "all" || activeFolderId === "unfiled")
      ? diagramArchives.filter((item) => matchesDiagramQuery(item, query))
      : [],
    [activeFolderId, activeType, diagramArchives, query]
  );

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
    directImageUpload = false
  ) {
    if (!projectId || rawFiles.length === 0 || preparingRef.current || isSaving) return;
    const files = uniqueFiles(rawFiles);
    const unsupported = files.find((file) => !isAcceptedArchiveFile(file));
    if (unsupported) {
      setErrorMessage(`"${unsupported.name}"은 PDF, JPG, JPEG, PNG, WebP 파일이 아닙니다.`);
      return;
    }
    const pdfFiles = files.filter(isPdfFile);
    const imageFiles = files.filter(isImageFile);
    if (expectedKind === "pdf" && imageFiles.length > 0) {
      setErrorMessage("PDF 선택에서는 PDF 파일만 추가할 수 있습니다.");
      return;
    }
    if (expectedKind === "images" && pdfFiles.length > 0) {
      setErrorMessage("이미지 선택에서는 JPG, JPEG, PNG, WebP 파일만 추가할 수 있습니다.");
      return;
    }
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
        await mapWithConcurrency(files, 3, async (file, index) => {
          setProgressMessage(`이미지 최적화 중 · ${file.name}`);
          const optimized = await optimizeArchiveImage(file);
          setProgressMessage(`썸네일 생성 완료 · 업로드 중 ${completed + 1}/${files.length}`);
          await uploadProjectReferenceAsset(projectId, assetType, optimized.displayFile, {
            thumbnailFile: optimized.thumbnailFile,
            sourceType: "upload_image",
            groupId: batchId,
            folderId: selectedFolderValue(activeFolderId),
            sortOrder: existingCount + index
          });
          completed += 1;
          setProgressMessage(`저장 중 ${completed}/${files.length}`);
        });
        await loadArchive();
        setProgressMessage("");
        return;
      }
      const pages: ArchiveImportPage[] = [];
      if (sourceKind === "pdf") {
        for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
          const file = files[fileIndex];
          const rendered = await renderArchivePdfPages(file, (current, total) => {
            setProgressMessage(`PDF ${fileIndex + 1}/${files.length} · 페이지 ${current}/${total}`);
          }, fileIndex);
          pages.push(...rendered);
        }
      } else {
        setProgressMessage("이미지 묶음을 준비하는 중입니다.");
        pages.push(...await loadArchiveImagePages(files));
      }
      setPendingImport({
        assetType,
        sourceKind,
        sourceFiles: files,
        sourceLabel: files.length === 1 ? files[0].name : `${files[0].name} 외 ${files.length - 1}개`,
        pages
      });
      setProgressMessage("");
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

  function handleDrop(assetType: ArchiveType, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragDepth((current) => ({ ...current, [assetType]: 0 }));
    if (!supportsDesktopDrop || !canEdit) return;
    void prepareFiles(assetType, Array.from(event.dataTransfer.files), undefined, true);
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
        const sourceAssetsByIndex = new Map<number, ProjectReferenceAsset>();
        for (let fileIndex = 0; fileIndex < pendingImport.sourceFiles.length; fileIndex += 1) {
          const sourceFile = pendingImport.sourceFiles[fileIndex];
          setProgressMessage(`원본 PDF 보존 ${fileIndex + 1}/${pendingImport.sourceFiles.length}`);
          const original = await uploadProjectReferenceAsset(projectId, pendingImport.assetType, sourceFile, {
            sourceType: "upload_pdf",
            groupId: `source:${batchId}`,
            title: value.title,
            memo: value.memo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo
          });
          sourceAssetsByIndex.set(fileIndex, original);
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
            sourceAssetId: sourceAssetsByIndex.get(page.sourceFileIndex)?.id,
            pageIndex: page.index,
            groupId: batchId,
            folderId: selectedFolderValue(activeFolderId),
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
        const sourceAssetsByIndex = new Map<number, ProjectReferenceAsset>();
        for (let index = 0; index < pendingImport.pages.length; index += 1) {
          const page = pendingImport.pages[index];
          const sourceFile = page.originalFile ?? pendingImport.sourceFiles[index];
          if (!sourceFile) continue;
          setProgressMessage(`원본 이미지 보존 ${index + 1}/${pendingImport.pages.length}`);
          const source = await uploadProjectReferenceAsset(projectId, pendingImport.assetType, sourceFile, {
            sourceType: "upload_image",
            groupId: `source:${batchId}`,
            title: value.title,
            memo: value.memo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo
          });
          sourceAssetsByIndex.set(page.sourceFileIndex, source);
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
            sourceAssetId: sourceAssetsByIndex.get(page.sourceFileIndex)?.id,
            pageIndex: page.index,
            groupId: batchId,
            folderId: selectedFolderValue(activeFolderId),
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
            folderId: selectedFolderValue(activeFolderId),
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

  async function createFolder(nameOverride?: string) {
    if (!projectId || !canEdit) return null;
    const name = (nameOverride ?? window.prompt("새 폴더 이름을 입력하세요.") ?? "").trim();
    if (!name) return null;
    try {
      const folder = await createProjectArchiveFolder(projectId, name, folders.length);
      setFolders((current) => [...current, folder]);
      return folder;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "폴더를 만들지 못했습니다.");
      return null;
    }
  }

  async function renameActiveFolder() {
    if (!projectId || !canEdit || activeFolderId === "all" || activeFolderId === "unfiled") return;
    const folder = folders.find((entry) => entry.id === activeFolderId);
    if (!folder) return;
    const name = (window.prompt("폴더 이름을 변경하세요.", folder.name) ?? "").trim();
    if (!name || name === folder.name) return;
    try {
      const updated = await renameProjectArchiveFolder(projectId, folder.id, name);
      setFolders((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "폴더 이름을 바꾸지 못했습니다.");
    }
  }

  async function removeActiveFolder() {
    if (!projectId || !canEdit || activeFolderId === "all" || activeFolderId === "unfiled") return;
    const folder = folders.find((entry) => entry.id === activeFolderId);
    if (!folder || !window.confirm(`"${folder.name}" 폴더를 삭제할까요? 폴더 안 자료는 자동 삭제되지 않습니다.`)) return;
    try {
      await deleteProjectArchiveFolder(projectId, folder.id);
      setFolders((current) => current.filter((entry) => entry.id !== folder.id));
      setActiveFolderId("all");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "폴더를 삭제하지 못했습니다.");
    }
  }

  async function uploadFolder(event: ChangeEvent<HTMLInputElement>) {
    if (!projectId || !canEdit) return;
    const files = Array.from(event.target.files ?? []).filter(isImageFile);
    event.target.value = "";
    if (files.length === 0) {
      setErrorMessage("선택한 폴더에 지원하는 이미지가 없습니다.");
      return;
    }
    setIsPreparing(true);
    preparingRef.current = true;
    try {
      const groups = new Map<string, File[]>();
      files.forEach((file) => {
        const relativePath = file.webkitRelativePath || file.name;
        const folderName = relativePath.split("/")[0] || "업로드 폴더";
        groups.set(folderName, [...(groups.get(folderName) ?? []), file]);
      });
      for (const [folderName, folderFiles] of groups) {
        let folder = folders.find((entry) => entry.name === folderName);
        folder ??= await createFolder(folderName) ?? undefined;
        if (!folder) continue;
        let completed = 0;
        await mapWithConcurrency(folderFiles, 3, async (file, index) => {
          setProgressMessage(`이미지 최적화 중 · ${file.name}`);
          const optimized = await optimizeArchiveImage(file);
          setProgressMessage(`폴더 업로드 중 ${completed + 1}/${folderFiles.length}`);
          await uploadProjectReferenceAsset(projectId, activeType, optimized.displayFile, {
            thumbnailFile: optimized.thumbnailFile,
            sourceType: "upload_image",
            folderId: folder.id,
            groupId: `folder:${folder.id}`,
            sortOrder: imageAssets.length + index
          });
          completed += 1;
          setProgressMessage(`저장 중 ${completed}/${folderFiles.length}`);
        });
      }
      await loadArchive();
      setProgressMessage("");
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
    if (!projectId || selectedIds.size === 0) return;
    try {
      setIsSaving(true);
      await moveProjectReferenceAssets(projectId, [...selectedIds], moveFolderId || null);
      setSelectedIds(new Set());
      setSelectionMode(false);
      await loadArchive();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "선택한 자료를 이동하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSelectedAssets() {
    if (!projectId || selectedIds.size === 0) return;
    if (!window.confirm(`선택한 자료 ${selectedIds.size}개를 삭제할까요? 연결된 컷에서는 선택이 해제됩니다.`)) return;
    try {
      setIsSaving(true);
      await deleteProjectReferenceAssets(projectId, [...selectedIds]);
      setSelectedIds(new Set());
      setSelectionMode(false);
      await loadArchive();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "선택한 자료를 삭제하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  function beginLasso(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canEdit || !supportsDesktopDrop || event.pointerType !== "mouse" || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("input,textarea,select,a,[data-no-lasso]")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    lassoBaseSelectionRef.current = event.metaKey || event.ctrlKey || event.shiftKey
      ? new Set(selectedIds)
      : new Set();
    lassoMovedRef.current = false;
    setLasso({
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY
    });
  }

  function moveLasso(event: ReactPointerEvent<HTMLDivElement>) {
    if (!lasso) return;
    event.preventDefault();
    const next = { ...lasso, currentX: event.clientX, currentY: event.clientY };
    const bounds = clientBounds(next);
    if (Math.abs(next.currentX - next.startX) > 4 || Math.abs(next.currentY - next.startY) > 4) {
      lassoMovedRef.current = true;
      setSelectionMode(true);
    }
    const ids = new Set(lassoBaseSelectionRef.current);
    cardRefs.current.forEach((node, id) => {
      if (rectanglesIntersect(bounds, node.getBoundingClientRect())) ids.add(id);
    });
    setSelectedIds(ids);
    setLasso(next);
  }

  function endLasso(event: ReactPointerEvent<HTMLDivElement>) {
    if (!lasso) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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

  async function deleteDiagram(item: OverheadDiagramArchiveItem) {
    if (!projectId || item.legacy || !window.confirm(`"${item.title}" 부감도를 삭제할까요? 연결된 컷에서는 선택이 해제됩니다.`)) return;
    try {
      await deleteOverheadDiagramArchive(projectId, item.id);
      await loadArchive();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "부감도를 삭제하지 못했습니다.");
    }
  }

  async function deleteAsset(asset: ProjectReferenceAsset) {
    if (!projectId || !window.confirm(`"${asset.crop.title || asset.filename}" 자료를 삭제할까요? 연결된 컷에서는 선택이 해제됩니다.`)) return;
    try {
      await deleteProjectReferenceAsset(projectId, asset.id);
      await loadArchive();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "자료를 삭제하지 못했습니다.");
    }
  }

  function openMetadata(asset: ProjectReferenceAsset) {
    setEditingAsset(asset);
    setMetadataDraft({
      title: asset.crop.title || "",
      memo: asset.crop.memo || "",
      sceneNo: asset.sceneNo || "",
      cutNo: asset.cutNo || ""
    });
  }

  async function saveMetadata() {
    if (!projectId || !editingAsset) return;
    setIsSaving(true);
    try {
      await updateProjectReferenceAsset(projectId, editingAsset.id, metadataDraft);
      setEditingAsset(null);
      await loadArchive();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "자료 정보를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  return (
    <>
      <div className="mx-auto grid w-full max-w-6xl gap-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display truncate text-xl font-black text-field-primary">부감도&콘티 아카이브</h1>
            <p className="truncate text-xs font-bold text-field-muted">{projectName} · 컷에 연결하기 전 프로젝트 공통 자료</p>
          </div>
          {!canEdit ? <span className="rounded-full border border-field-border bg-white px-3 py-2 text-xs font-black text-field-muted">읽기 전용</span> : null}
        </div>

        {errorMessage ? <p role="alert" className="rounded-xl border border-field-danger bg-red-50 px-3 py-2 text-sm font-bold text-field-danger">{errorMessage}</p> : null}
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
                    <p className="text-[11px] font-bold text-field-muted">PDF · JPG · JPEG · PNG · WebP · 여러 파일 가능</p>
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
          <div className="flex flex-wrap items-center gap-2 border-t border-field-border pt-3">
            <select
              value={activeFolderId}
              onChange={(event) => setActiveFolderId(event.target.value)}
              className="min-h-9 min-w-36 rounded-full border border-field-border bg-white px-3 text-xs font-bold text-field-text"
              aria-label="아카이브 폴더 필터"
            >
              <option value="all">모든 폴더</option>
              <option value="unfiled">미분류</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
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
                <button type="button" onClick={() => void createFolder()} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary">
                  <FolderPlus className="h-3.5 w-3.5" aria-hidden />
                  폴더
                </button>
                {activeFolderId !== "all" && activeFolderId !== "unfiled" ? (
                  <>
                    <button type="button" onClick={() => void renameActiveFolder()} className="min-h-9 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary">이름 변경</button>
                    <button type="button" onClick={() => void removeActiveFolder()} className="min-h-9 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-danger">폴더 삭제</button>
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
                      accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
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
          {canEdit && selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-field-border bg-field-soft/55 px-2 py-2">
              <span className="text-xs font-black text-field-primary">{selectedIds.size}개 선택</span>
              <select
                value={moveFolderId}
                onChange={(event) => setMoveFolderId(event.target.value)}
                className="min-h-9 rounded-full border border-field-border bg-white px-3 text-xs font-bold"
                aria-label="선택 자료 이동 폴더"
              >
                <option value="">미분류로 이동</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
              <button type="button" disabled={isSaving} onClick={() => void moveSelectedAssets()} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-field-primary px-3 text-xs font-black text-white disabled:opacity-50">
                <Move className="h-3.5 w-3.5" aria-hidden />
                이동
              </button>
              <button type="button" disabled={isSaving} onClick={() => void deleteSelectedAssets()} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-danger bg-white px-3 text-xs font-black text-field-danger disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                일괄 삭제
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())} className="min-h-9 rounded-full px-3 text-xs font-black text-field-muted">선택 해제</button>
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
              onPointerMove={moveLasso}
              onPointerUp={endLasso}
              onPointerCancel={endLasso}
              onContextMenu={(event) => event.preventDefault()}
            >
              {filteredDiagrams.map((item) => (
                <article key={item.id} className="grid min-w-0 gap-2 border border-field-border bg-white p-2">
                  <button type="button" data-no-lasso onClick={() => openDiagram(item, false)} className="grid aspect-[4/3] place-items-center bg-field-soft">
                    <ShotOverheadPreview diagram={item.diagram} label={`${item.title} 부감도`} />
                  </button>
                  <ArchiveText title={item.title} sceneNo={item.sceneNo} cutNo={item.cutNo} memo={item.legacy ? `기존 컷 자료 · ${item.sourceShotRef || ""}` : item.memo} />
                  {canEdit && !item.legacy ? (
                    <div className="grid grid-cols-2 gap-1">
                      <button type="button" data-no-lasso onClick={() => openDiagram(item, true)} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full border border-field-border text-[11px] font-black text-field-primary"><Pencil className="h-3.5 w-3.5" aria-hidden />수정</button>
                      <button type="button" data-no-lasso onClick={() => deleteDiagram(item)} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full border border-field-border text-[11px] font-black text-field-danger"><Trash2 className="h-3.5 w-3.5" aria-hidden />삭제</button>
                    </div>
                  ) : null}
                </article>
              ))}
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
                  }`}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      if (lassoMovedRef.current) return;
                      if (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) {
                        event.preventDefault();
                        toggleAssetSelection(asset.id);
                        return;
                      }
                      setPreview({ url: asset.publicUrl, title: asset.crop.title || asset.filename });
                    }}
                    className="grid aspect-[4/3] place-items-center bg-field-soft"
                    aria-pressed={selectionMode ? selected : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.crop.thumbnailUrl || asset.publicUrl}
                      alt={asset.crop.title || asset.filename}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
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
                  {canEdit ? (
                    <div className="grid grid-cols-2 gap-1">
                      <button type="button" data-no-lasso onClick={() => openMetadata(asset)} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full border border-field-border text-[11px] font-black text-field-primary"><Pencil className="h-3.5 w-3.5" aria-hidden />정보</button>
                      <button type="button" data-no-lasso onClick={() => deleteAsset(asset)} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full border border-field-border text-[11px] font-black text-field-danger"><Trash2 className="h-3.5 w-3.5" aria-hidden />삭제</button>
                    </div>
                  ) : null}
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
                    <a href={asset.publicUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-field-primary underline underline-offset-2">원본 보기</a>
                  </div>
                  {canEdit ? <button type="button" onClick={() => deleteAsset(asset)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-field-danger" aria-label={`${asset.filename} 원본 삭제`}><Trash2 className="h-4 w-4" aria-hidden /></button> : null}
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
        <MetadataDialog value={metadataDraft} isSaving={isSaving} onChange={setMetadataDraft} onClose={() => setEditingAsset(null)} onSave={saveMetadata} />
      ) : null}
      <ImagePreviewModal imageUrl={preview?.url ?? null} title={preview?.title ?? "자료"} onClose={() => setPreview(null)} />
    </>
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

function MetadataDialog({
  value,
  isSaving,
  onChange,
  onClose,
  onSave
}: {
  value: { title: string; memo: string; sceneNo: string; cutNo: string };
  isSaving: boolean;
  onChange: (value: { title: string; memo: string; sceneNo: string; cutNo: string }) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[85] grid place-items-center bg-black/25 p-4" role="dialog" aria-modal="true" aria-label="자료 정보 수정">
      <section className="grid w-full max-w-md gap-3 rounded-2xl border border-field-border bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-black text-field-primary">자료 정보</h2>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-field-border" aria-label="자료 정보 닫기"><X className="h-4 w-4" aria-hidden /></button>
        </div>
        <label className="grid gap-1 text-xs font-black text-field-muted">제목<input value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} className="min-h-10 rounded-lg border border-field-border px-3 text-sm text-field-text" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs font-black text-field-muted">씬<input value={value.sceneNo} onChange={(event) => onChange({ ...value, sceneNo: event.target.value })} className="min-h-10 rounded-lg border border-field-border px-3 text-sm text-field-text" /></label>
          <label className="grid gap-1 text-xs font-black text-field-muted">컷<input value={value.cutNo} onChange={(event) => onChange({ ...value, cutNo: event.target.value })} className="min-h-10 rounded-lg border border-field-border px-3 text-sm text-field-text" /></label>
        </div>
        <label className="grid gap-1 text-xs font-black text-field-muted">메모<textarea value={value.memo} onChange={(event) => onChange({ ...value, memo: event.target.value })} rows={4} className="rounded-lg border border-field-border px-3 py-2 text-sm leading-5 text-field-text" /></label>
        <button type="button" disabled={isSaving} onClick={onSave} className="min-h-11 rounded-full bg-field-primary px-4 text-sm font-black text-white disabled:opacity-50">{isSaving ? "저장 중" : "저장"}</button>
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
      targetColumn: template.targetColumn,
      includeContext: template.includeContext
    } : {})
  };
}

function selectedFolderValue(value: string) {
  return value === "all" || value === "unfiled" ? null : value;
}

function clientBounds(value: LassoBox) {
  return {
    left: Math.min(value.startX, value.currentX),
    right: Math.max(value.startX, value.currentX),
    top: Math.min(value.startY, value.currentY),
    bottom: Math.max(value.startY, value.currentY)
  };
}

function rectanglesIntersect(
  left: { left: number; right: number; top: number; bottom: number },
  right: DOMRect
) {
  return left.left <= right.right
    && left.right >= right.left
    && left.top <= right.bottom
    && left.bottom >= right.top;
}

function lassoStyle(value: LassoBox, grid: DOMRect) {
  const bounds = clientBounds(value);
  return {
    left: bounds.left - grid.left,
    top: bounds.top - grid.top,
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

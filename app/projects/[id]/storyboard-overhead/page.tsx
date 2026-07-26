"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  FileImage,
  FileText,
  ImagePlus,
  Map as MapIcon,
  Pencil,
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
  loadArchiveImagePages,
  releaseArchivePages,
  renderArchivePdfPages,
  type ArchiveImportPage
} from "@/lib/client/archiveMedia";
import {
  deleteProjectReferenceAsset,
  listProjectReferenceAssets,
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

export default function ProjectStoryboardOverheadPage() {
  const params = useParams<{ id: string | string[] }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const [projectName, setProjectName] = useState("");
  const [activeType, setActiveType] = useState<ArchiveType>("overhead");
  const [overheads, setOverheads] = useState<ProjectReferenceAsset[]>([]);
  const [storyboards, setStoryboards] = useState<ProjectReferenceAsset[]>([]);
  const [diagramArchives, setDiagramArchives] = useState<OverheadDiagramArchiveItem[]>([]);
  const [query, setQuery] = useState("");
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

  const loadArchive = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [project, overheadAssets, storyboardAssets, diagrams] = await Promise.all([
        getProject(projectId),
        listProjectReferenceAssets(projectId, "overhead"),
        listProjectReferenceAssets(projectId, "storyboard"),
        listOverheadDiagramArchive(projectId)
      ]);
      setProjectName(project?.name ?? "프로젝트");
      setOverheads(overheadAssets);
      setStoryboards(storyboardAssets);
      setDiagramArchives(diagrams);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "부감도와 콘티 아카이브를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadArchive();
  }, [loadArchive]);

  const activeAssets = activeType === "overhead" ? overheads : storyboards;
  const sourceAssets = useMemo(
    () => activeAssets.filter((asset) => asset.mimeType === "application/pdf" || asset.groupId?.startsWith("source:")),
    [activeAssets]
  );
  const imageAssets = useMemo(
    () => activeAssets.filter((asset) => asset.mimeType.startsWith("image/") && !asset.groupId?.startsWith("source:")),
    [activeAssets]
  );
  const filteredAssets = useMemo(
    () => imageAssets.filter((asset) => matchesAssetQuery(asset, query)),
    [imageAssets, query]
  );
  const filteredDiagrams = useMemo(
    () => activeType === "overhead"
      ? diagramArchives.filter((item) => matchesDiagramQuery(item, query))
      : [],
    [activeType, diagramArchives, query]
  );

  async function preparePdf(assetType: ArchiveType, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIsPreparing(true);
    setErrorMessage("");
    setProgressMessage("PDF 페이지를 준비하는 중입니다.");
    try {
      const pages = await renderArchivePdfPages(file, (current, total) => {
        setProgressMessage(`PDF 페이지 준비 ${current}/${total}`);
      });
      setPendingImport({
        assetType,
        sourceKind: "pdf",
        sourceFiles: [file],
        sourceLabel: file.name,
        pages
      });
      setProgressMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "PDF 페이지를 준비하지 못했습니다.");
      setProgressMessage("");
    } finally {
      setIsPreparing(false);
    }
  }

  async function prepareImages(assetType: ArchiveType, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setIsPreparing(true);
    setErrorMessage("");
    try {
      const pages = await loadArchiveImagePages(files);
      setPendingImport({
        assetType,
        sourceKind: "images",
        sourceFiles: files,
        sourceLabel: files.length === 1 ? files[0].name : `${files[0].name} 외 ${files.length - 1}개`,
        pages
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "이미지 묶음을 준비하지 못했습니다.");
    } finally {
      setIsPreparing(false);
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
        const original = await uploadProjectReferenceAsset(
          projectId,
          pendingImport.assetType,
          pendingImport.sourceFiles[0],
          {
            sourceType: "upload_pdf",
            groupId: `source:${batchId}`,
            title: value.title,
            memo: value.memo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo
          }
        );
        for (let index = 0; index < value.selectedPages.length; index += 1) {
          const page = value.selectedPages[index];
          setProgressMessage(`선택 페이지 저장 ${index + 1}/${value.selectedPages.length}`);
          const resultFile = value.applyCrop
            ? await createCroppedArchiveFile(page, value.crop, page.name)
            : new File([page.blob], page.name, { type: "image/jpeg" });
          await uploadProjectReferenceAsset(projectId, pendingImport.assetType, resultFile, {
            sourceType: value.applyCrop ? "pdf_crop" : "pdf_page",
            sourceAssetId: original.id,
            pageIndex: page.index,
            groupId: batchId,
            cropX: value.crop.x,
            cropY: value.crop.y,
            cropWidth: value.crop.width,
            cropHeight: value.crop.height,
            cropRatio: cropPixelRatio(value.crop, page),
            title: pageTitle(value.title, page.index, value.selectedPages.length),
            memo: value.memo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo,
            sortOrder: imageAssets.length + index
          });
        }
      } else if (value.applyCrop) {
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
          sourceAssetsByIndex.set(page.index, source);
        }
        for (let index = 0; index < value.selectedPages.length; index += 1) {
          const page = value.selectedPages[index];
          setProgressMessage(`crop 결과 저장 ${index + 1}/${value.selectedPages.length}`);
          const resultFile = await createCroppedArchiveFile(page, value.crop, page.name);
          await uploadProjectReferenceAsset(projectId, pendingImport.assetType, resultFile, {
            sourceType: "image_crop",
            sourceAssetId: sourceAssetsByIndex.get(page.index)?.id,
            pageIndex: page.index,
            groupId: batchId,
            cropX: value.crop.x,
            cropY: value.crop.y,
            cropWidth: value.crop.width,
            cropHeight: value.crop.height,
            cropRatio: cropPixelRatio(value.crop, page),
            title: pageTitle(value.title, page.index, value.selectedPages.length),
            memo: value.memo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo,
            sortOrder: imageAssets.length + index
          });
        }
      } else {
        for (let index = 0; index < value.selectedPages.length; index += 1) {
          const page = value.selectedPages[index];
          const sourceFile = page.originalFile ?? new File([page.blob], page.name, { type: "image/jpeg" });
          setProgressMessage(`이미지 저장 ${index + 1}/${value.selectedPages.length}`);
          await uploadProjectReferenceAsset(projectId, pendingImport.assetType, sourceFile, {
            sourceType: "upload_image",
            groupId: batchId,
            title: pageTitle(value.title, page.index, value.selectedPages.length),
            memo: value.memo,
            sceneNo: value.sceneNo,
            cutNo: value.cutNo,
            sortOrder: imageAssets.length + index
          });
        }
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
                  <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={isPreparing || isSaving} onChange={(event) => preparePdf(activeType, event)} />
                </label>
              </div>
            ) : null}
          </div>
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {filteredDiagrams.map((item) => (
                <article key={item.id} className="grid min-w-0 gap-2 border border-field-border bg-white p-2">
                  <button type="button" onClick={() => openDiagram(item, false)} className="grid aspect-[4/3] place-items-center bg-field-soft">
                    <ShotOverheadPreview diagram={item.diagram} label={`${item.title} 부감도`} />
                  </button>
                  <ArchiveText title={item.title} sceneNo={item.sceneNo} cutNo={item.cutNo} memo={item.legacy ? `기존 컷 자료 · ${item.sourceShotRef || ""}` : item.memo} />
                  {canEdit && !item.legacy ? (
                    <div className="grid grid-cols-2 gap-1">
                      <button type="button" onClick={() => openDiagram(item, true)} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full border border-field-border text-[11px] font-black text-field-primary"><Pencil className="h-3.5 w-3.5" aria-hidden />수정</button>
                      <button type="button" onClick={() => deleteDiagram(item)} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full border border-field-border text-[11px] font-black text-field-danger"><Trash2 className="h-3.5 w-3.5" aria-hidden />삭제</button>
                    </div>
                  ) : null}
                </article>
              ))}
              {filteredAssets.map((asset) => (
                <article key={asset.id} className="grid min-w-0 gap-2 border border-field-border bg-white p-2">
                  <button type="button" onClick={() => setPreview({ url: asset.publicUrl, title: asset.crop.title || asset.filename })} className="grid aspect-[4/3] place-items-center bg-field-soft">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset.publicUrl} alt={asset.crop.title || asset.filename} className="block h-full w-full rounded-none object-contain" />
                  </button>
                  <ArchiveText title={asset.crop.title || asset.filename} sceneNo={asset.sceneNo || ""} cutNo={asset.cutNo || ""} memo={asset.crop.memo || ""} />
                  {canEdit ? (
                    <div className="grid grid-cols-2 gap-1">
                      <button type="button" onClick={() => openMetadata(asset)} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full border border-field-border text-[11px] font-black text-field-primary"><Pencil className="h-3.5 w-3.5" aria-hidden />정보</button>
                      <button type="button" onClick={() => deleteAsset(asset)} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full border border-field-border text-[11px] font-black text-field-danger"><Trash2 className="h-3.5 w-3.5" aria-hidden />삭제</button>
                    </div>
                  ) : null}
                </article>
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

function cropPixelRatio(crop: ArchiveImportCommit["crop"], page: ArchiveImportPage) {
  const width = crop.width * page.width;
  const height = crop.height * page.height;
  return height > 0 ? width / height : null;
}

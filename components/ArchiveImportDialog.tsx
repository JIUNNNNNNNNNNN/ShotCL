"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Crop, FileImage, Grid2X2, Save, Trash2, Undo2, X } from "lucide-react";
import {
  createStoryboardAutoCrops,
  createStoryboardCellKey,
  createStoryboardCropTemplate,
  createStoryboardGridCells,
  findNearestStoryboardGridCell,
  getStoryboardPageGeometry,
  getStoryboardPageOrigin,
  selectStoryboardGridCells,
  type ArchiveImportPage,
  type RelativeCrop,
  type StoryboardCropCandidate,
  type StoryboardCropTemplate,
  type StoryboardGridCell,
  type StoryboardGridOrigin
} from "@/lib/client/archiveMedia";
import type { ProjectReferenceAssetType, ProjectSceneItem } from "@/lib/types";

export type ArchiveImportResult = {
  id: string;
  orderIndex: number;
  page: ArchiveImportPage;
  crop: RelativeCrop | null;
  templateId?: string;
  manuallyPositioned?: boolean;
  customSize?: boolean;
};

export type ArchiveImportCommit = {
  results: ArchiveImportResult[];
  cropTemplate: StoryboardCropTemplate | null;
  title: string;
  memo: string;
  sceneId: string;
  sceneNo: string;
  cutNo: string;
};

export type ArchiveImportInitialMetadata = {
  title?: string;
  memo?: string;
  sceneId?: string;
  sceneNo?: string;
  cutNo?: string;
};

export type ArchiveImportSaveFailure = {
  resultId: string;
  cropIndex: number;
  label: string;
  message: string;
};

export type ArchiveImportSaveReport = {
  total: number;
  succeededResultIds: string[];
  failures: ArchiveImportSaveFailure[];
};

export type ArchiveImportProgressPhase =
  | "idle"
  | "preparing"
  | "cropping"
  | "optimizing"
  | "uploading"
  | "saving"
  | "finalizing"
  | "complete"
  | "error"
  | "cancelling"
  | "cancelled";

export type ArchiveImportProgressState = {
  phase: ArchiveImportProgressPhase;
  totalCount: number;
  preparedCount: number;
  croppedCount: number;
  uploadedCount: number;
  savedCount: number;
  failedCount: number;
  overallPercent: number;
  importBatchId: string;
  startedAt: number;
};

type StoryboardCandidateChangeOptions = {
  gridCell?: StoryboardGridCell;
  manuallyPositioned?: boolean;
  customSize?: boolean;
};

const DEFAULT_CROP: RelativeCrop = { x: 0.06, y: 0.08, width: 0.46, height: 0.16 };

export function ArchiveImportDialog({
  assetType,
  sourceLabel,
  pages,
  scenes = [],
  allowSceneCutMetadata = true,
  initialMetadata,
  isSaving,
  saveReport,
  progress,
  onClose,
  onSave
}: {
  assetType: Extract<ProjectReferenceAssetType, "overhead" | "storyboard">;
  sourceLabel: string;
  pages: ArchiveImportPage[];
  scenes?: ProjectSceneItem[];
  allowSceneCutMetadata?: boolean;
  initialMetadata?: ArchiveImportInitialMetadata;
  isSaving: boolean;
  saveReport?: ArchiveImportSaveReport | null;
  progress?: ArchiveImportProgressState | null;
  onClose: () => void;
  onSave: (value: ArchiveImportCommit) => Promise<ArchiveImportSaveReport>;
}) {
  const saveGuardRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set(pages.map((page) => page.id)));
  const [referenceCrop, setReferenceCrop] = useState<RelativeCrop>(
    assetType === "storyboard"
      ? { x: 0, y: 0, width: 0, height: 0 }
      : DEFAULT_CROP
  );
  const [referenceSelected, setReferenceSelected] = useState(false);
  const [applyCrop, setApplyCrop] = useState(assetType === "storyboard");
  const [cropTemplate, setCropTemplate] = useState<StoryboardCropTemplate | null>(null);
  const [candidates, setCandidates] = useState<StoryboardCropCandidate[]>([]);
  const [pageOrigins, setPageOrigins] = useState<Record<string, StoryboardGridOrigin>>({});
  const [activePageId, setActivePageId] = useState(pages[0]?.id ?? "");
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null);
  const [title, setTitle] = useState(() => initialMetadata?.title ?? "");
  const [memo, setMemo] = useState(() => initialMetadata?.memo ?? "");
  const [sceneId, setSceneId] = useState(() => initialMetadata?.sceneId ?? "");
  const [sceneNo, setSceneNo] = useState(() => initialMetadata?.sceneNo ?? "");
  const [cutNo, setCutNo] = useState(() => initialMetadata?.cutNo ?? "");
  const selectedPages = useMemo(
    () => pages.filter((page) => selectedIds.has(page.id)),
    [pages, selectedIds]
  );
  const referencePage = pages[0] ?? null;
  const activePage = pages.find((page) => page.id === activePageId) ?? referencePage;
  const editingCandidate = candidates.find((candidate) => candidate.id === editingCandidateId) ?? null;
  const orderedCandidates = useMemo(
    () => [...candidates].sort(compareStoryboardCandidates),
    [candidates]
  );
  const results: ArchiveImportResult[] = assetType === "storyboard"
    ? orderedCandidates.map((candidate, orderIndex) => ({
        id: candidate.id,
        orderIndex,
        page: candidate.page,
        crop: candidate.crop,
        templateId: candidate.templateId,
        manuallyPositioned: candidate.manuallyPositioned,
        customSize: candidate.customSize
      }))
    : selectedPages.map((page, orderIndex) => ({
        id: page.id,
        orderIndex,
        page,
        crop: applyCrop ? referenceCrop : null
      }));
  const isProgressBlocking = isBlockingArchiveImportProgress(progress);
  const isInteractionLocked = isSaving || isProgressBlocking;

  useEffect(() => {
    if (!isProgressBlocking) return undefined;
    const blockEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", blockEscape, true);
    return () => document.removeEventListener("keydown", blockEscape, true);
  }, [isProgressBlocking]);

  function requestClose() {
    if (isInteractionLocked || saveGuardRef.current) return;
    onClose();
  }

  async function submitImport(value: ArchiveImportCommit) {
    if (saveGuardRef.current || isInteractionLocked) return;
    saveGuardRef.current = true;
    try {
      await onSave(value);
    } finally {
      saveGuardRef.current = false;
    }
  }

  function confirmTemplate() {
    if (!referencePage || !referenceSelected) return;
    const template = createStoryboardCropTemplate(referencePage, referenceCrop);
    const cellKey = createStoryboardCellKey(referencePage, 0, 0);
    const referenceCandidateId = `storyboard-cell-${cellKey}`;
    setCropTemplate(template);
    setActivePageId(referencePage.id);
    setPageOrigins({
      [referencePage.id]: getStoryboardPageOrigin(template, referencePage)
    });
    setCandidates((current) => {
      if (current.length > 0) return current;
      return [{
        id: referenceCandidateId,
        page: referencePage,
        crop: { ...referenceCrop },
        templateId: template.templateId,
        rowIndex: 0,
        columnIndex: 0,
        cellKey,
        manuallyPositioned: false,
        customSize: false
      }];
    });
    setEditingCandidateId(null);
  }

  function originForPage(page: ArchiveImportPage) {
    if (!cropTemplate) return { x: 0, y: 0 };
    return pageOrigins[page.id] ?? getStoryboardPageOrigin(cropTemplate, page);
  }

  function addGridCells(page: ArchiveImportPage, cells: StoryboardGridCell[]) {
    if (!cropTemplate || cells.length === 0) return;
    const orderedCells = cells
      .filter((cell) => cell.templateId === cropTemplate.templateId)
      .sort(compareStoryboardGridCells);
    const knownKeys = new Set(candidates.map((candidate) => candidate.cellKey));
    const knownIds = new Set(candidates.map((candidate) => candidate.id));
    const additions = orderedCells.flatMap((cell) => {
      const id = `storyboard-cell-${cell.key}`;
      if (knownKeys.has(cell.key) || knownIds.has(id)) return [];
      knownKeys.add(cell.key);
      knownIds.add(id);
      return [{
        id,
        page,
        crop: { ...cell.crop },
        templateId: cropTemplate.templateId,
        rowIndex: cell.rowIndex,
        columnIndex: cell.columnIndex,
        cellKey: cell.key,
        manuallyPositioned: false,
        customSize: false
      }];
    });
    if (additions.length === 0) return;
    setCandidates((current) => {
      const existingKeys = new Set(current.map((candidate) => candidate.cellKey));
      const existingIds = new Set(current.map((candidate) => candidate.id));
      const uniqueAdditions = additions.filter((candidate) => {
        if (existingKeys.has(candidate.cellKey) || existingIds.has(candidate.id)) return false;
        existingKeys.add(candidate.cellKey);
        existingIds.add(candidate.id);
        return true;
      });
      return uniqueAdditions.length > 0 ? [...current, ...uniqueAdditions] : current;
    });
    setEditingCandidateId(additions.at(-1)?.id ?? null);
  }

  function addCandidateAt(page: ArchiveImportPage, centerX: number, centerY: number) {
    if (!cropTemplate) return;
    const cell = findNearestStoryboardGridCell(
      cropTemplate,
      page,
      { x: centerX, y: centerY },
      originForPage(page)
    );
    if (cell) addGridCells(page, [cell]);
  }

  function addCandidatesInSelection(page: ArchiveImportPage, selection: RelativeCrop) {
    if (!cropTemplate) return;
    addGridCells(
      page,
      selectStoryboardGridCells(cropTemplate, page, selection, originForPage(page))
    );
  }

  function addAutomaticCandidates(page: ArchiveImportPage) {
    if (!cropTemplate) return;
    addGridCells(
      page,
      createStoryboardAutoCrops(cropTemplate, page, originForPage(page))
    );
  }

  function changeActivePage(id: string) {
    const nextPage = pages.find((page) => page.id === id);
    if (!nextPage || !cropTemplate) {
      setActivePageId(id);
      return;
    }
    setPageOrigins((current) => (
      current[id]
        ? current
        : {
            ...current,
            [id]: getStoryboardPageOrigin(cropTemplate, nextPage)
          }
    ));
    setActivePageId(id);
  }

  function resetActivePageOrigin(page: ArchiveImportPage, candidate: StoryboardCropCandidate) {
    if (!cropTemplate) return;
    const { columnStep, rowStep } = getStoryboardPageGeometry(cropTemplate, page);
    setPageOrigins((current) => ({
      ...current,
      [page.id]: {
        x: candidate.crop.x - candidate.columnIndex * columnStep,
        y: candidate.crop.y - candidate.rowIndex * rowStep
      }
    }));
  }

  function updateCandidate(
    id: string,
    crop: RelativeCrop,
    options: StoryboardCandidateChangeOptions = {}
  ) {
    setCandidates((current) => current.map((candidate) => (
      candidate.id === id
        ? {
            ...candidate,
            crop,
            manuallyPositioned: options.manuallyPositioned ?? candidate.manuallyPositioned,
            customSize: options.customSize ?? candidate.customSize,
            ...(options.gridCell?.templateId === candidate.templateId ? {
              rowIndex: options.gridCell.rowIndex,
              columnIndex: options.gridCell.columnIndex,
              cellKey: options.gridCell.key
            } : {})
          }
        : candidate
    )));
  }

  function removeCandidate(id: string) {
    setCandidates((current) => current.filter((candidate) => candidate.id !== id));
    if (editingCandidateId === id) setEditingCandidateId(null);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-busy={isProgressBlocking} aria-label={`${assetType === "overhead" ? "부감도" : "콘티"} 가져오기`}>
      <section className="relative flex max-h-[96dvh] w-full max-w-7xl flex-col rounded-t-2xl border border-field-border bg-white shadow-[0_18px_54px_rgba(20,32,27,0.2)] sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-field-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display truncate text-lg font-black text-field-primary">{assetType === "overhead" ? "부감도" : "콘티"} 가져오기</h2>
            <p className="truncate text-xs font-bold text-field-muted">{sourceLabel} · {pages.length}페이지/이미지</p>
          </div>
          <button type="button" onClick={requestClose} disabled={isInteractionLocked} className="grid h-10 w-10 place-items-center rounded-[3px] border border-field-border text-field-muted" aria-label="가져오기 닫기">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        {assetType === "storyboard" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            <StoryboardCropWorkflow
              pages={pages}
              referencePage={referencePage}
              referenceCrop={referenceCrop}
              referenceSelected={referenceSelected}
              cropTemplate={cropTemplate}
              candidates={candidates}
              activePage={activePage}
              editingCandidate={editingCandidate}
              pageOrigin={activePage ? originForPage(activePage) : null}
              isSaving={isInteractionLocked}
              saveReport={saveReport}
              onReferenceCropChange={(crop) => {
                setReferenceCrop(crop);
                setReferenceSelected(false);
              }}
              onReferenceSelectionComplete={() => setReferenceSelected(true)}
              onConfirmTemplate={confirmTemplate}
              onActivePageChange={changeActivePage}
              onAddCandidate={addCandidateAt}
              onAddCandidates={addCandidatesInSelection}
              onAddAutomaticCandidates={addAutomaticCandidates}
              onEditCandidate={setEditingCandidateId}
              onCandidateChange={updateCandidate}
              onResetPageGrid={resetActivePageOrigin}
              onDeleteCandidate={removeCandidate}
              onUndo={() => {
                const last = candidates.at(-1);
                if (last) removeCandidate(last.id);
              }}
              onCancel={requestClose}
              onConfirmExtraction={() => void submitImport({
                results,
                cropTemplate,
                title,
                memo,
                sceneId,
                sceneNo,
                cutNo
              })}
            />
            <details className="mx-auto mt-3 max-w-5xl border border-field-border bg-white">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-black text-field-primary">
                제목·씬·컷·메모
              </summary>
              <div className="border-t border-field-border p-3">
                <ArchiveMetadataFields
                  title={title}
                  memo={memo}
                  scenes={scenes}
                  sceneId={sceneId}
                  sceneNo={sceneNo}
                  cutNo={cutNo}
                  showSceneCut={allowSceneCutMetadata}
                  disabled={isInteractionLocked || Boolean(saveReport)}
                  onTitleChange={setTitle}
                  onMemoChange={setMemo}
                  onSceneChange={(nextSceneId, nextSceneNo) => {
                    setSceneId(nextSceneId);
                    setSceneNo(nextSceneNo);
                    if (!nextSceneId) setCutNo("");
                  }}
                  onSceneNoChange={setSceneNo}
                  onCutNoChange={setCutNo}
                />
              </div>
            </details>
          </div>
        ) : (
          <>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
              <OverheadCropWorkflow
                pages={pages}
                selectedIds={selectedIds}
                selectedCount={selectedPages.length}
                crop={referenceCrop}
                applyCrop={applyCrop}
                referencePage={referencePage}
                isSaving={isInteractionLocked}
                onSelectedIdsChange={setSelectedIds}
                onCropChange={setReferenceCrop}
                onApplyCropChange={setApplyCrop}
              />
              <ArchiveMetadataFields
                title={title}
                memo={memo}
                scenes={scenes}
                sceneId={sceneId}
                sceneNo={sceneNo}
                cutNo={cutNo}
                showSceneCut={allowSceneCutMetadata}
                disabled={isInteractionLocked}
                onTitleChange={setTitle}
                onMemoChange={setMemo}
                onSceneChange={(nextSceneId, nextSceneNo) => {
                  setSceneId(nextSceneId);
                  setSceneNo(nextSceneNo);
                  if (!nextSceneId) setCutNo("");
                }}
                onSceneNoChange={setSceneNo}
                onCutNoChange={setCutNo}
              />
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-field-border px-4 py-3">
              <p className="inline-flex items-center gap-1 text-xs font-bold text-field-muted">
                {results.some((result) => result.crop) ? <Crop className="h-4 w-4" aria-hidden /> : <FileImage className="h-4 w-4" aria-hidden />}
                {results.length}개 결과 확인
              </p>
              <button
                type="button"
                disabled={isInteractionLocked || results.length === 0}
                onClick={() => void submitImport({
                  results,
                  cropTemplate: null,
                  title,
                  memo,
                  sceneId,
                  sceneNo,
                  cutNo
                })}
                className="inline-flex min-h-11 items-center gap-2 rounded-[3px] bg-field-primary px-5 text-sm font-black text-white disabled:opacity-50"
              >
                <Save className="h-4 w-4" aria-hidden />
                {isInteractionLocked ? "저장 중" : "추출 확정"}
              </button>
            </footer>
          </>
        )}
        {progress && isProgressBlocking ? (
          <ArchiveImportProgressOverlay progress={progress} />
        ) : null}
      </section>
    </div>
  );
}

function ArchiveImportProgressOverlay({
  progress
}: {
  progress: ArchiveImportProgressState;
}) {
  const total = Math.max(0, Math.round(progress.totalCount));
  const current = Math.min(total, Math.max(0, archiveImportPhaseCount(progress)));
  const percent = Math.min(100, Math.max(0, Math.round(progress.overallPercent)));
  const phaseLabel = archiveImportPhaseLabel(progress.phase);

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-white/90 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5">
      <section
        className="grid max-h-[calc(100dvh-2rem)] w-full max-w-sm gap-3 overflow-y-auto rounded-[3px] border border-field-border bg-white p-4 shadow-[0_14px_34px_rgba(20,32,27,0.18)]"
        role="status"
        aria-live="polite"
        aria-label={`콘티 이미지 처리 중, ${phaseLabel}, ${percent}%`}
      >
        <div className="grid gap-1">
          <h3 className="font-display text-base font-black text-field-primary">
            콘티 이미지 처리 중
          </h3>
          <p className="text-sm font-black text-field-text">{phaseLabel}</p>
        </div>

        <div className="flex items-end justify-between gap-3">
          <p className="min-w-0 text-xs font-bold text-field-muted">
            {current} / {total}
          </p>
          <p className="shrink-0 text-sm font-black text-field-primary">{percent}%</p>
        </div>

        <div
          className="h-3 overflow-hidden rounded-[2px] border border-field-border bg-field-soft"
          role="progressbar"
          aria-label="콘티 이미지 처리 진행률"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className="h-full rounded-none bg-field-primary transition-[width] duration-150 ease-linear motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="grid grid-cols-2 border-y border-field-border text-xs font-bold text-field-muted">
          <p className="border-r border-field-border px-2 py-2">
            저장 {Math.max(0, progress.savedCount)}개
          </p>
          <p className="px-2 py-2">
            실패 {Math.max(0, progress.failedCount)}개
          </p>
        </div>

        <p className="text-xs font-bold leading-5 text-field-danger">
          처리 중에는 화면을 닫거나 새로고침하지 마세요.
        </p>
      </section>
    </div>
  );
}

function isBlockingArchiveImportProgress(progress?: ArchiveImportProgressState | null) {
  return Boolean(
    progress
    && progress.phase !== "idle"
    && progress.phase !== "complete"
    && progress.phase !== "error"
    && progress.phase !== "cancelled"
  );
}

function archiveImportPhaseLabel(phase: ArchiveImportProgressPhase) {
  switch (phase) {
    case "preparing":
      return "원본 준비 중";
    case "cropping":
      return "크롭 이미지 생성 중";
    case "optimizing":
      return "이미지 최적화 중";
    case "uploading":
      return "업로드 중";
    case "saving":
      return "저장 중";
    case "finalizing":
      return "마무리 중";
    case "cancelling":
      return "취소 중";
    case "complete":
      return "완료";
    case "error":
      return "처리 오류";
    case "cancelled":
      return "취소됨";
    default:
      return "준비 중";
  }
}

function archiveImportPhaseCount(progress: ArchiveImportProgressState) {
  switch (progress.phase) {
    case "preparing":
      return progress.preparedCount;
    case "cropping":
    case "optimizing":
      return progress.croppedCount;
    case "uploading":
      return progress.uploadedCount;
    case "saving":
    case "finalizing":
    case "complete":
      return progress.savedCount;
    case "error":
    case "cancelled":
      return progress.savedCount + progress.failedCount;
    default:
      return 0;
  }
}

function ArchiveMetadataFields({
  title,
  memo,
  scenes,
  sceneId,
  sceneNo,
  cutNo,
  showSceneCut = true,
  disabled = false,
  onTitleChange,
  onMemoChange,
  onSceneChange,
  onSceneNoChange,
  onCutNoChange
}: {
  title: string;
  memo: string;
  scenes: ProjectSceneItem[];
  sceneId: string;
  sceneNo: string;
  cutNo: string;
  showSceneCut?: boolean;
  disabled?: boolean;
  onTitleChange: (value: string) => void;
  onMemoChange: (value: string) => void;
  onSceneChange: (sceneId: string, sceneNo: string) => void;
  onSceneNoChange: (value: string) => void;
  onCutNoChange: (value: string) => void;
}) {
  const selectedSceneExists = scenes.some((scene) => scene.id === sceneId);
  return (
    <div className="grid content-start gap-2">
      <label className="grid gap-1 text-xs font-black text-field-muted">
        제목
        <input disabled={disabled} value={title} onChange={(event) => onTitleChange(event.target.value)} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text disabled:bg-field-soft disabled:opacity-70" placeholder="선택 사항" />
      </label>
      {showSceneCut ? <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs font-black text-field-muted">
          씬
          {scenes.length > 0 || sceneId ? (
            <select
              disabled={disabled}
              value={sceneId}
              onChange={(event) => {
                const scene = scenes.find((entry) => entry.id === event.target.value);
                onSceneChange(scene?.id || "", scene?.sceneNo || "");
              }}
              className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text"
            >
              <option value="">연결 안 함</option>
              {sceneId && !selectedSceneExists ? (
                <option value={sceneId}>{sceneNo || "삭제된 씬"} · 현재 연결 유지</option>
              ) : null}
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  S#{scene.sceneNo}
                </option>
              ))}
            </select>
          ) : (
            <input
              disabled={disabled}
              value={sceneNo}
              onChange={(event) => onSceneNoChange(event.target.value)}
              className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text"
            />
          )}
        </label>
        <label className="grid gap-1 text-xs font-black text-field-muted">컷<input disabled={disabled} value={cutNo} onChange={(event) => onCutNoChange(event.target.value)} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text disabled:bg-field-soft disabled:opacity-70" /></label>
      </div> : null}
      <label className="grid gap-1 text-xs font-black text-field-muted">메모<textarea disabled={disabled} value={memo} onChange={(event) => onMemoChange(event.target.value)} rows={3} className="rounded-lg border border-field-border bg-white px-3 py-2 text-sm leading-5 text-field-text disabled:bg-field-soft disabled:opacity-70" /></label>
    </div>
  );
}

function StoryboardCropWorkflow({
  pages,
  referencePage,
  referenceCrop,
  referenceSelected,
  cropTemplate,
  candidates,
  activePage,
  editingCandidate,
  pageOrigin,
  isSaving,
  saveReport,
  onReferenceCropChange,
  onReferenceSelectionComplete,
  onConfirmTemplate,
  onActivePageChange,
  onAddCandidate,
  onAddCandidates,
  onAddAutomaticCandidates,
  onEditCandidate,
  onCandidateChange,
  onResetPageGrid,
  onDeleteCandidate,
  onUndo,
  onCancel,
  onConfirmExtraction
}: {
  pages: ArchiveImportPage[];
  referencePage: ArchiveImportPage | null;
  referenceCrop: RelativeCrop;
  referenceSelected: boolean;
  cropTemplate: StoryboardCropTemplate | null;
  candidates: StoryboardCropCandidate[];
  activePage: ArchiveImportPage | null;
  editingCandidate: StoryboardCropCandidate | null;
  pageOrigin: StoryboardGridOrigin | null;
  isSaving: boolean;
  saveReport?: ArchiveImportSaveReport | null;
  onReferenceCropChange: (crop: RelativeCrop) => void;
  onReferenceSelectionComplete: () => void;
  onConfirmTemplate: () => void;
  onActivePageChange: (id: string) => void;
  onAddCandidate: (page: ArchiveImportPage, centerX: number, centerY: number) => void;
  onAddCandidates: (page: ArchiveImportPage, selection: RelativeCrop) => void;
  onAddAutomaticCandidates: (page: ArchiveImportPage) => void;
  onEditCandidate: (id: string | null) => void;
  onCandidateChange: (
    id: string,
    crop: RelativeCrop,
    options?: StoryboardCandidateChangeOptions
  ) => void;
  onResetPageGrid: (page: ArchiveImportPage, candidate: StoryboardCropCandidate) => void;
  onDeleteCandidate: (id: string) => void;
  onUndo: () => void;
  onCancel: () => void;
  onConfirmExtraction: () => void;
}) {
  const isEditorLocked = isSaving || Boolean(saveReport);
  const activeCandidates = activePage
    ? candidates.filter((candidate) => candidate.page.id === activePage.id)
    : [];
  const candidateNumbers = new Map(
    [...candidates]
      .sort(compareStoryboardCandidates)
      .map((candidate, index) => [candidate.id, index + 1])
  );
  const activePageIndex = activePage
    ? Math.max(0, pages.findIndex((page) => page.id === activePage.id))
    : 0;

  useEffect(() => {
    function handleDelete(event: KeyboardEvent) {
      if (!editingCandidate || isSaving || (event.key !== "Delete" && event.key !== "Backspace")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      onDeleteCandidate(editingCandidate.id);
    }
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [editingCandidate, isSaving, onDeleteCandidate]);

  function movePage(delta: number) {
    const nextPage = pages[activePageIndex + delta];
    if (!nextPage) return;
    onEditCandidate(null);
    onActivePageChange(nextPage.id);
  }

  return (
    <div className="mx-auto grid max-w-5xl content-start gap-2">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <p className="text-xs font-black text-field-primary sm:text-sm">
          {cropTemplate ? "칸을 누르거나 여러 칸을 드래그하세요" : "첫 그림칸을 드래그하세요"}
        </p>
        <span className="shrink-0 text-[11px] font-bold text-field-muted">
          {activePageIndex + 1}/{pages.length} 페이지 · {activeCandidates.length}개
        </span>
      </div>

      {activePage ? (
        <StoryboardCropCanvas
          page={activePage}
          referenceCrop={referenceCrop}
          referenceSelected={referenceSelected}
          cropTemplate={cropTemplate}
          pageOrigin={pageOrigin}
          candidates={activeCandidates}
          candidateNumbers={candidateNumbers}
          selectedCandidateId={editingCandidate?.page.id === activePage.id ? editingCandidate.id : null}
          disabled={isEditorLocked}
          onReferenceCropChange={onReferenceCropChange}
          onReferenceSelectionComplete={onReferenceSelectionComplete}
          onConfirmTemplate={onConfirmTemplate}
          onPlace={(x, y) => onAddCandidate(activePage, x, y)}
          onSelectRange={(selection) => onAddCandidates(activePage, selection)}
          onSelect={onEditCandidate}
          onCandidateChange={onCandidateChange}
        />
      ) : referencePage ? (
        <p className="p-6 text-center text-sm font-bold text-field-muted">페이지를 표시할 수 없습니다.</p>
      ) : null}

      {saveReport ? (
        <section
          className="grid gap-1 border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-950"
          aria-live="polite"
        >
          <p>
            추출 대상 {saveReport.total}개 · 저장 {saveReport.succeededResultIds.length}개
            {" · "}실패 {saveReport.failures.length}개
          </p>
          {saveReport.failures.length > 0 ? (
            <details>
              <summary className="cursor-pointer font-black">실패 항목 보기</summary>
              <ul className="mt-1 grid max-h-28 gap-1 overflow-y-auto">
                {saveReport.failures.map((failure) => (
                  <li key={failure.resultId}>
                    {failure.cropIndex}. {failure.label} · {failure.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <div className="sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-2 border border-field-border bg-white/95 p-2 shadow-[0_-8px_24px_rgba(20,32,27,0.1)] backdrop-blur">
        <div className="flex items-center gap-1">
          <span className="px-1 text-[11px] font-black text-field-primary">
            현재 {activeCandidates.length} · 전체 {candidates.length}
          </span>
          <button
            type="button"
            onClick={() => activePage && onAddAutomaticCandidates(activePage)}
            disabled={!cropTemplate || !activePage || isEditorLocked}
            className="inline-flex min-h-9 items-center gap-1 rounded-[3px] border border-field-border px-2.5 text-[11px] font-black text-field-primary disabled:opacity-40"
          >
            <Grid2X2 className="h-3.5 w-3.5" aria-hidden />
            자동 후보
          </button>
          {cropTemplate && activePage && editingCandidate?.page.id === activePage.id ? (
            <button
              type="button"
              onClick={() => onResetPageGrid(activePage, editingCandidate)}
              disabled={isEditorLocked}
              className="min-h-9 rounded-[3px] border border-field-border px-2.5 text-[11px] font-black text-field-primary disabled:opacity-40"
            >
              격자 재설정
            </button>
          ) : null}
          <button
            type="button"
            onClick={onUndo}
            disabled={candidates.length === 0 || isEditorLocked}
            className="grid h-9 w-9 place-items-center rounded-[3px] border border-field-border text-field-primary disabled:opacity-40"
            aria-label="마지막 후보 취소"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
          </button>
          {editingCandidate?.page.id === activePage?.id ? (
            <button
              type="button"
              onClick={() => editingCandidate && onDeleteCandidate(editingCandidate.id)}
              disabled={isEditorLocked}
              className="grid h-9 w-9 place-items-center rounded-[3px] border border-field-danger/35 text-field-danger disabled:opacity-40"
              aria-label="선택한 crop 후보 삭제"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <button type="button" onClick={() => movePage(-1)} disabled={activePageIndex <= 0 || isSaving} className="grid h-9 w-9 place-items-center rounded-[3px] border border-field-border text-field-primary disabled:opacity-35" aria-label="이전 페이지">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => movePage(1)} disabled={activePageIndex >= pages.length - 1 || isSaving} className="grid h-9 w-9 place-items-center rounded-[3px] border border-field-border text-field-primary disabled:opacity-35" aria-label="다음 페이지">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={onCancel} disabled={isSaving} className="min-h-9 rounded-[3px] border border-field-border px-3 text-[11px] font-black text-field-muted disabled:opacity-40">
            취소
          </button>
          <button
            type="button"
            onClick={onConfirmExtraction}
            disabled={!cropTemplate || candidates.length === 0 || isSaving}
            className="inline-flex min-h-9 items-center gap-1 rounded-[3px] bg-field-primary px-3 text-[11px] font-black text-white disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {isSaving
              ? "저장 중"
              : saveReport?.failures.length
                ? `실패 ${saveReport.failures.length}개 재시도`
                : "추출 확정"}
          </button>
        </div>
      </div>
    </div>
  );
}

type CropResizeHandle = "nw" | "ne" | "sw" | "se";

type CanvasDrag = {
  pointerId: number;
  mode: "reference-create" | "reference-move" | "reference-resize" | "grid-select" | "move" | "resize";
  startX: number;
  startY: number;
  original: RelativeCrop;
  candidateId?: string;
  candidateTemplateId?: string;
  handle?: CropResizeHandle;
  latest: RelativeCrop;
  hasMoved: boolean;
};

function StoryboardCropCanvas({
  page,
  referenceCrop,
  referenceSelected,
  cropTemplate,
  pageOrigin,
  candidates,
  candidateNumbers,
  selectedCandidateId,
  disabled,
  onReferenceCropChange,
  onReferenceSelectionComplete,
  onConfirmTemplate,
  onPlace,
  onSelectRange,
  onSelect,
  onCandidateChange
}: {
  page: ArchiveImportPage;
  referenceCrop: RelativeCrop;
  referenceSelected: boolean;
  cropTemplate: StoryboardCropTemplate | null;
  pageOrigin: StoryboardGridOrigin | null;
  candidates: StoryboardCropCandidate[];
  candidateNumbers: Map<string, number>;
  selectedCandidateId: string | null;
  disabled: boolean;
  onReferenceCropChange: (crop: RelativeCrop) => void;
  onReferenceSelectionComplete: () => void;
  onConfirmTemplate: () => void;
  onPlace: (x: number, y: number) => void;
  onSelectRange: (selection: RelativeCrop) => void;
  onSelect: (id: string | null) => void;
  onCandidateChange: (
    id: string,
    crop: RelativeCrop,
    options?: StoryboardCandidateChangeOptions
  ) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<CanvasDrag | null>(null);
  const suppressCandidateClickRef = useRef(false);
  const [selectionCrop, setSelectionCrop] = useState<RelativeCrop | null>(null);
  const effectiveOrigin = cropTemplate && pageOrigin
    ? pageOrigin
    : cropTemplate
      ? getStoryboardPageOrigin(cropTemplate, page)
      : null;
  const gridCells = useMemo(
    () => cropTemplate && effectiveOrigin
      ? createStoryboardGridCells(cropTemplate, page, effectiveOrigin)
      : [],
    [cropTemplate, effectiveOrigin, page]
  );
  const selectedGuideKeys = useMemo(
    () => cropTemplate && effectiveOrigin && selectionCrop
      ? new Set(
          selectStoryboardGridCells(cropTemplate, page, selectionCrop, effectiveOrigin)
            .map((cell) => cell.key)
        )
      : new Set<string>(),
    [cropTemplate, effectiveOrigin, page, selectionCrop]
  );

  function relativePoint(event: React.PointerEvent) {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height)
    };
  }

  function startReference(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    const point = relativePoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const minimumSize = cropTemplate ? 0.001 : 0.01;
    const crop = {
      x: point.x,
      y: point.y,
      width: minimumSize,
      height: minimumSize
    };
    dragRef.current = {
      pointerId: event.pointerId,
      mode: cropTemplate ? "grid-select" : "reference-create",
      startX: point.x,
      startY: point.y,
      original: crop,
      latest: crop,
      hasMoved: false
    };
    if (cropTemplate) {
      setSelectionCrop(crop);
    } else {
      onReferenceCropChange(crop);
    }
  }

  function startReferenceAdjustment(
    event: React.PointerEvent<HTMLElement>,
    mode: "reference-move" | "reference-resize",
    handle?: CropResizeHandle
  ) {
    if (disabled || cropTemplate) return;
    event.preventDefault();
    event.stopPropagation();
    const point = relativePoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: point.x,
      startY: point.y,
      original: { ...referenceCrop },
      handle,
      latest: { ...referenceCrop },
      hasMoved: false
    };
  }

  function startCandidateDrag(
    event: React.PointerEvent<HTMLElement>,
    candidate: StoryboardCropCandidate,
    mode: "move" | "resize",
    handle?: CropResizeHandle
  ) {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const point = relativePoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: point.x,
      startY: point.y,
      original: { ...candidate.crop },
      candidateId: candidate.id,
      candidateTemplateId: candidate.templateId,
      handle,
      latest: { ...candidate.crop },
      hasMoved: false
    };
    onSelect(candidate.id);
  }

  function updateDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = relativePoint(event);
    let next: RelativeCrop;

    if (drag.mode === "reference-create") {
      next = {
        x: Math.min(drag.startX, point.x),
        y: Math.min(drag.startY, point.y),
        width: Math.max(0.01, Math.abs(point.x - drag.startX)),
        height: Math.max(0.01, Math.abs(point.y - drag.startY))
      };
      onReferenceCropChange(next);
    } else if (drag.mode === "grid-select") {
      next = {
        x: Math.min(drag.startX, point.x),
        y: Math.min(drag.startY, point.y),
        width: Math.max(0.001, Math.abs(point.x - drag.startX)),
        height: Math.max(0.001, Math.abs(point.y - drag.startY))
      };
      setSelectionCrop(next);
    } else if (drag.mode === "reference-move") {
      next = {
        ...drag.original,
        x: Math.min(1 - drag.original.width, Math.max(0, drag.original.x + point.x - drag.startX)),
        y: Math.min(1 - drag.original.height, Math.max(0, drag.original.y + point.y - drag.startY))
      };
      onReferenceCropChange(next);
    } else if (drag.mode === "reference-resize" && drag.handle) {
      next = resizeCropWithAspect(drag.original, drag.handle, point);
      onReferenceCropChange(next);
    } else if (drag.mode === "move" && drag.candidateId) {
      const frameRect = frameRef.current?.getBoundingClientRect();
      const travelX = (point.x - drag.startX) * (frameRect?.width || page.width);
      const travelY = (point.y - drag.startY) * (frameRect?.height || page.height);
      drag.hasMoved = drag.hasMoved || Math.hypot(travelX, travelY) >= 3;
      if (!drag.hasMoved) return;
      next = {
        ...drag.original,
        x: Math.min(1 - drag.original.width, Math.max(0, drag.original.x + point.x - drag.startX)),
        y: Math.min(1 - drag.original.height, Math.max(0, drag.original.y + point.y - drag.startY))
      };
      onCandidateChange(drag.candidateId, next);
    } else if (drag.mode === "resize" && drag.candidateId && drag.handle) {
      next = resizeCropWithAspect(drag.original, drag.handle, point);
      onCandidateChange(drag.candidateId, next, { customSize: true });
    } else {
      return;
    }

    drag.latest = next;
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (
      drag.mode === "reference-create"
      || drag.mode === "reference-move"
      || drag.mode === "reference-resize"
    ) {
      if (drag.latest.width >= 0.025 && drag.latest.height >= 0.025) {
        onReferenceSelectionComplete();
      }
      return;
    }
    if (drag.mode === "grid-select") {
      setSelectionCrop(null);
      const dragWidthPx = drag.latest.width * page.width;
      const dragHeightPx = drag.latest.height * page.height;
      if (dragWidthPx < 8 && dragHeightPx < 8) {
        onPlace(drag.startX, drag.startY);
      } else {
        suppressCandidateClickRef.current = true;
        window.setTimeout(() => {
          suppressCandidateClickRef.current = false;
        }, 0);
        onSelectRange(drag.latest);
      }
      return;
    }
    if (drag.mode === "move" && drag.candidateId) {
      if (!drag.hasMoved) return;
      const occupiedKeys = new Set(
        candidates
          .filter((candidate) => (
            candidate.id !== drag.candidateId
            && candidate.templateId === drag.candidateTemplateId
          ))
          .map((candidate) => candidate.cellKey)
      );
      const frameRect = frameRef.current?.getBoundingClientRect();
      const snapped = cropTemplate && cropTemplate.templateId === drag.candidateTemplateId
        ? snapMovedCrop(
            cropTemplate,
            page,
            effectiveOrigin ?? getStoryboardPageOrigin(cropTemplate, page),
            drag.latest,
            occupiedKeys,
            {
              width: frameRect?.width || page.width,
              height: frameRect?.height || page.height
            },
            drag.candidateTemplateId
          )
        : { crop: drag.latest, gridCell: undefined };
      onCandidateChange(drag.candidateId, snapped.crop, {
        gridCell: snapped.gridCell,
        manuallyPositioned: true
      });
    }
  }

  return (
    <div
      ref={frameRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={cropTemplate ? `${page.index + 1}페이지 crop 중심 위치 지정` : "첫 콘티 crop 범위 드래그"}
      className={`relative w-full select-none border border-field-border bg-black/5 ${disabled ? "" : "touch-none cursor-crosshair"}`}
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
      onPointerDown={startReference}
      onPointerMove={updateDrag}
      onPointerUp={finishDrag}
      onPointerCancel={() => {
        dragRef.current = null;
        setSelectionCrop(null);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={page.previewUrl} alt="" draggable={false} className="pointer-events-none block h-full w-full select-none rounded-none object-fill" />
      {selectionCrop && cropTemplate ? (
        <>
          {gridCells.map((cell) => (
            <span
              key={`guide-${cell.key}`}
              aria-hidden
              className={`pointer-events-none absolute border ${
                selectedGuideKeys.has(cell.key)
                  ? "border-[#ef8f39] bg-[#ef8f39]/16"
                  : "border-[#ef8f39]/30"
              }`}
              style={{
                left: `${cell.crop.x * 100}%`,
                top: `${cell.crop.y * 100}%`,
                width: `${cell.crop.width * 100}%`,
                height: `${cell.crop.height * 100}%`
              }}
            />
          ))}
          <span
            aria-hidden
            className="pointer-events-none absolute z-20 border border-dashed border-field-primary bg-field-primary/5"
            style={{
              left: `${selectionCrop.x * 100}%`,
              top: `${selectionCrop.y * 100}%`,
              width: `${selectionCrop.width * 100}%`,
              height: `${selectionCrop.height * 100}%`
            }}
          />
        </>
      ) : null}
      {!cropTemplate && referenceCrop.width > 0 && referenceCrop.height > 0 ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="첫 콘티 기준 crop 이동 및 크기 조절"
          className="absolute cursor-move border-2 border-[#ef8f39] bg-[#ef8f39]/10"
          style={{
            left: `${referenceCrop.x * 100}%`,
            top: `${referenceCrop.y * 100}%`,
            width: `${referenceCrop.width * 100}%`,
            height: `${referenceCrop.height * 100}%`
          }}
          onPointerDown={(event) => startReferenceAdjustment(event, "reference-move")}
          onClick={(event) => event.stopPropagation()}
        >
          {referenceSelected
            ? (["nw", "ne", "sw", "se"] as CropResizeHandle[]).map((handle) => (
              <button
                key={handle}
                type="button"
                tabIndex={-1}
                aria-label={`기준 crop ${handle} 모서리 크기 조절`}
                className={`absolute grid h-7 w-7 touch-none place-items-center ${
                  handle.includes("n") ? "-top-3.5" : "-bottom-3.5"
                } ${handle.includes("w") ? "-left-3.5" : "-right-3.5"}`}
                style={{ cursor: handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize" }}
                onPointerDown={(event) => startReferenceAdjustment(event, "reference-resize", handle)}
                onClick={(event) => event.stopPropagation()}
              >
                <span className="block h-3 w-3 border-2 border-white bg-[#ef8f39]" />
              </button>
            ))
            : null}
        </div>
      ) : null}
      {!cropTemplate && referenceSelected ? (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onConfirmTemplate();
          }}
          className="absolute z-20 inline-flex min-h-9 -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-[3px] bg-field-primary px-3 text-[11px] font-black text-white shadow-[0_4px_16px_rgba(20,66,52,0.24)]"
          style={{
            left: `clamp(4.75rem, ${(referenceCrop.x + referenceCrop.width / 2) * 100}%, calc(100% - 4.75rem))`,
            top: `clamp(0.5rem, ${(referenceCrop.y + referenceCrop.height + 0.015) * 100}%, calc(100% - 2.75rem))`
          }}
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
          기준 비율로 적용
        </button>
      ) : null}
      {candidates.map((candidate, index) => {
        const overlaps = candidates.some((other) => (
          other.id !== candidate.id && cropsOverlap(candidate.crop, other.crop)
        ));
        return (
        <div
          key={candidate.id}
          role="button"
          tabIndex={0}
          aria-pressed={selectedCandidateId === candidate.id}
          onPointerDown={(event) => startCandidateDrag(event, candidate, "move")}
          onClick={(event) => {
            event.stopPropagation();
            if (suppressCandidateClickRef.current) {
              suppressCandidateClickRef.current = false;
              return;
            }
            onSelect(candidate.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(candidate.id);
            }
          }}
          className={`absolute cursor-move border-2 bg-[#ef8f39]/12 ${
            selectedCandidateId === candidate.id
              ? `z-10 ${overlaps ? "border-field-danger" : "border-[#d96f18]"} ring-2 ring-white/90`
              : overlaps ? "border-field-danger" : "border-[#ef8f39]"
          }`}
          style={{
            left: `${candidate.crop.x * 100}%`,
            top: `${candidate.crop.y * 100}%`,
            width: `${candidate.crop.width * 100}%`,
            height: `${candidate.crop.height * 100}%`
          }}
          aria-label={`후보 ${index + 1} 수정`}
        >
          <span className="pointer-events-none absolute left-0 top-0 grid h-5 min-w-5 place-items-center bg-[#ef8f39] px-1 text-[10px] font-black text-white">
            {candidateNumbers.get(candidate.id) ?? index + 1}
          </span>
          {selectedCandidateId === candidate.id
            ? (["nw", "ne", "sw", "se"] as CropResizeHandle[]).map((handle) => (
              <button
                key={handle}
                type="button"
                tabIndex={-1}
                aria-label={`crop ${handle} 모서리 크기 조절`}
                className={`absolute grid h-7 w-7 touch-none place-items-center ${
                  handle.includes("n") ? "-top-3.5" : "-bottom-3.5"
                } ${handle.includes("w") ? "-left-3.5" : "-right-3.5"}`}
                style={{ cursor: handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize" }}
                onPointerDown={(event) => startCandidateDrag(event, candidate, "resize", handle)}
                onClick={(event) => event.stopPropagation()}
              >
                <span className="block h-3 w-3 border-2 border-white bg-[#ef8f39]" />
              </button>
            ))
            : null}
        </div>
        );
      })}
    </div>
  );
}

function resizeCropWithAspect(
  crop: RelativeCrop,
  handle: CropResizeHandle,
  point: { x: number; y: number }
) {
  const fixedX = handle.includes("w") ? crop.x + crop.width : crop.x;
  const fixedY = handle.includes("n") ? crop.y + crop.height : crop.y;
  const availableWidth = handle.includes("w") ? fixedX : 1 - fixedX;
  const availableHeight = handle.includes("n") ? fixedY : 1 - fixedY;
  const scaleX = Math.abs(point.x - fixedX) / crop.width;
  const scaleY = Math.abs(point.y - fixedY) / crop.height;
  const requestedScale = (scaleX + scaleY) / 2;
  const minimumScale = Math.max(
    0.18,
    0.02 / crop.width,
    0.02 / crop.height
  );
  const maximumScale = Math.max(
    Number.EPSILON,
    Math.min(availableWidth / crop.width, availableHeight / crop.height)
  );
  const scale = Math.min(
    maximumScale,
    Math.max(Math.min(minimumScale, maximumScale), requestedScale)
  );
  const width = crop.width * scale;
  const height = crop.height * scale;
  return {
    x: handle.includes("w") ? fixedX - width : fixedX,
    y: handle.includes("n") ? fixedY - height : fixedY,
    width,
    height
  };
}

function snapMovedCrop(
  template: StoryboardCropTemplate,
  page: ArchiveImportPage,
  origin: StoryboardGridOrigin,
  crop: RelativeCrop,
  occupiedKeys: ReadonlySet<string>,
  renderedSize: { width: number; height: number },
  candidateTemplateId?: string
): { crop: RelativeCrop; gridCell?: StoryboardGridCell } {
  if (!candidateTemplateId || candidateTemplateId !== template.templateId) {
    return { crop };
  }

  const renderedWidth = Math.max(1, renderedSize.width);
  const renderedHeight = Math.max(1, renderedSize.height);
  const snapThreshold = Math.min(
    12,
    Math.max(
      4,
      Math.min(crop.width * renderedWidth, crop.height * renderedHeight) * 0.12
    )
  );
  const maximumX = 1 - crop.width;
  const maximumY = 1 - crop.height;
  let nearest: StoryboardGridCell | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const cell of createStoryboardGridCells(template, page, origin)) {
    if (cell.templateId !== candidateTemplateId) continue;
    if (
      cell.crop.x < -0.000001
      || cell.crop.y < -0.000001
      || cell.crop.x > maximumX + 0.000001
      || cell.crop.y > maximumY + 0.000001
    ) {
      continue;
    }
    const dx = (cell.crop.x - crop.x) * renderedWidth;
    const dy = (cell.crop.y - crop.y) * renderedHeight;
    const distance = Math.hypot(dx, dy);
    if (distance < nearestDistance) {
      nearest = cell;
      nearestDistance = distance;
    }
  }

  if (!nearest || nearestDistance > snapThreshold || occupiedKeys.has(nearest.key)) {
    return { crop };
  }
  return {
    crop: {
      ...crop,
      x: Math.min(maximumX, Math.max(0, nearest.crop.x)),
      y: Math.min(maximumY, Math.max(0, nearest.crop.y))
    },
    gridCell: nearest
  };
}

function cropsOverlap(left: RelativeCrop, right: RelativeCrop) {
  const overlapWidth = Math.min(left.x + left.width, right.x + right.width)
    - Math.max(left.x, right.x);
  const overlapHeight = Math.min(left.y + left.height, right.y + right.height)
    - Math.max(left.y, right.y);
  return overlapWidth > 0.000001 && overlapHeight > 0.000001;
}

function compareStoryboardGridCells(left: StoryboardGridCell, right: StoryboardGridCell) {
  return left.rowIndex - right.rowIndex || left.columnIndex - right.columnIndex;
}

function compareStoryboardCandidates(
  left: StoryboardCropCandidate,
  right: StoryboardCropCandidate
) {
  return left.page.sourceFileIndex - right.page.sourceFileIndex
    || left.page.index - right.page.index
    || left.rowIndex - right.rowIndex
    || left.columnIndex - right.columnIndex;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function OverheadCropWorkflow({
  pages,
  selectedIds,
  selectedCount,
  crop,
  applyCrop,
  referencePage,
  isSaving,
  onSelectedIdsChange,
  onCropChange,
  onApplyCropChange
}: {
  pages: ArchiveImportPage[];
  selectedIds: Set<string>;
  selectedCount: number;
  crop: RelativeCrop;
  applyCrop: boolean;
  referencePage: ArchiveImportPage | null;
  isSaving: boolean;
  onSelectedIdsChange: (value: Set<string> | ((value: Set<string>) => Set<string>)) => void;
  onCropChange: (crop: RelativeCrop) => void;
  onApplyCropChange: (value: boolean) => void;
}) {
  return (
    <div className="grid content-start gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black text-field-primary">저장할 페이지 선택</p>
        <button type="button" onClick={() => onSelectedIdsChange(selectedCount === pages.length ? new Set() : new Set(pages.map((page) => page.id)))} className="min-h-9 rounded-[3px] border border-field-border px-3 text-xs font-black text-field-primary">
          {selectedCount === pages.length ? "전체 해제" : "전체 선택"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {pages.map((page) => {
          const selected = selectedIds.has(page.id);
          return (
            <button
              key={page.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectedIdsChange((current) => {
                const next = new Set(current);
                if (next.has(page.id)) next.delete(page.id);
                else next.add(page.id);
                return next;
              })}
              className={`relative grid gap-1 border bg-white p-1.5 text-left ${selected ? "border-field-primary ring-2 ring-field-primary/20" : "border-field-border"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={page.previewUrl} alt={`${page.index + 1}페이지 미리보기`} draggable={false} className="block aspect-[4/3] h-auto w-full select-none rounded-none object-contain" />
              <span className="truncate px-1 text-[11px] font-bold text-field-muted">{page.index + 1}. {page.name}</span>
              {selected ? <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-[3px] bg-field-primary text-white"><Check className="h-4 w-4" aria-hidden /></span> : null}
            </button>
          );
        })}
      </div>
      <div className="grid gap-2 border border-field-border bg-field-soft/45 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-black text-field-primary">페이지 crop</p>
            <p className="text-[11px] font-bold text-field-muted">선택한 페이지에 같은 상대 좌표를 적용합니다.</p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-black text-field-primary"><input type="checkbox" checked={applyCrop} onChange={(event) => onApplyCropChange(event.target.checked)} />적용</label>
        </div>
        {referencePage ? <CropSelector page={referencePage} value={crop} disabled={!applyCrop || isSaving} onChange={onCropChange} label="부감도 페이지 crop" /> : null}
        <CropNumbers crop={crop} />
      </div>
    </div>
  );
}

function CropNumbers({ crop }: { crop: RelativeCrop }) {
  return (
    <div className="grid grid-cols-4 gap-1 text-[10px] font-bold text-field-muted">
      <span>x {Math.round(crop.x * 100)}%</span>
      <span>y {Math.round(crop.y * 100)}%</span>
      <span>w {Math.round(crop.width * 100)}%</span>
      <span>h {Math.round(crop.height * 100)}%</span>
    </div>
  );
}

function CropSelector({
  page,
  value,
  disabled,
  onChange,
  label
}: {
  page: ArchiveImportPage;
  value: RelativeCrop;
  disabled: boolean;
  onChange: (value: RelativeCrop) => void;
  label: string;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    mode: "create" | "move" | "resize";
    startX: number;
    startY: number;
    original: RelativeCrop;
  } | null>(null);

  function relativePoint(event: React.PointerEvent) {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  }

  function startDrag(event: React.PointerEvent, mode: "create" | "move" | "resize") {
    if (disabled) return;
    event.stopPropagation();
    const point = relativePoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, mode, startX: point.x, startY: point.y, original: { ...value } };
    if (mode === "create") onChange({ x: point.x, y: point.y, width: 0.01, height: 0.01 });
  }

  return (
    <div
      ref={frameRef}
      className={`relative w-full select-none border border-field-border bg-black/5 ${disabled ? "" : "touch-none cursor-crosshair"}`}
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
      aria-label={label}
      onPointerDown={(event) => startDrag(event, "create")}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const point = relativePoint(event);
        if (drag.mode === "move") {
          onChange({
            ...drag.original,
            x: Math.min(1 - drag.original.width, Math.max(0, drag.original.x + point.x - drag.startX)),
            y: Math.min(1 - drag.original.height, Math.max(0, drag.original.y + point.y - drag.startY))
          });
        } else if (drag.mode === "resize") {
          onChange({
            ...drag.original,
            width: Math.max(0.01, Math.min(1 - drag.original.x, point.x - drag.original.x)),
            height: Math.max(0.01, Math.min(1 - drag.original.y, point.y - drag.original.y))
          });
        } else {
          onChange({
            x: Math.min(drag.startX, point.x),
            y: Math.min(drag.startY, point.y),
            width: Math.max(0.01, Math.abs(point.x - drag.startX)),
            height: Math.max(0.01, Math.abs(point.y - drag.startY))
          });
        }
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={page.previewUrl} alt={label} draggable={false} className="pointer-events-none block h-full w-full select-none rounded-none object-fill" />
      {value.width > 0 && value.height > 0 ? (
        <div
          className="absolute cursor-move border-2 border-[#ef8f39] bg-[#ef8f39]/10 shadow-[0_0_0_999px_rgba(0,0,0,0.22)]"
          style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.width * 100}%`, height: `${value.height * 100}%` }}
          onPointerDown={(event) => startDrag(event, "move")}
        >
          <button type="button" tabIndex={-1} aria-label="crop 크기 조절" className="absolute -bottom-2 -right-2 h-5 w-5 cursor-se-resize border-2 border-white bg-[#ef8f39]" onPointerDown={(event) => startDrag(event, "resize")} />
        </div>
      ) : null}
    </div>
  );
}

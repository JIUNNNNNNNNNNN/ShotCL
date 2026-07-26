"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Crop, FileImage, Grid2X2, Save, Trash2, Undo2, X } from "lucide-react";
import {
  createCenteredStoryboardCrop,
  createSnappedStoryboardCrop,
  createStoryboardAutoCrops,
  createStoryboardCropTemplate,
  type ArchiveImportPage,
  type RelativeCrop,
  type StoryboardCropCandidate,
  type StoryboardCropTemplate
} from "@/lib/client/archiveMedia";
import type { ProjectReferenceAssetType } from "@/lib/types";

export type ArchiveImportResult = {
  page: ArchiveImportPage;
  crop: RelativeCrop | null;
};

export type ArchiveImportCommit = {
  results: ArchiveImportResult[];
  cropTemplate: StoryboardCropTemplate | null;
  title: string;
  memo: string;
  sceneNo: string;
  cutNo: string;
};

const DEFAULT_CROP: RelativeCrop = { x: 0.06, y: 0.08, width: 0.46, height: 0.16 };

export function ArchiveImportDialog({
  assetType,
  sourceLabel,
  pages,
  isSaving,
  onClose,
  onSave
}: {
  assetType: Extract<ProjectReferenceAssetType, "overhead" | "storyboard">;
  sourceLabel: string;
  pages: ArchiveImportPage[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (value: ArchiveImportCommit) => Promise<void> | void;
}) {
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
  const [activePageId, setActivePageId] = useState(pages[0]?.id ?? "");
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [sceneNo, setSceneNo] = useState("");
  const [cutNo, setCutNo] = useState("");
  const selectedPages = useMemo(
    () => pages.filter((page) => selectedIds.has(page.id)),
    [pages, selectedIds]
  );
  const referencePage = pages[0] ?? null;
  const activePage = pages.find((page) => page.id === activePageId) ?? referencePage;
  const editingCandidate = candidates.find((candidate) => candidate.id === editingCandidateId) ?? null;
  const results: ArchiveImportResult[] = assetType === "storyboard"
    ? candidates.map((candidate) => ({ page: candidate.page, crop: candidate.crop }))
    : selectedPages.map((page) => ({ page, crop: applyCrop ? referenceCrop : null }));

  function confirmTemplate() {
    if (!referencePage || !referenceSelected) return;
    const template = createStoryboardCropTemplate(referencePage, referenceCrop);
    const referenceCandidateId = `${referencePage.id}-reference-${Date.now()}`;
    setCropTemplate(template);
    setActivePageId(referencePage.id);
    setCandidates((current) => {
      if (current.length > 0) return current;
      return [{
        id: referenceCandidateId,
        page: referencePage,
        crop: { ...referenceCrop }
      }];
    });
    setEditingCandidateId(referenceCandidateId);
  }

  function addCandidateAt(page: ArchiveImportPage, _centerX: number, centerY: number) {
    if (!cropTemplate) return;
    const pageCrops = candidates
      .filter((candidate) => candidate.page.id === page.id)
      .map((candidate) => candidate.crop);
    const candidate: StoryboardCropCandidate = {
      id: `${page.id}-click-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      page,
      crop: createSnappedStoryboardCrop(cropTemplate, page, centerY, pageCrops)
    };
    setCandidates((current) => [...current, candidate]);
    setEditingCandidateId(candidate.id);
  }

  function addAutomaticCandidates(page: ArchiveImportPage) {
    if (!cropTemplate) return;
    setCandidates((current) => {
      const existing = current.filter((candidate) => candidate.page.id === page.id);
      const crops = createStoryboardAutoCrops(
        cropTemplate,
        page,
        existing.map((candidate) => candidate.crop)
      );
      return [
        ...current,
        ...crops.map((crop, index) => ({
          id: `${page.id}-auto-${Date.now()}-${index}`,
          page,
          crop
        }))
      ];
    });
  }

  function removeCandidate(id: string) {
    setCandidates((current) => current.filter((candidate) => candidate.id !== id));
    if (editingCandidateId === id) setEditingCandidateId(null);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`${assetType === "overhead" ? "부감도" : "콘티"} 가져오기`}>
      <section className="flex max-h-[96dvh] w-full max-w-7xl flex-col rounded-t-2xl border border-field-border bg-white shadow-[0_18px_54px_rgba(20,32,27,0.2)] sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-field-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display truncate text-lg font-black text-field-primary">{assetType === "overhead" ? "부감도" : "콘티"} 가져오기</h2>
            <p className="truncate text-xs font-bold text-field-muted">{sourceLabel} · {pages.length}페이지/이미지</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} className="grid h-10 w-10 place-items-center rounded-full border border-field-border text-field-muted" aria-label="가져오기 닫기">
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
              isSaving={isSaving}
              onReferenceCropChange={(crop) => {
                setReferenceCrop(crop);
                setReferenceSelected(false);
              }}
              onReferenceSelectionComplete={() => setReferenceSelected(true)}
              onConfirmTemplate={confirmTemplate}
              onActivePageChange={setActivePageId}
              onAddCandidate={addCandidateAt}
              onAddAutomaticCandidates={addAutomaticCandidates}
              onEditCandidate={setEditingCandidateId}
              onCandidateChange={(id, crop) => setCandidates((current) => current.map((candidate) => (
                candidate.id === id ? { ...candidate, crop } : candidate
              )))}
              onDeleteCandidate={removeCandidate}
              onUndo={() => {
                const last = candidates.at(-1);
                if (last) removeCandidate(last.id);
              }}
              onCancel={onClose}
              onConfirmExtraction={() => onSave({
                results,
                cropTemplate,
                title,
                memo,
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
                  sceneNo={sceneNo}
                  cutNo={cutNo}
                  onTitleChange={setTitle}
                  onMemoChange={setMemo}
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
                isSaving={isSaving}
                onSelectedIdsChange={setSelectedIds}
                onCropChange={setReferenceCrop}
                onApplyCropChange={setApplyCrop}
              />
              <ArchiveMetadataFields
                title={title}
                memo={memo}
                sceneNo={sceneNo}
                cutNo={cutNo}
                onTitleChange={setTitle}
                onMemoChange={setMemo}
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
                disabled={isSaving || results.length === 0}
                onClick={() => onSave({ results, cropTemplate: null, title, memo, sceneNo, cutNo })}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-field-primary px-5 text-sm font-black text-white disabled:opacity-50"
              >
                <Save className="h-4 w-4" aria-hidden />
                {isSaving ? "저장 중" : "추출 확정"}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

function ArchiveMetadataFields({
  title,
  memo,
  sceneNo,
  cutNo,
  onTitleChange,
  onMemoChange,
  onSceneNoChange,
  onCutNoChange
}: {
  title: string;
  memo: string;
  sceneNo: string;
  cutNo: string;
  onTitleChange: (value: string) => void;
  onMemoChange: (value: string) => void;
  onSceneNoChange: (value: string) => void;
  onCutNoChange: (value: string) => void;
}) {
  return (
    <div className="grid content-start gap-2">
      <label className="grid gap-1 text-xs font-black text-field-muted">
        제목
        <input value={title} onChange={(event) => onTitleChange(event.target.value)} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text" placeholder="선택 사항" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs font-black text-field-muted">씬<input value={sceneNo} onChange={(event) => onSceneNoChange(event.target.value)} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text" /></label>
        <label className="grid gap-1 text-xs font-black text-field-muted">컷<input value={cutNo} onChange={(event) => onCutNoChange(event.target.value)} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text" /></label>
      </div>
      <label className="grid gap-1 text-xs font-black text-field-muted">메모<textarea value={memo} onChange={(event) => onMemoChange(event.target.value)} rows={3} className="rounded-lg border border-field-border bg-white px-3 py-2 text-sm leading-5 text-field-text" /></label>
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
  isSaving,
  onReferenceCropChange,
  onReferenceSelectionComplete,
  onConfirmTemplate,
  onActivePageChange,
  onAddCandidate,
  onAddAutomaticCandidates,
  onEditCandidate,
  onCandidateChange,
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
  isSaving: boolean;
  onReferenceCropChange: (crop: RelativeCrop) => void;
  onReferenceSelectionComplete: () => void;
  onConfirmTemplate: () => void;
  onActivePageChange: (id: string) => void;
  onAddCandidate: (page: ArchiveImportPage, centerX: number, centerY: number) => void;
  onAddAutomaticCandidates: (page: ArchiveImportPage) => void;
  onEditCandidate: (id: string | null) => void;
  onCandidateChange: (id: string, crop: RelativeCrop) => void;
  onDeleteCandidate: (id: string) => void;
  onUndo: () => void;
  onCancel: () => void;
  onConfirmExtraction: () => void;
}) {
  const activeCandidates = activePage
    ? candidates.filter((candidate) => candidate.page.id === activePage.id)
    : [];
  const candidateNumbers = new Map(candidates.map((candidate, index) => [candidate.id, index + 1]));
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
          {cropTemplate ? "나머지 그림칸 중앙을 클릭하세요" : "첫 그림칸을 드래그하세요"}
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
          candidates={activeCandidates}
          candidateNumbers={candidateNumbers}
          selectedCandidateId={editingCandidate?.page.id === activePage.id ? editingCandidate.id : null}
          disabled={isSaving}
          onReferenceCropChange={onReferenceCropChange}
          onReferenceSelectionComplete={onReferenceSelectionComplete}
          onConfirmTemplate={onConfirmTemplate}
          onPlace={(x, y) => onAddCandidate(activePage, x, y)}
          onSelect={onEditCandidate}
          onCandidateChange={onCandidateChange}
        />
      ) : referencePage ? (
        <p className="p-6 text-center text-sm font-bold text-field-muted">페이지를 표시할 수 없습니다.</p>
      ) : null}

      <div className="sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-2 border border-field-border bg-white/95 p-2 shadow-[0_-8px_24px_rgba(20,32,27,0.1)] backdrop-blur">
        <div className="flex items-center gap-1">
          <span className="px-1 text-[11px] font-black text-field-primary">
            현재 {activeCandidates.length} · 전체 {candidates.length}
          </span>
          <button
            type="button"
            onClick={() => activePage && onAddAutomaticCandidates(activePage)}
            disabled={!cropTemplate || !activePage || isSaving}
            className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border px-2.5 text-[11px] font-black text-field-primary disabled:opacity-40"
          >
            <Grid2X2 className="h-3.5 w-3.5" aria-hidden />
            자동 후보
          </button>
          <button
            type="button"
            onClick={onUndo}
            disabled={candidates.length === 0 || isSaving}
            className="grid h-9 w-9 place-items-center rounded-full border border-field-border text-field-primary disabled:opacity-40"
            aria-label="마지막 후보 취소"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
          </button>
          {editingCandidate?.page.id === activePage?.id ? (
            <button
              type="button"
              onClick={() => editingCandidate && onDeleteCandidate(editingCandidate.id)}
              disabled={isSaving}
              className="grid h-9 w-9 place-items-center rounded-full border border-field-danger/35 text-field-danger disabled:opacity-40"
              aria-label="선택한 crop 후보 삭제"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <button type="button" onClick={() => movePage(-1)} disabled={activePageIndex <= 0 || isSaving} className="grid h-9 w-9 place-items-center rounded-full border border-field-border text-field-primary disabled:opacity-35" aria-label="이전 페이지">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => movePage(1)} disabled={activePageIndex >= pages.length - 1 || isSaving} className="grid h-9 w-9 place-items-center rounded-full border border-field-border text-field-primary disabled:opacity-35" aria-label="다음 페이지">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={onCancel} disabled={isSaving} className="min-h-9 rounded-full border border-field-border px-3 text-[11px] font-black text-field-muted disabled:opacity-40">
            취소
          </button>
          <button
            type="button"
            onClick={onConfirmExtraction}
            disabled={!cropTemplate || candidates.length === 0 || isSaving}
            className="inline-flex min-h-9 items-center gap-1 rounded-full bg-field-primary px-3 text-[11px] font-black text-white disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {isSaving ? "저장 중" : "추출 확정"}
          </button>
        </div>
      </div>
    </div>
  );
}

type CropResizeHandle = "nw" | "ne" | "sw" | "se";

type CanvasDrag = {
  pointerId: number;
  mode: "reference-create" | "reference-move" | "reference-resize" | "move" | "resize";
  startX: number;
  startY: number;
  original: RelativeCrop;
  candidateId?: string;
  handle?: CropResizeHandle;
  latest: RelativeCrop;
};

function StoryboardCropCanvas({
  page,
  referenceCrop,
  referenceSelected,
  cropTemplate,
  candidates,
  candidateNumbers,
  selectedCandidateId,
  disabled,
  onReferenceCropChange,
  onReferenceSelectionComplete,
  onConfirmTemplate,
  onPlace,
  onSelect,
  onCandidateChange
}: {
  page: ArchiveImportPage;
  referenceCrop: RelativeCrop;
  referenceSelected: boolean;
  cropTemplate: StoryboardCropTemplate | null;
  candidates: StoryboardCropCandidate[];
  candidateNumbers: Map<string, number>;
  selectedCandidateId: string | null;
  disabled: boolean;
  onReferenceCropChange: (crop: RelativeCrop) => void;
  onReferenceSelectionComplete: () => void;
  onConfirmTemplate: () => void;
  onPlace: (x: number, y: number) => void;
  onSelect: (id: string | null) => void;
  onCandidateChange: (id: string, crop: RelativeCrop) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<CanvasDrag | null>(null);

  function relativePoint(event: React.PointerEvent) {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height)
    };
  }

  function startReference(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || cropTemplate) return;
    const point = relativePoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const crop = { x: point.x, y: point.y, width: 0.01, height: 0.01 };
    dragRef.current = {
      pointerId: event.pointerId,
      mode: "reference-create",
      startX: point.x,
      startY: point.y,
      original: crop,
      latest: crop
    };
    onReferenceCropChange(crop);
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
      latest: { ...referenceCrop }
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
      handle,
      latest: { ...candidate.crop }
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
      next = {
        ...drag.original,
        x: Math.min(1 - drag.original.width, Math.max(0, drag.original.x + point.x - drag.startX)),
        y: Math.min(1 - drag.original.height, Math.max(0, drag.original.y + point.y - drag.startY))
      };
      onCandidateChange(drag.candidateId, next);
    } else if (drag.mode === "resize" && drag.candidateId && drag.handle) {
      next = resizeCropWithAspect(drag.original, drag.handle, point);
      onCandidateChange(drag.candidateId, next);
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
    if (drag.mode === "move" && drag.candidateId && cropTemplate) {
      onCandidateChange(
        drag.candidateId,
        snapMovedCrop(
          cropTemplate,
          page,
          drag.latest,
          candidates.filter((candidate) => candidate.id !== drag.candidateId).map((candidate) => candidate.crop)
        )
      );
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
      }}
      onClick={(event) => {
        if (disabled || !cropTemplate || !frameRef.current) return;
        const rect = frameRef.current.getBoundingClientRect();
        onPlace(
          clamp01((event.clientX - rect.left) / rect.width),
          clamp01((event.clientY - rect.top) / rect.height)
        );
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={page.previewUrl} alt="" draggable={false} className="pointer-events-none block h-full w-full select-none rounded-none object-fill" />
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
          className="absolute z-20 inline-flex min-h-9 -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-field-primary px-3 text-[11px] font-black text-white shadow-[0_4px_16px_rgba(20,66,52,0.24)]"
          style={{
            left: `clamp(4.75rem, ${(referenceCrop.x + referenceCrop.width / 2) * 100}%, calc(100% - 4.75rem))`,
            top: `clamp(0.5rem, ${(referenceCrop.y + referenceCrop.height + 0.015) * 100}%, calc(100% - 2.75rem))`
          }}
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
          기준 비율로 적용
        </button>
      ) : null}
      {candidates.map((candidate, index) => (
        <div
          key={candidate.id}
          role="button"
          tabIndex={0}
          aria-pressed={selectedCandidateId === candidate.id}
          onPointerDown={(event) => startCandidateDrag(event, candidate, "move")}
          onClick={(event) => {
            event.stopPropagation();
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
              ? "z-10 border-[#d96f18] ring-2 ring-white/90"
              : "border-[#ef8f39]"
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
      ))}
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
  const requestedScale = Math.max(0.18, (scaleX + scaleY) / 2);
  const maximumScale = Math.max(
    0.18,
    Math.min(availableWidth / crop.width, availableHeight / crop.height)
  );
  const scale = Math.min(requestedScale, maximumScale);
  const width = Math.max(0.02, crop.width * scale);
  const height = Math.max(0.02, crop.height * scale);
  return {
    x: handle.includes("w") ? fixedX - width : fixedX,
    y: handle.includes("n") ? fixedY - height : fixedY,
    width,
    height
  };
}

function snapMovedCrop(
  template: StoryboardCropTemplate,
  page: Pick<ArchiveImportPage, "width" | "height">,
  crop: RelativeCrop,
  otherCrops: RelativeCrop[]
) {
  const centerY = crop.y + crop.height / 2;
  const snapped = createSnappedStoryboardCrop(template, page, centerY, otherCrops);
  const templatePosition = createCenteredStoryboardCrop(
    template,
    template.columnX + template.cropWidth / 2,
    centerY,
    page
  );
  const next = { ...crop };
  if (Math.abs(crop.x - templatePosition.x) <= Math.max(0.025, crop.width * 0.18)) {
    next.x = templatePosition.x;
  }
  const snappedCenterY = snapped.y + snapped.height / 2;
  if (Math.abs(centerY - snappedCenterY) <= Math.max(0.025, crop.height * 0.32)) {
    next.y = Math.min(1 - crop.height, Math.max(0, snappedCenterY - crop.height / 2));
  }
  return next;
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
        <button type="button" onClick={() => onSelectedIdsChange(selectedCount === pages.length ? new Set() : new Set(pages.map((page) => page.id)))} className="min-h-9 rounded-full border border-field-border px-3 text-xs font-black text-field-primary">
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
              {selected ? <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-field-primary text-white"><Check className="h-4 w-4" aria-hidden /></span> : null}
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

"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Crop, FileImage, MousePointer2, Save, Trash2, Undo2, X } from "lucide-react";
import {
  createCenteredStoryboardCrop,
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
  const [referenceCrop, setReferenceCrop] = useState<RelativeCrop>(DEFAULT_CROP);
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
    if (!referencePage) return;
    const template = createStoryboardCropTemplate(referencePage, referenceCrop);
    setCropTemplate(template);
    setActivePageId(referencePage.id);
    setCandidates((current) => {
      if (current.length > 0) return current;
      return [{
        id: `${referencePage.id}-reference-${Date.now()}`,
        page: referencePage,
        crop: { ...referenceCrop }
      }];
    });
  }

  function addCandidateAt(page: ArchiveImportPage, centerX: number, centerY: number) {
    if (!cropTemplate) return;
    const candidate: StoryboardCropCandidate = {
      id: `${page.id}-click-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      page,
      crop: createCenteredStoryboardCrop(cropTemplate, centerX, centerY)
    };
    setCandidates((current) => [...current, candidate]);
    setEditingCandidateId(candidate.id);
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

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
          {assetType === "storyboard" ? (
            <StoryboardCropWorkflow
              pages={pages}
              referencePage={referencePage}
              referenceCrop={referenceCrop}
              cropTemplate={cropTemplate}
              candidates={candidates}
              activePage={activePage}
              editingCandidate={editingCandidate}
              isSaving={isSaving}
              onReferenceCropChange={setReferenceCrop}
              onConfirmTemplate={confirmTemplate}
              onActivePageChange={setActivePageId}
              onAddCandidate={addCandidateAt}
              onEditCandidate={setEditingCandidateId}
              onCandidateChange={(id, crop) => setCandidates((current) => current.map((candidate) => (
                candidate.id === id ? { ...candidate, crop } : candidate
              )))}
              onDeleteCandidate={removeCandidate}
              onUndo={() => {
                const last = candidates.at(-1);
                if (last) removeCandidate(last.id);
              }}
            />
          ) : (
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
          )}

          <div className="grid content-start gap-3">
            <div className="grid gap-2 rounded-xl border border-field-border p-3">
              <label className="grid gap-1 text-xs font-black text-field-muted">
                제목
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text" placeholder="선택 사항" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs font-black text-field-muted">씬<input value={sceneNo} onChange={(event) => setSceneNo(event.target.value)} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text" /></label>
                <label className="grid gap-1 text-xs font-black text-field-muted">컷<input value={cutNo} onChange={(event) => setCutNo(event.target.value)} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text" /></label>
              </div>
              <label className="grid gap-1 text-xs font-black text-field-muted">메모<textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} className="rounded-lg border border-field-border bg-white px-3 py-2 text-sm leading-5 text-field-text" /></label>
            </div>
            {assetType === "storyboard" ? (
              <p className="rounded-xl border border-field-border bg-field-soft/45 px-3 py-2 text-xs font-bold leading-5 text-field-muted">
                첫 칸만 드래그해 크기를 정한 뒤, 각 페이지에서 그림칸의 중앙을 클릭하세요. 텍스트 추출·OCR·AI 분석은 사용하지 않습니다.
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-field-border px-4 py-3">
          <p className="inline-flex items-center gap-1 text-xs font-bold text-field-muted">
            {results.some((result) => result.crop) ? <Crop className="h-4 w-4" aria-hidden /> : <FileImage className="h-4 w-4" aria-hidden />}
            {results.length}개 결과 확인
          </p>
          <button
            type="button"
            disabled={isSaving || results.length === 0 || (assetType === "storyboard" && !cropTemplate)}
            onClick={() => onSave({ results, cropTemplate: assetType === "storyboard" ? cropTemplate : null, title, memo, sceneNo, cutNo })}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-field-primary px-5 text-sm font-black text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" aria-hidden />
            {isSaving ? "저장 중" : "추출 확정"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function StoryboardCropWorkflow({
  pages,
  referencePage,
  referenceCrop,
  cropTemplate,
  candidates,
  activePage,
  editingCandidate,
  isSaving,
  onReferenceCropChange,
  onConfirmTemplate,
  onActivePageChange,
  onAddCandidate,
  onEditCandidate,
  onCandidateChange,
  onDeleteCandidate,
  onUndo
}: {
  pages: ArchiveImportPage[];
  referencePage: ArchiveImportPage | null;
  referenceCrop: RelativeCrop;
  cropTemplate: StoryboardCropTemplate | null;
  candidates: StoryboardCropCandidate[];
  activePage: ArchiveImportPage | null;
  editingCandidate: StoryboardCropCandidate | null;
  isSaving: boolean;
  onReferenceCropChange: (crop: RelativeCrop) => void;
  onConfirmTemplate: () => void;
  onActivePageChange: (id: string) => void;
  onAddCandidate: (page: ArchiveImportPage, centerX: number, centerY: number) => void;
  onEditCandidate: (id: string | null) => void;
  onCandidateChange: (id: string, crop: RelativeCrop) => void;
  onDeleteCandidate: (id: string) => void;
  onUndo: () => void;
}) {
  const activeCandidates = activePage
    ? candidates.filter((candidate) => candidate.page.id === activePage.id)
    : [];
  return (
    <div className="grid content-start gap-4">
      <div className="grid gap-3 border border-field-border bg-field-soft/45 p-3">
        <div>
          <p className="text-sm font-black text-field-primary">1단계 · 첫 콘티 그림칸 지정</p>
          <p className="text-[11px] font-bold leading-5 text-field-muted">첫 페이지에서 그림칸만 드래그하고 크기를 조절한 뒤 기준을 확정하세요.</p>
        </div>
        {referencePage ? <CropSelector page={referencePage} value={referenceCrop} disabled={isSaving || Boolean(cropTemplate)} onChange={onReferenceCropChange} label="첫 콘티 그림칸 기준" /> : null}
        <CropNumbers crop={referenceCrop} />
        <button type="button" onClick={onConfirmTemplate} disabled={isSaving || Boolean(cropTemplate)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-field-primary bg-white px-4 text-xs font-black text-field-primary disabled:opacity-60">
          <Check className="h-4 w-4" aria-hidden />
          {cropTemplate ? "기준 크기 적용됨" : "기준 비율·크기 확정"}
        </button>
      </div>

      {cropTemplate && activePage ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-black text-field-primary">2단계 · 그림칸 중앙 클릭</p>
              <p className="text-[11px] font-bold text-field-muted">현재 페이지 후보 {activeCandidates.length}개 · 전체 {candidates.length}개</p>
            </div>
            <div className="flex items-center gap-1">
              <select value={activePage.id} onChange={(event) => onActivePageChange(event.target.value)} className="min-h-9 rounded-full border border-field-border bg-white px-3 text-xs font-black">
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>{page.index + 1}페이지</option>
                ))}
              </select>
              <button type="button" onClick={onUndo} disabled={candidates.length === 0} className="grid h-9 w-9 place-items-center rounded-full border border-field-border text-field-primary disabled:opacity-40" aria-label="마지막 후보 취소">
                <Undo2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
          <CandidatePlacementCanvas
            page={activePage}
            candidates={activeCandidates}
            disabled={isSaving}
            onPlace={(x, y) => onAddCandidate(activePage, x, y)}
            onEdit={onEditCandidate}
          />
        </div>
      ) : null}

      {candidates.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-sm font-black text-field-primary">crop 후보</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {candidates.map((candidate, index) => (
              <article key={candidate.id} className={`grid gap-1 border bg-white p-1.5 ${editingCandidate?.id === candidate.id ? "border-field-primary ring-2 ring-field-primary/20" : "border-field-border"}`}>
                <button type="button" onClick={() => onEditCandidate(candidate.id)} className="grid gap-1 text-left">
                  <CropCandidatePreview candidate={candidate} />
                  <span className="truncate px-1 text-[10px] font-bold text-field-muted">{index + 1}. {candidate.page.index + 1}페이지</span>
                </button>
                <button type="button" onClick={() => onDeleteCandidate(candidate.id)} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full text-[10px] font-black text-field-danger">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />후보 삭제
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {editingCandidate ? (
        <div className="grid gap-2 border border-field-primary bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-field-primary">후보 위치·크기 수정 · {editingCandidate.page.index + 1}페이지</p>
            <button type="button" onClick={() => onEditCandidate(null)} className="grid h-8 w-8 place-items-center rounded-full border border-field-border" aria-label="후보 수정 닫기"><X className="h-4 w-4" aria-hidden /></button>
          </div>
          <CropSelector page={editingCandidate.page} value={editingCandidate.crop} disabled={isSaving} onChange={(crop) => onCandidateChange(editingCandidate.id, crop)} label="개별 crop 후보 수정" />
          <CropNumbers crop={editingCandidate.crop} />
        </div>
      ) : null}
    </div>
  );
}

function CandidatePlacementCanvas({
  page,
  candidates,
  disabled,
  onPlace,
  onEdit
}: {
  page: ArchiveImportPage;
  candidates: StoryboardCropCandidate[];
  disabled: boolean;
  onPlace: (x: number, y: number) => void;
  onEdit: (id: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={frameRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={`${page.index + 1}페이지 crop 중심 위치 지정`}
      className={`relative w-full select-none border border-field-border bg-black/5 ${disabled ? "" : "cursor-crosshair"}`}
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
      onClick={(event) => {
        if (disabled || !frameRef.current) return;
        const rect = frameRef.current.getBoundingClientRect();
        onPlace(
          Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
          Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
        );
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={page.previewUrl} alt="" draggable={false} className="pointer-events-none block h-full w-full select-none rounded-none object-fill" />
      {candidates.map((candidate, index) => (
        <button
          key={candidate.id}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onEdit(candidate.id);
          }}
          className="absolute border-2 border-[#ef8f39] bg-[#ef8f39]/14"
          style={{
            left: `${candidate.crop.x * 100}%`,
            top: `${candidate.crop.y * 100}%`,
            width: `${candidate.crop.width * 100}%`,
            height: `${candidate.crop.height * 100}%`
          }}
          aria-label={`후보 ${index + 1} 수정`}
        >
          <span className="absolute left-0 top-0 grid h-5 min-w-5 place-items-center bg-[#ef8f39] px-1 text-[10px] font-black text-white">{index + 1}</span>
        </button>
      ))}
      {!disabled ? (
        <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 bg-white/90 px-2 py-1 text-[10px] font-black text-field-primary">
          <MousePointer2 className="h-3 w-3" aria-hidden />그림칸 중앙 클릭
        </span>
      ) : null}
    </div>
  );
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

function CropCandidatePreview({ candidate }: { candidate: StoryboardCropCandidate }) {
  const viewX = candidate.crop.x * candidate.page.width;
  const viewY = candidate.crop.y * candidate.page.height;
  const viewWidth = candidate.crop.width * candidate.page.width;
  const viewHeight = candidate.crop.height * candidate.page.height;
  return (
    <svg
      viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
      preserveAspectRatio="xMidYMid meet"
      className="block w-full border border-field-border bg-black/5"
      style={{ aspectRatio: `${viewWidth} / ${viewHeight}` }}
      aria-label={`${candidate.page.index + 1}페이지 crop 미리보기`}
      role="img"
    >
      <image href={candidate.page.previewUrl} x="0" y="0" width={candidate.page.width} height={candidate.page.height} />
    </svg>
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

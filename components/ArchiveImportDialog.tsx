"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Crop, FileImage, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import {
  generateStoryboardCropCandidates,
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
  const [crop, setCrop] = useState<RelativeCrop>(DEFAULT_CROP);
  const [applyCrop, setApplyCrop] = useState(assetType === "storyboard");
  const [secondCrop, setSecondCrop] = useState<RelativeCrop>({
    ...DEFAULT_CROP,
    y: Math.min(0.8, DEFAULT_CROP.y + DEFAULT_CROP.height + 0.03)
  });
  const [useSecondCrop, setUseSecondCrop] = useState(false);
  const [manualRowStep, setManualRowStep] = useState(DEFAULT_CROP.height + 0.03);
  const initialStoryboard = useMemo(
    () => generateStoryboardCropCandidates(pages, DEFAULT_CROP, DEFAULT_CROP.height + 0.03),
    [pages]
  );
  const [candidates, setCandidates] = useState<StoryboardCropCandidate[]>(initialStoryboard.candidates);
  const [cropTemplate, setCropTemplate] = useState<StoryboardCropTemplate | null>(initialStoryboard.template);
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null);
  const [addPageId, setAddPageId] = useState(pages[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [sceneNo, setSceneNo] = useState("");
  const [cutNo, setCutNo] = useState("");
  const selectedPages = useMemo(
    () => pages.filter((page) => selectedIds.has(page.id)),
    [pages, selectedIds]
  );
  const referencePage = pages[0] ?? null;
  const rowStep = useSecondCrop
    ? Math.max(0.01, secondCrop.y - crop.y)
    : manualRowStep;
  const editingCandidate = candidates.find((candidate) => candidate.id === editingCandidateId) ?? null;
  const results: ArchiveImportResult[] = assetType === "storyboard"
    ? candidates.map((candidate) => ({ page: candidate.page, crop: candidate.crop }))
    : selectedPages.map((page) => ({ page, crop: applyCrop ? crop : null }));

  function regenerateCandidates() {
    const generated = generateStoryboardCropCandidates(pages, crop, rowStep);
    setCandidates(generated.candidates);
    setCropTemplate(generated.template);
    setEditingCandidateId(null);
  }

  function addCandidate() {
    const page = pages.find((item) => item.id === addPageId) ?? pages[0];
    if (!page) return;
    const id = `${page.id}-manual-${Date.now()}`;
    const candidate = { id, page, crop: { ...crop } };
    setCandidates((current) => [...current, candidate]);
    setEditingCandidateId(id);
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
              crop={crop}
              secondCrop={secondCrop}
              useSecondCrop={useSecondCrop}
              manualRowStep={manualRowStep}
              candidates={candidates}
              editingCandidate={editingCandidate}
              addPageId={addPageId}
              isSaving={isSaving}
              onCropChange={setCrop}
              onSecondCropChange={setSecondCrop}
              onUseSecondCropChange={setUseSecondCrop}
              onManualRowStepChange={setManualRowStep}
              onRegenerate={regenerateCandidates}
              onEditCandidate={setEditingCandidateId}
              onCandidateChange={(id, nextCrop) => setCandidates((current) => current.map((candidate) => candidate.id === id ? { ...candidate, crop: nextCrop } : candidate))}
              onDeleteCandidate={(id) => {
                setCandidates((current) => current.filter((candidate) => candidate.id !== id));
                if (editingCandidateId === id) setEditingCandidateId(null);
              }}
              onAddPageIdChange={setAddPageId}
              onAddCandidate={addCandidate}
            />
          ) : (
            <OverheadCropWorkflow
              pages={pages}
              selectedIds={selectedIds}
              selectedCount={selectedPages.length}
              crop={crop}
              applyCrop={applyCrop}
              referencePage={referencePage}
              isSaving={isSaving}
              onSelectedIdsChange={setSelectedIds}
              onCropChange={setCrop}
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
                <label className="grid gap-1 text-xs font-black text-field-muted">
                  씬
                  <input value={sceneNo} onChange={(event) => setSceneNo(event.target.value)} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text" />
                </label>
                <label className="grid gap-1 text-xs font-black text-field-muted">
                  컷
                  <input value={cutNo} onChange={(event) => setCutNo(event.target.value)} className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm text-field-text" />
                </label>
              </div>
              <label className="grid gap-1 text-xs font-black text-field-muted">
                메모
                <textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} className="rounded-lg border border-field-border bg-white px-3 py-2 text-sm leading-5 text-field-text" />
              </label>
            </div>
            {assetType === "storyboard" ? (
              <p className="rounded-xl border border-field-border bg-field-soft/45 px-3 py-2 text-xs font-bold leading-5 text-field-muted">
                콘티 PDF는 이미지로만 렌더링합니다. 텍스트 추출·OCR·AI 분석은 사용하지 않으며, 설명 열은 첫 칸 crop의 가로 범위에서 제외됩니다.
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
            disabled={isSaving || results.length === 0}
            onClick={() => onSave({ results, cropTemplate: assetType === "storyboard" ? cropTemplate : null, title, memo, sceneNo, cutNo })}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-field-primary px-5 text-sm font-black text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" aria-hidden />
            {isSaving ? "저장 중" : "확인한 자료 저장"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function StoryboardCropWorkflow({
  pages,
  referencePage,
  crop,
  secondCrop,
  useSecondCrop,
  manualRowStep,
  candidates,
  editingCandidate,
  addPageId,
  isSaving,
  onCropChange,
  onSecondCropChange,
  onUseSecondCropChange,
  onManualRowStepChange,
  onRegenerate,
  onEditCandidate,
  onCandidateChange,
  onDeleteCandidate,
  onAddPageIdChange,
  onAddCandidate
}: {
  pages: ArchiveImportPage[];
  referencePage: ArchiveImportPage | null;
  crop: RelativeCrop;
  secondCrop: RelativeCrop;
  useSecondCrop: boolean;
  manualRowStep: number;
  candidates: StoryboardCropCandidate[];
  editingCandidate: StoryboardCropCandidate | null;
  addPageId: string;
  isSaving: boolean;
  onCropChange: (crop: RelativeCrop) => void;
  onSecondCropChange: (crop: RelativeCrop) => void;
  onUseSecondCropChange: (value: boolean) => void;
  onManualRowStepChange: (value: number) => void;
  onRegenerate: () => void;
  onEditCandidate: (id: string | null) => void;
  onCandidateChange: (id: string, crop: RelativeCrop) => void;
  onDeleteCandidate: (id: string) => void;
  onAddPageIdChange: (id: string) => void;
  onAddCandidate: () => void;
}) {
  return (
    <div className="grid content-start gap-4">
      <div className="grid gap-3 rounded-xl border border-field-border bg-field-soft/45 p-3">
        <div>
          <p className="text-sm font-black text-field-primary">첫 콘티 칸 기준</p>
          <p className="text-[11px] font-bold leading-5 text-field-muted">첫 페이지에서 콘티 그림 열만 잡으세요. 사각형은 이동·재지정·오른쪽 아래 핸들 크기 조절이 가능합니다.</p>
        </div>
        {referencePage ? <CropSelector page={referencePage} value={crop} disabled={isSaving} onChange={onCropChange} label="첫 콘티 칸 crop 기준" /> : null}
        <CropNumbers crop={crop} />
        <label className="inline-flex items-center gap-2 text-xs font-black text-field-primary">
          <input type="checkbox" checked={useSecondCrop} onChange={(event) => onUseSecondCropChange(event.target.checked)} />
          두 번째 콘티 칸으로 행 간격 지정
        </label>
        {useSecondCrop && referencePage ? (
          <>
            <CropSelector page={referencePage} value={secondCrop} disabled={isSaving} onChange={onSecondCropChange} label="두 번째 콘티 칸 crop 기준" />
            <CropNumbers crop={secondCrop} />
          </>
        ) : (
          <label className="grid gap-1 text-xs font-black text-field-muted">
            반복 행 간격 {Math.round(manualRowStep * 100)}%
            <input
              type="range"
              min="0.03"
              max="0.5"
              step="0.005"
              value={manualRowStep}
              onChange={(event) => onManualRowStepChange(Number(event.target.value))}
            />
          </label>
        )}
        <button type="button" onClick={onRegenerate} disabled={isSaving} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-field-primary bg-white px-4 text-xs font-black text-field-primary">
          <RotateCcw className="h-4 w-4" aria-hidden />
          같은 위치 반복 후보 만들기
        </button>
      </div>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-black text-field-primary">반복 crop 후보</p>
            <p className="text-[11px] font-bold text-field-muted">범위를 벗어난 후보는 만들지 않습니다. 삭제·추가·개별 수정 후 저장하세요.</p>
          </div>
          <div className="flex items-center gap-1">
            <select value={addPageId} onChange={(event) => onAddPageIdChange(event.target.value)} className="min-h-9 rounded-full border border-field-border bg-white px-2 text-xs">
              {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
            </select>
            <button type="button" onClick={onAddCandidate} className="grid h-9 w-9 place-items-center rounded-full border border-field-border text-field-primary" aria-label="crop 후보 추가">
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {candidates.map((candidate, index) => (
            <article key={candidate.id} className={`grid gap-1 border bg-white p-1.5 ${editingCandidate?.id === candidate.id ? "border-field-primary ring-2 ring-field-primary/20" : "border-field-border"}`}>
              <button type="button" onClick={() => onEditCandidate(candidate.id)} className="grid gap-1 text-left">
                <CropCandidatePreview candidate={candidate} />
                <span className="truncate px-1 text-[10px] font-bold text-field-muted">{index + 1}. {candidate.page.name}</span>
              </button>
              <button type="button" onClick={() => onDeleteCandidate(candidate.id)} className="inline-flex min-h-8 items-center justify-center gap-1 rounded-full text-[10px] font-black text-field-danger">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                후보 삭제
              </button>
            </article>
          ))}
        </div>
        {editingCandidate ? (
          <div className="grid gap-2 border border-field-primary bg-white p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-field-primary">개별 후보 수정 · {editingCandidate.page.name}</p>
              <button type="button" onClick={() => onEditCandidate(null)} className="grid h-8 w-8 place-items-center rounded-full border border-field-border" aria-label="개별 수정 닫기"><X className="h-4 w-4" aria-hidden /></button>
            </div>
            <CropSelector
              page={editingCandidate.page}
              value={editingCandidate.crop}
              disabled={isSaving}
              onChange={(nextCrop) => onCandidateChange(editingCandidate.id, nextCrop)}
              label={`${editingCandidate.page.name} 개별 crop`}
            />
            <CropNumbers crop={editingCandidate.crop} />
          </div>
        ) : null}
      </div>
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
        <button
          type="button"
          onClick={() => onSelectedIdsChange(selectedCount === pages.length ? new Set() : new Set(pages.map((page) => page.id)))}
          className="min-h-9 rounded-full border border-field-border px-3 text-xs font-black text-field-primary"
        >
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
              <img src={page.previewUrl} alt={`${page.index + 1}페이지 미리보기`} className="block aspect-[4/3] h-auto w-full rounded-none object-contain" />
              <span className="truncate px-1 text-[11px] font-bold text-field-muted">{page.index + 1}. {page.name}</span>
              {selected ? <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-field-primary text-white"><Check className="h-4 w-4" aria-hidden /></span> : null}
            </button>
          );
        })}
      </div>
      <div className="grid gap-2 rounded-xl border border-field-border bg-field-soft/45 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-black text-field-primary">페이지 crop</p>
            <p className="text-[11px] font-bold text-field-muted">선택한 페이지에 같은 상대 좌표를 적용합니다.</p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-black text-field-primary">
            <input type="checkbox" checked={applyCrop} onChange={(event) => onApplyCropChange(event.target.checked)} />
            적용
          </label>
        </div>
        {referencePage ? <CropSelector page={referencePage} value={crop} disabled={!applyCrop || isSaving} onChange={onCropChange} label="부감도 페이지 crop" /> : null}
        <CropNumbers crop={crop} />
      </div>
    </div>
  );
}

function CropCandidatePreview({ candidate }: { candidate: StoryboardCropCandidate }) {
  return (
    <div className="relative w-full border border-field-border bg-black/5" style={{ aspectRatio: `${candidate.page.width} / ${candidate.page.height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={candidate.page.previewUrl} alt="" className="block h-full w-full rounded-none object-fill" />
      <div
        className="pointer-events-none absolute border-2 border-[#ef8f39] bg-[#ef8f39]/12"
        style={{
          left: `${candidate.crop.x * 100}%`,
          top: `${candidate.crop.y * 100}%`,
          width: `${candidate.crop.width * 100}%`,
          height: `${candidate.crop.height * 100}%`
        }}
      />
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
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: point.x,
      startY: point.y,
      original: { ...value }
    };
    if (mode === "create") onChange({ x: point.x, y: point.y, width: 0.01, height: 0.01 });
  }

  return (
    <div
      ref={frameRef}
      className={`relative w-full border border-field-border bg-black/5 ${disabled ? "" : "touch-none cursor-crosshair"}`}
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
      aria-label={label}
      onPointerDown={(event) => startDrag(event, "create")}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const point = relativePoint(event);
        if (drag.mode === "move") {
          const deltaX = point.x - drag.startX;
          const deltaY = point.y - drag.startY;
          onChange({
            ...drag.original,
            x: Math.min(1 - drag.original.width, Math.max(0, drag.original.x + deltaX)),
            y: Math.min(1 - drag.original.height, Math.max(0, drag.original.y + deltaY))
          });
          return;
        }
        if (drag.mode === "resize") {
          onChange({
            ...drag.original,
            width: Math.max(0.01, Math.min(1 - drag.original.x, point.x - drag.original.x)),
            height: Math.max(0.01, Math.min(1 - drag.original.y, point.y - drag.original.y))
          });
          return;
        }
        onChange({
          x: Math.min(drag.startX, point.x),
          y: Math.min(drag.startY, point.y),
          width: Math.max(0.01, Math.abs(point.x - drag.startX)),
          height: Math.max(0.01, Math.abs(point.y - drag.startY))
        });
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={page.previewUrl} alt={label} className="pointer-events-none block h-full w-full select-none rounded-none object-fill" />
      {hasCrop(value) ? (
        <div
          className="absolute cursor-move border-2 border-[#ef8f39] bg-[#ef8f39]/10 shadow-[0_0_0_999px_rgba(0,0,0,0.22)]"
          style={{
            left: `${value.x * 100}%`,
            top: `${value.y * 100}%`,
            width: `${value.width * 100}%`,
            height: `${value.height * 100}%`
          }}
          onPointerDown={(event) => startDrag(event, "move")}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label="crop 크기 조절"
            className="absolute -bottom-2 -right-2 h-5 w-5 cursor-se-resize border-2 border-white bg-[#ef8f39]"
            onPointerDown={(event) => startDrag(event, "resize")}
          />
        </div>
      ) : null}
    </div>
  );
}

function hasCrop(value: RelativeCrop) {
  return value.width > 0 && value.height > 0;
}

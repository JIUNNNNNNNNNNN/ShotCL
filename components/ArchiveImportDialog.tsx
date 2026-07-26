"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Crop, FileImage, Save, X } from "lucide-react";
import type { ArchiveImportPage, RelativeCrop } from "@/lib/client/archiveMedia";
import type { ProjectReferenceAssetType } from "@/lib/types";

export type ArchiveImportCommit = {
  selectedPages: ArchiveImportPage[];
  crop: RelativeCrop;
  applyCrop: boolean;
  title: string;
  memo: string;
  sceneNo: string;
  cutNo: string;
};

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
  const [crop, setCrop] = useState<RelativeCrop>({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
  const [applyCrop, setApplyCrop] = useState(assetType === "storyboard");
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [sceneNo, setSceneNo] = useState("");
  const [cutNo, setCutNo] = useState("");
  const selectedPages = useMemo(
    () => pages.filter((page) => selectedIds.has(page.id)),
    [pages, selectedIds]
  );
  const referencePage = pages[0] ?? null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`${assetType === "overhead" ? "부감도" : "콘티"} 가져오기`}>
      <section className="flex max-h-[96dvh] w-full max-w-6xl flex-col rounded-t-2xl border border-field-border bg-white shadow-[0_18px_54px_rgba(20,32,27,0.2)] sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-field-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display truncate text-lg font-black text-field-primary">{assetType === "overhead" ? "부감도" : "콘티"} 가져오기</h2>
            <p className="truncate text-xs font-bold text-field-muted">{sourceLabel} · {pages.length}페이지/이미지</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} className="grid h-10 w-10 place-items-center rounded-full border border-field-border text-field-muted" aria-label="가져오기 닫기">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <div className="grid content-start gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-black text-field-primary">저장할 페이지 선택</p>
              <button
                type="button"
                onClick={() => setSelectedIds(selectedIds.size === pages.length ? new Set() : new Set(pages.map((page) => page.id)))}
                className="min-h-9 rounded-full border border-field-border px-3 text-xs font-black text-field-primary"
              >
                {selectedIds.size === pages.length ? "전체 해제" : "전체 선택"}
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
                    onClick={() => setSelectedIds((current) => {
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
          </div>

          <div className="grid content-start gap-3">
            <div className="grid gap-2 rounded-xl border border-field-border bg-field-soft/45 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-field-primary">첫 장 기준 crop</p>
                  <p className="text-[11px] font-bold text-field-muted">상대 좌표를 선택한 모든 장에 동일하게 적용합니다.</p>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-black text-field-primary">
                  <input type="checkbox" checked={applyCrop} onChange={(event) => setApplyCrop(event.target.checked)} />
                  적용
                </label>
              </div>
              {referencePage ? (
                <CropSelector page={referencePage} value={crop} disabled={!applyCrop || isSaving} onChange={setCrop} />
              ) : null}
              <div className="grid grid-cols-4 gap-1 text-[10px] font-bold text-field-muted">
                <span>x {Math.round(crop.x * 100)}%</span>
                <span>y {Math.round(crop.y * 100)}%</span>
                <span>w {Math.round(crop.width * 100)}%</span>
                <span>h {Math.round(crop.height * 100)}%</span>
              </div>
            </div>

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
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-field-border px-4 py-3">
          <p className="inline-flex items-center gap-1 text-xs font-bold text-field-muted">
            {applyCrop ? <Crop className="h-4 w-4" aria-hidden /> : <FileImage className="h-4 w-4" aria-hidden />}
            {selectedPages.length}개 결과 저장
          </p>
          <button
            type="button"
            disabled={isSaving || selectedPages.length === 0}
            onClick={() => onSave({ selectedPages, crop, applyCrop, title, memo, sceneNo, cutNo })}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-field-primary px-5 text-sm font-black text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" aria-hidden />
            {isSaving ? "저장 중" : "선택 자료 저장"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function CropSelector({
  page,
  value,
  disabled,
  onChange
}: {
  page: ArchiveImportPage;
  value: RelativeCrop;
  disabled: boolean;
  onChange: (value: RelativeCrop) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

  function relativePoint(event: React.PointerEvent) {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  }

  return (
    <div
      ref={frameRef}
      className={`relative w-full border border-field-border bg-black/5 ${disabled ? "" : "touch-none cursor-crosshair"}`}
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
      onPointerDown={(event) => {
        if (disabled) return;
        const point = relativePoint(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startX: point.x, startY: point.y };
        onChange({ x: point.x, y: point.y, width: 0.01, height: 0.01 });
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const point = relativePoint(event);
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
      <img src={page.previewUrl} alt="첫 장 crop 기준" className="pointer-events-none block h-full w-full select-none rounded-none object-fill" />
      {applySafeCrop(value) ? (
        <div
          className="pointer-events-none absolute border-2 border-[#ef8f39] bg-[#ef8f39]/10 shadow-[0_0_0_999px_rgba(0,0,0,0.22)]"
          style={{
            left: `${value.x * 100}%`,
            top: `${value.y * 100}%`,
            width: `${value.width * 100}%`,
            height: `${value.height * 100}%`
          }}
        />
      ) : null}
    </div>
  );
}

function applySafeCrop(value: RelativeCrop) {
  return value.width > 0 && value.height > 0;
}

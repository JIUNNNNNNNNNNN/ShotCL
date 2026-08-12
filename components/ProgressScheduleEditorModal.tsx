"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { ImageIcon, Save, X } from "lucide-react";
import { AutosaveStatus } from "@/components/AutosaveStatus";
import { Button } from "@/components/ui/Button";
import { useAutosave } from "@/hooks/useAutosave";
import { getAutosaveDraft } from "@/lib/client/autosaveDraftCache";
import { getDailyPlanAdditionalScheduleDisplay } from "@/lib/dailyPlan/additionalSchedule";
import type { DailyPlanMealTime } from "@/lib/types";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

export type ProgressScheduleEditorValues = {
  progressMemo: string;
  imageUrl: string | null;
  imageFile: File | null;
};

type ProgressScheduleEditorModalProps = {
  item: DailyPlanMealTime;
  readOnly: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave?: (values: ProgressScheduleEditorValues) => void | Promise<void>;
  onAutoSaveMemo?: (memo: string) => Promise<void>;
  onDeleteImage?: (imageUrl: string) => void;
};

/** 기타일정의 그림과 진행 메모만 명시적으로 저장하는 작은 팝업입니다. */
export function ProgressScheduleEditorModal({
  item,
  readOnly,
  isSaving,
  onClose,
  onSave,
  onAutoSaveMemo,
  onDeleteImage
}: ProgressScheduleEditorModalProps) {
  const memoScopeKey = `progress-schedule-memo:${item.id}`;
  const [values, setValues] = useState<ProgressScheduleEditorValues>(() => ({
    progressMemo: getAutosaveDraft<string>(memoScopeKey)?.value ?? item.progressMemo ?? "",
    imageUrl: item.imageUrl ?? null,
    imageFile: null
  }));
  const [temporaryImageUrl, setTemporaryImageUrl] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const initialFingerprint = JSON.stringify({
    imageUrl: item.imageUrl ?? null,
    imageFile: null
  });
  const currentFingerprint = JSON.stringify({
    imageUrl: values.imageUrl,
    imageFile: values.imageFile
      ? `${values.imageFile.name}:${values.imageFile.size}:${values.imageFile.lastModified}`
      : null
  });
  useUnsavedChangesGuard(!readOnly && currentFingerprint !== initialFingerprint);
  const memoAutosave = useAutosave<string>({
    value: values.progressMemo,
    enabled: Boolean(!readOnly && onAutoSaveMemo && !isComposing),
    delayMs: 850,
    scopeKey: memoScopeKey,
    initialSavedFingerprint: JSON.stringify(item.progressMemo ?? ""),
    restoreDraft: (memo) => {
      setValues((current) => ({ ...current, progressMemo: memo }));
    },
    save: async (memo) => {
      await onAutoSaveMemo?.(memo);
    }
  });

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeEditor();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  useEffect(() => () => {
    if (temporaryImageUrl) URL.revokeObjectURL(temporaryImageUrl);
  }, [temporaryImageUrl]);

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

    const nextUrl = URL.createObjectURL(file);
    setTemporaryImageUrl(nextUrl);
    setValues((current) => ({ ...current, imageFile: file, imageUrl: nextUrl }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    // Memo persistence is independent; do not delay an explicit image upload
    // while a background text mutation is still in flight.
    void memoAutosave.flush();
    await onSave?.(values);
  }

  function closeEditor() {
    if (!readOnly) void memoAutosave.flush();
    onClose();
  }

  function deleteImage() {
    const imageUrl = values.imageUrl;
    if (!imageUrl) return;
    setValues((current) => ({ ...current, imageFile: null, imageUrl: null }));
    if (values.imageFile) return;
    onDeleteImage?.(imageUrl);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={readOnly ? "기타일정 그림과 메모 보기" : "기타일정 그림과 메모 수정"}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeEditor();
      }}
    >
      <form
        onSubmit={handleSubmit}
        onBlurCapture={() => {
          if (!isComposing) void memoAutosave.flush();
        }}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onPointerDown={(event) => event.stopPropagation()}
        className="mx-auto max-h-[72dvh] w-full max-w-[26rem] overflow-y-auto border border-field-border bg-field-dialog p-3 shadow-dialog"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="sr-only">{readOnly ? "기타일정 보기" : "기타일정 수정"}</span>
          <Button
            variant="ghost"
            onClick={closeEditor}
            aria-label="팝업 닫기"
            className="ml-auto !h-8 !min-h-8 !w-8 !border-0 !bg-transparent !px-0 !py-0"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <span className="text-[11px] font-bold text-field-subtle">그림</span>
            {values.imageUrl ? (
              <div className="flex max-h-44 w-full items-center justify-center overflow-hidden bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={values.imageUrl}
                  alt={`${getDailyPlanAdditionalScheduleDisplay(item)} 그림`}
                  className="block max-h-44 w-full object-contain"
                />
              </div>
            ) : (
              <div className="grid min-h-20 place-items-center border border-field-border bg-black text-[11px] text-field-muted">
                <span className="grid place-items-center gap-1">
                  <ImageIcon className="h-5 w-5" aria-hidden />
                  그림 없음
                </span>
              </div>
            )}

            {!readOnly ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex min-h-9 cursor-pointer items-center justify-center border border-field-border bg-field-input px-2 text-xs font-bold text-field-text transition-colors hover:bg-field-hover">
                  이미지 선택
                  <input type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={handleImageChange} />
                </label>
                <Button
                  variant="ghost"
                  onClick={deleteImage}
                  disabled={!values.imageUrl}
                  className="!min-h-9 py-1 text-xs"
                >
                  이미지 삭제
                </Button>
              </div>
            ) : null}
          </div>

          <label className="grid gap-1.5">
            <span className="text-[11px] font-bold text-field-subtle">메모</span>
            <textarea
              value={values.progressMemo}
              readOnly={readOnly}
              rows={3}
              maxLength={2000}
              onChange={(event) => setValues((current) => ({ ...current, progressMemo: event.target.value }))}
              className="min-h-20 w-full resize-none border border-field-border bg-field-input px-3 py-2 text-sm leading-5 text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/20"
            />
          </label>
        </div>

        {!readOnly ? (
          <div className="mt-3 grid gap-2">
            <AutosaveStatus status={memoAutosave.status} onRetry={memoAutosave.retry} />
            <Button type="submit" disabled={isSaving} className="w-full">
              <Save className="h-4 w-4" aria-hidden />
              그림 저장
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}

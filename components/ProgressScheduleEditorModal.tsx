"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { ImageIcon, Save, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { DailyPlanMealTime } from "@/lib/types";

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
  onSave?: (values: ProgressScheduleEditorValues) => void;
};

/** 기타일정의 그림과 진행 메모만 명시적으로 저장하는 작은 팝업입니다. */
export function ProgressScheduleEditorModal({
  item,
  readOnly,
  isSaving,
  onClose,
  onSave
}: ProgressScheduleEditorModalProps) {
  const [values, setValues] = useState<ProgressScheduleEditorValues>({
    progressMemo: item.progressMemo ?? "",
    imageUrl: item.imageUrl ?? null,
    imageFile: null
  });
  const [temporaryImageUrl, setTemporaryImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!readOnly) onSave?.(values);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/15 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={readOnly ? "기타일정 그림과 메모 보기" : "기타일정 그림과 메모 수정"}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        onPointerDown={(event) => event.stopPropagation()}
        className="mx-auto max-h-[72dvh] w-full max-w-[26rem] overflow-y-auto rounded-[1rem] bg-[#fff8dc] p-3 shadow-[0_12px_32px_rgba(20,32,27,0.16)]"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="sr-only">{readOnly ? "기타일정 보기" : "기타일정 수정"}</span>
          <Button
            variant="ghost"
            onClick={onClose}
            aria-label="팝업 닫기"
            className="ml-auto !h-8 !min-h-8 !w-8 !border-0 !bg-transparent !px-0 !py-0"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <span className="text-[11px] font-black text-[#64551f]">그림</span>
            {values.imageUrl ? (
              <div className="flex max-h-44 w-full items-center justify-center overflow-hidden rounded-none bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={values.imageUrl}
                  alt={`${item.memo.trim() || "기타일정"} 그림`}
                  className="block max-h-44 w-full rounded-none object-contain"
                />
              </div>
            ) : (
              <div className="grid min-h-20 place-items-center rounded-none bg-white text-[11px] font-black text-field-muted">
                <span className="grid place-items-center gap-1">
                  <ImageIcon className="h-5 w-5" aria-hidden />
                  그림 없음
                </span>
              </div>
            )}

            {!readOnly ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-[#d9bd59] bg-white px-2 text-xs font-black text-field-primary">
                  이미지 선택
                  <input type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={handleImageChange} />
                </label>
                <Button
                  variant="ghost"
                  onClick={() => setValues((current) => ({ ...current, imageFile: null, imageUrl: null }))}
                  disabled={!values.imageUrl}
                  className="!min-h-9 !border-[#d9bd59] py-1 text-xs"
                >
                  이미지 삭제
                </Button>
              </div>
            ) : null}
          </div>

          <label className="grid gap-1.5">
            <span className="text-[11px] font-black text-[#64551f]">메모</span>
            <textarea
              value={values.progressMemo}
              readOnly={readOnly}
              rows={3}
              maxLength={2000}
              onChange={(event) => setValues((current) => ({ ...current, progressMemo: event.target.value }))}
              className="min-h-20 w-full resize-none rounded-md border border-[#d9bd59] bg-white px-3 py-2 text-sm leading-5 text-field-text outline-none focus:border-field-primary"
            />
          </label>
        </div>

        {!readOnly ? (
          <Button type="submit" disabled={isSaving} className="mt-3 w-full">
            <Save className="h-4 w-4" aria-hidden />
            저장
          </Button>
        ) : null}
      </form>
    </div>
  );
}

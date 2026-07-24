"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { ImageIcon, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Shot, ShotStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ShotEditorValues = {
  sceneNumber: string;
  cutNumber: string;
  title: string;
  description: string;
  location: string;
  charactersText: string;
  memo: string;
  orderIndex: number;
  status: ShotStatus;
  storyboardImageUrl: string | null;
  imageFile: File | null;
};

type ShotEditorModalProps = {
  mode: "add" | "edit";
  open: boolean;
  shot: Shot | null;
  defaultOrderIndex: number;
  isSaving: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onSave?: (values: ShotEditorValues) => void;
  onDelete?: (shot: Shot) => void;
};

const fieldClass =
  "min-h-11 w-full rounded-md border border-field-border bg-white px-3 py-2 text-base text-field-text outline-none focus:border-field-primary";
const textareaClass = `${fieldClass} resize-none leading-6`;

function emptyValues(orderIndex: number): ShotEditorValues {
  return {
    sceneNumber: "",
    cutNumber: "",
    title: "",
    description: "",
    location: "",
    charactersText: "",
    memo: "",
    orderIndex,
    status: "pending",
    storyboardImageUrl: null,
    imageFile: null
  };
}

function valuesFromShot(shot: Shot): ShotEditorValues {
  return {
    sceneNumber: shot.sceneNumber,
    cutNumber: shot.cutNumber,
    title: shot.title,
    description: shot.description,
    location: shot.location,
    charactersText: shot.characters.join(", "),
    memo: shot.memo,
    orderIndex: shot.orderIndex,
    status: shot.status,
    storyboardImageUrl: shot.storyboardImageUrl,
    imageFile: null
  };
}

/** 컷 추가 화면과 진행 카드 위의 작은 내용 편집 팝업을 함께 제공합니다. */
export function ShotEditorModal({
  mode,
  open,
  shot,
  defaultOrderIndex,
  isSaving,
  readOnly = false,
  onClose,
  onSave,
  onDelete
}: ShotEditorModalProps) {
  const [values, setValues] = useState<ShotEditorValues>(() => emptyValues(defaultOrderIndex));

  useEffect(() => {
    if (!open) return;
    setValues(shot ? valuesFromShot(shot) : emptyValues(defaultOrderIndex));
  }, [defaultOrderIndex, open, shot]);

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);

  if (!open) return null;

  function updateField<K extends keyof ShotEditorValues>(field: K, value: ShotEditorValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) return;
    updateField("imageFile", file);
    updateField("storyboardImageUrl", URL.createObjectURL(file));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!readOnly) onSave?.(values);
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex p-3",
        mode === "add"
          ? "items-end bg-black/35 sm:items-center sm:p-4"
          : "items-center justify-center bg-black/15"
      )}
      role="dialog"
      aria-modal="true"
      aria-label={mode === "add" ? "새 컷 추가" : readOnly ? "컷 내용 보기" : "컷 내용 수정"}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        onPointerDown={(event) => event.stopPropagation()}
        className={cn(
          "w-full overflow-y-auto bg-field-soft shadow-[0_12px_32px_rgba(20,32,27,0.16)]",
          mode === "add"
            ? "max-h-[92dvh] rounded-t-2xl p-4 sm:mx-auto sm:max-w-3xl sm:rounded-2xl"
            : "mx-auto max-h-[72dvh] max-w-[26rem] rounded-[1rem] p-3"
        )}
      >
        <div className={cn("mx-auto", mode === "add" && "max-w-3xl")}>
          <div className={cn("flex items-center justify-between gap-2", mode === "add" ? "mb-4" : "mb-1")}>
            {mode === "add" ? (
              <h2 className="text-lg font-black text-field-primary">새 컷 추가</h2>
            ) : (
              <span className="sr-only">{readOnly ? "컷 내용 보기" : "컷 내용 수정"}</span>
            )}
            <Button
              variant="ghost"
              onClick={onClose}
              aria-label="팝업 닫기"
              className="ml-auto !h-8 !min-h-8 !w-8 !border-0 !px-0 !py-0"
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <div className={cn("grid", mode === "add" ? "gap-3" : "gap-2")}>
            <div className={cn("grid gap-1.5", mode === "edit" && readOnly && !values.storyboardImageUrl && "hidden")}>
              <span className="text-[11px] font-black text-field-muted">콘티</span>
              <div className={cn(
                "grid items-center gap-2",
                readOnly ? "grid-cols-1" : mode === "add" ? "grid-cols-[96px_1fr]" : "grid-cols-[80px_1fr]"
              )}>
                <div className={cn(
                  "flex aspect-[4/3] items-center justify-center rounded-none text-[11px] font-black text-field-muted",
                  readOnly ? "w-full max-w-[11rem] justify-self-center" : mode === "add" ? "w-24" : "w-20"
                )}>
                  {values.storyboardImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={values.storyboardImageUrl} alt="콘티 미리보기" className="block h-full max-h-full w-full max-w-full rounded-none object-contain" />
                  ) : (
                    <span className="grid place-items-center gap-1">
                      <ImageIcon className="h-5 w-5" aria-hidden />
                      콘티 없음
                    </span>
                  )}
                </div>
                {!readOnly ? <div className="grid gap-1.5">
                  <label className="flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-field-border bg-white px-2 text-xs font-black text-field-primary">
                    이미지 선택
                    <input type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={handleImageChange} />
                  </label>
                  {values.storyboardImageUrl ? (
                    <Button variant="ghost" onClick={() => updateField("storyboardImageUrl", null)} className="!min-h-9 py-1 text-xs">
                      이미지 삭제
                    </Button>
                  ) : null}
                </div> : null}
              </div>
            </div>

            {mode === "add" ? <div className="grid grid-cols-3 gap-3">
              <label className="grid gap-2">
                <span className="text-xs font-black text-field-muted">씬 번호</span>
                <input
                  value={values.sceneNumber}
                  readOnly={readOnly}
                  onChange={(event) => updateField("sceneNumber", event.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-black text-field-muted">컷 번호</span>
                <input
                  value={values.cutNumber}
                  readOnly={readOnly}
                  onChange={(event) => updateField("cutNumber", event.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-black text-field-muted">순서</span>
                <input
                  type="number"
                  min={1}
                  value={values.orderIndex}
                  onChange={(event) => updateField("orderIndex", Number(event.target.value) || 1)}
                  className={fieldClass}
                />
              </label>
            </div> : null}

            {mode === "add" ? <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">제목</span>
              <input required value={values.title} onChange={(event) => updateField("title", event.target.value)} className={fieldClass} />
            </label> : null}

            <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">컷 내용</span>
              <textarea
                value={values.description}
                readOnly={readOnly}
                rows={mode === "add" ? 5 : 3}
                onChange={(event) => updateField("description", event.target.value)}
                className={cn(textareaClass, mode === "edit" && "min-h-20 py-2 text-sm leading-5")}
              />
            </label>

            {mode === "add" ? <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">장소</span>
              <input
                value={values.location}
                readOnly={readOnly}
                onChange={(event) => updateField("location", event.target.value)}
                className={fieldClass}
              />
            </label> : null}

            <label className={cn("grid", mode === "add" ? "gap-2" : "gap-1.5")}>
              <span className={cn("font-black text-field-muted", mode === "add" ? "text-xs" : "text-[11px]")}>등장인물</span>
              <input
                value={values.charactersText}
                readOnly={readOnly}
                onChange={(event) => updateField("charactersText", event.target.value)}
                placeholder="주인공, 상대역"
                className={cn(fieldClass, mode === "edit" && "min-h-9 py-1 text-sm")}
              />
            </label>

            {mode === "add" ? <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">메모</span>
              <textarea value={values.memo} rows={2} onChange={(event) => updateField("memo", event.target.value)} className={textareaClass} />
            </label> : null}

            {mode === "add" ? <div className="grid gap-2">
              <span className="text-xs font-black text-field-muted">상태</span>
              <div className="grid grid-cols-3 gap-2">
                {(["pending", "ok", "omit"] as ShotStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => updateField("status", status)}
                    className={
                      values.status === status
                        ? "min-h-11 rounded-md bg-field-primary text-sm font-black text-white"
                        : "min-h-11 rounded-md border border-field-border bg-white text-sm font-black text-field-muted"
                    }
                  >
                    {status === "pending" ? "대기" : status}
                  </button>
                ))}
              </div>
            </div> : null}
          </div>

          {!readOnly ? <div className={cn("grid grid-cols-2 gap-2", mode === "add" ? "mt-5" : "mt-3")}>
            <Button
              type="submit"
              disabled={isSaving || (mode === "add" && !values.title.trim())}
              className={mode === "edit" && shot && onDelete ? "" : "col-span-2"}
            >
              <Save className="h-4 w-4" aria-hidden />
              저장
            </Button>

            {mode === "edit" && shot && onDelete ? (
              <Button variant="danger" onClick={() => onDelete(shot)} disabled={isSaving}>
                <Trash2 className="h-4 w-4" aria-hidden />
                삭제
              </Button>
            ) : null}
          </div> : null}
        </div>
      </form>
    </div>
  );
}

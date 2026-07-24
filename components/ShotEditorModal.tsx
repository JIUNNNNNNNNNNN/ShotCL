"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { ImageIcon, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Shot, ShotStatus } from "@/lib/types";

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

/** 컷 추가와 수정에 함께 쓰는 모바일 bottom sheet입니다. */
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
      className="fixed inset-0 z-50 flex items-end bg-black/35 sm:items-center sm:p-4"
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
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-field-soft p-4 shadow-2xl sm:mx-auto sm:max-w-3xl sm:rounded-2xl"
      >
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="text-lg font-black text-field-primary">
              {mode === "add" ? "새 컷 추가" : readOnly ? "컷 내용 보기" : "컷 내용 수정"}
            </h2>
            <Button variant="ghost" onClick={onClose} className="px-3">
              <X className="h-4 w-4" aria-hidden />
              닫기
            </Button>
          </div>

          <div className="grid gap-3">
            <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">콘티 이미지</span>
              <div className="grid grid-cols-[96px_1fr] gap-3">
                <div className="flex aspect-[4/3] w-24 items-center justify-center border border-field-border bg-white text-xs font-black text-field-muted">
                  {values.storyboardImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={values.storyboardImageUrl} alt="콘티 미리보기" className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid place-items-center gap-1">
                      <ImageIcon className="h-5 w-5" aria-hidden />
                      콘티 없음
                    </span>
                  )}
                </div>
                {!readOnly ? <div className="grid gap-2">
                  <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-field-border bg-white px-3 text-sm font-black text-field-primary">
                    이미지 선택
                    <input type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={handleImageChange} />
                  </label>
                  {values.storyboardImageUrl ? (
                    <Button variant="ghost" onClick={() => updateField("storyboardImageUrl", null)} className="min-h-10">
                      이미지 삭제
                    </Button>
                  ) : null}
                </div> : <div />}
              </div>
            </label>

            <div className={mode === "add" ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-3"}>
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
              {mode === "add" ? <label className="grid gap-2">
                <span className="text-xs font-black text-field-muted">순서</span>
                <input
                  type="number"
                  min={1}
                  value={values.orderIndex}
                  onChange={(event) => updateField("orderIndex", Number(event.target.value) || 1)}
                  className={fieldClass}
                />
              </label> : null}
            </div>

            {mode === "add" ? <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">제목</span>
              <input required value={values.title} onChange={(event) => updateField("title", event.target.value)} className={fieldClass} />
            </label> : null}

            <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">컷 내용</span>
              <textarea
                value={values.description}
                readOnly={readOnly}
                rows={5}
                onChange={(event) => updateField("description", event.target.value)}
                className={textareaClass}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">장소</span>
              <input
                value={values.location}
                readOnly={readOnly}
                onChange={(event) => updateField("location", event.target.value)}
                className={fieldClass}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">등장 인물</span>
              <input
                value={values.charactersText}
                readOnly={readOnly}
                onChange={(event) => updateField("charactersText", event.target.value)}
                placeholder="주인공, 상대역"
                className={fieldClass}
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

          {!readOnly ? <div className="mt-5 grid grid-cols-2 gap-2">
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

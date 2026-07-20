"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ImageIcon, Save, Trash2, X } from "lucide-react";
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
  onClose: () => void;
  onSave: (values: ShotEditorValues) => void;
  onDelete?: (shot: Shot) => void;
  onMove?: (shot: Shot, direction: "up" | "down") => void;
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
  onClose,
  onSave,
  onDelete,
  onMove
}: ShotEditorModalProps) {
  const [values, setValues] = useState<ShotEditorValues>(() => emptyValues(defaultOrderIndex));

  useEffect(() => {
    if (!open) return;
    setValues(shot ? valuesFromShot(shot) : emptyValues(defaultOrderIndex));
  }, [defaultOrderIndex, open, shot]);

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
    onSave(values);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/35" role="dialog" aria-modal="true">
      <form onSubmit={handleSubmit} className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-field-soft p-4 shadow-2xl">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-field-muted">{mode === "add" ? "새 컷 추가" : "컷 수정"}</p>
              <h2 className="mt-1 text-xl font-black text-field-primary">{values.title || "제목 없음"}</h2>
            </div>
            <Button variant="ghost" onClick={onClose} className="px-3">
              <X className="h-4 w-4" aria-hidden />
              닫기
            </Button>
          </div>

          <div className="grid gap-3">
            <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">콘티 이미지</span>
              <div className="grid grid-cols-[96px_1fr] gap-3">
                <div className="flex aspect-[4/3] w-24 items-center justify-center overflow-hidden rounded-md border border-field-border bg-white text-xs font-black text-field-muted">
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
                <div className="grid gap-2">
                  <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-field-border bg-white px-3 text-sm font-black text-field-primary">
                    이미지 선택
                    <input type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={handleImageChange} />
                  </label>
                  {values.storyboardImageUrl ? (
                    <Button variant="ghost" onClick={() => updateField("storyboardImageUrl", null)} className="min-h-10">
                      이미지 삭제
                    </Button>
                  ) : null}
                </div>
              </div>
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="grid gap-2">
                <span className="text-xs font-black text-field-muted">씬 번호</span>
                <input value={values.sceneNumber} onChange={(event) => updateField("sceneNumber", event.target.value)} className={fieldClass} />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-black text-field-muted">컷 번호</span>
                <input value={values.cutNumber} onChange={(event) => updateField("cutNumber", event.target.value)} className={fieldClass} />
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
            </div>

            <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">제목</span>
              <input required value={values.title} onChange={(event) => updateField("title", event.target.value)} className={fieldClass} />
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">설명</span>
              <textarea value={values.description} rows={3} onChange={(event) => updateField("description", event.target.value)} className={textareaClass} />
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">장소</span>
              <input value={values.location} onChange={(event) => updateField("location", event.target.value)} className={fieldClass} />
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">등장 인물</span>
              <input
                value={values.charactersText}
                onChange={(event) => updateField("charactersText", event.target.value)}
                placeholder="주인공, 상대역"
                className={fieldClass}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-black text-field-muted">메모</span>
              <textarea value={values.memo} rows={2} onChange={(event) => updateField("memo", event.target.value)} className={textareaClass} />
            </label>

            <div className="grid gap-2">
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
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {mode === "edit" && shot && onMove ? (
              <>
                <Button variant="ghost" onClick={() => onMove(shot, "up")}>
                  <ArrowUp className="h-4 w-4" aria-hidden />
                  위로
                </Button>
                <Button variant="ghost" onClick={() => onMove(shot, "down")}>
                  <ArrowDown className="h-4 w-4" aria-hidden />
                  아래로
                </Button>
              </>
            ) : null}

            <Button type="submit" disabled={isSaving || !values.title.trim()} className={mode === "edit" ? "" : "col-span-2"}>
              <Save className="h-4 w-4" aria-hidden />
              저장
            </Button>

            {mode === "edit" && shot && onDelete ? (
              <Button variant="danger" onClick={() => onDelete(shot)} disabled={isSaving}>
                <Trash2 className="h-4 w-4" aria-hidden />
                삭제
              </Button>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}

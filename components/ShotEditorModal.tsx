"use client";

import { FormEvent, useEffect, useState } from "react";
import { Save, Trash2, X } from "lucide-react";
import { AutosaveStatus } from "@/components/AutosaveStatus";
import { Button } from "@/components/ui/Button";
import { useAutosave } from "@/hooks/useAutosave";
import { getAutosaveDraft } from "@/lib/client/autosaveDraftCache";
import type { Shot, ShotStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

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
  onAutoSave?: (values: ShotEditorValues) => Promise<void>;
  onDelete?: (shot: Shot) => void;
};

const fieldClass =
  "min-h-11 w-full border border-field-border bg-field-input px-3 py-2 text-base font-normal text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-1 focus:ring-field-primary";
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
  onAutoSave,
  onDelete
}: ShotEditorModalProps) {
  const [values, setValues] = useState<ShotEditorValues>(() => (
    shot ? valuesFromShot(shot) : emptyValues(defaultOrderIndex)
  ));
  const [savedFingerprint, setSavedFingerprint] = useState(() => (
    shotEditorFingerprint(shot ? valuesFromShot(shot) : emptyValues(defaultOrderIndex))
  ));
  const [isComposing, setIsComposing] = useState(false);
  useUnsavedChangesGuard(
    open && mode === "add" && !readOnly && shotEditorFingerprint(values) !== savedFingerprint
  );

  const autosave = useAutosave<ShotEditorValues>({
    value: values,
    enabled: Boolean(open && mode === "edit" && shot && !readOnly && onAutoSave && !isComposing),
    delayMs: 700,
    scopeKey: shot?.id ?? "new-shot",
    initialSavedFingerprint: shotEditorFingerprint(
      shot ? valuesFromShot(shot) : emptyValues(defaultOrderIndex)
    ),
    restoreDraft: (draft) => setValues(draft),
    save: async (draft) => {
      await onAutoSave?.(draft);
    }
  });

  useEffect(() => {
    if (!open) return;
    const canonicalValues = shot ? valuesFromShot(shot) : emptyValues(defaultOrderIndex);
    const cached = mode === "edit" && shot
      ? getAutosaveDraft<ShotEditorValues>(shot.id)
      : null;
    const nextValues = cached?.value ?? canonicalValues;
    setValues(nextValues);
    setSavedFingerprint(shotEditorFingerprint(canonicalValues));
  }, [defaultOrderIndex, mode, open, shot]);

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeEditor();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open]);

  if (!open) return null;

  function updateField<K extends keyof ShotEditorValues>(field: K, value: ShotEditorValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    if (mode === "edit") {
      void autosave.flush();
      onClose();
      return;
    }
    onSave?.(values);
  }

  function closeEditor() {
    if (mode === "edit" && !readOnly) void autosave.flush();
    onClose();
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex p-3",
        mode === "add"
          ? "items-end bg-black/70 sm:items-center sm:p-4"
          : "items-center justify-center bg-black/70"
      )}
      role="dialog"
      aria-modal="true"
      aria-label={mode === "add" ? "새 컷 추가" : readOnly ? "컷 내용 보기" : "컷 내용 수정"}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeEditor();
      }}
    >
      <form
        onSubmit={handleSubmit}
        onBlurCapture={() => {
          if (mode === "edit" && !isComposing) void autosave.flush();
        }}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onPointerDown={(event) => event.stopPropagation()}
        className={cn(
          "w-full overflow-y-auto border border-field-divider bg-field-dialog shadow-dialog",
          mode === "add"
            ? "max-h-[92dvh] p-4 sm:mx-auto sm:max-w-3xl"
            : "mx-auto max-h-[72dvh] max-w-[26rem] p-3"
        )}
      >
        <div className={cn("mx-auto", mode === "add" && "max-w-3xl")}>
          <div className={cn("flex items-center justify-between gap-2", mode === "add" ? "mb-4" : "mb-1")}>
            {mode === "add" ? (
              <h2 className="text-lg font-bold text-field-text">새 컷 추가</h2>
            ) : (
              <span className="sr-only">{readOnly ? "컷 내용 보기" : "컷 내용 수정"}</span>
            )}
            <Button
              variant="ghost"
              onClick={closeEditor}
              aria-label="팝업 닫기"
              className="ml-auto !h-8 !min-h-8 !w-8 !border !border-field-border !bg-field-soft !px-0 !py-0 !text-field-muted hover:!border-field-divider hover:!bg-field-hover hover:!text-field-text"
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <div className={cn("grid", mode === "add" ? "gap-3" : "gap-2")}>
            {mode === "add" ? <div className="grid grid-cols-3 gap-3">
              <label className="grid gap-2">
                <span className="text-xs font-normal text-field-muted">씬 번호</span>
                <input
                  value={values.sceneNumber}
                  readOnly={readOnly}
                  onChange={(event) => updateField("sceneNumber", event.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-normal text-field-muted">컷 번호</span>
                <input
                  value={values.cutNumber}
                  readOnly={readOnly}
                  onChange={(event) => updateField("cutNumber", event.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-normal text-field-muted">순서</span>
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
              <span className="text-xs font-normal text-field-muted">제목</span>
              <input required value={values.title} onChange={(event) => updateField("title", event.target.value)} className={fieldClass} />
            </label> : null}

            <label className="grid gap-2">
              <span className="text-xs font-normal text-field-muted">컷 내용</span>
              <textarea
                value={values.description}
                readOnly={readOnly}
                rows={mode === "add" ? 5 : 3}
                onChange={(event) => updateField("description", event.target.value)}
                className={cn(textareaClass, mode === "edit" && "min-h-20 py-2 text-sm leading-5")}
              />
            </label>

            {mode === "add" ? <label className="grid gap-2">
              <span className="text-xs font-normal text-field-muted">장소</span>
              <input
                value={values.location}
                readOnly={readOnly}
                onChange={(event) => updateField("location", event.target.value)}
                className={fieldClass}
              />
            </label> : null}

            <label className={cn("grid", mode === "add" ? "gap-2" : "gap-1.5")}>
              <span className={cn("font-normal text-field-muted", mode === "add" ? "text-xs" : "text-[11px]")}>등장인물</span>
              <input
                value={values.charactersText}
                readOnly={readOnly}
                onChange={(event) => updateField("charactersText", event.target.value)}
                placeholder="주인공, 상대역"
                className={cn(fieldClass, mode === "edit" && "min-h-9 py-1 text-sm")}
              />
            </label>

            {mode === "add" ? <label className="grid gap-2">
              <span className="text-xs font-normal text-field-muted">메모</span>
              <textarea value={values.memo} rows={2} onChange={(event) => updateField("memo", event.target.value)} className={textareaClass} />
            </label> : null}

            {mode === "add" ? <div className="grid gap-2">
              <span className="text-xs font-normal text-field-muted">상태</span>
              <div className="grid grid-cols-3 gap-2">
                {(["pending", "ok", "omit"] as ShotStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => updateField("status", status)}
                    className={
                      values.status === status
                        ? "min-h-11 border border-field-primary/70 bg-field-primary/10 text-sm font-bold text-field-text"
                        : "min-h-11 border border-field-border bg-field-soft text-sm font-normal text-field-muted hover:border-field-divider hover:bg-field-hover hover:text-field-text"
                    }
                  >
                    {status === "pending" ? "대기" : status}
                  </button>
                ))}
              </div>
            </div> : null}
          </div>

          {!readOnly ? <div className={cn("grid grid-cols-2 gap-2", mode === "add" ? "mt-5" : "mt-3")}>
            {mode === "add" ? (
              <Button
                type="submit"
                disabled={isSaving || !values.title.trim()}
                className="col-span-2"
              >
                <Save className="h-4 w-4" aria-hidden />
                저장
              </Button>
            ) : (
              <div className={shot && onDelete ? "" : "col-span-2"}>
                <AutosaveStatus status={autosave.status} onRetry={autosave.retry} />
              </div>
            )}

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

function shotEditorFingerprint(values: ShotEditorValues) {
  return JSON.stringify({
    ...values,
    imageFile: values.imageFile
      ? `${values.imageFile.name}:${values.imageFile.size}:${values.imageFile.lastModified}`
      : null
  });
}

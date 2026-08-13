"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FolderOpen, ImagePlus, Save, Trash2, X } from "lucide-react";
import { AutosaveStatus } from "@/components/AutosaveStatus";
import {
  ShotArchiveSelector,
  type ShotMediaLinkMutation
} from "@/components/ShotArchivePicker";
import { ShotOverheadPreview } from "@/components/ShotOverheadPreview";
import { Button } from "@/components/ui/Button";
import { useAutosave } from "@/hooks/useAutosave";
import { getAutosaveDraft } from "@/lib/client/autosaveDraftCache";
import { getShotDiagramKey } from "@/lib/data/shotDiagrams";
import { saveShotMediaLink, type ProgressArchiveMediaAsset } from "@/lib/data/shotMediaArchive";
import { buildProgressMediaGalleryItems } from "@/lib/progress/mediaGallery";
import { hasShotOverheadContent } from "@/lib/shotOverhead";
import type { Shot, ShotMediaLink, ShotMediaType, ShotStatus } from "@/lib/types";
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

export type ShotEditorMediaContext = {
  /** project_scene_items.id. 있으면 업로드 자료의 자동 연결 메타데이터에도 보존합니다. */
  sceneId?: string | null;
  episodeNumber?: number | null;
};

export type ShotEditorModalProps = {
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
  archiveMedia?: readonly ProgressArchiveMediaAsset[];
  selectedMediaLinks?: readonly ShotMediaLink[];
  mediaContext?: ShotEditorMediaContext;
  /** 이 callback을 제공한 관리자 화면에서만 미디어 mutation control을 엽니다. */
  onMediaMutation?: (mutation: ShotMediaLinkMutation) => Promise<void> | void;
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

/** 컷 추가 화면과 canonical 내용·등장인물·미디어를 한 번에 관리하는 편집창입니다. */
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
  onDelete,
  archiveMedia = [],
  selectedMediaLinks = [],
  mediaContext,
  onMediaMutation
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
            : "mx-auto max-h-[90dvh] max-w-5xl p-3 sm:p-4"
        )}
      >
        <div className={cn("mx-auto", mode === "add" && "max-w-3xl")}>
          <div className={cn("flex items-center justify-between gap-2", mode === "add" ? "mb-4" : "mb-1")}>
            {mode === "add" ? (
              <h2 className="text-lg font-bold text-field-text">새 컷 추가</h2>
            ) : (
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-field-text">{readOnly ? "컷 내용 보기" : "컷 편집"}</h2>
                {shot ? <p className="text-xs font-normal text-field-muted">S#{shot.sceneNumber} · C#{shot.cutNumber}</p> : null}
              </div>
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

            {mode === "edit" && shot ? (
              <div className="grid gap-2 border-t border-field-divider pt-2 sm:grid-cols-2">
                <ShotEditorMediaSection
                  shot={shot}
                  mediaType="overhead"
                  archiveMedia={archiveMedia}
                  selectedMediaLinks={selectedMediaLinks}
                  readOnly={readOnly || !onMediaMutation}
                  mediaContext={mediaContext}
                  onMediaMutation={onMediaMutation}
                />
                <ShotEditorMediaSection
                  shot={shot}
                  mediaType="storyboard"
                  archiveMedia={archiveMedia}
                  selectedMediaLinks={selectedMediaLinks}
                  readOnly={readOnly || !onMediaMutation}
                  mediaContext={mediaContext}
                  onMediaMutation={onMediaMutation}
                />
              </div>
            ) : null}

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

function ShotEditorMediaSection({
  shot,
  mediaType,
  archiveMedia,
  selectedMediaLinks,
  readOnly,
  mediaContext,
  onMediaMutation
}: {
  shot: Shot;
  mediaType: ShotMediaType;
  archiveMedia: readonly ProgressArchiveMediaAsset[];
  selectedMediaLinks: readonly ShotMediaLink[];
  readOnly: boolean;
  mediaContext?: ShotEditorMediaContext;
  onMediaMutation?: (mutation: ShotMediaLinkMutation) => Promise<void> | void;
}) {
  const label = mediaType === "overhead" ? "부감도" : "스토리보드(콘티)";
  const selectedLink = selectedMediaLinks.find((link) => link.mediaType === mediaType) ?? null;
  const gallery = buildProgressMediaGalleryItems(
    archiveMedia,
    mediaType,
    mediaType === "storyboard" && shot.storyboardImageUrl ? {
      id: `${shot.id}:legacy-storyboard`,
      title: `${label} 대표 이미지`,
      url: shot.storyboardImageUrl,
      thumbnailUrl: shot.storyboardImageUrl
    } : mediaType === "overhead" && shot.overheadImageUrl ? {
      id: `${shot.id}:legacy-overhead`,
      title: `${label} 대표 이미지`,
      url: shot.overheadImageUrl,
      thumbnailUrl: shot.overheadImageUrl
    } : null
  );
  const representative = gallery[0] ?? null;
  const selectedArchiveMedia = selectedLink
    ? archiveMedia.find((asset) => asset.mediaType === mediaType && asset.id === selectedLink.assetId) ?? null
    : null;
  const diagram = mediaType === "overhead"
    ? selectedLink?.diagram ?? (!selectedLink && hasShotOverheadContent(shot.overheadDiagram) ? shot.overheadDiagram : null)
    : null;
  const imageUrl = selectedArchiveMedia?.thumbnailUrl
    || selectedLink?.publicUrl
    || representative?.thumbnailUrl
    || representative?.url
    || "";
  const currentTitle = selectedLink?.filename || representative?.title || `${label} 없음`;
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadAndLink(file: File) {
    if (readOnly || isUploading) return;
    const validationError = validateShotMediaImage(file);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsUploading(true);
    setErrorMessage("");
    try {
      const [{ optimizeArchiveImage }, { uploadProjectReferenceAsset }] = await Promise.all([
        import("@/lib/client/archiveMedia"),
        import("@/lib/data/projectReferenceAssets")
      ]);
      const optimized = await optimizeArchiveImage(file);
      const shotKey = getShotDiagramKey(shot);
      const displayName = stripFileExtension(file.name);
      const cutNumber = positiveInteger(shot.cutNumber);
      const uploaded = await uploadProjectReferenceAsset(
        shot.projectId,
        mediaType,
        optimized.displayFile,
        {
          thumbnailFile: optimized.thumbnailFile,
          sourceType: "upload_image",
          dailyPlanId: shot.dailyPlanId || undefined,
          sceneNo: shot.sceneNumber.trim() || undefined,
          cutNo: shot.cutNumber.trim() || undefined,
          shotRef: shotKey.shotRef,
          displayName,
          originalFilename: file.name,
          title: displayName,
          sceneId: mediaContext?.sceneId?.trim() || undefined,
          sceneNumber: shot.sceneNumber.trim() || undefined,
          cutNumber: cutNumber ?? undefined,
          episodeNumber: positiveInteger(mediaContext?.episodeNumber) ?? undefined
        }
      );
      await saveShotMediaLink(shot, mediaType, { assetId: uploaded.id, source: "reference" });
      const nextLink: ShotMediaLink = {
        shotRef: shotKey.shotRef,
        mediaType,
        assetId: uploaded.id,
        source: "reference",
        publicUrl: uploaded.publicUrl,
        filename: uploaded.filename,
        diagram: null
      };
      await onMediaMutation?.({ shotId: shot.id, shotRef: shotKey.shotRef, mediaType, link: nextLink });
      setArchiveOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `${label} 자료를 업로드하지 못했습니다.`);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section className="grid min-w-0 content-start gap-2 border border-field-divider bg-field-panel p-2" aria-label={`${label} 관리`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 className="truncate text-xs font-bold text-field-text">{label}</h3>
        {selectedLink ? <span className="shrink-0 text-[10px] font-bold text-field-primary">직접 연결</span> : null}
      </div>

      <div className="grid min-h-36 place-items-center overflow-hidden rounded-[var(--radius-control)] border border-field-divider bg-field-soft">
        {diagram ? (
          <ShotOverheadPreview diagram={diagram} label={`${label} 현재 연결`} />
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={currentTitle} loading="lazy" decoding="async" className="block max-h-48 h-full w-full object-contain" />
        ) : (
          <p className="px-3 text-center text-xs font-normal text-field-muted">현재 연결된 {label} 자료가 없습니다.</p>
        )}
      </div>
      <p className="truncate text-[11px] font-normal text-field-muted" title={currentTitle}>{currentTitle}</p>

      {!readOnly ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex min-h-9 items-center justify-center gap-1 border border-field-divider bg-field-input px-2 text-[11px] font-bold text-field-text hover:border-field-subtle hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:cursor-wait disabled:opacity-55"
          >
            {isUploading ? <ImagePlus className="h-3.5 w-3.5 animate-pulse" aria-hidden /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden />}
            {isUploading ? "업로드 중" : imageUrl || diagram ? "사진 교체" : "사진 추가"}
          </button>
          <button
            type="button"
            disabled={isUploading}
            onClick={() => setArchiveOpen((current) => !current)}
            aria-expanded={archiveOpen}
            className="inline-flex min-h-9 items-center justify-center gap-1 border border-field-divider bg-field-input px-2 text-[11px] font-bold text-field-text hover:border-field-subtle hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary disabled:cursor-wait disabled:opacity-55"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden />
            아카이브
            {archiveOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = "";
              if (file) void uploadAndLink(file);
            }}
          />
        </div>
      ) : null}

      {errorMessage ? <p role="alert" className="border border-field-danger bg-field-danger/10 p-2 text-xs font-normal text-field-danger">{errorMessage}</p> : null}

      {!readOnly && archiveOpen ? (
        <div className="min-h-0 border border-field-divider bg-field-dialog">
          <ShotArchiveSelector
            shot={shot}
            mediaType={mediaType}
            selectedLinks={selectedMediaLinks}
            readOnly={false}
            compact
            onMutation={(mutation) => onMediaMutation?.(mutation)}
            onLinked={() => setArchiveOpen(false)}
          />
        </div>
      ) : null}
    </section>
  );
}

function validateShotMediaImage(file: File) {
  const supported = ["image/jpeg", "image/png", "image/webp"].includes(file.type)
    || /\.(?:jpe?g|png|webp)$/i.test(file.name);
  if (!supported) return "JPG, PNG, WebP 이미지 파일만 선택할 수 있습니다.";
  if (file.size <= 0) return "비어 있는 파일은 업로드할 수 없습니다.";
  if (file.size > 20 * 1024 * 1024) return "이미지는 장당 20MB 이하만 업로드할 수 있습니다.";
  return "";
}

function stripFileExtension(value: string) {
  return value.replace(/\.[^.]+$/, "").trim() || "컷 자료";
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import { ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { useParams } from "next/navigation";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  deleteProjectCostume,
  listProjectCostumes,
  saveProjectCostume
} from "@/lib/data/projectReferenceAssets";
import { getProject } from "@/lib/data/projects";
import type { CostumeImage, ProjectCostume } from "@/lib/types";

type CostumeDraft = {
  id?: string;
  characterName: string;
  costumeName: string;
  description: string;
  memo: string;
  sortOrder: number;
  existingImages: CostumeImage[];
  files: File[];
};

const emptyDraft: CostumeDraft = {
  characterName: "",
  costumeName: "",
  description: "",
  memo: "",
  sortOrder: 0,
  existingImages: [],
  files: []
};

export default function ProjectCostumesPage() {
  const params = useParams<{ id: string | string[] }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const [projectName, setProjectName] = useState("");
  const [items, setItems] = useState<ProjectCostume[]>([]);
  const [draft, setDraft] = useState<CostumeDraft | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [project, costumes] = await Promise.all([
        getProject(projectId),
        listProjectCostumes(projectId)
      ]);
      setProjectName(project?.name ?? "프로젝트");
      setItems(costumes);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "의상 리스트를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(item: ProjectCostume) {
    setDraft({
      id: item.id,
      characterName: item.characterName,
      costumeName: item.costumeName,
      description: item.description,
      memo: item.memo,
      sortOrder: item.sortOrder,
      existingImages: item.images,
      files: []
    });
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    setDraft((current) => current ? { ...current, files: [...current.files, ...files] } : current);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !draft || !canEdit) return;
    if (!draft.costumeName.trim() && !draft.characterName.trim()) {
      setErrorMessage("배역명 또는 의상명을 입력해주세요.");
      return;
    }
    setIsSaving(true);
    setErrorMessage("");
    try {
      await saveProjectCostume(projectId, {
        id: draft.id,
        characterName: draft.characterName,
        costumeName: draft.costumeName,
        description: draft.description,
        memo: draft.memo,
        sortOrder: draft.sortOrder,
        keepImagePaths: draft.existingImages.map((image) => image.path),
        files: draft.files
      });
      setDraft(null);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "의상 항목을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(item: ProjectCostume) {
    if (!projectId || !window.confirm(`"${item.costumeName || item.characterName}" 의상 항목을 삭제할까요?`)) return;
    try {
      await deleteProjectCostume(projectId, item.id);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "의상 항목을 삭제하지 못했습니다.");
    }
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  return (
    <>
      <div className="mx-auto grid w-full max-w-6xl gap-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display truncate text-xl font-black text-field-primary">의상</h1>
            <p className="truncate text-xs font-bold text-field-muted">{projectName} · 프로젝트 의상 리스트</p>
          </div>
          {canEdit ? (
            <Button onClick={() => setDraft({ ...emptyDraft, sortOrder: items.length })}>
              <Plus className="h-4 w-4" aria-hidden />
              의상 추가
            </Button>
          ) : (
            <span className="rounded-full border border-field-border bg-white px-3 py-2 text-xs font-black text-field-muted">읽기 전용</span>
          )}
        </div>

        {errorMessage ? (
          <p role="alert" className="rounded-xl border border-field-danger bg-red-50 px-3 py-2 text-sm font-bold text-field-danger">
            {errorMessage}
          </p>
        ) : null}

        {items.length === 0 ? (
          <Card className="py-12 text-center text-sm font-bold text-field-muted">등록된 의상 자료가 없습니다.</Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-2xl border border-field-border bg-white">
                <div className="grid aspect-square grid-cols-2 gap-px bg-field-border">
                  {item.images.length > 0 ? item.images.slice(0, 4).map((image, index) => (
                    <button
                      key={image.path}
                      type="button"
                      onClick={() => setPreview({ url: image.url, title: item.costumeName || item.characterName || "의상" })}
                      className={`${item.images.length === 1 ? "col-span-2 row-span-2" : ""} min-h-0 overflow-hidden bg-field-soft`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt={`${item.costumeName || item.characterName} 의상 ${index + 1}`} className="h-full w-full object-cover" />
                    </button>
                  )) : (
                    <div className="col-span-2 row-span-2 grid place-items-center bg-field-soft text-field-muted">
                      <ImagePlus className="h-8 w-8" aria-hidden />
                    </div>
                  )}
                </div>
                <div className="grid gap-1 p-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-black text-field-secondary">{item.characterName || "배역 미지정"}</p>
                      <h2 className="mt-0.5 break-words text-base font-black text-field-text">{item.costumeName || "의상명 없음"}</h2>
                    </div>
                    {canEdit ? (
                      <div className="flex shrink-0 gap-1">
                        <button type="button" onClick={() => openEdit(item)} aria-label="의상 수정" className="grid h-8 w-8 place-items-center rounded-full border border-field-border">
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button type="button" onClick={() => handleDelete(item)} aria-label="의상 삭제" className="grid h-8 w-8 place-items-center rounded-full border border-field-border text-field-danger">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {item.description ? <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-field-text">{item.description}</p> : null}
                  {item.memo ? <p className="whitespace-pre-wrap border-t border-field-border pt-2 text-xs font-bold leading-5 text-field-muted">{item.memo}</p> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {draft ? (
        <div className="fixed inset-0 z-[90] flex items-end bg-black/25 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="의상 항목 편집">
          <form onSubmit={handleSubmit} className="mx-auto max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-black text-field-primary">{draft.id ? "의상 수정" : "의상 추가"}</h2>
              <button type="button" onClick={() => setDraft(null)} className="grid h-9 w-9 place-items-center rounded-full border border-field-border" aria-label="닫기">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="배역/캐릭터">
                <input value={draft.characterName} onChange={(event) => setDraft({ ...draft, characterName: event.target.value })} className={fieldClass} />
              </Field>
              <Field label="의상명">
                <input value={draft.costumeName} onChange={(event) => setDraft({ ...draft, costumeName: event.target.value })} className={fieldClass} />
              </Field>
              <Field label="설명" wide>
                <textarea rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={`${fieldClass} resize-y`} />
              </Field>
              <Field label="메모" wide>
                <textarea rows={3} value={draft.memo} onChange={(event) => setDraft({ ...draft, memo: event.target.value })} className={`${fieldClass} resize-y`} />
              </Field>
              <Field label="사진" wide>
                <div className="grid grid-cols-3 gap-2">
                  {draft.existingImages.map((image) => (
                    <div key={image.path} className="relative aspect-square overflow-hidden border border-field-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, existingImages: draft.existingImages.filter((item) => item.path !== image.path) })}
                        className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-field-danger"
                        aria-label="사진 제거"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ))}
                  {draft.files.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="relative grid aspect-square place-items-center border border-field-border bg-field-soft px-2 text-center text-[10px] font-bold text-field-muted">
                      <span className="line-clamp-3">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, files: draft.files.filter((_, fileIndex) => fileIndex !== index) })}
                        className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-field-danger"
                        aria-label="선택한 사진 제거"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ))}
                  <label className="grid aspect-square cursor-pointer place-items-center border border-dashed border-field-secondary bg-field-light text-xs font-black text-field-primary">
                    <span className="grid place-items-center gap-1"><ImagePlus className="h-5 w-5" aria-hidden />사진 선택</span>
                    <input type="file" accept="image/*,.heic,.heif" multiple className="sr-only" onChange={handleFiles} />
                  </label>
                </div>
              </Field>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>닫기</Button>
              <Button type="submit" disabled={isSaving}>{isSaving ? "저장 중" : "저장"}</Button>
            </div>
          </form>
        </div>
      ) : null}

      <ImagePreviewModal imageUrl={preview?.url ?? null} title={preview?.title ?? "의상"} onClose={() => setPreview(null)} />
    </>
  );
}

const fieldClass = "min-h-11 w-full rounded-lg border border-field-border bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-field-primary";

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`grid gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-black text-field-muted">{label}</span>
      {children}
    </label>
  );
}

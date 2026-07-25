"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ImagePlus, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useParams } from "next/navigation";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { Button } from "@/components/ui/Button";
import {
  createProjectCostumeScene,
  deleteProjectCostume,
  deleteProjectCostumeScene,
  listProjectCostumeScenes,
  saveProjectCostume,
  updateProjectCostumeScene
} from "@/lib/data/projectReferenceAssets";
import { listDailyPlans, type DailyPlanListItem } from "@/lib/data/dailyPlans";
import { getProject, getProjectBasicInfo } from "@/lib/data/projects";
import { getProjectSceneList } from "@/lib/data/sceneList";
import { listShots } from "@/lib/data/shots";
import type {
  CostumeImage,
  ProjectActor,
  ProjectCostume,
  ProjectCostumeScene,
  ProjectSceneItem
} from "@/lib/types";

type CostumeDraft = {
  actorRole: string;
  actorName: string;
  costumeContent: string;
  provider: string;
  hair: string;
  existingImages: CostumeImage[];
  files: File[];
};

type SceneDraft = {
  id?: string;
  sceneNo: string;
  sceneTitle: string;
};

type ActorDraft = {
  sceneId: string;
  role: string;
  name: string;
};

const providerOptions = ["소지", "대여", "구입"];

export default function ProjectCostumesPage() {
  const params = useParams<{ id: string | string[] }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const [projectName, setProjectName] = useState("");
  const [scenes, setScenes] = useState<ProjectCostumeScene[]>([]);
  const [actors, setActors] = useState<ProjectActor[]>([]);
  const [sceneOptions, setSceneOptions] = useState<ProjectSceneItem[]>([]);
  const [dailyPlans, setDailyPlans] = useState<DailyPlanListItem[]>([]);
  const [selectedDailyPlanId, setSelectedDailyPlanId] = useState("");
  const [dailyPlanSceneKeys, setDailyPlanSceneKeys] = useState<Set<string> | null>(null);
  const [expandedSceneIds, setExpandedSceneIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, CostumeDraft>>({});
  const [sceneDraft, setSceneDraft] = useState<SceneDraft | null>(null);
  const [actorDraft, setActorDraft] = useState<ActorDraft | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFiltering, setIsFiltering] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [project, costumeScenes, basicInfo, plans, sceneList] = await Promise.all([
        getProject(projectId),
        listProjectCostumeScenes(projectId),
        getProjectBasicInfo(projectId).catch(() => null),
        listDailyPlans(projectId).catch(() => []),
        getProjectSceneList(projectId).catch(() => null)
      ]);
      setProjectName(project?.name ?? "프로젝트");
      setScenes(costumeScenes);
      setActors(basicInfo?.actors ?? []);
      setDailyPlans(plans);
      setSceneOptions(sceneList?.items ?? []);
      setDrafts(Object.fromEntries(costumeScenes.flatMap((scene) => scene.items.map((item) => [item.id, toDraft(item)]))));
      setExpandedSceneIds((current) => current.size > 0
        ? new Set([...current].filter((id) => costumeScenes.some((scene) => scene.id === id)))
        : new Set(costumeScenes[0] ? [costumeScenes[0].id] : []));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "씬별 의상 자료를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projectId || !selectedDailyPlanId) {
      setDailyPlanSceneKeys(null);
      setIsFiltering(false);
      return;
    }
    let cancelled = false;
    setIsFiltering(true);
    void listShots(projectId, selectedDailyPlanId)
      .then((shots) => {
        if (!cancelled) {
          setDailyPlanSceneKeys(new Set(shots.map((shot) => normalizeSceneNumber(shot.sceneNumber)).filter(Boolean)));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDailyPlanSceneKeys(new Set());
          setErrorMessage(error instanceof Error ? error.message : "일촬표의 씬을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsFiltering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedDailyPlanId]);

  const filteredScenes = useMemo(() => {
    if (!selectedDailyPlanId || dailyPlanSceneKeys === null) return scenes;
    return scenes.filter((scene) => dailyPlanSceneKeys.has(normalizeSceneNumber(scene.sceneNo)));
  }, [dailyPlanSceneKeys, scenes, selectedDailyPlanId]);

  function updateDraft(id: string, patch: Partial<CostumeDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    setNoticeMessage("");
  }

  function toggleScene(id: string) {
    setExpandedSceneIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSceneNoChange(value: string) {
    const matched = sceneOptions.find((scene) => normalizeSceneNumber(scene.sceneNo) === normalizeSceneNumber(value));
    setSceneDraft((current) => current ? {
      ...current,
      sceneNo: value,
      sceneTitle: matched?.sceneContent || current.sceneTitle
    } : current);
  }

  async function handleSceneSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !sceneDraft || !canEdit) return;
    if (!sceneDraft.sceneNo.trim()) {
      setErrorMessage("씬 번호 또는 씬 이름을 입력해주세요.");
      return;
    }
    setSavingId(sceneDraft.id ?? "new-scene");
    setErrorMessage("");
    try {
      if (sceneDraft.id) {
        const updated = await updateProjectCostumeScene(projectId, {
          id: sceneDraft.id,
          sceneNo: sceneDraft.sceneNo,
          sceneTitle: sceneDraft.sceneTitle
        });
        setScenes((current) => current.map((scene) => scene.id === updated.id
          ? { ...scene, sceneNo: updated.sceneNo, sceneTitle: updated.sceneTitle }
          : scene));
      } else {
        const created = await createProjectCostumeScene(projectId, {
          sceneNo: sceneDraft.sceneNo,
          sceneTitle: sceneDraft.sceneTitle,
          actors
        });
        setScenes((current) => [...current, created]);
        setDrafts((current) => ({
          ...current,
          ...Object.fromEntries(created.items.map((item) => [item.id, toDraft(item)]))
        }));
        setExpandedSceneIds((current) => new Set([...current, created.id]));
      }
      setSceneDraft(null);
      setNoticeMessage("씬 의상 구성을 저장했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "의상 씬을 저장하지 못했습니다.");
    } finally {
      setSavingId("");
    }
  }

  async function handleSceneDelete(scene: ProjectCostumeScene) {
    if (!projectId || !canEdit || !window.confirm(`"${sceneLabel(scene)}" 씬의 의상 자료를 모두 삭제할까요?`)) return;
    setSavingId(scene.id);
    setErrorMessage("");
    try {
      await deleteProjectCostumeScene(projectId, scene.id);
      setScenes((current) => current.filter((item) => item.id !== scene.id));
      setDrafts((current) => {
        const next = { ...current };
        scene.items.forEach((item) => delete next[item.id]);
        return next;
      });
      setNoticeMessage("씬 의상 구성을 삭제했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "의상 씬을 삭제하지 못했습니다.");
    } finally {
      setSavingId("");
    }
  }

  function handleFiles(id: string, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const current = drafts[id];
    if (current) updateDraft(id, { files: [...current.files, ...files] });
  }

  async function handleItemSave(scene: ProjectCostumeScene, item: ProjectCostume) {
    const draft = drafts[item.id];
    if (!projectId || !draft || !canEdit) return;
    if (!draft.actorRole.trim() && !draft.actorName.trim()) {
      setErrorMessage("배역 또는 배우 이름을 입력해주세요.");
      return;
    }
    setSavingId(item.id);
    setErrorMessage("");
    try {
      const saved = await saveProjectCostume(projectId, {
        id: item.id,
        costumeSceneId: scene.id,
        actorRole: draft.actorRole,
        actorName: draft.actorName,
        costumeContent: draft.costumeContent,
        provider: draft.provider,
        hair: draft.hair,
        sortOrder: item.sortOrder,
        keepImagePaths: draft.existingImages.map((image) => image.path),
        files: draft.files
      });
      replaceCostumeItem(scene.id, saved);
      setDrafts((current) => ({ ...current, [item.id]: toDraft(saved) }));
      setNoticeMessage(`${draft.actorRole || draft.actorName} 의상 정보를 저장했습니다.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "의상 항목을 저장하지 못했습니다.");
    } finally {
      setSavingId("");
    }
  }

  async function handleActorAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !actorDraft || !canEdit) return;
    const scene = scenes.find((item) => item.id === actorDraft.sceneId);
    if (!scene) return;
    if (!actorDraft.role.trim() && !actorDraft.name.trim()) {
      setErrorMessage("배역 또는 배우 이름을 입력해주세요.");
      return;
    }
    const duplicateKey = normalizeActorKey(actorDraft.role, actorDraft.name);
    if (scene.items.some((item) => normalizeActorKey(item.actorRole, item.actorName) === duplicateKey)) {
      setErrorMessage("이미 이 씬에 등록된 배역입니다.");
      return;
    }
    setSavingId("new-actor");
    setErrorMessage("");
    try {
      const saved = await saveProjectCostume(projectId, {
        costumeSceneId: scene.id,
        actorRole: actorDraft.role,
        actorName: actorDraft.name,
        costumeContent: "",
        provider: "",
        hair: "",
        sortOrder: scene.items.length,
        keepImagePaths: [],
        files: []
      });
      setScenes((current) => current.map((item) => item.id === scene.id
        ? { ...item, items: [...item.items, saved] }
        : item));
      setDrafts((current) => ({ ...current, [saved.id]: toDraft(saved) }));
      setActorDraft(null);
      setNoticeMessage("배역을 추가했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "배역을 추가하지 못했습니다.");
    } finally {
      setSavingId("");
    }
  }

  async function handleItemDelete(scene: ProjectCostumeScene, item: ProjectCostume) {
    if (!projectId || !canEdit || !window.confirm(`"${item.actorRole || item.actorName}" 배역의 의상 자료를 삭제할까요?`)) return;
    setSavingId(item.id);
    setErrorMessage("");
    try {
      await deleteProjectCostume(projectId, item.id);
      setScenes((current) => current.map((entry) => entry.id === scene.id
        ? { ...entry, items: entry.items.filter((costume) => costume.id !== item.id) }
        : entry));
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setNoticeMessage("배역 의상 자료를 삭제했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "의상 항목을 삭제하지 못했습니다.");
    } finally {
      setSavingId("");
    }
  }

  function replaceCostumeItem(sceneId: string, saved: ProjectCostume) {
    setScenes((current) => current.map((scene) => scene.id === sceneId
      ? { ...scene, items: scene.items.map((item) => item.id === saved.id ? saved : item) }
      : scene));
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  return (
    <>
      <div className="mx-auto grid w-full max-w-6xl gap-3">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-xl font-black text-field-primary">의상</h1>
            <p className="truncate text-xs font-bold text-field-muted">{projectName} · 씬별 의상표</p>
          </div>
          {canEdit ? (
            <Button onClick={() => setSceneDraft({ sceneNo: "", sceneTitle: "" })}>
              <Plus className="h-4 w-4" aria-hidden />
              씬 추가
            </Button>
          ) : (
            <span className="rounded-full border border-field-border bg-white px-3 py-2 text-xs font-black text-field-muted">읽기 전용</span>
          )}
        </div>

        <label className="grid min-w-0 gap-1 sm:max-w-sm">
          <span className="text-xs font-black text-field-muted">일촬표 씬 필터</span>
          <select
            value={selectedDailyPlanId}
            onChange={(event) => setSelectedDailyPlanId(event.target.value)}
            className={fieldClass}
          >
            <option value="">전체 씬</option>
            {dailyPlans.map((plan) => (
              <option key={plan.id} value={plan.id}>{dailyPlanLabel(plan)}</option>
            ))}
          </select>
        </label>

        {errorMessage ? (
          <p role="alert" className="rounded-xl border border-field-danger bg-red-50 px-3 py-2 text-sm font-bold text-field-danger">
            {errorMessage}
          </p>
        ) : null}
        {noticeMessage ? (
          <p role="status" className="rounded-xl border border-field-secondary bg-field-light px-3 py-2 text-sm font-bold text-field-primary">
            {noticeMessage}
          </p>
        ) : null}

        {isFiltering ? (
          <div className="py-8"><PixelDogLoader size="sm" /></div>
        ) : filteredScenes.length === 0 ? (
          <div className="rounded-2xl border border-field-border bg-white px-4 py-12 text-center text-sm font-bold text-field-muted">
            {scenes.length === 0 ? "등록된 의상 씬이 없습니다." : "선택한 일촬표에 포함된 의상 씬이 없습니다."}
          </div>
        ) : (
          <div className="grid gap-2">
            {filteredScenes.map((scene) => {
              const expanded = expandedSceneIds.has(scene.id);
              return (
                <section key={scene.id} className="overflow-hidden rounded-2xl border border-field-border bg-white">
                  <div className="flex min-w-0 items-center gap-2 bg-field-light px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleScene(scene.id)}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={expanded}
                    >
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden />
                      <span className="min-w-0">
                        <strong className="block break-words text-sm font-black text-field-primary">{sceneLabel(scene)}</strong>
                        <span className="block text-xs font-bold text-field-muted">{scene.items.length}개 배역</span>
                      </span>
                    </button>
                    {canEdit ? (
                      <div className="flex shrink-0 gap-1">
                        <IconButton label="씬 정보 수정" onClick={() => setSceneDraft({ id: scene.id, sceneNo: scene.sceneNo, sceneTitle: scene.sceneTitle })}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </IconButton>
                        <IconButton label="씬 삭제" danger onClick={() => void handleSceneDelete(scene)}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </IconButton>
                      </div>
                    ) : null}
                  </div>

                  {expanded ? (
                    <div className="grid gap-2 border-t border-field-border p-2 sm:p-3">
                      {scene.items.length === 0 ? (
                        <p className="py-6 text-center text-sm font-bold text-field-muted">이 씬에 등록된 배역이 없습니다.</p>
                      ) : scene.items.map((item) => (
                        <CostumeItemCard
                          key={item.id}
                          item={item}
                          draft={drafts[item.id] ?? toDraft(item)}
                          canEdit={canEdit}
                          isSaving={savingId === item.id}
                          onChange={(patch) => updateDraft(item.id, patch)}
                          onFiles={(event) => handleFiles(item.id, event)}
                          onSave={() => void handleItemSave(scene, item)}
                          onDelete={() => void handleItemDelete(scene, item)}
                          onPreview={(image) => setPreview({
                            url: image.url,
                            title: `${scene.sceneNo} · ${item.actorRole || item.actorName || "의상"}`
                          })}
                        />
                      ))}
                      {canEdit ? (
                        <Button
                          variant="secondary"
                          className="justify-self-start"
                          onClick={() => setActorDraft({ sceneId: scene.id, role: "", name: "" })}
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                          배역 추가
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {sceneDraft ? (
        <BottomSheet title={sceneDraft.id ? "의상 씬 수정" : "의상 씬 추가"} onClose={() => setSceneDraft(null)}>
          <form onSubmit={handleSceneSubmit} className="grid gap-3">
            <Field label="씬">
              <input
                list="costume-scene-options"
                value={sceneDraft.sceneNo}
                onChange={(event) => handleSceneNoChange(event.target.value)}
                placeholder="예: S#1 또는 Scene 1"
                className={fieldClass}
              />
              <datalist id="costume-scene-options">
                {sceneOptions.filter((scene) => scene.sceneNo).map((scene) => (
                  <option key={scene.id} value={scene.sceneNo}>{scene.sceneContent}</option>
                ))}
              </datalist>
            </Field>
            <Field label="씬 이름">
              <input
                value={sceneDraft.sceneTitle}
                onChange={(event) => setSceneDraft({ ...sceneDraft, sceneTitle: event.target.value })}
                placeholder="씬리스트 내용 또는 직접 입력"
                className={fieldClass}
              />
            </Field>
            {!sceneDraft.id ? (
              <p className="text-xs font-bold leading-5 text-field-muted">
                새 씬에는 현재 기본정보의 배역 {actors.length}개가 복사됩니다. 이후 기본정보 변경은 이 씬을 덮어쓰지 않습니다.
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSceneDraft(null)}>닫기</Button>
              <Button type="submit" disabled={Boolean(savingId)}>{savingId ? "저장 중" : "저장"}</Button>
            </div>
          </form>
        </BottomSheet>
      ) : null}

      {actorDraft ? (
        <BottomSheet title="배역 추가" onClose={() => setActorDraft(null)}>
          <form onSubmit={handleActorAdd} className="grid gap-3">
            <Field label="배역">
              <input value={actorDraft.role} onChange={(event) => setActorDraft({ ...actorDraft, role: event.target.value })} className={fieldClass} />
            </Field>
            <Field label="배우 이름">
              <input value={actorDraft.name} onChange={(event) => setActorDraft({ ...actorDraft, name: event.target.value })} className={fieldClass} />
            </Field>
            <p className="text-xs font-bold leading-5 text-field-muted">이 배역은 의상표에만 추가되며 프로젝트 기본정보는 변경하지 않습니다.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setActorDraft(null)}>닫기</Button>
              <Button type="submit" disabled={Boolean(savingId)}>{savingId ? "추가 중" : "추가"}</Button>
            </div>
          </form>
        </BottomSheet>
      ) : null}

      <ImagePreviewModal imageUrl={preview?.url ?? null} title={preview?.title ?? "의상"} onClose={() => setPreview(null)} />
    </>
  );
}

function CostumeItemCard({
  item,
  draft,
  canEdit,
  isSaving,
  onChange,
  onFiles,
  onSave,
  onDelete,
  onPreview
}: {
  item: ProjectCostume;
  draft: CostumeDraft;
  canEdit: boolean;
  isSaving: boolean;
  onChange: (patch: Partial<CostumeDraft>) => void;
  onFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onDelete: () => void;
  onPreview: (image: CostumeImage) => void;
}) {
  const customProvider = draft.provider && !providerOptions.includes(draft.provider);
  if (!canEdit) {
    return (
      <article className="grid gap-3 rounded-xl border border-field-border bg-white p-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-black text-field-primary">{item.actorRole || "배역 미지정"}</h3>
          {item.actorName ? <p className="break-words text-xs font-bold text-field-muted">{item.actorName}</p> : null}
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <ReadOnlyValue label="내용" value={item.costumeContent} />
          <ReadOnlyValue label="제공자" value={item.provider} />
          <ReadOnlyValue label="헤어" value={item.hair} />
        </dl>
        <ImageStrip images={item.images} title={item.actorRole || item.actorName} onPreview={onPreview} />
      </article>
    );
  }

  return (
    <article className="grid gap-3 rounded-xl border border-field-border bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Field label="배역">
          <input value={draft.actorRole} onChange={(event) => onChange({ actorRole: event.target.value })} className={fieldClass} />
        </Field>
        <Field label="배우 이름">
          <input value={draft.actorName} onChange={(event) => onChange({ actorName: event.target.value })} className={fieldClass} />
        </Field>
        <IconButton label="배역 삭제" danger className="self-end" onClick={onDelete}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="내용">
          <textarea
            rows={2}
            value={draft.costumeContent}
            onChange={(event) => onChange({ costumeContent: event.target.value })}
            placeholder="정장, 교복, 군복 등"
            className={`${fieldClass} resize-y`}
          />
        </Field>
        <Field label="제공자">
          <select
            value={customProvider ? "기타" : draft.provider}
            onChange={(event) => onChange({ provider: event.target.value === "기타" ? "기타" : event.target.value })}
            className={fieldClass}
          >
            <option value="">선택</option>
            {providerOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            <option value="기타">기타</option>
          </select>
          {customProvider || draft.provider === "기타" ? (
            <input
              value={draft.provider === "기타" ? "" : draft.provider}
              onChange={(event) => onChange({ provider: event.target.value })}
              placeholder="제공자 직접 입력"
              className={fieldClass}
            />
          ) : null}
        </Field>
        <Field label="헤어">
          <textarea
            rows={2}
            value={draft.hair}
            onChange={(event) => onChange({ hair: event.target.value })}
            placeholder="묶음머리, 생머리, 모자 등"
            className={`${fieldClass} resize-y`}
          />
        </Field>
      </div>

      <div className="grid gap-2">
        <span className="text-xs font-black text-field-muted">이미지</span>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {draft.existingImages.map((image) => (
            <div key={image.path} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-field-border bg-field-soft">
              <button type="button" onClick={() => onPreview(image)} className="h-full w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={`${draft.actorRole || draft.actorName} 의상`} className="h-full w-full object-cover" />
              </button>
              <button
                type="button"
                onClick={() => onChange({ existingImages: draft.existingImages.filter((item) => item.path !== image.path) })}
                className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white/95 text-field-danger"
                aria-label="저장 시 이미지 삭제"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
          {draft.files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="relative grid h-24 w-24 shrink-0 place-items-center rounded-lg border border-field-border bg-field-soft px-2 text-center text-[10px] font-bold text-field-muted">
              <span className="line-clamp-3">{file.name}</span>
              <button
                type="button"
                onClick={() => onChange({ files: draft.files.filter((_, fileIndex) => fileIndex !== index) })}
                className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white/95 text-field-danger"
                aria-label="선택한 이미지 제외"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <label className="grid h-24 w-24 shrink-0 cursor-pointer place-items-center rounded-lg border border-dashed border-field-secondary bg-field-light text-xs font-black text-field-primary">
            <span className="grid place-items-center gap-1"><ImagePlus className="h-5 w-5" aria-hidden />이미지 선택</span>
            <input type="file" accept="image/*,.heic,.heif" multiple className="sr-only" onChange={onFiles} />
          </label>
        </div>
        <p className="text-[11px] font-bold text-field-muted">이미지 추가·제거도 아래 저장 버튼을 눌렀을 때 반영됩니다.</p>
      </div>

      <Button className="justify-self-end" onClick={onSave} disabled={isSaving}>
        <Save className="h-4 w-4" aria-hidden />
        {isSaving ? "저장 중" : "이 배역 저장"}
      </Button>
    </article>
  );
}

function ImageStrip({
  images,
  title,
  onPreview
}: {
  images: CostumeImage[];
  title: string;
  onPreview: (image: CostumeImage) => void;
}) {
  if (images.length === 0) return <p className="text-xs font-bold text-field-muted">등록된 이미지가 없습니다.</p>;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {images.map((image) => (
        <button key={image.path} type="button" onClick={() => onPreview(image)} className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-field-border bg-field-soft">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt={`${title} 의상`} className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-field-soft px-3 py-2">
      <dt className="text-[11px] font-black text-field-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words font-bold leading-6 text-field-text">{value || "미입력"}</dd>
    </div>
  );
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-black/20 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mx-auto max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-black text-field-primary">{title}</h2>
          <IconButton label="닫기" onClick={onClose}><X className="h-4 w-4" aria-hidden /></IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function IconButton({
  label,
  danger = false,
  className = "",
  onClick,
  children
}: {
  label: string;
  danger?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border border-field-border bg-white ${danger ? "text-field-danger" : "text-field-text"} ${className}`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 content-start gap-1.5">
      <span className="text-xs font-black text-field-muted">{label}</span>
      {children}
    </label>
  );
}

function toDraft(item: ProjectCostume): CostumeDraft {
  return {
    actorRole: item.actorRole,
    actorName: item.actorName,
    costumeContent: item.costumeContent,
    provider: item.provider,
    hair: item.hair,
    existingImages: item.images,
    files: []
  };
}

function sceneLabel(scene: Pick<ProjectCostumeScene, "sceneNo" | "sceneTitle">) {
  return [scene.sceneNo, scene.sceneTitle].filter(Boolean).join(" · ") || "씬";
}

function dailyPlanLabel(plan: DailyPlanListItem) {
  const episode = plan.episode ? `${plan.episode}회차` : plan.title || "일촬표";
  return [episode, plan.shootingDate].filter(Boolean).join(" / ");
}

function normalizeSceneNumber(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "")
    .replace(/^(?:scene|씬|s)#?/i, "")
    .replace(/^#+/, "");
}

function normalizeActorKey(role: string, name: string) {
  return (role || name).normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

const fieldClass = "min-h-11 w-full rounded-lg border border-field-border bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-field-primary";

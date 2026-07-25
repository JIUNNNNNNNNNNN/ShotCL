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
  costumeImages: CostumeImage[];
  hairImages: CostumeImage[];
  costumeFiles: PendingFile[];
  hairFiles: PendingFile[];
};

type PendingFile = { id: string; file: File };
type ImageFieldType = "costume" | "hair";

type SceneDraft = {
  id?: string;
  sceneNo: string;
  sceneTitle: string;
  selectedSceneId?: string;
};

type ActorDraft = {
  sceneId: string;
  role: string;
  name: string;
};

const providerOptions = ["소지", "대여", "구입"];
const tempPrefix = "costume-local-";

export default function ProjectCostumesPage() {
  const params = useParams<{ id: string | string[] }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { role } = useProjectAccess();
  const canEdit = role === "admin";
  const [projectName, setProjectName] = useState("");
  const [scenes, setScenes] = useState<ProjectCostumeScene[]>([]);
  const [actors, setActors] = useState<ProjectActor[]>([]);
  const [sceneOptions, setSceneOptions] = useState<ProjectSceneItem[]>([]);
  const [dailyPlans, setDailyPlans] = useState<DailyPlanListItem[]>([]);
  const [selectedDailyPlanId, setSelectedDailyPlanId] = useState("");
  const [dailyPlanSceneKeys, setDailyPlanSceneKeys] = useState<Set<string> | null>(null);
  const [expandedSceneIds, setExpandedSceneIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, CostumeDraft>>({});
  const [deletedSceneIds, setDeletedSceneIds] = useState<Set<string>>(new Set());
  const [deletedItemIds, setDeletedItemIds] = useState<Set<string>>(new Set());
  const [sceneDraft, setSceneDraft] = useState<SceneDraft | null>(null);
  const [actorDraft, setActorDraft] = useState<ActorDraft | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
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
      setSceneOptions(sceneList?.items ?? []);
      setDailyPlans(plans);
      setDrafts(Object.fromEntries(costumeScenes.flatMap((scene) => scene.items.map((item) => [item.id, toDraft(item)]))));
      setDeletedSceneIds(new Set());
      setDeletedItemIds(new Set());
      setIsDirty(false);
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
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

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

  function markDirty(message = "") {
    setIsDirty(true);
    setNoticeMessage(message);
    setErrorMessage("");
  }

  function updateDraft(id: string, patch: Partial<CostumeDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    markDirty();
  }

  function toggleScene(id: string) {
    setExpandedSceneIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSceneListSelection(sceneId: string) {
    if (!sceneDraft) return;
    const selected = sceneOptions.find((item) => item.id === sceneId);
    setSceneDraft({
      ...sceneDraft,
      selectedSceneId: sceneId,
      sceneNo: selected?.sceneNo ?? sceneDraft.sceneNo
    });
  }

  function handleSceneSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !sceneDraft || !canEdit) return;
    if (!sceneDraft.sceneNo.trim()) {
      setErrorMessage("씬 번호 또는 씬 이름을 입력해주세요.");
      return;
    }
    const duplicateKey = normalizeSceneNumber(sceneDraft.sceneNo);
    if (scenes.some((scene) => scene.id !== sceneDraft.id && normalizeSceneNumber(scene.sceneNo) === duplicateKey)) {
      setErrorMessage("이미 추가된 씬입니다.");
      return;
    }

    if (sceneDraft.id) {
      setScenes((current) => current.map((scene) => scene.id === sceneDraft.id
        ? { ...scene, sceneNo: sceneDraft.sceneNo.trim(), sceneTitle: sceneDraft.sceneTitle.trim() }
        : scene));
    } else {
      const sceneId = createTemporaryId("scene");
      const now = new Date().toISOString();
      const seededActors = dedupeActors(actors);
      const items = seededActors.map((actor, index) => createTemporaryCostume(
        projectId,
        sceneId,
        sceneDraft.sceneNo.trim(),
        actor.role,
        actor.name,
        index,
        now
      ));
      const created: ProjectCostumeScene = {
        id: sceneId,
        projectId,
        sceneNo: sceneDraft.sceneNo.trim(),
        sceneTitle: sceneDraft.sceneTitle.trim(),
        sortOrder: scenes.length,
        items,
        createdAt: now,
        updatedAt: now
      };
      setScenes((current) => [...current, created]);
      setDrafts((current) => ({
        ...current,
        ...Object.fromEntries(items.map((item) => [item.id, toDraft(item)]))
      }));
      setExpandedSceneIds((current) => new Set([...current, sceneId]));
    }
    setSceneDraft(null);
    markDirty("씬 변경사항을 임시 저장했습니다. 전체 저장을 눌러 반영해주세요.");
  }

  function handleSceneDelete(scene: ProjectCostumeScene) {
    if (!canEdit || !window.confirm(`"${sceneLabel(scene)}" 씬의 의상 자료를 삭제할까요? 전체 저장 전에는 DB에서 삭제되지 않습니다.`)) return;
    setScenes((current) => current.filter((item) => item.id !== scene.id));
    if (!isTemporaryId(scene.id)) {
      setDeletedSceneIds((current) => new Set([...current, scene.id]));
    }
    setDrafts((current) => {
      const next = { ...current };
      scene.items.forEach((item) => delete next[item.id]);
      return next;
    });
    markDirty("씬 삭제가 대기 중입니다. 전체 저장을 눌러 반영해주세요.");
  }

  function handleFiles(id: string, fieldType: ImageFieldType, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const current = drafts[id];
    if (!current || files.length === 0) return;
    const pendingFiles = files.map((file) => ({ id: crypto.randomUUID(), file }));
    if (fieldType === "hair") {
      updateDraft(id, { hairFiles: [...current.hairFiles, ...pendingFiles] });
    } else {
      updateDraft(id, { costumeFiles: [...current.costumeFiles, ...pendingFiles] });
    }
  }

  function handleActorAdd(event: FormEvent<HTMLFormElement>) {
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
    const now = new Date().toISOString();
    const item = createTemporaryCostume(
      projectId,
      scene.id,
      scene.sceneNo,
      actorDraft.role.trim(),
      actorDraft.name.trim(),
      scene.items.length,
      now
    );
    setScenes((current) => current.map((entry) => entry.id === scene.id
      ? { ...entry, items: [...entry.items, item] }
      : entry));
    setDrafts((current) => ({ ...current, [item.id]: toDraft(item) }));
    setActorDraft(null);
    markDirty("배역을 임시 추가했습니다. 전체 저장을 눌러 반영해주세요.");
  }

  function handleItemDelete(scene: ProjectCostumeScene, item: ProjectCostume) {
    if (!canEdit || !window.confirm(`"${item.actorRole || item.actorName}" 배역의 의상 자료를 삭제할까요? 전체 저장 전에는 DB에서 삭제되지 않습니다.`)) return;
    setScenes((current) => current.map((entry) => entry.id === scene.id
      ? { ...entry, items: entry.items.filter((costume) => costume.id !== item.id) }
      : entry));
    if (!isTemporaryId(item.id)) {
      setDeletedItemIds((current) => new Set([...current, item.id]));
    }
    setDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    markDirty("배역 삭제가 대기 중입니다. 전체 저장을 눌러 반영해주세요.");
  }

  async function handleSaveAll() {
    if (!projectId || !canEdit || !isDirty || isSaving) return;
    for (const scene of scenes) {
      for (const item of scene.items) {
        const draft = drafts[item.id];
        if (!draft?.actorRole.trim() && !draft?.actorName.trim()) {
          setErrorMessage(`"${sceneLabel(scene)}" 씬에 배역과 배우 이름이 모두 비어 있는 항목이 있습니다.`);
          return;
        }
      }
    }

    setIsSaving(true);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      for (const itemId of deletedItemIds) {
        await deleteProjectCostume(projectId, itemId);
      }
      setDeletedItemIds(new Set());

      for (const sceneId of deletedSceneIds) {
        await deleteProjectCostumeScene(projectId, sceneId);
      }
      setDeletedSceneIds(new Set());

      for (const scene of scenes) {
        const savedScene = isTemporaryId(scene.id)
          ? await createProjectCostumeScene(projectId, {
              sceneNo: scene.sceneNo,
              sceneTitle: scene.sceneTitle,
              actors: []
            })
          : await updateProjectCostumeScene(projectId, {
              id: scene.id,
              sceneNo: scene.sceneNo,
              sceneTitle: scene.sceneTitle
            });

        if (isTemporaryId(scene.id)) {
          setScenes((current) => current.map((entry) => entry.id === scene.id
            ? {
                ...entry,
                id: savedScene.id,
                items: entry.items.map((item) => ({ ...item, costumeSceneId: savedScene.id }))
              }
            : entry));
          setExpandedSceneIds((current) => new Set(
            [...current].map((id) => id === scene.id ? savedScene.id : id)
          ));
        }

        for (const item of scene.items) {
          const draft = drafts[item.id];
          if (!draft) continue;
          const savedItem = await saveProjectCostume(projectId, {
            id: isTemporaryId(item.id) ? undefined : item.id,
            clientItemId: item.id,
            costumeSceneId: savedScene.id,
            actorRole: draft.actorRole,
            actorName: draft.actorName,
            costumeContent: draft.costumeContent,
            provider: draft.provider,
            hair: draft.hair,
            sortOrder: item.sortOrder,
            keepCostumeImagePaths: draft.costumeImages.map((image) => image.path),
            keepHairImagePaths: draft.hairImages.map((image) => image.path),
            costumeFiles: draft.costumeFiles.map(({ file }) => file),
            hairFiles: draft.hairFiles.map(({ file }) => file)
          });
          if (isTemporaryId(item.id)) {
            setScenes((current) => current.map((entry) => (
              entry.id === savedScene.id || entry.id === scene.id
                ? { ...entry, items: entry.items.map((value) => value.id === item.id ? savedItem : value) }
                : entry
            )));
            setDrafts((current) => {
              const next = { ...current, [savedItem.id]: toDraft(savedItem) };
              delete next[item.id];
              return next;
            });
          } else {
            setScenes((current) => current.map((entry) => entry.id === savedScene.id
              ? { ...entry, items: entry.items.map((value) => value.id === item.id ? savedItem : value) }
              : entry));
            setDrafts((current) => ({ ...current, [item.id]: toDraft(savedItem) }));
          }
        }
      }

      await load();
      setNoticeMessage("의상 변경사항을 모두 저장했습니다.");
    } catch (error) {
      setIsDirty(true);
      setErrorMessage(error instanceof Error ? error.message : "의상 변경사항을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  return (
    <>
      <div className="mx-auto grid w-full max-w-6xl gap-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-xl font-black text-field-primary">의상</h1>
            <p className="truncate text-xs font-bold text-field-muted">{projectName} · 씬별 의상표</p>
          </div>
          <label className="min-w-0 flex-1 sm:max-w-[280px]">
            <span className="sr-only">일촬표 씬 필터</span>
            <select
              value={selectedDailyPlanId}
              onChange={(event) => setSelectedDailyPlanId(event.target.value)}
              className={compactInputClass}
              aria-label="일촬표 씬 필터"
            >
              <option value="">전체 씬</option>
              {dailyPlans.map((plan) => (
                <option key={plan.id} value={plan.id}>{dailyPlanLabel(plan)}</option>
              ))}
            </select>
          </label>
          {canEdit ? (
            <>
              <Button variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => setSceneDraft({ sceneNo: "", sceneTitle: "" })}>
                <Plus className="h-4 w-4" aria-hidden />
                씬 추가
              </Button>
              <Button className="min-h-9 px-3 py-1.5 text-xs" onClick={() => void handleSaveAll()} disabled={!isDirty || isSaving}>
                <Save className="h-4 w-4" aria-hidden />
                {isSaving ? "전체 저장 중" : "전체 저장"}
              </Button>
            </>
          ) : (
            <span className="rounded-full border border-field-border bg-white px-2.5 py-1.5 text-[11px] font-black text-field-muted">읽기 전용</span>
          )}
        </div>

        {canEdit && isDirty ? (
          <p className="text-xs font-black text-amber-700">저장되지 않은 변경사항이 있습니다.</p>
        ) : null}
        {errorMessage ? (
          <p role="alert" className="rounded-lg border border-field-danger bg-red-50 px-3 py-1.5 text-xs font-bold text-field-danger">
            {errorMessage}
          </p>
        ) : null}
        {noticeMessage ? (
          <p role="status" className="rounded-lg border border-field-secondary bg-field-light px-3 py-1.5 text-xs font-bold text-field-primary">
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
          <div className="grid gap-1.5">
            {filteredScenes.map((scene) => {
              const expanded = expandedSceneIds.has(scene.id);
              const imageCount = scene.items.reduce((total, item) => {
                const draft = drafts[item.id];
                return total
                  + (draft?.costumeImages.length ?? item.images.filter((image) => image.fieldType === "costume").length)
                  + (draft?.hairImages.length ?? item.images.filter((image) => image.fieldType === "hair").length)
                  + (draft?.costumeFiles.length ?? 0)
                  + (draft?.hairFiles.length ?? 0);
              }, 0);
              return (
                <section key={scene.id} className="overflow-hidden rounded-xl border border-field-border bg-white">
                  <div className="flex min-w-0 items-center gap-1.5 bg-field-light px-2.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleScene(scene.id)}
                      className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 text-left"
                      aria-expanded={expanded}
                    >
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <strong className="break-words text-sm font-black text-field-primary">{sceneLabel(scene)}</strong>
                        <span className="text-[11px] font-bold text-field-muted">{scene.items.length}명 · 이미지 {imageCount}장</span>
                      </span>
                    </button>
                    {canEdit ? (
                      <div className="flex shrink-0 gap-1">
                        <IconButton label="씬 정보 수정" onClick={() => setSceneDraft({ id: scene.id, sceneNo: scene.sceneNo, sceneTitle: scene.sceneTitle })}>
                          <Pencil className="h-3 w-3" aria-hidden />
                        </IconButton>
                        <IconButton label="씬 삭제" danger onClick={() => handleSceneDelete(scene)}>
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </IconButton>
                      </div>
                    ) : null}
                  </div>

                  {expanded ? (
                    <div className="border-t border-field-border p-1.5 sm:p-2">
                      {scene.items.length > 0 ? (
                        <div className="mb-1 hidden grid-cols-[minmax(90px,.7fr)_80px_minmax(230px,1.5fr)_minmax(230px,1.5fr)_40px] gap-1.5 px-2 text-[10px] font-black text-field-muted sm:grid">
                          <span>배역</span>
                          <span>제공자</span>
                          <span>의상</span>
                          <span>헤어</span>
                          <span className="text-center">삭제</span>
                        </div>
                      ) : null}
                      <div className="grid gap-1.5 sm:divide-y sm:divide-field-border sm:gap-0">
                        {scene.items.length === 0 ? (
                          <p className="py-5 text-center text-xs font-bold text-field-muted">이 씬에 등록된 배역이 없습니다.</p>
                        ) : scene.items.map((item) => (
                          <CostumeItemCard
                            key={item.id}
                            item={item}
                            draft={drafts[item.id] ?? toDraft(item)}
                            canEdit={canEdit}
                            onChange={(patch) => updateDraft(item.id, patch)}
                            onCostumeFiles={(event) => handleFiles(item.id, "costume", event)}
                            onHairFiles={(event) => handleFiles(item.id, "hair", event)}
                            onDelete={() => handleItemDelete(scene, item)}
                            onPreview={(image) => setPreview({
                              url: image.url,
                              title: `${scene.sceneNo} · ${item.actorRole || item.actorName || "의상"}`
                            })}
                            onPreviewUrl={(url) => setPreview({
                              url,
                              title: `${scene.sceneNo} · ${item.actorRole || item.actorName || "의상"}`
                            })}
                          />
                        ))}
                      </div>
                      {canEdit ? (
                        <Button
                          variant="secondary"
                          className="mt-1.5 min-h-8 px-2.5 py-1 text-[11px]"
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
            {!sceneDraft.id ? (
              <Field label="씬리스트에서 선택 (선택사항)">
                <select
                  value={sceneDraft.selectedSceneId ?? ""}
                  onChange={(event) => handleSceneListSelection(event.target.value)}
                  className={compactInputClass}
                >
                  <option value="">직접 입력</option>
                  {sceneOptions.map((scene) => (
                    <option key={scene.id} value={scene.id}>{sceneOptionLabel(scene)}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="씬 번호">
              <input
                value={sceneDraft.sceneNo}
                onChange={(event) => setSceneDraft({ ...sceneDraft, selectedSceneId: "", sceneNo: event.target.value })}
                placeholder="예: S#1"
                className={compactInputClass}
              />
            </Field>
            <Field label="씬 이름">
              <input
                value={sceneDraft.sceneTitle}
                onChange={(event) => setSceneDraft({ ...sceneDraft, sceneTitle: event.target.value })}
                placeholder="직접 입력 (씬 내용은 가져오지 않음)"
                className={compactInputClass}
              />
            </Field>
            {!sceneDraft.id ? (
              <p className="text-xs font-bold leading-5 text-field-muted">
                씬리스트에서는 씬 번호만 가져옵니다. 별도 씬 이름 필드가 없어 이름은 직접 입력하며, 씬 내용과 Characters 메모는 가져오지 않습니다.
                새 씬에는 현재 기본정보의 배역 {actors.length}개만 복사됩니다.
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSceneDraft(null)}>닫기</Button>
              <Button type="submit">변경사항 반영</Button>
            </div>
          </form>
        </BottomSheet>
      ) : null}

      {actorDraft ? (
        <BottomSheet title="배역 추가" onClose={() => setActorDraft(null)}>
          <form onSubmit={handleActorAdd} className="grid gap-3">
            <Field label="배역">
              <input value={actorDraft.role} onChange={(event) => setActorDraft({ ...actorDraft, role: event.target.value })} className={compactInputClass} />
            </Field>
            <Field label="배우 이름">
              <input value={actorDraft.name} onChange={(event) => setActorDraft({ ...actorDraft, name: event.target.value })} className={compactInputClass} />
            </Field>
            <p className="text-xs font-bold leading-5 text-field-muted">이 배역은 의상표에만 추가되며 프로젝트 기본정보는 변경하지 않습니다.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setActorDraft(null)}>닫기</Button>
              <Button type="submit">임시 추가</Button>
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
  onChange,
  onCostumeFiles,
  onHairFiles,
  onDelete,
  onPreview,
  onPreviewUrl
}: {
  item: ProjectCostume;
  draft: CostumeDraft;
  canEdit: boolean;
  onChange: (patch: Partial<CostumeDraft>) => void;
  onCostumeFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onHairFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onDelete: () => void;
  onPreview: (image: CostumeImage) => void;
  onPreviewUrl: (url: string) => void;
}) {
  const customProvider = draft.provider && !providerOptions.includes(draft.provider);
  if (!canEdit) {
    return (
      <article className="grid grid-cols-2 gap-1.5 rounded-lg border border-field-border bg-white p-2 sm:grid-cols-[minmax(90px,.7fr)_80px_minmax(230px,1.5fr)_minmax(230px,1.5fr)_40px] sm:items-start sm:gap-1.5 sm:rounded-none sm:border-0 sm:px-2 sm:py-1.5">
        <div className="col-span-2 min-w-0 border-b border-field-border pb-1 sm:col-span-1 sm:border-0 sm:pb-0">
          <h3 className="break-words text-xs font-black leading-5 text-field-primary">{item.actorRole || "배역 미지정"}</h3>
          {item.actorName ? <p className="break-words text-[10px] font-bold leading-4 text-field-muted">{item.actorName}</p> : null}
        </div>
        <ReadOnlyValue label="제공자" value={item.provider} />
        <ReadOnlyMediaField
          label="의상"
          value={item.costumeContent}
          images={draft.costumeImages}
          title={item.actorRole || item.actorName}
          onPreview={onPreview}
        />
        <ReadOnlyMediaField
          label="헤어"
          value={item.hair}
          images={draft.hairImages}
          title={item.actorRole || item.actorName}
          onPreview={onPreview}
        />
        <span className="hidden text-center text-[10px] font-bold text-field-muted sm:block">보기</span>
      </article>
    );
  }

  return (
    <article className="grid grid-cols-2 gap-1.5 rounded-lg border border-field-border bg-white p-2 sm:grid-cols-[minmax(90px,.7fr)_80px_minmax(230px,1.5fr)_minmax(230px,1.5fr)_40px] sm:items-start sm:gap-1.5 sm:rounded-none sm:border-0 sm:px-2 sm:py-1.5">
      <div className="col-span-2 grid grid-cols-2 gap-1 sm:col-span-1 sm:grid-cols-1">
        <CompactField label="배역">
          <input
            value={draft.actorRole}
            onChange={(event) => onChange({ actorRole: event.target.value })}
            placeholder="배역"
            className={compactInputClass}
          />
        </CompactField>
        <CompactField label="배우">
          <input
            value={draft.actorName}
            onChange={(event) => onChange({ actorName: event.target.value })}
            placeholder="배우"
            className={compactInputClass}
          />
        </CompactField>
      </div>

      <CompactField label="제공자">
        <div className="grid gap-1">
          <select
            value={customProvider ? "기타" : draft.provider}
            onChange={(event) => onChange({ provider: event.target.value === "기타" ? "기타" : event.target.value })}
            className={compactInputClass}
          >
            <option value="">선택</option>
            {providerOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            <option value="기타">기타</option>
          </select>
          {customProvider || draft.provider === "기타" ? (
            <input
              value={draft.provider === "기타" ? "" : draft.provider}
              onChange={(event) => onChange({ provider: event.target.value })}
              placeholder="직접 입력"
              className={compactInputClass}
            />
          ) : null}
        </div>
      </CompactField>

      <EditableMediaField
        label="의상"
        value={draft.costumeContent}
        placeholder="교복, 정장"
        images={draft.costumeImages}
        pendingFiles={draft.costumeFiles}
        title={draft.actorRole || draft.actorName}
        onValueChange={(value) => onChange({ costumeContent: value })}
        onImagesChange={(images) => onChange({ costumeImages: images })}
        onPendingFilesChange={(files) => onChange({ costumeFiles: files })}
        onFiles={onCostumeFiles}
        onPreview={onPreview}
        onPreviewUrl={onPreviewUrl}
      />

      <EditableMediaField
        label="헤어"
        value={draft.hair}
        placeholder="묶음, 생머리, 가발"
        images={draft.hairImages}
        pendingFiles={draft.hairFiles}
        title={draft.actorRole || draft.actorName}
        onValueChange={(value) => onChange({ hair: value })}
        onImagesChange={(images) => onChange({ hairImages: images })}
        onPendingFilesChange={(files) => onChange({ hairFiles: files })}
        onFiles={onHairFiles}
        onPreview={onPreview}
        onPreviewUrl={onPreviewUrl}
      />

      <div className="col-span-2 flex items-start justify-end sm:col-span-1">
        <IconButton label="배역 삭제" danger compact onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </IconButton>
      </div>
    </article>
  );
}

function EditableMediaField({
  label,
  value,
  placeholder,
  images,
  pendingFiles,
  title,
  onValueChange,
  onImagesChange,
  onPendingFilesChange,
  onFiles,
  onPreview,
  onPreviewUrl
}: {
  label: string;
  value: string;
  placeholder: string;
  images: CostumeImage[];
  pendingFiles: PendingFile[];
  title: string;
  onValueChange: (value: string) => void;
  onImagesChange: (images: CostumeImage[]) => void;
  onPendingFilesChange: (files: PendingFile[]) => void;
  onFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onPreview: (image: CostumeImage) => void;
  onPreviewUrl: (url: string) => void;
}) {
  return (
    <div className="col-span-2 grid min-w-0 content-start gap-1 sm:col-span-1">
      <label className="grid gap-0.5">
        <span className="text-[9px] font-black leading-4 text-field-muted sm:sr-only">{label}</span>
        <input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          className={compactInputClass}
        />
      </label>
      <div className="flex max-w-full items-start gap-1.5 overflow-x-auto pb-1">
        {images.map((image) => (
          <div key={image.path} className="relative h-32 w-32 shrink-0 border border-field-border bg-field-soft">
            <button type="button" onClick={() => onPreview(image)} className="h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={`${title} ${label}`} className="h-full w-full object-contain" />
            </button>
            <button
              type="button"
              onClick={() => onImagesChange(images.filter((item) => item.path !== image.path))}
              className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white/95 text-field-danger"
              aria-label={`저장 시 ${label} 이미지 삭제`}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
        {pendingFiles.map((pending) => (
          <PendingImagePreview
            key={pending.id}
            pending={pending}
            title={`${title} ${label}`}
            onPreview={onPreviewUrl}
            onRemove={() => onPendingFilesChange(pendingFiles.filter((item) => item.id !== pending.id))}
          />
        ))}
        <label className="grid min-h-9 w-20 shrink-0 cursor-pointer place-items-center border border-dashed border-field-secondary bg-field-light px-1.5 py-1 text-[10px] font-black text-field-primary">
          <span className="flex items-center gap-1"><ImagePlus className="h-4 w-4" aria-hidden />+ 사진</span>
          <input type="file" accept="image/*,.heic,.heif" multiple className="sr-only" onChange={onFiles} />
        </label>
      </div>
    </div>
  );
}

function PendingImagePreview({
  pending,
  title,
  onPreview,
  onRemove
}: {
  pending: PendingFile;
  title: string;
  onPreview: (url: string) => void;
  onRemove: () => void;
}) {
  const url = useMemo(() => URL.createObjectURL(pending.file), [pending.file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="relative h-32 w-32 shrink-0 border border-amber-300 bg-field-soft">
      <button type="button" onClick={() => onPreview(url)} className="h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`${title} 새 이미지`} className="h-full w-full object-contain" />
      </button>
      <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-bold text-white">저장 전</span>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white/95 text-field-danger"
        aria-label="선택한 이미지 제외"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function ReadOnlyMediaField({
  label,
  value,
  images,
  title,
  onPreview
}: {
  label: string;
  value: string;
  images: CostumeImage[];
  title: string;
  onPreview: (image: CostumeImage) => void;
}) {
  return (
    <div className="col-span-2 grid min-w-0 content-start gap-1 sm:col-span-1">
      <div>
        <span className="text-[9px] font-black leading-4 text-field-muted sm:sr-only">{label}</span>
        <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs font-bold leading-5 text-field-text">{value || "미입력"}</p>
      </div>
      {images.length > 0 ? <div className="flex gap-1.5 overflow-x-auto pb-1">
        {images.map((image) => (
          <button key={image.path} type="button" onClick={() => onPreview(image)} className="h-32 w-32 shrink-0 border border-field-border bg-field-soft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={`${title} ${label}`} className="h-full w-full object-contain" />
          </button>
        ))}
      </div> : <p className="text-[10px] font-bold text-field-muted">이미지 없음</p>}
    </div>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-black leading-4 text-field-muted sm:hidden">{label}</dt>
      <dd className="line-clamp-2 whitespace-pre-wrap break-words text-xs font-bold leading-5 text-field-text">{value || "미입력"}</dd>
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
  compact = false,
  className = "",
  onClick,
  children
}: {
  label: string;
  danger?: boolean;
  compact?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`grid shrink-0 place-items-center rounded-full border border-field-border bg-white ${compact ? "h-8 w-8" : "h-9 w-9"} ${danger ? "text-field-danger" : "text-field-text"} ${className}`}
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

function CompactField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 content-start gap-0.5">
      <span className="text-[9px] font-black leading-4 text-field-muted sm:sr-only">{label}</span>
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
    costumeImages: item.images.filter((image) => image.fieldType !== "hair"),
    hairImages: item.images.filter((image) => image.fieldType === "hair"),
    costumeFiles: [],
    hairFiles: []
  };
}

function createTemporaryCostume(
  projectId: string,
  sceneId: string,
  sceneNo: string,
  actorRole: string,
  actorName: string,
  sortOrder: number,
  now: string
): ProjectCostume {
  return {
    id: createTemporaryId("item"),
    projectId,
    costumeSceneId: sceneId,
    sceneNo,
    actorRole,
    actorName,
    costumeContent: "",
    provider: "",
    hair: "",
    images: [],
    sortOrder,
    createdAt: now,
    updatedAt: now
  };
}

function createTemporaryId(kind: "scene" | "item") {
  return `${tempPrefix}${kind}-${crypto.randomUUID()}`;
}

function isTemporaryId(id: string) {
  return id.startsWith(tempPrefix);
}

function dedupeActors(actors: ProjectActor[]) {
  const seen = new Set<string>();
  return actors.filter((actor) => {
    const key = normalizeActorKey(actor.role, actor.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sceneOptionLabel(scene: ProjectSceneItem) {
  return [scene.sceneNo, scene.mainLocation, scene.subLocation].filter(Boolean).join(" · ") || "번호 없는 씬";
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

const compactInputClass = "min-h-8 w-full rounded-md border border-field-border bg-white px-2 py-0.5 text-xs leading-5 outline-none focus:border-field-primary";

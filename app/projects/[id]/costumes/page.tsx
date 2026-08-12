"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ImagePlus, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { AutosaveStatus } from "@/components/AutosaveStatus";
import { PageLoader, SectionLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { useProjectDeleteUndo } from "@/components/ProjectDeleteUndoProvider";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import {
  useAutoContextualGuide,
  useContextualGuideAnchor
} from "@/components/guides/ContextualGuideProvider";
import { Button } from "@/components/ui/Button";
import {
  getProjectCostumeSceneOverview,
  ProjectCostumeBulkSaveError,
  deleteProjectCostume,
  deleteProjectCostumeImage,
  deleteProjectCostumeScene,
  finalizeDeletedProjectCostume,
  finalizeDeletedProjectCostumeImage,
  finalizeDeletedProjectCostumeScene,
  restoreDeletedProjectCostume,
  restoreDeletedProjectCostumeImage,
  restoreDeletedProjectCostumeScene,
  saveProjectCostumeSnapshot,
  saveProjectCostume,
  updateProjectCostumeScene,
  type ProjectCostumeBulkSaveInput,
  type ProjectCostumeBulkSaveResult
} from "@/lib/data/projectReferenceAssets";
import type { DailyPlanListItem } from "@/lib/data/dailyPlans";
import { getProjectBasicInfo } from "@/lib/data/projects";
import { getProjectSceneList } from "@/lib/data/sceneList";
import { listShots } from "@/lib/data/shots";
import { auditQuery, isQueryAuditEnabled } from "@/lib/queryAudit";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useKeyedAutosave } from "@/hooks/useKeyedAutosave";
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
  seedAllBasicActors?: boolean;
};

type CostumeAutosaveEntity =
  | {
    key: string;
    kind: "scene";
    sceneId: string;
    sceneNo: string;
    sceneTitle: string;
    episodeNumbers: number[];
  }
  | {
    key: string;
    kind: "item";
    itemId: string;
    costumeSceneId: string;
    actorRole: string;
    actorName: string;
    costumeContent: string;
    provider: string;
    hair: string;
    sortOrder: number;
    keepCostumeImagePaths: string[];
    keepHairImagePaths: string[];
    canAutosave: boolean;
  };

type CostumeAutosaveResult =
  | { kind: "scene"; scene: ProjectCostumeScene }
  | { kind: "item"; item: ProjectCostume };

const providerOptions = ["소지", "대여", "구입"];
const tempPrefix = "costume-local-";

export default function ProjectCostumesPage() {
  const { role } = useProjectAccess();
  const { deleteWithUndo } = useProjectDeleteUndo();
  const {
    projectId,
    project,
    dailyPlans,
    isLoading: isWorkspaceLoading
  } = useProjectWorkspace();
  const canEdit = role === "admin";
  const [projectName, setProjectName] = useState("");
  const [scenes, setScenes] = useState<ProjectCostumeScene[]>([]);
  const [actors, setActors] = useState<ProjectActor[]>([]);
  const [sceneOptions, setSceneOptions] = useState<ProjectSceneItem[]>([]);
  const [sceneActorRoles, setSceneActorRoles] = useState<string[]>([]);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [automaticEpisodesByScene, setAutomaticEpisodesByScene] = useState<Map<string, Set<number>>>(new Map());
  const [selectedDailyPlanId, setSelectedDailyPlanId] = useState("");
  const [dailyPlanSceneKeys, setDailyPlanSceneKeys] = useState<Set<string> | null>(null);
  const [expandedSceneIds, setExpandedSceneIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, CostumeDraft>>({});
  const [deletedSceneIds, setDeletedSceneIds] = useState<Set<string>>(new Set());
  const [deletedItemIds, setDeletedItemIds] = useState<Set<string>>(new Set());
  const [sceneDraft, setSceneDraft] = useState<SceneDraft | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingCostumeDeleteCount, setPendingCostumeDeleteCount] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ scenes: number; items: number; stage: string } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const saveLockRef = useRef(false);
  const dirtyRef = useRef(false);
  const scenesRef = useRef<ProjectCostumeScene[]>([]);
  const draftsRef = useRef<Record<string, CostumeDraft>>({});
  const deletedSceneIdsRef = useRef(new Set<string>());
  const deletedItemIdsRef = useRef(new Set<string>());
  const savedCostumeEntityFingerprintsRef = useRef(new Map<string, string>());
  const pendingCostumeDeleteKeysRef = useRef(new Set<string>());
  const activeCostumeProjectIdRef = useRef(projectId);
  const loadRequestRef = useRef(0);
  scenesRef.current = scenes;
  draftsRef.current = drafts;
  deletedSceneIdsRef.current = deletedSceneIds;
  deletedItemIdsRef.current = deletedItemIds;
  activeCostumeProjectIdRef.current = projectId;
  const wardrobeGuideAnchorRef = useContextualGuideAnchor("wardrobe.main");
  useAutoContextualGuide(
    "wardrobe.intro",
    !isLoading && !isWorkspaceLoading && Boolean(project)
  );

  const load = useCallback(async () => {
    if (!projectId || isWorkspaceLoading || saveLockRef.current || dirtyRef.current) return;
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setIsLoading(true);
    try {
      const [costumeOverview, basicInfo, sceneList] = await Promise.all([
        auditQuery(
          "costume.loadCostumeScenesAndItems",
          "app/projects/[id]/costumes/page.tsx:load",
          () => getProjectCostumeSceneOverview(projectId)
        ),
        auditQuery(
          "costume.loadProjectBasicInfo",
          "app/projects/[id]/costumes/page.tsx:load",
          () => getProjectBasicInfo(projectId)
        ).catch(() => null),
        auditQuery(
          "costume.loadSceneList",
          "app/projects/[id]/costumes/page.tsx:load",
          () => getProjectSceneList(projectId)
        ).catch(() => null)
      ]);
      if (requestId !== loadRequestRef.current || saveLockRef.current || dirtyRef.current) return;
      const costumeScenes = costumeOverview.scenes;
      const automaticEpisodes = buildAutomaticEpisodesByScene(dailyPlans);
      const scenesWithAutomaticEpisodes = costumeScenes.map((scene) => ({
        ...scene,
        episodeNumbers: mergeEpisodeNumbers(
          scene.episodeNumbers,
          automaticEpisodes.get(normalizeSceneNumber(scene.sceneNo))
        )
      }));
      const loadedDrafts = Object.fromEntries(
        costumeScenes.flatMap((scene) => scene.items.map((item) => [item.id, toDraft(item)]))
      );
      setProjectName(project?.name ?? "프로젝트");
      setScenes(scenesWithAutomaticEpisodes);
      setActors(basicInfo?.actors ?? []);
      setSceneOptions(sceneList?.items ?? []);
      setSceneActorRoles(sceneList?.actorRoles ?? []);
      setTotalEpisodes(Math.max(
        0,
        basicInfo?.totalEpisodes
          ?? project?.basicInfo?.totalEpisodes
          ?? costumeOverview.totalEpisodes
      ));
      setAutomaticEpisodesByScene(automaticEpisodes);
      setDrafts(loadedDrafts);
      setDeletedSceneIds(new Set());
      setDeletedItemIds(new Set());
      // Episodes inferred from daily plans are derived display state. Loading them must
      // establish a clean autosave baseline rather than mutate the server on page entry.
      dirtyRef.current = false;
      setIsDirty(false);
      savedCostumeEntityFingerprintsRef.current = new Map(
        buildCostumeAutosaveEntities(scenesWithAutomaticEpisodes, loadedDrafts).map((entity) => (
          [entity.key, costumeAutosaveEntityFingerprint(entity)]
        ))
      );
      setExpandedSceneIds((current) => new Set(
        [...current].filter((id) => costumeScenes.some((scene) => scene.id === id))
      ));
      setErrorMessage("");
      setNoticeMessage("");
    } catch (error) {
      if (requestId === loadRequestRef.current && !saveLockRef.current && !dirtyRef.current) {
        setErrorMessage(error instanceof Error ? error.message : "씬별 의상 자료를 불러오지 못했습니다.");
      }
    } finally {
      if (requestId === loadRequestRef.current) setIsLoading(false);
    }
  }, [dailyPlans, isWorkspaceLoading, project, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasExplicitPendingChanges = hasExplicitCostumePendingChanges(
    scenes,
    drafts,
    deletedSceneIds,
    deletedItemIds
  );

  useUnsavedChangesGuard(canEdit && hasExplicitPendingChanges);

  useEffect(() => {
    if (!projectId || !selectedDailyPlanId) {
      setDailyPlanSceneKeys(null);
      setIsFiltering(false);
      return;
    }
    let cancelled = false;
    setIsFiltering(true);
    void auditQuery(
      "costume.filter.loadSelectedPlanShots",
      "app/projects/[id]/costumes/page.tsx:selectedDailyPlanId effect",
      () => listShots(projectId, selectedDailyPlanId)
    )
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
    if (saveLockRef.current) return;
    dirtyRef.current = true;
    setIsDirty(true);
    setNoticeMessage(message);
    setErrorMessage("");
  }

  function updateDraft(id: string, patch: Partial<CostumeDraft>) {
    if (saveLockRef.current) return;
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

  function handleImportAllScenes() {
    if (!projectId || !canEdit || saveLockRef.current) return;
    const existingKeys = new Set(scenes.map((scene) => normalizeSceneNumber(scene.sceneNo)));
    const addedKeys = new Set<string>();
    const now = new Date().toISOString();
    const newScenes = sceneOptions.flatMap((sourceScene) => {
      const sceneKey = normalizeSceneNumber(sourceScene.sceneNo);
      if (!sceneKey || existingKeys.has(sceneKey) || addedKeys.has(sceneKey)) return [];
      addedKeys.add(sceneKey);
      const sceneId = createTemporaryId("scene");
      const sceneNo = displaySceneNumber(sourceScene.sceneNo);
      const seededActors = getPresentSceneActors(sourceScene, actors, sceneActorRoles);
      const items = seededActors.map((actor, index) => createTemporaryCostume(
        projectId,
        sceneId,
        sceneNo,
        actor.role,
        actor.name,
        index,
        now
      ));
      return [{
        id: sceneId,
        projectId,
        sceneNo,
        sceneTitle: "",
        episodeNumbers: mergeEpisodeNumbers([], automaticEpisodesByScene.get(sceneKey)),
        sortOrder: scenes.length + addedKeys.size - 1,
        items,
        createdAt: now,
        updatedAt: now
      } satisfies ProjectCostumeScene];
    });

    if (newScenes.length === 0) {
      setNoticeMessage("추가할 씬리스트 씬이 없습니다.");
      setErrorMessage("");
      return;
    }
    setScenes((current) => [...current, ...newScenes]);
    setDrafts((current) => ({
      ...current,
      ...Object.fromEntries(newScenes.flatMap((scene) => (
        scene.items.map((item) => [item.id, toDraft(item)])
      )))
    }));
    // 새 씬 ID는 expandedSceneIds에 넣지 않아 기존 씬의 펼침 상태만 유지합니다.
    markDirty(`씬리스트의 새 씬 ${newScenes.length}개를 접힌 상태로 추가했습니다. 전체 저장을 눌러 반영해주세요.`);
  }

  function handleEpisodeToggle(scene: ProjectCostumeScene, episode: number) {
    if (!canEdit || saveLockRef.current) return;
    const sceneKey = normalizeSceneNumber(scene.sceneNo);
    if (automaticEpisodesByScene.get(sceneKey)?.has(episode)) return;
    setScenes((current) => current.map((entry) => {
      if (entry.id !== scene.id) return entry;
      const checked = entry.episodeNumbers.includes(episode);
      return {
        ...entry,
        episodeNumbers: checked
          ? entry.episodeNumbers.filter((value) => value !== episode)
          : [...entry.episodeNumbers, episode].sort((left, right) => left - right)
      };
    }));
    markDirty("씬 회차 체크를 변경했습니다. 전체 저장을 눌러 반영해주세요.");
  }

  function handleSceneListSelection(sceneId: string) {
    if (!sceneDraft) return;
    const selected = sceneOptions.find((item) => item.id === sceneId);
    setSceneDraft({
      ...sceneDraft,
      selectedSceneId: sceneId,
      seedAllBasicActors: false,
      sceneNo: selected ? displaySceneNumber(selected.sceneNo) : sceneDraft.sceneNo
    });
  }

  function handleSceneSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !sceneDraft || !canEdit || saveLockRef.current) return;
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
      const selectedScene = sceneOptions.find((item) => item.id === sceneDraft.selectedSceneId);
      const presentActors = selectedScene
        ? getPresentSceneActors(selectedScene, actors, sceneActorRoles)
        : [];
      const seededActors = presentActors.length > 0
        ? presentActors
        : sceneDraft.seedAllBasicActors
          ? dedupeActors(actors)
          : [];
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
        episodeNumbers: mergeEpisodeNumbers(
          [],
          automaticEpisodesByScene.get(normalizeSceneNumber(sceneDraft.sceneNo))
        ),
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

  function handleSceneActorSeed(scene: ProjectCostumeScene) {
    if (!projectId || !canEdit || saveLockRef.current) return;
    const sourceScene = findMatchingSceneOption(scene.sceneNo, sceneOptions);
    const presentActors = sourceScene
      ? getPresentSceneActors(sourceScene, actors, sceneActorRoles)
      : [];
    const existingKeys = new Set(scene.items.map((item) => {
      const draft = drafts[item.id];
      return normalizeActorKey(
        draft?.actorRole ?? item.actorRole,
        draft?.actorName ?? item.actorName
      );
    }));
    const missingActors = presentActors.filter((actor) => {
      const key = normalizeActorKey(actor.role, actor.name);
      if (!key || existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });

    if (missingActors.length === 0) {
      setNoticeMessage("씬리스트의 등장 배역이 이미 모두 등록되어 있습니다.");
      setErrorMessage("");
      return;
    }

    const now = new Date().toISOString();
    const items = missingActors.map((actor, index) => createTemporaryCostume(
      projectId,
      scene.id,
      scene.sceneNo,
      actor.role,
      actor.name,
      scene.items.length + index,
      now
    ));
    setScenes((current) => current.map((entry) => entry.id === scene.id
      ? { ...entry, items: [...entry.items, ...items] }
      : entry));
    setDrafts((current) => ({
      ...current,
      ...Object.fromEntries(items.map((item) => [item.id, toDraft(item)]))
    }));
    markDirty(`씬리스트 등장 배역 ${missingActors.length}명을 보충했습니다. 전체 저장을 눌러 반영해주세요.`);
  }

  function handleDirectActorAdd(scene: ProjectCostumeScene) {
    if (!projectId || !canEdit || saveLockRef.current) return;
    const now = new Date().toISOString();
    const item = createTemporaryCostume(
      projectId,
      scene.id,
      scene.sceneNo,
      "",
      "",
      scene.items.length,
      now
    );
    setScenes((current) => current.map((entry) => entry.id === scene.id
      ? { ...entry, items: [...entry.items, item] }
      : entry));
    setDrafts((current) => ({ ...current, [item.id]: toDraft(item) }));
    setExpandedSceneIds((current) => new Set([...current, scene.id]));
    markDirty("빈 배역 행을 추가했습니다. 내용을 입력한 뒤 전체 저장을 눌러주세요.");
  }

  function handleSceneDelete(scene: ProjectCostumeScene) {
    if (!projectId || !canEdit || saveLockRef.current) return;
    const originalIndex = scenesRef.current.findIndex((item) => item.id === scene.id);
    if (originalIndex < 0) return;
    const beforeId = originalIndex > 0 ? scenesRef.current[originalIndex - 1].id : "";
    const afterId = originalIndex + 1 < scenesRef.current.length
      ? scenesRef.current[originalIndex + 1].id
      : "";
    const sceneDrafts = Object.fromEntries(scene.items.flatMap((item) => (
      draftsRef.current[item.id] ? [[item.id, draftsRef.current[item.id]]] : []
    )));
    const wasExpanded = expandedSceneIds.has(scene.id);
    const isPersisted = !isTemporaryId(scene.id);
    const operationKey = `costume-scene:${scene.id}`;
    if (pendingCostumeDeleteKeysRef.current.has(operationKey)) return;
    const preDeleteFlush = isPersisted
      ? costumeAutosave.flushKeys([
          `scene:${scene.id}`,
          ...scene.items.map((item) => `item:${item.id}`)
        ])
      : Promise.resolve(true);
    let receipt = "";
    let deleteFailed = false;
    let restoredLocally = false;
    let pendingReleased = false;
    const releasePending = () => {
      if (pendingReleased || !isPersisted) return;
      pendingReleased = true;
      pendingCostumeDeleteKeysRef.current.delete(operationKey);
      setPendingCostumeDeleteCount((current) => Math.max(0, current - 1));
    };
    deleteWithUndo({
      key: operationKey,
      label: sceneLabel(scene),
      removeLocal: () => {
        if (!scenesRef.current.some((item) => item.id === scene.id)) return;
        const nextScenes = scenesRef.current.filter((item) => item.id !== scene.id);
        const nextDrafts = { ...draftsRef.current };
        scene.items.forEach((item) => delete nextDrafts[item.id]);
        scenesRef.current = nextScenes;
        draftsRef.current = nextDrafts;
        setScenes(nextScenes);
        setDrafts(nextDrafts);
        setExpandedSceneIds((current) => {
          const next = new Set(current);
          next.delete(scene.id);
          return next;
        });
        if (isPersisted) {
          pendingCostumeDeleteKeysRef.current.add(operationKey);
          setPendingCostumeDeleteCount((current) => current + 1);
        }
        markDirty("의상 씬을 삭제했습니다. Command/Ctrl+Z로 되돌릴 수 있습니다.");
      },
      restoreLocal: () => {
        restoredLocally = true;
        if (!scenesRef.current.some((item) => item.id === scene.id)) {
          const nextScenes = insertCostumeSceneByAnchors(
            scenesRef.current,
            scene,
            beforeId,
            afterId,
            originalIndex
          );
          const nextDrafts = { ...draftsRef.current, ...sceneDrafts };
          scenesRef.current = nextScenes;
          draftsRef.current = nextDrafts;
          setScenes(nextScenes);
          setDrafts(nextDrafts);
          if (wasExpanded) setExpandedSceneIds((current) => new Set([...current, scene.id]));
          markDirty("의상 씬 삭제를 되돌렸습니다.");
        }
        if (deleteFailed) releasePending();
      },
      deleteRemote: async () => {
        try {
          if (isPersisted) {
            if (!await preDeleteFlush) {
              throw new Error("삭제할 의상 씬의 자동 저장에 실패했습니다.");
            }
            receipt = await deleteProjectCostumeScene(projectId, scene.id);
            releasePending();
          }
          reconcileCostumeDirtyAfterDelete();
        } catch (error) {
          deleteFailed = true;
          if (restoredLocally) releasePending();
          throw error;
        }
      },
      restoreRemote: async () => {
        if (isPersisted) await restoreDeletedProjectCostumeScene(projectId, receipt);
        releasePending();
        reconcileCostumeDirtyAfterDelete();
      },
      finalize: isPersisted
        ? () => finalizeDeletedProjectCostumeScene(projectId, receipt)
        : undefined
    });
  }

  function handleFiles(id: string, fieldType: ImageFieldType, event: ChangeEvent<HTMLInputElement>) {
    if (saveLockRef.current) return;
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

  function handleItemDelete(scene: ProjectCostumeScene, item: ProjectCostume) {
    if (!projectId || !canEdit || saveLockRef.current) return;
    const currentScene = scenesRef.current.find((entry) => entry.id === scene.id);
    const originalIndex = currentScene?.items.findIndex((candidate) => candidate.id === item.id) ?? -1;
    if (!currentScene || originalIndex < 0) return;
    const beforeId = originalIndex > 0 ? currentScene.items[originalIndex - 1].id : "";
    const afterId = originalIndex + 1 < currentScene.items.length
      ? currentScene.items[originalIndex + 1].id
      : "";
    const itemDraft = draftsRef.current[item.id] ?? toDraft(item);
    const isPersisted = !isTemporaryId(item.id);
    const operationKey = `costume-item:${item.id}`;
    if (pendingCostumeDeleteKeysRef.current.has(operationKey)) return;
    const preDeleteFlush = isPersisted
      ? costumeAutosave.flushKeys([`item:${item.id}`])
      : Promise.resolve(true);
    let receipt = "";
    let deleteFailed = false;
    let restoredLocally = false;
    let pendingReleased = false;
    const releasePending = () => {
      if (pendingReleased || !isPersisted) return;
      pendingReleased = true;
      pendingCostumeDeleteKeysRef.current.delete(operationKey);
      setPendingCostumeDeleteCount((current) => Math.max(0, current - 1));
    };
    deleteWithUndo({
      key: operationKey,
      label: item.actorRole.trim() || item.actorName.trim() || "의상 배역",
      removeLocal: () => {
        const owner = scenesRef.current.find((entry) => entry.id === scene.id);
        if (!owner?.items.some((candidate) => candidate.id === item.id)) return;
        const nextScenes = scenesRef.current.map((entry) => entry.id === scene.id
          ? { ...entry, items: entry.items.filter((candidate) => candidate.id !== item.id) }
          : entry);
        if (nextScenes === scenesRef.current) return;
        const nextDrafts = { ...draftsRef.current };
        delete nextDrafts[item.id];
        scenesRef.current = nextScenes;
        draftsRef.current = nextDrafts;
        setScenes(nextScenes);
        setDrafts(nextDrafts);
        if (isPersisted) {
          pendingCostumeDeleteKeysRef.current.add(operationKey);
          setPendingCostumeDeleteCount((current) => current + 1);
        }
        markDirty("의상 배역을 삭제했습니다. Command/Ctrl+Z로 되돌릴 수 있습니다.");
      },
      restoreLocal: () => {
        restoredLocally = true;
        const owner = scenesRef.current.find((entry) => entry.id === scene.id);
        if (owner && !owner.items.some((candidate) => candidate.id === item.id)) {
          const restoredItems = insertCostumeItemByAnchors(
            owner.items,
            item,
            beforeId,
            afterId,
            originalIndex
          );
          const nextScenes = scenesRef.current.map((entry) => entry.id === owner.id
            ? { ...entry, items: restoredItems }
            : entry);
          const nextDrafts = { ...draftsRef.current, [item.id]: itemDraft };
          scenesRef.current = nextScenes;
          draftsRef.current = nextDrafts;
          setScenes(nextScenes);
          setDrafts(nextDrafts);
          markDirty("의상 배역 삭제를 되돌렸습니다.");
        }
        if (deleteFailed) releasePending();
      },
      deleteRemote: async () => {
        try {
          if (isPersisted) {
            if (!await preDeleteFlush) {
              throw new Error("삭제할 의상 배역의 자동 저장에 실패했습니다.");
            }
            receipt = await deleteProjectCostume(projectId, item.id);
            releasePending();
          }
          reconcileCostumeDirtyAfterDelete();
        } catch (error) {
          deleteFailed = true;
          if (restoredLocally) releasePending();
          throw error;
        }
      },
      restoreRemote: async () => {
        if (isPersisted) await restoreDeletedProjectCostume(projectId, receipt);
        releasePending();
        reconcileCostumeDirtyAfterDelete();
      },
      finalize: isPersisted
        ? () => finalizeDeletedProjectCostume(projectId, receipt)
        : undefined
    });
  }

  function handleSavedImageDelete(item: ProjectCostume, image: CostumeImage) {
    if (!projectId || !canEdit || saveLockRef.current || isTemporaryId(item.id)) return;
    const originalDraft = draftsRef.current[item.id] ?? toDraft(item);
    const field = image.fieldType === "hair" ? "hairImages" : "costumeImages";
    const originalIndex = originalDraft[field].findIndex((candidate) => candidate.path === image.path);
    if (originalIndex < 0) return;
    const operationKey = `costume-image:${item.id}:${image.path}`;
    if (pendingCostumeDeleteKeysRef.current.has(operationKey)) return;
    // Capture and start the old-value flush before removeLocal changes any keep
    // paths. This request can finish in the background without delaying the UI.
    const preDeleteFlush = costumeAutosave.flushKeys([`item:${item.id}`]);
    let receipt = "";
    let deleteFailed = false;
    let restoredLocally = false;
    let pendingReleased = false;
    const releasePending = () => {
      if (pendingReleased) return;
      pendingReleased = true;
      pendingCostumeDeleteKeysRef.current.delete(operationKey);
      setPendingCostumeDeleteCount((current) => Math.max(0, current - 1));
    };
    deleteWithUndo({
      key: operationKey,
      label: image.fieldType === "hair" ? "헤어 이미지" : "의상 이미지",
      removeLocal: () => {
        const current = draftsRef.current[item.id];
        if (!current?.[field].some((candidate) => candidate.path === image.path)) return;
        const nextDraft = {
          ...current,
          [field]: current[field].filter((candidate) => candidate.path !== image.path)
        };
        const nextDrafts = { ...draftsRef.current, [item.id]: nextDraft };
        draftsRef.current = nextDrafts;
        setDrafts(nextDrafts);
        pendingCostumeDeleteKeysRef.current.add(operationKey);
        setPendingCostumeDeleteCount((current) => current + 1);
        markDirty("의상 이미지를 삭제했습니다. Command/Ctrl+Z로 되돌릴 수 있습니다.");
      },
      restoreLocal: () => {
        restoredLocally = true;
        const current = draftsRef.current[item.id];
        if (current && !current[field].some((candidate) => candidate.path === image.path)) {
          const nextImages = [...current[field]];
          nextImages.splice(Math.max(0, Math.min(originalIndex, nextImages.length)), 0, image);
          const nextDraft = { ...current, [field]: nextImages };
          const nextDrafts = { ...draftsRef.current, [item.id]: nextDraft };
          draftsRef.current = nextDrafts;
          setDrafts(nextDrafts);
          markDirty("의상 이미지 삭제를 되돌렸습니다.");
        }
        if (deleteFailed) releasePending();
      },
      deleteRemote: async () => {
        try {
          if (!await preDeleteFlush) {
            throw new Error("삭제할 의상 이미지의 자동 저장에 실패했습니다.");
          }
          receipt = await deleteProjectCostumeImage(projectId, item.id, image.path);
          const nextScenes = scenesRef.current.map((scene) => ({
            ...scene,
            items: scene.items.map((candidate) => candidate.id === item.id
              ? { ...candidate, images: candidate.images.filter((entry) => entry.path !== image.path) }
              : candidate)
          }));
          scenesRef.current = nextScenes;
          setScenes(nextScenes);
          const currentEntity = buildCostumeAutosaveEntities(nextScenes, draftsRef.current)
            .find((entity) => entity.kind === "item" && entity.itemId === item.id);
          if (currentEntity?.kind === "item" && currentEntity.canAutosave) {
            savedCostumeEntityFingerprintsRef.current.set(
              currentEntity.key,
              costumeAutosaveEntityFingerprint(currentEntity)
            );
            costumeAutosave.markSaved([currentEntity]);
          }
          reconcileCostumeDirtyAfterDelete();
        } catch (error) {
          deleteFailed = true;
          if (restoredLocally) releasePending();
          throw error;
        }
      },
      restoreRemote: async () => {
        try {
          const restoredItem = await restoreDeletedProjectCostumeImage(projectId, receipt);
          if (restoredItem) {
            const nextScenes = scenesRef.current.map((scene) => ({
              ...scene,
              items: scene.items.map((candidate) => candidate.id === item.id ? restoredItem : candidate)
            }));
            scenesRef.current = nextScenes;
            setScenes(nextScenes);
          }
          const currentEntity = buildCostumeAutosaveEntities(scenesRef.current, draftsRef.current)
            .find((entity) => entity.kind === "item" && entity.itemId === item.id);
          if (currentEntity) {
            savedCostumeEntityFingerprintsRef.current.set(
              currentEntity.key,
              costumeAutosaveEntityFingerprint(currentEntity)
            );
            costumeAutosave.markSaved([currentEntity]);
          }
          reconcileCostumeDirtyAfterDelete();
        } finally {
          releasePending();
        }
      },
      finalize: async () => {
        try {
          await finalizeDeletedProjectCostumeImage(projectId, receipt);
        } finally {
          releasePending();
        }
      }
    });
  }

  async function handleSaveAll() {
    if (pendingCostumeDeleteKeysRef.current.size > 0) {
      setNoticeMessage("삭제를 반영한 뒤 전체 저장을 계속할 수 있습니다.");
      return;
    }
    await costumeAutosave.flush();
    // flush() can synchronously finish the metadata autosave and clear dirtyRef.
    // The render-time isDirty value is stale across this await and would double-save.
    if (!projectId || !canEdit || !dirtyRef.current || isSaving || saveLockRef.current) return;
    for (const scene of scenes) {
      for (const item of scene.items) {
        const draft = drafts[item.id];
        if (!draft?.actorRole.trim() && !draft?.actorName.trim()) {
          setErrorMessage(`"${sceneLabel(scene)}" 씬에 배역과 배우 이름이 모두 비어 있는 항목이 있습니다.`);
          return;
        }
      }
    }

    saveLockRef.current = true;
    setIsSaving(true);
    setErrorMessage("");
    setNoticeMessage("");
    const snapshotScenes = scenes.map((scene) => ({
      ...scene,
      items: scene.items.map((item) => ({ ...item }))
    }));
    const snapshotDrafts = { ...drafts };
    const saveInput = buildCostumeSaveInput(
      snapshotScenes,
      snapshotDrafts,
      deletedSceneIds,
      deletedItemIds
    );
    const sceneCount = saveInput.scenes.length;
    const itemCount = saveInput.scenes.reduce((total, scene) => total + scene.items.length, 0);
    setSaveProgress({ scenes: sceneCount, items: itemCount, stage: "DB 일괄 저장" });
    logCostumeSaveAudit({
      event: "save_start",
      scenes: sceneCount,
      items: itemCount,
      deletedScenes: saveInput.deletedSceneIds.length,
      deletedItems: saveInput.deletedItemIds.length,
      pendingFileItems: countPendingFileItems(snapshotScenes, snapshotDrafts)
    });

    let bulkResult: ProjectCostumeBulkSaveResult | null = null;
    const uploadedItems = new Map<string, ProjectCostume>();
    try {
      bulkResult = await auditQuery(
        "costume.save.batchMetadata",
        "app/projects/[id]/costumes/page.tsx:handleSaveAll",
        () => saveProjectCostumeSnapshot(projectId, saveInput)
      );
      logCostumeSaveAudit({
        event: "batch_saved",
        ...bulkResult.verification,
        ...bulkResult.timings
      });

      setDeletedSceneIds(new Set());
      setDeletedItemIds(new Set());
      setSaveProgress({ scenes: sceneCount, items: itemCount, stage: "이미지 저장" });
      const pendingUploads = collectPendingUploads(
        snapshotScenes,
        snapshotDrafts,
        bulkResult.sceneIdMap,
        bulkResult.itemIdMap
      );
      const uploadResults = await settleInBatches(pendingUploads, 4, async (upload) => (
        auditQuery(
          "costume.save.uploadItemFiles",
          `app/projects/[id]/costumes/page.tsx:${upload.sceneNo}/${upload.actorLabel}`,
          () => saveProjectCostume(projectId, upload.value)
        )
      ));
      const uploadFailures: string[] = [];
      uploadResults.forEach(({ input, result }) => {
        if (result.status === "fulfilled") {
          uploadedItems.set(result.value.id, result.value);
        } else {
          uploadFailures.push(
            `${input.sceneNo} · ${input.actorLabel}: ${
              result.reason instanceof Error ? result.reason.message : String(result.reason)
            }`
          );
        }
      });

      if (uploadFailures.length > 0) {
        const mapped = remapCostumeLocalState(snapshotScenes, snapshotDrafts, bulkResult, uploadedItems);
        setScenes(mapped.scenes);
        setDrafts(mapped.drafts);
        setExpandedSceneIds((current) => new Set(
          [...current].map((id) => bulkResult?.sceneIdMap[id] ?? id)
        ));
        throw new Error(`이미지 저장 실패 항목: ${uploadFailures.join(" / ")}`);
      }

      setSaveProgress({ scenes: sceneCount, items: itemCount, stage: "저장 결과 확인" });
      const mapped = remapCostumeLocalState(
        snapshotScenes,
        snapshotDrafts,
        bulkResult,
        uploadedItems
      );
      const verificationErrors = verifyCostumeSave(
        saveInput,
        snapshotDrafts,
        mapped.scenes,
        bulkResult.sceneIdMap,
        bulkResult.itemIdMap
      );
      logCostumeSaveAudit({
        event: "save_verify",
        scenes: mapped.scenes.length,
        items: mapped.scenes.reduce((total, scene) => total + scene.items.length, 0),
        errors: verificationErrors.length
      });
      if (verificationErrors.length > 0) {
        setScenes(mapped.scenes);
        setDrafts(mapped.drafts);
        setExpandedSceneIds((current) => new Set(
          [...current].map((id) => bulkResult?.sceneIdMap[id] ?? id)
        ));
        throw new Error(`저장 검증 실패: ${verificationErrors.join(" / ")}`);
      }

      setScenes(mapped.scenes);
      setDrafts(mapped.drafts);
      setExpandedSceneIds((current) => new Set(
        [...current].map((id) => bulkResult?.sceneIdMap[id] ?? id)
      ));
      dirtyRef.current = false;
      setIsDirty(false);
      setNoticeMessage("의상 변경사항을 모두 저장했습니다.");
    } catch (error) {
      if (!bulkResult && error instanceof ProjectCostumeBulkSaveError && error.partialResult) {
        bulkResult = error.partialResult;
        const mapped = remapCostumeLocalState(snapshotScenes, snapshotDrafts, bulkResult, uploadedItems);
        setScenes(mapped.scenes);
        setDrafts(mapped.drafts);
        setExpandedSceneIds((current) => new Set(
          [...current].map((id) => bulkResult?.sceneIdMap[id] ?? id)
        ));
        // DB 일괄 요청이 실행된 뒤 검증 단계에서 실패한 경우, 같은 삭제를 재요청하지 않습니다.
        setDeletedSceneIds(new Set());
        setDeletedItemIds(new Set());
      }
      dirtyRef.current = true;
      setIsDirty(true);
      setErrorMessage(error instanceof Error ? error.message : "의상 변경사항을 저장하지 못했습니다.");
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
      setSaveProgress(null);
    }
  }

  const costumeAutosaveEntities = useMemo(
    () => buildCostumeAutosaveEntities(scenes, drafts),
    [drafts, scenes]
  );

  const canAutosaveMetadata = canEdit
    && Boolean(projectId)
    && !isLoading
    && !isSaving
    && !isComposing
    && pendingCostumeDeleteCount === 0;

  const costumeAutosave = useKeyedAutosave<CostumeAutosaveEntity, CostumeAutosaveResult>({
    values: costumeAutosaveEntities,
    getKey: (entity) => entity.key,
    enabled: canAutosaveMetadata,
    delayMs: 1_100,
    scopeKey: `costumes:${projectId ?? "unknown"}`,
    fingerprint: costumeAutosaveEntityFingerprint,
    validate: (entity) => (
      (entity.kind === "scene" || entity.canAutosave)
      && !(entity.kind === "item" && hasPendingCostumeImageDelete(
        pendingCostumeDeleteKeysRef.current,
        entity.itemId
      ))
    ),
    restoreDrafts: (restoredDrafts) => {
      let nextScenes = scenesRef.current;
      let nextDrafts = draftsRef.current;
      let didRestore = false;
      for (const restored of restoredDrafts) {
        const entity = restored.value;
        const savedEntity = restored.savedValue;
        if (entity.kind === "scene") {
          const savedScene = savedEntity?.kind === "scene" ? savedEntity : null;
          if (!savedScene) continue;
          const sceneNoChanged = entity.sceneNo !== savedScene.sceneNo;
          const titleChanged = entity.sceneTitle !== savedScene.sceneTitle;
          const episodesChanged = JSON.stringify(entity.episodeNumbers)
            !== JSON.stringify(savedScene.episodeNumbers);
          if (!sceneNoChanged && !titleChanged && !episodesChanged) continue;
          nextScenes = nextScenes.map((scene) => scene.id === entity.sceneId
            ? {
                ...scene,
                ...(sceneNoChanged ? { sceneNo: entity.sceneNo } : {}),
                ...(titleChanged ? { sceneTitle: entity.sceneTitle } : {}),
                ...(episodesChanged ? { episodeNumbers: [...entity.episodeNumbers] } : {}),
                items: scene.items.map((item) => sceneNoChanged
                  ? { ...item, sceneNo: entity.sceneNo }
                  : item)
              }
            : scene);
          didRestore = true;
          continue;
        }
        const savedItem = savedEntity?.kind === "item" ? savedEntity : null;
        if (!savedItem) continue;
        const currentScene = nextScenes.find((scene) => scene.id === entity.costumeSceneId);
        const currentItem = currentScene?.items.find((item) => item.id === entity.itemId);
        if (!currentItem) continue;
        const currentDraft = nextDrafts[entity.itemId] ?? toDraft(currentItem);
        const restoredPatch: Partial<CostumeDraft> = {};
        if (entity.actorRole !== savedItem.actorRole) restoredPatch.actorRole = entity.actorRole;
        if (entity.actorName !== savedItem.actorName) restoredPatch.actorName = entity.actorName;
        if (entity.costumeContent !== savedItem.costumeContent) restoredPatch.costumeContent = entity.costumeContent;
        if (entity.provider !== savedItem.provider) restoredPatch.provider = entity.provider;
        if (entity.hair !== savedItem.hair) restoredPatch.hair = entity.hair;
        if (Object.keys(restoredPatch).length === 0 && entity.sortOrder === savedItem.sortOrder) continue;
        const mergedDraft = { ...currentDraft, ...restoredPatch };
        nextDrafts = { ...nextDrafts, [entity.itemId]: mergedDraft };
        nextScenes = nextScenes.map((scene) => scene.id === entity.costumeSceneId
          ? {
              ...scene,
              items: scene.items.map((item) => item.id === entity.itemId
                ? {
                    ...item,
                    actorRole: mergedDraft.actorRole,
                    actorName: mergedDraft.actorName,
                    costumeContent: mergedDraft.costumeContent,
                    provider: mergedDraft.provider,
                    hair: mergedDraft.hair,
                    sortOrder: entity.sortOrder !== savedItem.sortOrder ? entity.sortOrder : item.sortOrder
                  }
                : item)
            }
          : scene);
        didRestore = true;
      }
      if (!didRestore) return;
      scenesRef.current = nextScenes;
      draftsRef.current = nextDrafts;
      setScenes(nextScenes);
      setDrafts(nextDrafts);
      dirtyRef.current = true;
      setIsDirty(true);
    },
    save: async (entity) => {
      if (!projectId || saveLockRef.current) throw new Error("의상 정보를 자동 저장할 수 없습니다.");
      if (entity.kind === "scene") {
        const scene = await auditQuery(
          "costume.autosave.scene",
          `app/projects/[id]/costumes/page.tsx:${entity.sceneId}`,
          () => updateProjectCostumeScene(projectId, {
            id: entity.sceneId,
            sceneNo: entity.sceneNo,
            sceneTitle: entity.sceneTitle,
            episodeNumbers: entity.episodeNumbers
          })
        );
        return { kind: "scene", scene };
      }
      if (!entity.actorRole.trim() && !entity.actorName.trim()) {
        throw new Error("배역과 배우 이름을 모두 비워둘 수 없습니다.");
      }
      const item = await auditQuery(
        "costume.autosave.item",
        `app/projects/[id]/costumes/page.tsx:${entity.itemId}`,
        () => saveProjectCostume(projectId, {
          id: entity.itemId,
          costumeSceneId: entity.costumeSceneId,
          actorRole: entity.actorRole,
          actorName: entity.actorName,
          costumeContent: entity.costumeContent,
          provider: entity.provider,
          hair: entity.hair,
          sortOrder: entity.sortOrder,
          keepCostumeImagePaths: entity.keepCostumeImagePaths,
          keepHairImagePaths: entity.keepHairImagePaths,
          costumeFiles: [],
          hairFiles: []
        })
      );
      return { kind: "item", item };
    },
    onSaved: (result, entity) => {
      if (activeCostumeProjectIdRef.current !== projectId) return;
      const submittedFingerprint = costumeAutosaveEntityFingerprint(entity);
      savedCostumeEntityFingerprintsRef.current.set(entity.key, submittedFingerprint);
      const currentEntity = buildCostumeAutosaveEntities(
        scenesRef.current,
        draftsRef.current
      ).find((candidate) => candidate.key === entity.key);
      const submissionIsLatest = Boolean(
        currentEntity
        && costumeAutosaveEntityFingerprint(currentEntity) === submittedFingerprint
      );

      if (submissionIsLatest && result.kind === "scene" && entity.kind === "scene") {
        setScenes((current) => current.map((scene) => scene.id === entity.sceneId
          ? {
              ...scene,
              sceneNo: entity.sceneNo,
              sceneTitle: entity.sceneTitle,
              episodeNumbers: [...entity.episodeNumbers],
              updatedAt: result.scene.updatedAt || scene.updatedAt,
              items: scene.items.map((item) => ({ ...item, sceneNo: entity.sceneNo }))
            }
          : scene));
      } else if (submissionIsLatest && result.kind === "item" && entity.kind === "item") {
        setScenes((current) => current.map((scene) => ({
          ...scene,
          items: scene.items.map((item) => item.id === entity.itemId
            ? {
                ...item,
                actorRole: entity.actorRole,
                actorName: entity.actorName,
                costumeContent: entity.costumeContent,
                provider: entity.provider,
                hair: entity.hair,
                images: result.item.images,
                updatedAt: result.item.updatedAt || item.updatedAt
              }
            : item)
        })));
      }

      const currentEntities = buildCostumeAutosaveEntities(
        scenesRef.current,
        draftsRef.current
      );
      const hasPendingMetadata = currentEntities.some((candidate) => (
        savedCostumeEntityFingerprintsRef.current.get(candidate.key)
          !== costumeAutosaveEntityFingerprint(candidate)
      ));
      const hasExplicitPending = hasExplicitCostumePendingChanges(
        scenesRef.current,
        draftsRef.current,
        deletedSceneIdsRef.current,
        deletedItemIdsRef.current
      );
      if (!hasPendingMetadata && !hasExplicitPending) {
        dirtyRef.current = false;
        setIsDirty(false);
        setNoticeMessage("");
      }
      setErrorMessage("");
    },
    onError: (error) => {
      if (activeCostumeProjectIdRef.current !== projectId) return;
      dirtyRef.current = true;
      setIsDirty(true);
      setErrorMessage(error instanceof Error ? error.message : "의상 정보를 자동 저장하지 못했습니다.");
    }
  });

  function reconcileCostumeDirtyAfterDelete() {
    const currentEntities = buildCostumeAutosaveEntities(
      scenesRef.current,
      draftsRef.current
    );
    const hasPendingMetadata = currentEntities.some((candidate) => (
      savedCostumeEntityFingerprintsRef.current.get(candidate.key)
        !== costumeAutosaveEntityFingerprint(candidate)
    ));
    const hasExplicitPending = hasExplicitCostumePendingChanges(
      scenesRef.current,
      draftsRef.current,
      deletedSceneIdsRef.current,
      deletedItemIdsRef.current
    );
    const dirty = hasPendingMetadata || hasExplicitPending;
    dirtyRef.current = dirty;
    setIsDirty(dirty);
    if (!dirty) setNoticeMessage("");
  }

  useEffect(() => {
    if (isDirty) return;
    savedCostumeEntityFingerprintsRef.current = new Map(
      costumeAutosaveEntities.map((entity) => [entity.key, costumeAutosaveEntityFingerprint(entity)])
    );
    costumeAutosave.markSaved(costumeAutosaveEntities);
  }, [costumeAutosave.markSaved, costumeAutosaveEntities, isDirty]);

  if (isLoading) return <PageLoader />;

  return (
    <>
      <div
        ref={wardrobeGuideAnchorRef}
        className="mx-auto grid w-full max-w-6xl gap-2.5"
        onCompositionStartCapture={() => setIsComposing(true)}
        onCompositionEndCapture={() => setIsComposing(false)}
        onBlur={() => {
          if (canAutosaveMetadata && !isComposing) void costumeAutosave.flush();
        }}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="ui-density-heading font-display break-words font-bold text-field-text">의상</h1>
            <p className="break-words text-xs text-field-muted [overflow-wrap:anywhere]">{projectName} · 씬별 의상표</p>
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
              <Button
                variant="secondary"
                className="min-h-9 px-3 py-1.5 text-xs"
                onClick={handleImportAllScenes}
              >
                <Plus className="h-4 w-4" aria-hidden />
                씬리스트 전체 불러오기
              </Button>
              <Button variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => setSceneDraft({ sceneNo: "", sceneTitle: "" })}>
                <Plus className="h-4 w-4" aria-hidden />
                씬 추가
              </Button>
              <Button className="min-h-9 px-3 py-1.5 text-xs" onClick={() => void handleSaveAll()} disabled={!isDirty || isSaving || pendingCostumeDeleteCount > 0}>
                <Save className="h-4 w-4" aria-hidden />
                {isSaving && saveProgress
                  ? `${saveProgress.stage} · 씬 ${saveProgress.scenes} / 항목 ${saveProgress.items}`
                  : "전체 저장"}
              </Button>
              <AutosaveStatus status={costumeAutosave.status} onRetry={costumeAutosave.retry} />
            </>
          ) : (
            <span className="rounded-md border border-field-border bg-field-panel px-2.5 py-1.5 text-[11px] font-semibold text-field-muted">읽기 전용</span>
          )}
        </div>

        {canEdit && isDirty ? (
          <p className="text-xs font-bold text-field-primary">저장되지 않은 변경사항이 있습니다.</p>
        ) : null}
        {errorMessage ? (
          <p role="alert" className="border border-field-danger bg-field-danger/10 px-3 py-1.5 text-xs font-bold text-field-danger">
            {errorMessage}
          </p>
        ) : null}
        {noticeMessage ? (
          <p role="status" className="border border-field-divider bg-field-soft px-3 py-1.5 text-xs font-bold text-field-subtle">
            {noticeMessage}
          </p>
        ) : null}

        {isFiltering ? (
          <SectionLoader className="min-h-24" />
        ) : filteredScenes.length === 0 ? (
          <div className="rounded-[10px] border border-field-border bg-field-panel px-4 py-12 text-center text-sm text-field-muted">
            {scenes.length === 0 ? "등록된 의상 씬이 없습니다." : "선택한 일촬표에 포함된 의상 씬이 없습니다."}
          </div>
        ) : (
          <div className="grid gap-1.5">
            {filteredScenes.map((scene) => {
              const expanded = expandedSceneIds.has(scene.id);
              const sourceScene = findMatchingSceneOption(scene.sceneNo, sceneOptions);
              const sourceActors = sourceScene
                ? getPresentSceneActors(sourceScene, actors, sceneActorRoles)
                : [];
              const missingSourceActors = getMissingSceneActors(scene, sourceActors, drafts);
              const imageCount = scene.items.reduce((total, item) => {
                const draft = drafts[item.id];
                return total
                  + (draft?.costumeImages.length ?? item.images.filter((image) => image.fieldType === "costume").length)
                  + (draft?.hairImages.length ?? item.images.filter((image) => image.fieldType === "hair").length)
                  + (draft?.costumeFiles.length ?? 0)
                  + (draft?.hairFiles.length ?? 0);
              }, 0);
              return (
                <section key={scene.id} className="ui-motion-surface overflow-hidden rounded-[var(--radius-card)] border border-field-border bg-field-panel">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 bg-field-light px-2.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleScene(scene.id)}
                      className="flex min-h-9 min-w-[150px] flex-1 items-center justify-center gap-1.5 text-center"
                      aria-expanded={expanded}
                    >
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 text-center">
                        <strong className="break-words text-sm font-bold text-field-text">{sceneLabel(scene)}</strong>
                        <span className="text-[11px] text-field-muted">{scene.items.length}명 · 이미지 {imageCount}장</span>
                      </span>
                    </button>
                    {totalEpisodes > 0 ? (
                      <EpisodeChecks
                        totalEpisodes={totalEpisodes}
                        checkedEpisodes={scene.episodeNumbers}
                        automaticEpisodes={automaticEpisodesByScene.get(normalizeSceneNumber(scene.sceneNo))}
                        canEdit={canEdit}
                        onToggle={(episode) => handleEpisodeToggle(scene, episode)}
                      />
                    ) : null}
                    {canEdit ? (
                      <div className="flex shrink-0 gap-1">
                        <IconButton compact label="배역 직접 추가" onClick={() => handleDirectActorAdd(scene)}>
                          <Plus className="h-3.5 w-3.5" aria-hidden />
                        </IconButton>
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
                    <div data-expanded="true" className="ui-accordion">
                    <div className="ui-accordion-inner min-h-0">
                    <div className="border-t border-field-border p-1.5 text-left sm:p-2">
                      {scene.items.length > 0 ? (
                        <div className="mb-1 hidden grid-cols-[minmax(140px,.72fr)_minmax(300px,1.5fr)_minmax(300px,1.5fr)_40px] gap-2 px-2 text-[10px] font-bold text-field-muted lg:grid">
                          <span>배역 / 제공자</span>
                          <span>의상</span>
                          <span>헤어</span>
                          <span className="text-center">삭제</span>
                        </div>
                      ) : null}
                      <div className="grid gap-1.5 sm:divide-y sm:divide-field-border sm:gap-0">
                        {scene.items.length === 0 ? (
                          <p className="py-5 text-center text-xs text-field-muted">이 씬에 등록된 배역이 없습니다.</p>
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
                            onDeleteSavedImage={(image) => handleSavedImageDelete(item, image)}
                            onPreview={(image) => setPreview({
                              url: image.url,
                              title: `${displaySceneNumber(scene.sceneNo)} · ${item.actorRole || item.actorName || "의상"}`
                            })}
                            onPreviewUrl={(url) => setPreview({
                              url,
                              title: `${displaySceneNumber(scene.sceneNo)} · ${item.actorRole || item.actorName || "의상"}`
                            })}
                          />
                        ))}
                      </div>
                      {canEdit ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {missingSourceActors.length > 0 ? (
                            <Button
                              variant="secondary"
                              className="min-h-8 px-2.5 py-1 text-[11px]"
                              onClick={() => handleSceneActorSeed(scene)}
                            >
                              <Plus className="h-4 w-4" aria-hidden />
                              씬리스트 배역 보충 ({missingSourceActors.length}명)
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    </div>
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
                onChange={(event) => setSceneDraft({
                  ...sceneDraft,
                  selectedSceneId: "",
                  seedAllBasicActors: false,
                  sceneNo: event.target.value
                })}
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
              <SceneSeedSummary
                selectedScene={sceneOptions.find((scene) => scene.id === sceneDraft.selectedSceneId)}
                presentActors={sceneOptions.find((scene) => scene.id === sceneDraft.selectedSceneId)
                  ? getPresentSceneActors(
                      sceneOptions.find((scene) => scene.id === sceneDraft.selectedSceneId)!,
                      actors,
                      sceneActorRoles
                    )
                  : []}
                actorCount={actors.length}
                useBasicActors={Boolean(sceneDraft.seedAllBasicActors)}
                onUseBasicActors={() => setSceneDraft({
                  ...sceneDraft,
                  seedAllBasicActors: !sceneDraft.seedAllBasicActors
                })}
              />
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSceneDraft(null)}>닫기</Button>
              <Button type="submit">변경사항 반영</Button>
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
  onDeleteSavedImage,
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
  onDeleteSavedImage: (image: CostumeImage) => void;
  onPreview: (image: CostumeImage) => void;
  onPreviewUrl: (url: string) => void;
}) {
  const customProvider = draft.provider && !providerOptions.includes(draft.provider);
  if (!canEdit) {
    return (
      <article className="grid gap-2 border border-field-border bg-field-panel p-2 lg:grid-cols-[minmax(140px,.72fr)_minmax(300px,1.5fr)_minmax(300px,1.5fr)_40px] lg:items-start lg:border-0 lg:px-2 lg:py-2">
        <div className="min-w-0 border-b border-field-border pb-1 lg:border-0 lg:pb-0">
          <h3 className="break-words text-xs font-bold leading-5 text-field-text">{item.actorRole || "배역 미지정"}</h3>
          {item.actorName ? <p className="break-words text-[10px] leading-4 text-field-muted">{item.actorName}</p> : null}
          <dl className="mt-1 border-t border-field-border pt-1">
            <ReadOnlyValue label="제공자" value={item.provider} />
          </dl>
        </div>
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
        <span className="hidden text-center text-[10px] text-field-muted lg:block">보기</span>
      </article>
    );
  }

  return (
    <article className="grid gap-2 border border-field-border bg-field-panel p-2 lg:grid-cols-[minmax(140px,.72fr)_minmax(300px,1.5fr)_minmax(300px,1.5fr)_40px] lg:items-start lg:border-0 lg:px-2 lg:py-2">
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
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
        <div className="col-span-2 mt-0.5 border-t border-field-border pt-1 lg:col-span-1">
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
        </div>
      </div>

      <EditableMediaField
        label="의상"
        value={draft.costumeContent}
        placeholder="교복, 정장"
        images={draft.costumeImages}
        pendingFiles={draft.costumeFiles}
        title={draft.actorRole || draft.actorName}
        onValueChange={(value) => onChange({ costumeContent: value })}
        onImagesChange={(images) => onChange({ costumeImages: images })}
        onDeleteSavedImage={onDeleteSavedImage}
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
        onDeleteSavedImage={onDeleteSavedImage}
        onPendingFilesChange={(files) => onChange({ hairFiles: files })}
        onFiles={onHairFiles}
        onPreview={onPreview}
        onPreviewUrl={onPreviewUrl}
      />

      <div className="flex items-start justify-end">
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
  onDeleteSavedImage,
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
  onDeleteSavedImage: (image: CostumeImage) => void;
  onPendingFilesChange: (files: PendingFile[]) => void;
  onFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onPreview: (image: CostumeImage) => void;
  onPreviewUrl: (url: string) => void;
}) {
  return (
    <div className="grid min-w-0 content-start gap-1">
      <span className="text-[9px] font-bold leading-4 text-field-muted lg:sr-only">{label}</span>
      <div className="grid min-w-0 gap-1.5 sm:grid-cols-[minmax(152px,1fr)_minmax(118px,.64fr)] sm:items-start">
        <div className="flex min-h-32 min-w-0 items-start gap-1.5 overflow-x-auto overflow-y-hidden pb-1">
          {images.map((image) => (
            <div key={image.path} className="relative h-32 w-32 shrink-0 border border-field-border bg-field-soft">
              <button type="button" onClick={() => onPreview(image)} className="h-full w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={`${title} ${label}`}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain"
                />
              </button>
              <button
                type="button"
                onClick={() => onDeleteSavedImage(image)}
                className="absolute right-1 top-1 grid h-7 w-7 place-items-center border border-field-divider bg-field-elevated/95 text-field-danger"
                aria-label={`${label} 이미지 삭제`}
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
          <label
            className="grid h-14 w-14 shrink-0 cursor-pointer place-items-center self-center border border-dashed border-field-divider bg-field-input text-field-muted transition-colors hover:bg-field-hover hover:text-field-text"
            title={`${label} 사진 추가`}
            aria-label={`${label} 사진 추가`}
          >
            <span className="relative">
              <ImagePlus className="h-5 w-5" aria-hidden />
              <Plus className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 bg-field-input" aria-hidden />
            </span>
            <input type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={onFiles} />
          </label>
        </div>
        <label className="grid gap-0.5">
          <span className="text-[10px] font-bold text-field-muted">{label} 메모</span>
          <textarea
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
            rows={4}
            className={`${compactInputClass} min-h-32 resize-y py-2`}
          />
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
    <div className="relative h-32 w-32 shrink-0 border border-field-primary bg-field-soft">
      <button type="button" onClick={() => onPreview(url)} className="h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`${title} 새 이미지`} className="h-full w-full object-contain" />
      </button>
      <span className="absolute bottom-1 left-1 border border-field-border bg-black/80 px-1.5 py-0.5 text-[9px] font-bold text-field-text">저장 전</span>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 grid h-7 w-7 place-items-center border border-field-divider bg-field-elevated/95 text-field-danger"
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
    <div className="grid min-w-0 content-start gap-1">
      <span className="text-[9px] font-bold leading-4 text-field-muted lg:sr-only">{label}</span>
      <div className="grid min-w-0 gap-1.5 sm:grid-cols-[minmax(152px,1fr)_minmax(118px,.64fr)] sm:items-start">
        {images.length > 0 ? <div className="flex min-h-32 gap-1.5 overflow-x-auto overflow-y-hidden pb-1">
          {images.map((image) => (
            <button key={image.path} type="button" onClick={() => onPreview(image)} className="h-32 w-32 shrink-0 border border-field-border bg-field-soft">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={`${title} ${label}`}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-contain"
              />
            </button>
          ))}
        </div> : <div className="grid min-h-32 place-items-center border border-dashed border-field-border text-[10px] text-field-muted">이미지 없음</div>}
        <div className="min-h-32 rounded-[10px] border border-field-border bg-field-soft p-2">
          <span className="text-[10px] font-bold text-field-muted">{label} 메모</span>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-field-text">{value || "미입력"}</p>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-bold leading-4 text-field-muted lg:hidden">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-xs leading-5 text-field-text [overflow-wrap:anywhere]">{value || "미입력"}</dd>
    </div>
  );
}

function EpisodeChecks({
  totalEpisodes,
  checkedEpisodes,
  automaticEpisodes,
  canEdit,
  onToggle
}: {
  totalEpisodes: number;
  checkedEpisodes: number[];
  automaticEpisodes?: Set<number>;
  canEdit: boolean;
  onToggle: (episode: number) => void;
}) {
  return (
    <div className="flex max-w-full shrink-0 flex-wrap justify-end gap-1 py-0.5" aria-label="씬 포함 회차">
      {Array.from({ length: totalEpisodes }, (_, index) => index + 1).map((episode) => {
        const checked = checkedEpisodes.includes(episode);
        const automatic = automaticEpisodes?.has(episode) ?? false;
        return (
          <label
            key={episode}
            title={automatic ? `${episode}회차 일촬표에서 자동 반영됨` : `${episode}회차`}
            className={`flex h-6 min-w-7 items-center justify-center gap-0.5 border px-1 text-[10px] font-bold ${
              checked
                ? "border-field-primary bg-field-primary/15 text-field-text"
                : "border-field-border bg-field-panel text-field-muted"
            } ${canEdit && !automatic ? "cursor-pointer" : "cursor-default"}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!canEdit || automatic}
              onChange={() => onToggle(episode)}
              className="h-3 w-3 accent-field-primary"
            />
            <span>{episode}</span>
          </label>
        );
      })}
    </div>
  );
}

function SceneSeedSummary({
  selectedScene,
  presentActors,
  actorCount,
  useBasicActors,
  onUseBasicActors
}: {
  selectedScene?: ProjectSceneItem;
  presentActors: Array<Pick<ProjectActor, "role" | "name">>;
  actorCount: number;
  useBasicActors: boolean;
  onUseBasicActors: () => void;
}) {
  if (selectedScene && presentActors.length > 0) {
    return (
      <p className="text-xs leading-5 text-field-muted">
        씬 내용과 메모는 가져오지 않고, 배우칸이 색상/등장 상태인 배역 {presentActors.length}명만 모두 추가합니다.
      </p>
    );
  }

  return (
    <div className="grid gap-2 rounded-[10px] border border-field-border bg-field-soft p-2.5">
      <p className="text-xs leading-5 text-field-muted">
        {selectedScene
          ? "이 씬에는 색상/등장 상태인 배우칸이 없어 배역을 자동 추가하지 않습니다."
          : "직접 입력한 씬에는 배역을 자동 추가하지 않습니다."}
        {" "}씬 내용과 Characters 메모는 가져오지 않습니다.
      </p>
      <Button
        type="button"
        variant="secondary"
        className="justify-self-start"
        onClick={onUseBasicActors}
        disabled={actorCount === 0}
      >
        {useBasicActors
          ? `기본정보 배우 ${actorCount}명 추가 예정`
          : "기본정보 배우 전체 추가"}
      </Button>
    </div>
  );
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-field-bg/80 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mx-auto max-h-[90dvh] w-full max-w-lg overflow-y-auto border border-field-divider bg-field-elevated p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-field-text">{title}</h2>
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
      className={`grid shrink-0 place-items-center border border-field-border bg-field-panel transition-colors hover:border-field-divider hover:bg-field-hover ${compact ? "h-8 w-8" : "h-9 w-9"} ${danger ? "text-field-danger" : "text-field-text"} ${className}`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 content-start gap-1.5">
      <span className="text-xs font-bold text-field-muted">{label}</span>
      {children}
    </label>
  );
}

function CompactField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 content-start gap-0.5">
      <span className="text-[9px] font-bold leading-4 text-field-muted lg:sr-only">{label}</span>
      {children}
    </label>
  );
}

function buildCostumeSaveInput(
  scenes: ProjectCostumeScene[],
  drafts: Record<string, CostumeDraft>,
  deletedSceneIds: Set<string>,
  deletedItemIds: Set<string>
): ProjectCostumeBulkSaveInput {
  return {
    scenes: scenes.map((scene, sceneIndex) => ({
      id: scene.id,
      sceneNo: scene.sceneNo,
      sceneTitle: scene.sceneTitle,
      episodeNumbers: scene.episodeNumbers,
      sortOrder: sceneIndex,
      items: scene.items.map((item, itemIndex) => {
        const draft = drafts[item.id] ?? toDraft(item);
        return {
          id: item.id,
          actorRole: draft.actorRole,
          actorName: draft.actorName,
          costumeContent: draft.costumeContent,
          provider: draft.provider,
          hair: draft.hair,
          sortOrder: itemIndex,
          keepCostumeImagePaths: draft.costumeImages.map((image) => image.path),
          keepHairImagePaths: draft.hairImages.map((image) => image.path)
        };
      })
    })),
    deletedSceneIds: [...deletedSceneIds],
    deletedItemIds: [...deletedItemIds]
  };
}

type PendingCostumeUpload = {
  sceneNo: string;
  actorLabel: string;
  value: Parameters<typeof saveProjectCostume>[1];
};

function collectPendingUploads(
  scenes: ProjectCostumeScene[],
  drafts: Record<string, CostumeDraft>,
  sceneIdMap: Record<string, string>,
  itemIdMap: Record<string, string>
): PendingCostumeUpload[] {
  return scenes.flatMap((scene) => scene.items.flatMap((item) => {
    const draft = drafts[item.id];
    if (!draft || (draft.costumeFiles.length === 0 && draft.hairFiles.length === 0)) return [];
    return [{
      sceneNo: scene.sceneNo,
      actorLabel: draft.actorRole || draft.actorName || "배역 이름 없음",
      value: {
        id: itemIdMap[item.id],
        clientItemId: item.id,
        costumeSceneId: sceneIdMap[scene.id],
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
      }
    }];
  }));
}

async function settleInBatches<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>
): Promise<Array<{ input: T; result: PromiseSettledResult<R> }>> {
  const settled: Array<{ input: T; result: PromiseSettledResult<R> }> = [];
  for (let index = 0; index < values.length; index += concurrency) {
    const batch = values.slice(index, index + concurrency);
    const results = await Promise.allSettled(batch.map(operation));
    results.forEach((result, resultIndex) => {
      settled.push({ input: batch[resultIndex], result });
    });
  }
  return settled;
}

function remapCostumeLocalState(
  originalScenes: ProjectCostumeScene[],
  originalDrafts: Record<string, CostumeDraft>,
  result: ProjectCostumeBulkSaveResult,
  uploadedItems: Map<string, ProjectCostume>
) {
  const savedScenesById = new Map(result.scenes.map((scene) => [scene.id, scene]));
  const drafts: Record<string, CostumeDraft> = {};
  const scenes = originalScenes.map((originalScene) => {
    const savedSceneId = result.sceneIdMap[originalScene.id] ?? originalScene.id;
    const returnedScene = savedScenesById.get(savedSceneId);
    const returnedItemsById = new Map(
      (returnedScene?.items ?? []).map((item) => [item.id, item])
    );
    const items = originalScene.items.map((originalItem) => {
      const savedItemId = result.itemIdMap[originalItem.id] ?? originalItem.id;
      const returnedItem = returnedItemsById.get(savedItemId);
      const savedItem = uploadedItems.get(savedItemId)
        ?? returnedItem
        ?? { ...originalItem, id: savedItemId, costumeSceneId: savedSceneId };
      const originalDraft = originalDrafts[originalItem.id];
      drafts[savedItem.id] = uploadedItems.has(savedItemId) || !originalDraft
        ? toDraft(savedItem)
        : {
            ...originalDraft,
            costumeImages: savedItem.images.filter((image) => image.fieldType !== "hair"),
            hairImages: savedItem.images.filter((image) => image.fieldType === "hair")
          };
      return savedItem;
    });
    return returnedScene
      ? { ...returnedScene, items }
      : { ...originalScene, id: savedSceneId, items };
  });
  return { scenes, drafts };
}

function verifyCostumeSave(
  expected: ProjectCostumeBulkSaveInput,
  expectedDrafts: Record<string, CostumeDraft>,
  actualScenes: ProjectCostumeScene[],
  sceneIdMap: Record<string, string>,
  itemIdMap: Record<string, string>
) {
  const errors: string[] = [];
  const expectedItemCount = expected.scenes.reduce((total, scene) => total + scene.items.length, 0);
  const actualItemCount = actualScenes.reduce((total, scene) => total + scene.items.length, 0);
  if (expected.scenes.length !== actualScenes.length) {
    errors.push(`씬 ${expected.scenes.length}개 중 ${actualScenes.length}개 확인`);
  }
  if (expectedItemCount !== actualItemCount) {
    errors.push(`배역 ${expectedItemCount}개 중 ${actualItemCount}개 확인`);
  }

  const actualScenesById = new Map(actualScenes.map((scene) => [scene.id, scene]));
  expected.scenes.forEach((scene) => {
    const actualScene = actualScenesById.get(sceneIdMap[scene.id]);
    if (!actualScene) {
      errors.push(`${scene.sceneNo} 씬 누락`);
      return;
    }
    if (scene.items.length !== actualScene.items.length) {
      errors.push(`${scene.sceneNo} 배역 ${scene.items.length}개 중 ${actualScene.items.length}개 확인`);
    }
    const actualItems = new Map(actualScene.items.map((item) => [item.id, item]));
    scene.items.forEach((item) => {
      const actualItem = actualItems.get(itemIdMap[item.id]);
      if (!actualItem) {
        errors.push(`${scene.sceneNo} · ${item.actorRole || item.actorName} 누락`);
        return;
      }
      const draft = expectedDrafts[item.id];
      if (!draft) return;
      const expectedCostumeImages = draft.costumeImages.length + draft.costumeFiles.length;
      const expectedHairImages = draft.hairImages.length + draft.hairFiles.length;
      const actualCostumeImages = actualItem.images.filter((image) => image.fieldType !== "hair").length;
      const actualHairImages = actualItem.images.filter((image) => image.fieldType === "hair").length;
      if (expectedCostumeImages !== actualCostumeImages || expectedHairImages !== actualHairImages) {
        errors.push(
          `${scene.sceneNo} · ${draft.actorRole || draft.actorName}: 의상 이미지 ${expectedCostumeImages}/${actualCostumeImages}, 헤어 이미지 ${expectedHairImages}/${actualHairImages}`
        );
      }
    });
  });
  return errors;
}

function buildCostumeAutosaveEntities(
  scenes: ProjectCostumeScene[],
  drafts: Record<string, CostumeDraft>
): CostumeAutosaveEntity[] {
  return scenes.flatMap((scene) => {
    if (isTemporaryId(scene.id)) return [];
    const sceneEntity: CostumeAutosaveEntity = {
      key: `scene:${scene.id}`,
      kind: "scene",
      sceneId: scene.id,
      sceneNo: scene.sceneNo,
      sceneTitle: scene.sceneTitle,
      episodeNumbers: [...scene.episodeNumbers]
    };
    const itemEntities = scene.items.flatMap((item): CostumeAutosaveEntity[] => {
      if (isTemporaryId(item.id)) return [];
      const draft = drafts[item.id] ?? toDraft(item);
      return [{
        key: `item:${item.id}`,
        kind: "item",
        itemId: item.id,
        costumeSceneId: scene.id,
        actorRole: draft.actorRole,
        actorName: draft.actorName,
        costumeContent: draft.costumeContent,
        provider: draft.provider,
        hair: draft.hair,
        sortOrder: item.sortOrder,
        keepCostumeImagePaths: draft.costumeImages.map((image) => image.path),
        keepHairImagePaths: draft.hairImages.map((image) => image.path),
        canAutosave: draft.costumeFiles.length === 0
          && draft.hairFiles.length === 0
          && !hasPendingCostumeItemImageRemoval(item, draft)
      }];
    });
    return [sceneEntity, ...itemEntities];
  });
}

function costumeAutosaveEntityFingerprint(entity: CostumeAutosaveEntity) {
  return entity.kind === "scene"
    ? JSON.stringify([
        entity.kind,
        entity.sceneId,
        entity.sceneNo,
        entity.sceneTitle,
        entity.episodeNumbers
      ])
    : JSON.stringify([
        entity.kind,
        entity.itemId,
        entity.costumeSceneId,
        entity.actorRole,
        entity.actorName,
        entity.costumeContent,
        entity.provider,
        entity.hair,
        entity.sortOrder
      ]);
}

function hasPendingCostumeImageDelete(keys: Set<string>, itemId: string) {
  const prefix = `costume-image:${itemId}:`;
  for (const key of keys) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

function hasExplicitCostumePendingChanges(
  scenes: ProjectCostumeScene[],
  drafts: Record<string, CostumeDraft>,
  deletedSceneIds: Set<string>,
  deletedItemIds: Set<string>
) {
  return deletedSceneIds.size > 0
    || deletedItemIds.size > 0
    || countPendingFileItems(scenes, drafts) > 0
    || hasPendingCostumeImageRemoval(scenes, drafts)
    || scenes.some((scene) => (
      isTemporaryId(scene.id)
      || scene.items.some((item) => isTemporaryId(item.id))
    ));
}

function countPendingFileItems(
  scenes: ProjectCostumeScene[],
  drafts: Record<string, CostumeDraft>
) {
  return scenes.reduce((total, scene) => total + scene.items.filter((item) => {
    const draft = drafts[item.id];
    return Boolean(draft && (draft.costumeFiles.length > 0 || draft.hairFiles.length > 0));
  }).length, 0);
}

function hasPendingCostumeImageRemoval(
  scenes: ProjectCostumeScene[],
  drafts: Record<string, CostumeDraft>
) {
  return scenes.some((scene) => scene.items.some((item) => {
    const draft = drafts[item.id];
    return draft ? hasPendingCostumeItemImageRemoval(item, draft) : false;
  }));
}

function hasPendingCostumeItemImageRemoval(item: ProjectCostume, draft: CostumeDraft) {
  const keptPaths = new Set([
    ...draft.costumeImages.map((image) => image.path),
    ...draft.hairImages.map((image) => image.path)
  ]);
  return item.images.some((image) => !keptPaths.has(image.path));
}

function logCostumeSaveAudit(values: Record<string, unknown>) {
  if (!isQueryAuditEnabled()) return;
  console.table([values]);
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

function insertCostumeSceneByAnchors(
  scenes: ProjectCostumeScene[],
  scene: ProjectCostumeScene,
  beforeId: string,
  afterId: string,
  fallbackIndex: number
) {
  return insertCostumeEntityByAnchors(
    scenes,
    scene,
    (candidate) => candidate.id,
    beforeId,
    afterId,
    fallbackIndex
  );
}

function insertCostumeItemByAnchors(
  items: ProjectCostume[],
  item: ProjectCostume,
  beforeId: string,
  afterId: string,
  fallbackIndex: number
) {
  return insertCostumeEntityByAnchors(
    items,
    item,
    (candidate) => candidate.id,
    beforeId,
    afterId,
    fallbackIndex
  );
}

function insertCostumeEntityByAnchors<T>(
  items: T[],
  item: T,
  getId: (candidate: T) => string,
  beforeId: string,
  afterId: string,
  fallbackIndex: number
) {
  const itemId = getId(item);
  if (items.some((candidate) => getId(candidate) === itemId)) return items;
  const beforeIndex = beforeId ? items.findIndex((candidate) => getId(candidate) === beforeId) : -1;
  const afterIndex = afterId ? items.findIndex((candidate) => getId(candidate) === afterId) : -1;
  const insertionIndex = beforeIndex >= 0
    ? beforeIndex + 1
    : afterIndex >= 0
      ? afterIndex
      : Math.max(0, Math.min(fallbackIndex, items.length));
  const next = [...items];
  next.splice(insertionIndex, 0, item);
  return next;
}

function isTemporaryId(id: string) {
  return id.startsWith(tempPrefix);
}

function dedupeActors(actors: Array<Pick<ProjectActor, "role" | "name">>) {
  const seen = new Set<string>();
  return actors.filter((actor) => {
    const key = normalizeActorKey(actor.role, actor.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildAutomaticEpisodesByScene(plans: DailyPlanListItem[]) {
  const episodesByScene = new Map<string, Set<number>>();
  plans.forEach((plan) => {
    const episode = parseEpisodeNumber(plan.episode || plan.title);
    if (!episode) return;
    plan.sceneNumbers.forEach((sceneNumber) => {
      const sceneKey = normalizeSceneNumber(sceneNumber);
      if (!sceneKey) return;
      const episodes = episodesByScene.get(sceneKey) ?? new Set<number>();
      episodes.add(episode);
      episodesByScene.set(sceneKey, episodes);
    });
  });
  return episodesByScene;
}

function parseEpisodeNumber(value: string) {
  const match = value.normalize("NFKC").match(/\d{1,3}/);
  if (!match) return null;
  const episode = Number.parseInt(match[0], 10);
  return episode > 0 ? episode : null;
}

function mergeEpisodeNumbers(current: number[], automatic?: Iterable<number>) {
  return Array.from(new Set([
    ...current.filter((episode) => Number.isInteger(episode) && episode > 0),
    ...(automatic ?? [])
  ])).sort((left, right) => left - right);
}

function getMissingSceneActors(
  scene: ProjectCostumeScene,
  sourceActors: Array<Pick<ProjectActor, "role" | "name">>,
  drafts: Record<string, CostumeDraft>
) {
  const existingKeys = new Set(scene.items.map((item) => {
    const draft = drafts[item.id];
    return normalizeActorKey(
      draft?.actorRole ?? item.actorRole,
      draft?.actorName ?? item.actorName
    );
  }));
  return sourceActors.filter((actor) => {
    const key = normalizeActorKey(actor.role, actor.name);
    return Boolean(key) && !existingKeys.has(key);
  });
}

function getPresentSceneActors(
  scene: ProjectSceneItem,
  basicActors: ProjectActor[],
  actorRoles: string[]
) {
  const actorCells = scene.actorCells as Record<string, unknown>;
  const legacyPresence = getLegacyActorPresence(scene);
  const candidates = dedupeTextValues([
    ...actorRoles,
    ...basicActors.flatMap((actor) => [actor.role, actor.name]),
    ...Object.keys(actorCells),
    ...Object.keys(legacyPresence)
  ]);
  const legacyCharacterKeys = new Set(
    splitLegacyCharacters(scene.characters).map(normalizeActorTextKey)
  );

  return dedupeActors(candidates.flatMap((role) => {
    const actorCell = findCaseInsensitiveValue(actorCells, role);
    const legacyCell = findCaseInsensitiveValue(legacyPresence, role);
    const isPresent = isPresentActorCell(actorCell)
      || isPresentActorCell(legacyCell)
      || legacyCharacterKeys.has(normalizeActorTextKey(role));
    if (!isPresent || isTextOnlyActorCell(actorCell)) return [];

    const actor = basicActors.find((candidate) => (
      normalizeActorTextKey(candidate.role) === normalizeActorTextKey(role)
      || normalizeActorTextKey(candidate.name) === normalizeActorTextKey(role)
    ));
    return [{
      role: actor?.role || role.trim(),
      name: actor?.name || ""
    }];
  }));
}

function findMatchingSceneOption(sceneNo: string, sceneOptions: ProjectSceneItem[]) {
  const key = normalizeSceneNumber(sceneNo);
  return sceneOptions.find((scene) => normalizeSceneNumber(scene.sceneNo) === key);
}

function getLegacyActorPresence(scene: ProjectSceneItem) {
  const record = scene as ProjectSceneItem & {
    actorPresence?: unknown;
    actor_presence?: unknown;
  };
  const value = record.actorPresence ?? record.actor_presence;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function findCaseInsensitiveValue(record: Record<string, unknown>, key: string) {
  const normalizedKey = normalizeActorTextKey(key);
  const entry = Object.entries(record).find(
    ([candidate]) => normalizeActorTextKey(candidate) === normalizedKey
  );
  return entry?.[1];
}

function isPresentActorCell(value: unknown) {
  if (value === true) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase();
    return normalized === "o" || normalized === "true" || normalized === "color"
      || normalized === "colored" || normalized === "present";
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const mode = String((value as Record<string, unknown>).mode ?? "").trim().toLocaleLowerCase();
  return mode === "color" || mode === "colored" || mode === "present";
}

function isTextOnlyActorCell(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return String((value as Record<string, unknown>).mode ?? "").trim().toLocaleLowerCase() === "text";
}

function splitLegacyCharacters(value: string) {
  return value
    .split(/[,;\n|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeTextValues(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeActorTextKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeActorTextKey(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function sceneOptionLabel(scene: ProjectSceneItem) {
  return [displaySceneNumber(scene.sceneNo), scene.mainLocation, scene.subLocation].filter(Boolean).join(" · ") || "번호 없는 씬";
}

function sceneLabel(scene: Pick<ProjectCostumeScene, "sceneNo" | "sceneTitle">) {
  return [displaySceneNumber(scene.sceneNo), scene.sceneTitle].filter(Boolean).join(" · ") || "씬";
}

function displaySceneNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return `S#${Number.parseInt(trimmed, 10)}`;
  return trimmed;
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

const compactInputClass = "min-h-8 w-full border border-field-border bg-field-input px-2 py-0.5 text-xs leading-5 outline-none focus:border-field-primary focus:ring-2 focus:ring-field-primary/30";

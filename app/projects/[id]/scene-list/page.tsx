"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Plus, Save } from "lucide-react";
import { InlineLoader, PageLoader, SectionLoader } from "@/components/PixelDogLoader";
import { AutosaveStatus } from "@/components/AutosaveStatus";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import { useProjectDeleteUndo } from "@/components/ProjectDeleteUndoProvider";
import { SceneListNativeTable } from "@/components/SceneListNativeTable";
import { SceneListPortraitReadOnly } from "@/components/SceneListPortraitReadOnly";
import {
  useAutoContextualGuide,
  useContextualGuideAnchor
} from "@/components/guides/ContextualGuideProvider";
import {
  confirmUnsavedChangesNavigation,
  useUnsavedChangesGuard
} from "@/hooks/useUnsavedChangesGuard";
import { useSceneListViewportMode } from "@/hooks/useSceneListViewportMode";
import { useKeyedAutosave } from "@/hooks/useKeyedAutosave";
import {
  clearProjectSceneCells,
  createProjectSceneItemDraftPatch,
  createBlankProjectSceneItem,
  getProjectSceneList,
  reorderProjectSceneItems,
  deleteProjectSceneItem,
  finalizeDeletedProjectSceneItem,
  restoreProjectSceneItem,
  restoreProjectSceneCells,
  saveProjectSceneItemDraft,
  saveProjectSceneReferenceDraft,
  saveProjectSceneCellMerges,
  saveProjectSceneList,
  SceneListMergeMutationError,
  type ProjectSceneClearCell,
  type ProjectSceneItemDraftPatch,
  type ProjectSceneReferenceAutosaveResult
} from "@/lib/data/sceneList";
import { AutosaveConflictError } from "@/lib/data/autosaveConflict";
import { auditQuery } from "@/lib/queryAudit";
import { deriveLegacySceneListMerges, type SceneListMergeCell } from "@/lib/sceneListMergeModel";
import type {
  ProjectSceneCellMerge,
  ProjectSceneItem,
  ProjectSceneMergeColumn
} from "@/lib/types";

type PersistedMergeSnapshot = {
  merges: ProjectSceneCellMerge[];
  materialized: boolean;
  updatedAt: string | null;
};

type MergeSaveJob = {
  projectId: string;
  version: number;
  merges: ProjectSceneCellMerge[];
  beforeSave: Promise<boolean>;
  expectedUpdatedAt: string | null;
  rollbackSnapshot: PersistedMergeSnapshot;
  legacyItems: ProjectSceneItem[];
  resolve: () => void;
  reject: (error: unknown) => void;
};

type ClearSaveJob = {
  projectId: string;
  version: number;
  cells: ProjectSceneClearCell[];
  beforeSave: Promise<boolean>;
  previousValues: Map<string, string>;
  previousVersions: Map<string, number | undefined>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type SceneAutosaveEntity =
  | { key: string; kind: "item"; item: ProjectSceneItem }
  | { key: string; kind: "reference"; scenarioReference: string };

type SceneAutosaveResult =
  | { kind: "item"; item: ProjectSceneItem }
  | { kind: "reference"; reference: ProjectSceneReferenceAutosaveResult };

// SPA 내부 이동으로 page instance가 교체되어도 같은 프로젝트의 저장 완료를
// 다음 load가 기다릴 수 있도록 module scope에서 pending tail을 공유합니다.
const projectMergeMutationTails = new Map<string, Promise<void>>();
const projectClearMutationTails = new Map<string, Promise<void>>();
const projectSceneItemMutationTails = new Map<string, Promise<void>>();

/** 프로젝트 공통 씬리스트를 수동 저장하며 Cut 값은 일촬표 컷수와 공유합니다. */
export default function ProjectSceneListPage() {
  const { project, projectId } = useProjectWorkspace();
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const { deleteWithUndo } = useProjectDeleteUndo();
  const viewportMode = useSceneListViewportMode();
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [items, setItems] = useState<ProjectSceneItem[]>([]);
  const [expandedPortraitSceneIds, setExpandedPortraitSceneIds] = useState<Set<string>>(
    () => new Set()
  );
  const [actorRoles, setActorRoles] = useState<string[]>([]);
  const [scenarioReference, setScenarioReference] = useState("");
  const [cellMerges, setCellMerges] = useState<ProjectSceneCellMerge[]>([]);
  const [cellMergesMaterialized, setCellMergesMaterialized] = useState(false);
  const [cellMergesUpdatedAt, setCellMergesUpdatedAt] = useState<string | null>(null);
  const [mergeMetadataDirty, setMergeMetadataDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isMergePersisting, setIsMergePersisting] = useState(false);
  const [isClearPersisting, setIsClearPersisting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [composingAutosaveKey, setComposingAutosaveKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [cutInputErrors, setCutInputErrors] = useState<Record<string, string>>({});
  const desktopGuideAnchorRef = useContextualGuideAnchor("scene-list.desktop");
  const mobileGuideAnchorRef = useContextualGuideAnchor("scene-list.mobile");
  const itemsRef = useRef(items);
  const cellMergesRef = useRef(cellMerges);
  const cellMergesMaterializedRef = useRef(cellMergesMaterialized);
  const cellMergesUpdatedAtRef = useRef(cellMergesUpdatedAt);
  const mountedRef = useRef(true);
  const activeProjectIdRef = useRef(projectId);
  const loadRequestVersionRef = useRef(0);
  const persistedMergeSnapshotRef = useRef<PersistedMergeSnapshot>({
    merges: [],
    materialized: false,
    updatedAt: null
  });
  const sceneListGuideReady = !isLoading
    && !loadFailed
    && loadedProjectId === projectId
    && Boolean(project);
  useAutoContextualGuide(
    "scene-list.desktop-intro",
    sceneListGuideReady && viewportMode === "editor" && canEdit
  );
  useAutoContextualGuide(
    "scene-list.mobile-intro",
    sceneListGuideReady && viewportMode === "portrait"
  );
  const mergeMutationVersionsRef = useRef(new Map<string, number>());
  const mergeSaveQueueRef = useRef<MergeSaveJob[]>([]);
  const mergeSaveRunningRef = useRef(false);
  const sceneCellMutationVersionRef = useRef(0);
  const sceneCellVersionsRef = useRef(new Map<string, number>());
  const clearSaveQueueRef = useRef<ClearSaveJob[]>([]);
  const clearSaveRunningRef = useRef(false);
  const persistedItemIdsRef = useRef(new Set<string>());
  const autosaveItemVersionsRef = useRef(new Map<string, string>());
  const autosaveItemSnapshotsRef = useRef(new Map<string, ProjectSceneItem>());
  const autosaveItemIntentFieldsRef = useRef(new Map<string, Set<keyof ProjectSceneItemDraftPatch>>());
  const autosaveReferenceVersionsRef = useRef(new Map<string, string | null>());
  activeProjectIdRef.current = projectId;
  // Only not-yet-created/deleted structural rows require an explicit guard.
  // Merge/clear persistence already runs through module-scoped tails and must
  // never hold route navigation while its background request is in flight.
  useUnsavedChangesGuard(isDirty);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    setExpandedPortraitSceneIds(new Set());
  }, [projectId]);

  useEffect(() => {
    const availableSceneIds = new Set(items.map((item) => item.id));
    setExpandedPortraitSceneIds((current) => {
      const next = new Set(
        Array.from(current).filter((sceneId) => availableSceneIds.has(sceneId))
      );
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const togglePortraitScene = useCallback((sceneId: string) => {
    setExpandedPortraitSceneIds((current) => {
      const next = new Set(current);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  }, []);
  useEffect(() => {
    cellMergesRef.current = cellMerges;
  }, [cellMerges]);
  useEffect(() => {
    cellMergesMaterializedRef.current = cellMergesMaterialized;
  }, [cellMergesMaterialized]);
  useEffect(() => {
    cellMergesUpdatedAtRef.current = cellMergesUpdatedAt;
  }, [cellMergesUpdatedAt]);

  const sceneAutosaveEntities = useMemo<SceneAutosaveEntity[]>(() => [
    ...items
      .filter((item) => persistedItemIdsRef.current.has(item.id))
      .map((item) => ({
        key: sceneItemAutosaveKey(item.id),
        kind: "item" as const,
        item
      })),
    { key: sceneReferenceAutosaveKey(), kind: "reference", scenarioReference }
  ], [items, scenarioReference]);
  const validateSceneAutosaveEntity = useCallback((entity: SceneAutosaveEntity) => (
    entity.key !== composingAutosaveKey
      && (entity.kind === "reference" || !cutInputErrors[entity.item.id])
  ), [composingAutosaveKey, cutInputErrors]);
  const sceneAutosave = useKeyedAutosave<SceneAutosaveEntity, SceneAutosaveResult>({
    values: sceneAutosaveEntities,
    getKey: (entity) => entity.key,
    enabled: canEdit
      && !isLoading
      && loadedProjectId === projectId
      && !isSaving,
    scopeKey: projectId || "scene-list",
    delayMs: 750,
    fingerprint: sceneAutosaveEntityFingerprint,
    validate: validateSceneAutosaveEntity,
    restoreDrafts: (drafts) => {
      for (const restored of drafts) {
        const entity = restored.value;
        const savedEntity = restored.savedValue;
        if (entity.kind === "reference") {
          setScenarioReference(entity.scenarioReference);
          continue;
        }
        const currentItem = itemsRef.current.find((item) => item.id === entity.item.id);
        if (!currentItem) continue;
        const savedItem = savedEntity?.kind === "item" ? savedEntity.item : currentItem;
        const restoredFieldNames = Object.keys(
          createProjectSceneItemDraftPatch(savedItem, entity.item)
        ) as Array<keyof ProjectSceneItemDraftPatch>;
        const intentFields = new Set<keyof ProjectSceneItemDraftPatch>(restoredFieldNames);
        if (intentFields.size === 0) continue;
        autosaveItemIntentFieldsRef.current.set(entity.item.id, intentFields);
        const mergedItem = mergeSceneItemConflict(currentItem, entity.item, intentFields);
        const nextItems = itemsRef.current.map((item) => (
          item.id === entity.item.id ? mergedItem : item
        ));
        itemsRef.current = nextItems;
        setItems(nextItems);
      }
    },
    save: async (entity) => {
      if (!projectId) throw new Error("프로젝트 ID를 확인할 수 없습니다.");
      if (entity.kind === "item") {
        await projectSceneItemMutationTails.get(sceneItemMutationKey(projectId, entity.item.id));
        const expectedUpdatedAt = autosaveItemVersionsRef.current.get(entity.item.id);
        if (!expectedUpdatedAt) throw new Error("자동 저장할 씬의 저장 버전을 확인할 수 없습니다.");
        const baseline = autosaveItemSnapshotsRef.current.get(entity.item.id);
        if (!baseline) throw new Error("자동 저장할 씬의 기준값을 확인할 수 없습니다.");
        const currentItem = autosaveItemIntentFieldsRef.current.has(entity.item.id)
          ? itemsRef.current.find((item) => item.id === entity.item.id) ?? entity.item
          : entity.item;
        const patch = createProjectSceneItemDraftPatch(baseline, currentItem);
        if (Object.keys(patch).length === 0) {
          autosaveItemIntentFieldsRef.current.delete(entity.item.id);
          return { kind: "item", item: { ...currentItem, updatedAt: expectedUpdatedAt } };
        }
        autosaveItemIntentFieldsRef.current.set(
          entity.item.id,
          new Set(Object.keys(patch) as Array<keyof ProjectSceneItemDraftPatch>)
        );
        const saved = await saveProjectSceneItemDraft(
          projectId,
          entity.item.id,
          patch,
          expectedUpdatedAt
        );
        autosaveItemVersionsRef.current.set(entity.item.id, saved.updatedAt);
        autosaveItemSnapshotsRef.current.set(entity.item.id, saved);
        autosaveItemIntentFieldsRef.current.delete(entity.item.id);
        return { kind: "item", item: saved };
      }
      await projectMergeMutationTails.get(projectId);
      const savedReference = await saveProjectSceneReferenceDraft(
        projectId,
        entity.scenarioReference,
        autosaveReferenceVersionsRef.current.get(projectId) ?? null
      );
      autosaveReferenceVersionsRef.current.set(projectId, savedReference.updatedAt);
      if (activeProjectIdRef.current === projectId) {
        cellMergesUpdatedAtRef.current = savedReference.updatedAt;
        persistedMergeSnapshotRef.current = {
          ...persistedMergeSnapshotRef.current,
          updatedAt: savedReference.updatedAt
        };
      }
      return { kind: "reference", reference: savedReference };
    },
    onSaved: (result, entity) => {
      if (activeProjectIdRef.current !== projectId) return;
      if (result.kind === "item" && entity.kind === "item") {
        setItems((current) => {
          const next = current.map((item) => {
            return item.id === entity.item.id
              && sceneItemEditableFingerprint(item) === sceneItemEditableFingerprint(entity.item)
              ? { ...item, updatedAt: result.item.updatedAt }
              : item;
          });
          itemsRef.current = next;
          return next;
        });
        return;
      }
      if (result.kind === "reference") {
        setCellMergesUpdatedAt(result.reference.updatedAt);
      }
    },
    onError: (error, failedEntity) => {
      if (error instanceof AutosaveConflictError) {
        if (error.kind === "scene-item") {
          const latestItem = error.latest as ProjectSceneItem | null;
          if (latestItem?.id && latestItem.updatedAt) {
            autosaveItemVersionsRef.current.set(latestItem.id, latestItem.updatedAt);
            autosaveItemSnapshotsRef.current.set(latestItem.id, latestItem);
            if (failedEntity.kind === "item" && failedEntity.item.id === latestItem.id) {
              const currentItem = itemsRef.current.find((item) => item.id === latestItem.id)
                ?? failedEntity.item;
              const intentFields = autosaveItemIntentFieldsRef.current.get(latestItem.id)
                ?? new Set<keyof ProjectSceneItemDraftPatch>();
              for (const key of Object.keys(
                createProjectSceneItemDraftPatch(failedEntity.item, currentItem)
              ) as Array<keyof ProjectSceneItemDraftPatch>) {
                intentFields.add(key);
              }
              autosaveItemIntentFieldsRef.current.set(latestItem.id, intentFields);
              const mergedItem = mergeSceneItemConflict(latestItem, currentItem, intentFields);
              const nextItems = itemsRef.current.map((item) => (
                item.id === latestItem.id ? mergedItem : item
              ));
              itemsRef.current = nextItems;
              setItems(nextItems);
            }
          }
        } else if (error.kind === "scene-reference") {
          const latestReference = error.latest as ProjectSceneReferenceAutosaveResult | null;
          if (latestReference) {
            autosaveReferenceVersionsRef.current.set(projectId, latestReference.updatedAt);
            if (activeProjectIdRef.current === projectId) {
              cellMergesUpdatedAtRef.current = latestReference.updatedAt;
              persistedMergeSnapshotRef.current = {
                ...persistedMergeSnapshotRef.current,
                updatedAt: latestReference.updatedAt
              };
              setCellMergesUpdatedAt(latestReference.updatedAt);
            }
          }
        }
      }
      if (activeProjectIdRef.current !== projectId) return;
      setErrorMessage(getErrorMessage(error, "씬리스트 변경사항을 자동 저장하지 못했습니다."));
    }
  });

  const load = useCallback(async () => {
    if (!projectId) return;
    const requestVersion = ++loadRequestVersionRef.current;
    setIsLoading(true);
    setLoadFailed(false);
    try {
      await Promise.all([
        projectMergeMutationTails.get(projectId),
        projectClearMutationTails.get(projectId)
      ].filter((pending): pending is Promise<void> => Boolean(pending)));
      if (
        !mountedRef.current
        || activeProjectIdRef.current !== projectId
        || loadRequestVersionRef.current !== requestVersion
      ) return;
      const sceneList = await auditQuery(
        "sceneList.loadSceneItems",
        "app/projects/[id]/scene-list/page.tsx:load",
        () => getProjectSceneList(projectId)
      );
      const visibleMerges = sceneList.cellMergesMaterialized
        ? sceneList.cellMerges
        : deriveLegacySceneListMerges(sceneList.items);
      if (
        !mountedRef.current
        || activeProjectIdRef.current !== projectId
        || loadRequestVersionRef.current !== requestVersion
      ) return;
      itemsRef.current = sceneList.items;
      cellMergesRef.current = visibleMerges;
      cellMergesMaterializedRef.current = sceneList.cellMergesMaterialized;
      cellMergesUpdatedAtRef.current = sceneList.cellMergesUpdatedAt;
      persistedMergeSnapshotRef.current = {
        merges: visibleMerges,
        materialized: sceneList.cellMergesMaterialized,
        updatedAt: sceneList.cellMergesUpdatedAt
      };
      setLoadedProjectId(projectId);
      setLoadFailed(false);
      setItems(sceneList.items);
      setActorRoles(sceneList.actorRoles);
      setScenarioReference(sceneList.scenarioReference);
      setCellMerges(visibleMerges);
      setCellMergesMaterialized(sceneList.cellMergesMaterialized);
      setCellMergesUpdatedAt(sceneList.cellMergesUpdatedAt);
      setMergeMetadataDirty(false);
      setCutInputErrors({});
      setIsDirty(false);
      setErrorMessage("");
      persistedItemIdsRef.current = new Set(sceneList.items.map((item) => item.id));
      autosaveItemVersionsRef.current = new Map(sceneList.items.map((item) => [item.id, item.updatedAt]));
      autosaveItemSnapshotsRef.current = new Map(sceneList.items.map((item) => [item.id, item]));
      autosaveItemIntentFieldsRef.current.clear();
      autosaveReferenceVersionsRef.current.set(projectId, sceneList.cellMergesUpdatedAt);
      sceneAutosave.markSaved(sceneAutosaveEntitiesFrom(
        sceneList.items,
        sceneList.scenarioReference
      ));
    } catch (error) {
      if (
        mountedRef.current
        && activeProjectIdRef.current === projectId
        && loadRequestVersionRef.current === requestVersion
      ) {
        setLoadedProjectId(projectId);
        setLoadFailed(true);
        setErrorMessage(getErrorMessage(error, "씬리스트를 불러오지 못했습니다."));
      }
    } finally {
      if (
        mountedRef.current
        && activeProjectIdRef.current === projectId
        && loadRequestVersionRef.current === requestVersion
      ) {
        setIsLoading(false);
      }
    }
  }, [projectId, sceneAutosave.markSaved]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateItem = useCallback((id: string, patch: Partial<ProjectSceneItem>) => {
    if (!canEdit || !projectId) return;
    markSceneCellPatchVersion(
      sceneCellVersionsRef.current,
      projectId,
      id,
      patch,
      ++sceneCellMutationVersionRef.current
    );
    setItems((current) => {
      const next = current.map((item) => item.id === id ? { ...item, ...patch } : item);
      itemsRef.current = next;
      return next;
    });
    if (!persistedItemIdsRef.current.has(id)) setIsDirty(true);
    setErrorMessage("");
  }, [canEdit, projectId]);

  const updateCutInputError = useCallback((id: string, message: string) => {
    setCutInputErrors((current) => {
      const next = { ...current };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }, []);

  const addItem = useCallback(() => {
    if (!canEdit || !projectId) return;
    setItems((current) => {
      const next = [
        ...current,
        createBlankProjectSceneItem(projectId, current.length + 1)
      ];
      itemsRef.current = next;
      return next;
    });
    setIsDirty(true);
    setErrorMessage("");
  }, [canEdit, projectId]);

  const deleteItem = useCallback((item: ProjectSceneItem) => {
    if (!canEdit || !projectId) return;
    const persisted = persistedItemIdsRef.current.has(item.id);
    let deleteReceipt: string | null = null;
    const originalIndex = itemsRef.current.findIndex((candidate) => candidate.id === item.id);
    const removedMerges = cellMergesRef.current.filter((merge) => merge.sceneIds.includes(item.id));
    const removeLocal = () => {
      if (activeProjectIdRef.current !== projectId) return;
      const next = itemsRef.current
        .filter((candidate) => candidate.id !== item.id)
        .map((candidate, index) => ({ ...candidate, sortOrder: index + 1 }));
      itemsRef.current = next;
      setItems(next);
      const remainingMerges = cellMergesRef.current.filter((merge) => !merge.sceneIds.includes(item.id));
      cellMergesRef.current = remainingMerges;
      cellMergesMaterializedRef.current = true;
      setCellMerges(remainingMerges);
      setCellMergesMaterialized(true);
      setCutInputErrors((current) => {
        const nextErrors = { ...current };
        delete nextErrors[item.id];
        return nextErrors;
      });
      if (!persisted) setIsDirty(true);
      setErrorMessage("");
    };
    const restoreLocal = () => {
      if (activeProjectIdRef.current !== projectId || itemsRef.current.some((candidate) => candidate.id === item.id)) return;
      const next = [...itemsRef.current];
      next.splice(Math.max(0, Math.min(originalIndex, next.length)), 0, item);
      const reordered = next.map((candidate, index) => ({ ...candidate, sortOrder: index + 1 }));
      itemsRef.current = reordered;
      setItems(reordered);
      const mergeById = new Map([...cellMergesRef.current, ...removedMerges].map((merge) => [merge.id, merge]));
      const restoredMerges = [...mergeById.values()];
      cellMergesRef.current = restoredMerges;
      setCellMerges(restoredMerges);
      if (!persisted) setIsDirty(true);
    };
    deleteWithUndo({
      key: `scene:${item.id}`,
      label: `씬 ${item.sceneNo || originalIndex + 1}`,
      removeLocal,
      restoreLocal,
      deleteRemote: async () => {
        if (!persisted) return;
        if (!await sceneAutosave.flushKeys([sceneItemAutosaveKey(item.id)])) {
          throw new Error("삭제할 씬의 자동 저장에 실패했습니다.");
        }
        const result = await deleteProjectSceneItem(projectId, item.id);
        deleteReceipt = result?.receipt ?? null;
        if (result && activeProjectIdRef.current === projectId) {
          cellMergesUpdatedAtRef.current = result.cellMergesUpdatedAt;
          setCellMergesUpdatedAt(result.cellMergesUpdatedAt);
          autosaveReferenceVersionsRef.current.set(projectId, result.cellMergesUpdatedAt);
          persistedMergeSnapshotRef.current = {
            ...persistedMergeSnapshotRef.current,
            updatedAt: result.cellMergesUpdatedAt
          };
        }
      },
      restoreRemote: async () => {
        if (!persisted) return;
        const result = await restoreProjectSceneItem(projectId, deleteReceipt, item, removedMerges);
        if (activeProjectIdRef.current !== projectId) return;
        autosaveItemVersionsRef.current.set(item.id, result.item.updatedAt);
        autosaveItemSnapshotsRef.current.set(item.id, result.item);
        cellMergesUpdatedAtRef.current = result.cellMergesUpdatedAt;
        setCellMergesUpdatedAt(result.cellMergesUpdatedAt);
        autosaveReferenceVersionsRef.current.set(projectId, result.cellMergesUpdatedAt);
        persistedMergeSnapshotRef.current = {
          ...persistedMergeSnapshotRef.current,
          updatedAt: result.cellMergesUpdatedAt
        };
        const nextItems = itemsRef.current.map((candidate) => (
          candidate.id === item.id ? result.item : candidate
        ));
        itemsRef.current = nextItems;
        setItems(nextItems);
      },
      finalize: async () => {
        if (!persisted) return;
        await finalizeDeletedProjectSceneItem(projectId, deleteReceipt);
      }
    });
  }, [canEdit, deleteWithUndo, projectId, sceneAutosave.flushKeys]);

  const drainMergeSaveQueue = useCallback(async () => {
    if (mergeSaveRunningRef.current) return;
    mergeSaveRunningRef.current = true;
    if (mountedRef.current) setIsMergePersisting(true);
    try {
      while (mergeSaveQueueRef.current.length > 0) {
        const job = mergeSaveQueueRef.current.shift()!;
        try {
          if (!await job.beforeSave) {
            throw new Error("메모 자동 저장에 실패해 셀 병합을 저장하지 못했습니다.");
          }
          if (activeProjectIdRef.current === job.projectId) {
            job.expectedUpdatedAt = persistedMergeSnapshotRef.current.updatedAt;
            job.rollbackSnapshot = clonePersistedMergeSnapshot(persistedMergeSnapshotRef.current);
          }
          const saved = await saveProjectSceneCellMerges(
            job.projectId,
            job.merges,
            job.expectedUpdatedAt
          );
          const snapshot: PersistedMergeSnapshot = {
            merges: saved.cellMerges,
            materialized: true,
            updatedAt: saved.updatedAt
          };
          autosaveReferenceVersionsRef.current.set(job.projectId, saved.updatedAt);
          rebaseQueuedMergeJobs(mergeSaveQueueRef.current, job.projectId, snapshot);
          const isActiveProject = mountedRef.current
            && activeProjectIdRef.current === job.projectId;
          if (isActiveProject) {
            persistedMergeSnapshotRef.current = snapshot;
            cellMergesUpdatedAtRef.current = saved.updatedAt;
            setCellMergesUpdatedAt(saved.updatedAt);
          }

          if (
            isActiveProject
            && !mergeQueueContainsProject(mergeSaveQueueRef.current, job.projectId)
            && job.version === mergeMutationVersionsRef.current.get(job.projectId)
          ) {
            cellMergesRef.current = saved.cellMerges;
            cellMergesMaterializedRef.current = true;
            flushSync(() => {
              setCellMerges(saved.cellMerges);
              setCellMergesMaterialized(true);
              setMergeMetadataDirty(false);
            });
          }
          job.resolve();
        } catch (error) {
          if (error instanceof SceneListMergeMutationError && error.status === 409) {
            const latestMerges = error.latestMaterialized
              ? error.latestCellMerges
              : deriveLegacySceneListMerges(job.legacyItems);
            const latest: PersistedMergeSnapshot = {
              merges: latestMerges,
              materialized: error.latestMaterialized,
              updatedAt: error.latestUpdatedAt
            };
            autosaveReferenceVersionsRef.current.set(job.projectId, latest.updatedAt);
            const queued = takeMergeJobsForProject(mergeSaveQueueRef.current, job.projectId);
            if (mountedRef.current && activeProjectIdRef.current === job.projectId) {
              persistedMergeSnapshotRef.current = latest;
              cellMergesUpdatedAtRef.current = latest.updatedAt;
              cellMergesRef.current = latest.merges;
              cellMergesMaterializedRef.current = latest.materialized;
              flushSync(() => {
                setCellMerges(latest.merges);
                setCellMergesMaterialized(latest.materialized);
                setCellMergesUpdatedAt(latest.updatedAt);
                setMergeMetadataDirty(false);
              });
            }
            const shouldReport = mountedRef.current
              && activeProjectIdRef.current === job.projectId;
            if (shouldReport) {
              job.reject(error);
              queued.forEach((queuedJob) => queuedJob.reject(error));
            } else {
              job.resolve();
              queued.forEach((queuedJob) => queuedJob.resolve());
            }
            continue;
          }

          if (mergeQueueContainsProject(mergeSaveQueueRef.current, job.projectId)) {
            // 뒤의 작업은 현재 전체 optimistic 상태를 포함하므로 최신 작업으로 재시도합니다.
            job.resolve();
            continue;
          }

          const persisted = job.rollbackSnapshot;
          if (mountedRef.current && activeProjectIdRef.current === job.projectId) {
            persistedMergeSnapshotRef.current = persisted;
            cellMergesRef.current = persisted.merges;
            cellMergesMaterializedRef.current = persisted.materialized;
            flushSync(() => {
              setCellMerges(persisted.merges);
              setCellMergesMaterialized(persisted.materialized);
              setCellMergesUpdatedAt(persisted.updatedAt);
              setMergeMetadataDirty(false);
            });
          }
          if (mountedRef.current && activeProjectIdRef.current === job.projectId) {
            job.reject(error);
          } else {
            job.resolve();
          }
        }
      }
    } finally {
      mergeSaveRunningRef.current = false;
      if (mountedRef.current) setIsMergePersisting(false);
    }
  }, []);

  const persistMerges = useCallback((nextMerges: ProjectSceneCellMerge[]) => {
    if (!projectId) return Promise.reject(new Error("프로젝트 ID를 확인할 수 없습니다."));
    const version = (mergeMutationVersionsRef.current.get(projectId) ?? 0) + 1;
    mergeMutationVersionsRef.current.set(projectId, version);
    cellMergesRef.current = nextMerges;
    cellMergesMaterializedRef.current = true;
    flushSync(() => {
      setCellMerges(nextMerges);
      setCellMergesMaterialized(true);
      setMergeMetadataDirty(true);
      setErrorMessage("");
    });
    const beforeSave = sceneAutosave.flushKeys([sceneReferenceAutosaveKey()]);
    const promise = new Promise<void>((resolve, reject) => {
      mergeSaveQueueRef.current.push({
        projectId,
        version,
        merges: nextMerges,
        beforeSave,
        expectedUpdatedAt: persistedMergeSnapshotRef.current.updatedAt,
        rollbackSnapshot: clonePersistedMergeSnapshot(persistedMergeSnapshotRef.current),
        legacyItems: itemsRef.current,
        resolve,
        reject
      });
    });
    trackProjectMutationTail(projectMergeMutationTails, projectId, promise);
    void drainMergeSaveQueue();
    return promise;
  }, [drainMergeSaveQueue, projectId, sceneAutosave.flushKeys]);

  const drainClearSaveQueue = useCallback(async () => {
    if (clearSaveRunningRef.current) return;
    clearSaveRunningRef.current = true;
    if (mountedRef.current) setIsClearPersisting(true);
    try {
      while (clearSaveQueueRef.current.length > 0) {
        const job = clearSaveQueueRef.current.shift()!;
        try {
          if (!await job.beforeSave) {
            throw new Error("선택한 씬의 자동 저장에 실패해 칸을 비우지 못했습니다.");
          }
          const cleared = await clearProjectSceneCells(job.projectId, job.cells);
          cleared.items.forEach((item) => {
            autosaveItemVersionsRef.current.set(item.id, item.updatedAt);
            autosaveItemSnapshotsRef.current.set(item.id, item);
          });
          const isActiveProject = mountedRef.current
            && activeProjectIdRef.current === job.projectId;
          if (isActiveProject) {
            sceneAutosave.markSaved(cleared.items.map(sceneItemAutosaveEntity));
          }
          if (cleared.items.length > 0 && isActiveProject) {
            const clearedById = new Map(cleared.items.map((item) => [item.id, item]));
            setItems((current) => {
              const next = current.map((item) => {
                const saved = clearedById.get(item.id);
                return saved ? { ...item, updatedAt: saved.updatedAt } : item;
              });
              itemsRef.current = next;
              return next;
            });
          }
          for (const cell of job.cells) {
            const key = sceneCellKey(job.projectId, cell.sceneId, cell.column);
            rebaseQueuedClearJobs(
              clearSaveQueueRef.current,
              job.projectId,
              key,
              job.version,
              ""
            );
          }
          job.resolve();
        } catch (error) {
          if (mountedRef.current && activeProjectIdRef.current === job.projectId) {
            setItems((current) => {
              const next = restoreClearJobValues(
                current,
                job,
                sceneCellVersionsRef.current
              );
              itemsRef.current = next;
              return next;
            });
          }
          for (const cell of job.cells) {
            const key = sceneCellKey(job.projectId, cell.sceneId, cell.column);
            rebaseQueuedClearJobs(
              clearSaveQueueRef.current,
              job.projectId,
              key,
              job.version,
              job.previousValues.get(key) ?? ""
            );
          }
          if (mountedRef.current && activeProjectIdRef.current === job.projectId) {
            job.reject(error);
          } else {
            job.resolve();
          }
        }
      }
    } finally {
      clearSaveRunningRef.current = false;
      if (mountedRef.current) setIsClearPersisting(false);
    }
  }, [sceneAutosave.markSaved]);

  const persistClearCells = useCallback((
    cells: SceneListMergeCell[],
    preparedBeforeSave?: Promise<boolean>
  ) => {
    if (!projectId) return Promise.reject(new Error("프로젝트 ID를 확인할 수 없습니다."));
    const previous = itemsRef.current;
    const columnsById = new Map<string, Set<ProjectSceneMergeColumn>>();
    for (const cell of cells) {
      const columns = columnsById.get(cell.sceneId) ?? new Set<ProjectSceneMergeColumn>();
      columns.add(cell.column);
      columnsById.set(cell.sceneId, columns);
    }
    const nextItems = previous.map((item) => clearSceneItemColumns(item, columnsById.get(item.id)));
    const beforeSave = preparedBeforeSave ?? sceneAutosave.flushKeys(
      [...columnsById.keys()].map(sceneItemAutosaveKey)
    );
    const version = ++sceneCellMutationVersionRef.current;
    const normalizedCells = cells as ProjectSceneClearCell[];
    const previousValues = new Map<string, string>();
    const previousVersions = new Map<string, number | undefined>();
    for (const cell of normalizedCells) {
      const item = previous.find((candidate) => candidate.id === cell.sceneId);
      const key = sceneCellKey(projectId, cell.sceneId, cell.column);
      previousValues.set(key, readSceneCellValue(item, cell.column));
      previousVersions.set(key, sceneCellVersionsRef.current.get(key));
      sceneCellVersionsRef.current.set(key, version);
    }
    itemsRef.current = nextItems;
    flushSync(() => {
      setItems(nextItems);
      setErrorMessage("");
    });
    const promise = new Promise<void>((resolve, reject) => {
      clearSaveQueueRef.current.push({
        projectId,
        version,
        cells: normalizedCells,
        beforeSave,
        previousValues,
        previousVersions,
        resolve,
        reject
      });
    });
    trackProjectMutationTail(projectClearMutationTails, projectId, promise);
    for (const sceneId of columnsById.keys()) {
      trackProjectMutationTail(
        projectSceneItemMutationTails,
        sceneItemMutationKey(projectId, sceneId),
        promise
      );
    }
    void drainClearSaveQueue();
    return promise;
  }, [drainClearSaveQueue, projectId, sceneAutosave.flushKeys]);

  const clearCells = useCallback((cells: SceneListMergeCell[]) => {
    if (!projectId || cells.length === 0) return Promise.resolve();
    const snapshot = cells.map((cell) => ({
      ...cell,
      value: readSceneCellValue(
        itemsRef.current.find((item) => item.id === cell.sceneId),
        cell.column
      )
    }));
    const preparedBeforeSave = sceneAutosave.flushKeys(
      [...new Set(cells.map((cell) => cell.sceneId))].map(sceneItemAutosaveKey)
    );
    const removeLocal = () => {
      const columnsById = new Map<string, Set<ProjectSceneMergeColumn>>();
      for (const cell of cells) {
        const columns = columnsById.get(cell.sceneId) ?? new Set<ProjectSceneMergeColumn>();
        columns.add(cell.column);
        columnsById.set(cell.sceneId, columns);
      }
      const next = itemsRef.current.map((item) => clearSceneItemColumns(item, columnsById.get(item.id)));
      itemsRef.current = next;
      setItems(next);
    };
    const restoreLocal = () => {
      const byScene = new Map<string, Map<ProjectSceneMergeColumn, string>>();
      for (const cell of snapshot) {
        const values = byScene.get(cell.sceneId) ?? new Map<ProjectSceneMergeColumn, string>();
        values.set(cell.column, cell.value);
        byScene.set(cell.sceneId, values);
      }
      const next = itemsRef.current.map((item) => {
        const values = byScene.get(item.id);
        if (!values) return item;
        const restored = { ...item };
        for (const [column, value] of values) writeSceneCellValue(restored, column, value);
        return restored;
      });
      itemsRef.current = next;
      setItems(next);
    };
    deleteWithUndo({
      key: `scene-cells:${snapshot.map((cell) => `${cell.sceneId}:${cell.column}`).join("|")}`,
      label: "선택한 씬 셀",
      removeLocal,
      restoreLocal,
      deleteRemote: () => persistClearCells(cells, preparedBeforeSave),
      restoreRemote: async () => {
        const restored = await restoreProjectSceneCells(projectId, snapshot);
        restored.items.forEach((item) => {
          autosaveItemVersionsRef.current.set(item.id, item.updatedAt);
          autosaveItemSnapshotsRef.current.set(item.id, item);
        });
      }
    });
    return Promise.resolve();
  }, [deleteWithUndo, persistClearCells, projectId, sceneAutosave.flushKeys]);

  const reorderLocal = useCallback((nextItems: ProjectSceneItem[]) => {
    const ordered = nextItems.map((item, index) => ({ ...item, sortOrder: index + 1 }));
    itemsRef.current = ordered;
    setItems(ordered);
    setErrorMessage("");
  }, []);

  const commitReorder = useCallback(async (nextItems: ProjectSceneItem[]) => {
    if (!projectId) throw new Error("프로젝트 ID를 확인할 수 없습니다.");
    try {
      const persistedIds = nextItems
        .filter((item) => persistedItemIdsRef.current.has(item.id))
        .map((item) => item.id);
      if (!await sceneAutosave.flushKeys(persistedIds.map(sceneItemAutosaveKey))) {
        throw new Error("씬 입력값 자동 저장에 실패해 순서를 변경하지 못했습니다.");
      }
      const reorderPromise = reorderProjectSceneItems(
        projectId,
        nextItems.map((item) => item.id)
      );
      const settledReorder = reorderPromise.then(() => undefined, () => undefined);
      for (const itemId of persistedIds) {
        trackProjectMutationTail(
          projectSceneItemMutationTails,
          sceneItemMutationKey(projectId, itemId),
          settledReorder
        );
      }
      const savedItems = await reorderPromise;
      savedItems.forEach((item) => {
        autosaveItemVersionsRef.current.set(item.id, item.updatedAt);
        autosaveItemSnapshotsRef.current.set(item.id, item);
      });
      if (mountedRef.current && activeProjectIdRef.current === projectId) {
        const savedById = new Map(savedItems.map((item) => [item.id, item]));
        setItems((current) => {
          const next = current.map((item) => {
            const saved = savedById.get(item.id);
            return saved ? { ...item, sortOrder: saved.sortOrder, updatedAt: saved.updatedAt } : item;
          });
          itemsRef.current = next;
          return next;
        });
      }
    } catch (error) {
      if (activeProjectIdRef.current === projectId) throw error;
    }
  }, [projectId, sceneAutosave.flushKeys]);

  const save = useCallback(async () => {
    if (
      !canEdit
      || !projectId
      || isMergePersisting
      || isClearPersisting
      || mergeSaveRunningRef.current
      || clearSaveRunningRef.current
      || mergeSaveQueueRef.current.length > 0
      || clearSaveQueueRef.current.length > 0
    ) return;
    const activeCutError = Object.entries(cutInputErrors).find(([itemId, message]) => (
      message && items.some((item) => item.id === itemId)
    ));
    if (activeCutError) {
      setErrorMessage(activeCutError[1]);
      return;
    }
    setIsSaving(true);
    setErrorMessage("");
    try {
      if (!await sceneAutosave.flush()) {
        setErrorMessage("자동 저장에 실패한 입력값을 먼저 확인해주세요.");
        return;
      }
      const saved = await saveProjectSceneList(projectId, {
        items,
        scenarioReference,
        ...(mergeMetadataDirty ? {
          cellMerges,
          cellMergesMaterialized: true,
          cellMergesUpdatedAt
        } : {})
      });
      if (!mountedRef.current || activeProjectIdRef.current !== projectId) return;
      const visibleMerges = saved.cellMergesMaterialized
        ? saved.cellMerges
        : deriveLegacySceneListMerges(saved.items);
      itemsRef.current = saved.items;
      cellMergesRef.current = visibleMerges;
      cellMergesMaterializedRef.current = saved.cellMergesMaterialized;
      cellMergesUpdatedAtRef.current = saved.cellMergesUpdatedAt;
      autosaveReferenceVersionsRef.current.set(projectId, saved.cellMergesUpdatedAt);
      persistedMergeSnapshotRef.current = {
        merges: visibleMerges,
        materialized: saved.cellMergesMaterialized,
        updatedAt: saved.cellMergesUpdatedAt
      };
      setItems(saved.items);
      setScenarioReference(saved.scenarioReference);
      setCellMerges(visibleMerges);
      setCellMergesMaterialized(saved.cellMergesMaterialized);
      setCellMergesUpdatedAt(saved.cellMergesUpdatedAt);
      setMergeMetadataDirty(false);
      setCutInputErrors({});
      setIsDirty(false);
      persistedItemIdsRef.current = new Set(saved.items.map((item) => item.id));
      autosaveItemVersionsRef.current = new Map(saved.items.map((item) => [item.id, item.updatedAt]));
      autosaveItemSnapshotsRef.current = new Map(saved.items.map((item) => [item.id, item]));
      autosaveItemIntentFieldsRef.current.clear();
      sceneAutosave.markSaved(sceneAutosaveEntitiesFrom(saved.items, saved.scenarioReference));
    } catch (error) {
      if (mountedRef.current && activeProjectIdRef.current === projectId) {
        setErrorMessage(getErrorMessage(error, "씬리스트를 저장하지 못했습니다."));
      }
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  }, [
    canEdit,
    cellMerges,
    cellMergesUpdatedAt,
    cutInputErrors,
    items,
    isClearPersisting,
    isMergePersisting,
    mergeMetadataDirty,
    projectId,
    scenarioReference
    , sceneAutosave
  ]);

  if (isLoading || loadedProjectId !== projectId) {
    return (
      <div
        data-scene-list-mode="loading"
        className={viewportMode === "editor"
          ? "light-workspace scene-workspace workspace-canvas"
          : viewportMode === "portrait"
            ? "scene-list-portrait-dark scene-list-portrait-workspace"
            : "scene-list-responsive-pending"}
      >
        <PageLoader />
      </div>
    );
  }

  if (!project || loadFailed) {
    return (
      <div className="border border-field-danger bg-field-panel p-6 text-center">
        <p className="font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</p>
        <Link
          href="/"
          className="mt-4 inline-flex min-h-10 items-center border border-field-divider bg-field-panel px-4 text-sm font-bold text-field-text"
        >
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <section
      data-scene-list-page
      data-scene-list-viewport={viewportMode ?? "pending"}
      className={`mx-auto w-full min-w-0 max-w-[1480px] pb-20 ${
        viewportMode === "portrait" ? "scene-list-page--portrait" : ""
      }`}
      onCompositionStartCapture={(event) => {
        setComposingAutosaveKey(getSceneAutosaveKeyFromTarget(event.target));
      }}
      onCompositionEndCapture={(event) => {
        const key = getSceneAutosaveKeyFromTarget(event.target);
        setComposingAutosaveKey((current) => current === key ? null : current);
        if (key) window.setTimeout(() => void sceneAutosave.flushKeys([key]), 0);
      }}
      onBlurCapture={(event) => {
        const key = getSceneAutosaveKeyFromTarget(event.target);
        if (key && key !== composingAutosaveKey) void sceneAutosave.flushKeys([key]);
      }}
    >
      <section className="border border-field-border bg-field-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-field-border bg-field-soft px-3 py-2">
          <div className="min-w-0">
            <h1 className="ui-density-heading font-display break-words font-black text-field-text [overflow-wrap:anywhere]">
              {project.name} 씬리스트
            </h1>
            {isMergePersisting || isClearPersisting ? (
              <p className="text-[10px] font-bold text-field-muted" role="status">변경사항 저장 중</p>
            ) : null}
            <AutosaveStatus
              status={sceneAutosave.status}
              onRetry={() => {
                setErrorMessage("");
                sceneAutosave.retry();
              }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/projects/${project.id}`}
              onClick={(event) => {
                if (!confirmUnsavedChangesNavigation()) event.preventDefault();
              }}
              className="inline-flex min-h-9 items-center gap-1 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition-colors hover:bg-field-hover"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              프로젝트
            </Link>
            {canEdit && viewportMode === "editor" ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={isSaving || isMergePersisting || isClearPersisting || !isDirty}
                className="scene-list-edit-action inline-flex min-h-9 items-center gap-1 rounded-md border border-field-primary bg-field-primary px-3 text-xs font-semibold text-field-accent-foreground transition-colors hover:border-field-secondary hover:bg-field-secondary active:bg-field-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSaving ? <InlineLoader /> : <Save className="h-3.5 w-3.5" aria-hidden />}
                저장
              </button>
            ) : null}
          </div>
        </div>

        {errorMessage ? (
          <p className="border-b border-field-danger bg-field-danger/10 px-3 py-2 text-xs font-bold text-field-danger" role="status">
            {errorMessage}
          </p>
        ) : null}

        <div className={`min-w-0 max-w-full ${
          viewportMode === "editor"
            ? "light-workspace scene-workspace workspace-canvas"
            : viewportMode === "portrait"
              ? "scene-list-portrait-dark scene-list-portrait-workspace"
              : "scene-list-responsive-pending"
        }`}>
          {viewportMode === null ? (
            <div
              data-scene-list-mode="pending"
              className="scene-list-pending-state grid min-h-40 w-full place-items-center border-b"
              role="status"
              aria-label="씬리스트 화면 준비 중"
            >
              <SectionLoader className="min-h-40" />
            </div>
          ) : viewportMode === "portrait" ? (
            <div ref={mobileGuideAnchorRef} className="min-w-0">
              <SceneListPortraitReadOnly
                items={items}
                actorRoles={actorRoles}
                cellMerges={cellMerges}
                expandedSceneIds={expandedPortraitSceneIds}
                onToggle={togglePortraitScene}
              />
            </div>
          ) : (
            <div ref={desktopGuideAnchorRef} data-scene-list-mode="editor">
              <SceneListNativeTable
                items={items}
                actorRoles={actorRoles}
                cellMerges={cellMerges}
                canEdit={canEdit && !isSaving}
                showReorderHandle={canEdit}
                hasPendingMutation={isMergePersisting || isClearPersisting}
                onUpdate={updateItem}
                onReorderLocal={reorderLocal}
                onReorderCommit={commitReorder}
                onPersistMerges={persistMerges}
                onClearCells={clearCells}
                onDelete={deleteItem}
                onError={setErrorMessage}
                onCutValidationChange={updateCutInputError}
              />
            </div>
          )}
          {canEdit && viewportMode === "editor" ? (
            <div className="workspace-surface-subtle workspace-border border-t p-2">
              <button
                type="button"
                onClick={addItem}
                disabled={isSaving || isMergePersisting || isClearPersisting}
                className="workspace-button inline-flex min-h-9 items-center gap-1 border px-3 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                씬 추가
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {viewportMode === "editor" && (canEdit || scenarioReference) ? (
        <details className="light-workspace scene-workspace workspace-surface workspace-border mt-3 overflow-hidden border">
          <summary className="workspace-button cursor-pointer border-0 px-3 py-2 text-sm font-bold">
            메모
          </summary>
          <div className="workspace-border border-t p-3">
            {canEdit ? (
              <textarea
                data-scene-reference-editor
                value={scenarioReference}
                disabled={isSaving}
                onChange={(event) => {
                  setScenarioReference(event.target.value);
                }}
                rows={7}
                aria-label="메모"
                placeholder="메모"
                className="workspace-control w-full resize-y border px-3 py-2 text-sm font-medium leading-6 outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            ) : (
              <p className="workspace-text whitespace-pre-wrap text-sm font-medium leading-6">
                {scenarioReference}
              </p>
            )}
          </div>
        </details>
      ) : null}

      {viewportMode === "portrait" && scenarioReference ? (
        <details className="scene-list-portrait-dark scene-list-portrait-reference mt-3 overflow-hidden border">
          <summary className="cursor-pointer border-0 px-3 py-2 text-center text-sm font-bold">
            메모
          </summary>
          <p className="min-w-0 whitespace-pre-wrap border-t p-3 text-left text-[13px] font-medium leading-[1.6] [overflow-wrap:anywhere]">
            {scenarioReference}
          </p>
        </details>
      ) : null}

      {!cellMergesMaterialized && cellMerges.length > 0 ? (
        <p className="sr-only">기존 셀 병합 표시를 호환 모드로 불러왔습니다.</p>
      ) : null}
    </section>
  );
}

function clearSceneItemColumns(
  item: ProjectSceneItem,
  columns: Set<ProjectSceneMergeColumn> | undefined
) {
  if (!columns?.size) return item;
  const next = { ...item };
  if (columns.has("location")) next.mainLocation = "";
  if (columns.has("subLocation")) next.subLocation = "";
  if (columns.has("day")) next.dayLabel = "";
  if (columns.has("time")) next.dayNight = "";
  if (columns.has("intExt")) next.interiorExterior = "";
  return next;
}

function sceneItemAutosaveKey(itemId: string) {
  return `item:${itemId}`;
}

function sceneReferenceAutosaveKey() {
  return "reference";
}

function getSceneAutosaveKeyFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-scene-reference-editor]")) return sceneReferenceAutosaveKey();
  const owner = target.closest<HTMLElement>(
    "[data-scene-item-id],[data-scene-merge-scene-id],[data-scene-character-note-row-id]"
  );
  const itemId = owner?.dataset.sceneItemId
    || owner?.dataset.sceneMergeSceneId
    || owner?.dataset.sceneCharacterNoteRowId;
  return itemId ? sceneItemAutosaveKey(itemId) : null;
}

function sceneItemAutosaveEntity(item: ProjectSceneItem): SceneAutosaveEntity {
  return { key: sceneItemAutosaveKey(item.id), kind: "item", item };
}

function sceneAutosaveEntitiesFrom(
  items: ProjectSceneItem[],
  scenarioReference: string
): SceneAutosaveEntity[] {
  return [
    ...items.map(sceneItemAutosaveEntity),
    { key: sceneReferenceAutosaveKey(), kind: "reference", scenarioReference }
  ];
}

function sceneAutosaveEntityFingerprint(entity: SceneAutosaveEntity) {
  return entity.kind === "item"
    ? sceneItemEditableFingerprint(entity.item)
    : JSON.stringify(entity.scenarioReference);
}

function sceneItemEditableFingerprint(item: ProjectSceneItem) {
  return JSON.stringify({
    sceneNo: item.sceneNo,
    mainLocation: item.mainLocation,
    subLocation: item.subLocation,
    dayLabel: item.dayLabel,
    dayNight: item.dayNight,
    interiorExterior: item.interiorExterior,
    sceneContent: item.sceneContent,
    characters: item.characters,
    characterNotes: item.characterNotes,
    actorCells: item.actorCells,
    props: item.props,
    cutCount: item.cutCount
  });
}

function restoreClearJobValues(
  items: ProjectSceneItem[],
  job: ClearSaveJob,
  latestVersions: Map<string, number>
) {
  const cellsBySceneId = new Map<string, ProjectSceneClearCell[]>();
  for (const cell of job.cells) {
    const key = sceneCellKey(job.projectId, cell.sceneId, cell.column);
    if (latestVersions.get(key) !== job.version) continue;
    const current = cellsBySceneId.get(cell.sceneId) ?? [];
    current.push(cell);
    cellsBySceneId.set(cell.sceneId, current);
  }
  if (cellsBySceneId.size === 0) return items;
  return items.map((item) => {
    const cells = cellsBySceneId.get(item.id);
    if (!cells?.length) return item;
    const next = { ...item };
    for (const cell of cells) {
      writeSceneCellValue(
        next,
        cell.column,
        job.previousValues.get(sceneCellKey(job.projectId, cell.sceneId, cell.column)) ?? ""
      );
    }
    return next;
  });
}

function markSceneCellPatchVersion(
  versions: Map<string, number>,
  projectId: string,
  sceneId: string,
  patch: Partial<ProjectSceneItem>,
  version: number
) {
  const keys: Array<[keyof ProjectSceneItem, ProjectSceneMergeColumn]> = [
    ["mainLocation", "location"],
    ["subLocation", "subLocation"],
    ["dayLabel", "day"],
    ["dayNight", "time"],
    ["interiorExterior", "intExt"]
  ];
  keys.forEach(([field, column]) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      versions.set(sceneCellKey(projectId, sceneId, column), version);
    }
  });
}

function readSceneCellValue(
  item: ProjectSceneItem | undefined,
  column: ProjectSceneMergeColumn
) {
  if (!item) return "";
  if (column === "location") return item.mainLocation;
  if (column === "subLocation") return item.subLocation;
  if (column === "day") return item.dayLabel;
  if (column === "time") return item.dayNight;
  return item.interiorExterior;
}

function writeSceneCellValue(
  item: ProjectSceneItem,
  column: ProjectSceneMergeColumn,
  value: string
) {
  if (column === "location") item.mainLocation = value;
  else if (column === "subLocation") item.subLocation = value;
  else if (column === "day") item.dayLabel = value;
  else if (column === "time") item.dayNight = value;
  else item.interiorExterior = value;
}

function sceneCellKey(
  projectId: string,
  sceneId: string,
  column: ProjectSceneMergeColumn
) {
  return `${projectId}\u0000${sceneId}\u0000${column}`;
}

function sceneItemMutationKey(projectId: string, sceneId: string) {
  return `${projectId}\u0000${sceneId}`;
}

function clonePersistedMergeSnapshot(snapshot: PersistedMergeSnapshot): PersistedMergeSnapshot {
  return {
    merges: snapshot.merges,
    materialized: snapshot.materialized,
    updatedAt: snapshot.updatedAt
  };
}

function trackProjectMutationTail(
  tails: Map<string, Promise<void>>,
  projectId: string,
  mutation: Promise<void>
) {
  const settled = mutation.then(() => undefined, () => undefined);
  tails.set(projectId, settled);
  void settled.then(() => {
    if (tails.get(projectId) === settled) tails.delete(projectId);
  });
}

function rebaseQueuedMergeJobs(
  queue: MergeSaveJob[],
  projectId: string,
  snapshot: PersistedMergeSnapshot
) {
  queue.forEach((job) => {
    if (job.projectId === projectId) {
      job.expectedUpdatedAt = snapshot.updatedAt;
      job.rollbackSnapshot = clonePersistedMergeSnapshot(snapshot);
    }
  });
}

function mergeQueueContainsProject(queue: MergeSaveJob[], projectId: string) {
  return queue.some((job) => job.projectId === projectId);
}

function takeMergeJobsForProject(queue: MergeSaveJob[], projectId: string) {
  const selected: MergeSaveJob[] = [];
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index]?.projectId === projectId) {
      selected.unshift(queue[index]!);
      queue.splice(index, 1);
    }
  }
  return selected;
}

function rebaseQueuedClearJobs(
  queue: ClearSaveJob[],
  projectId: string,
  cellKey: string,
  settledVersion: number,
  value: string
) {
  queue.forEach((job) => {
    if (
      job.projectId === projectId
      && job.previousVersions.get(cellKey) === settledVersion
    ) {
      job.previousValues.set(cellKey, value);
    }
  });
}

function mergeSceneItemConflict(
  latest: ProjectSceneItem,
  local: ProjectSceneItem,
  intentFields: ReadonlySet<keyof ProjectSceneItemDraftPatch>
) {
  const merged = { ...latest };
  for (const field of intentFields) {
    (merged as unknown as Record<string, unknown>)[field] = local[field];
  }
  return merged;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

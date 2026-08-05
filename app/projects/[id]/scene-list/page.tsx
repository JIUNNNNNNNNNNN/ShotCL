"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Save } from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { SceneListNativeTable } from "@/components/SceneListNativeTable";
import { SceneListPortraitReadOnly } from "@/components/SceneListPortraitReadOnly";
import {
  confirmUnsavedChangesNavigation,
  useUnsavedChangesGuard
} from "@/hooks/useUnsavedChangesGuard";
import { useSceneListViewportMode } from "@/hooks/useSceneListViewportMode";
import {
  clearProjectSceneCells,
  createBlankProjectSceneItem,
  getProjectSceneList,
  reorderProjectSceneItems,
  saveProjectSceneCellMerges,
  saveProjectSceneList,
  SceneListMergeMutationError,
  type ProjectSceneClearCell
} from "@/lib/data/sceneList";
import { getProject } from "@/lib/data/projects";
import { auditQuery } from "@/lib/queryAudit";
import { deriveLegacySceneListMerges, type SceneListMergeCell } from "@/lib/sceneListMergeModel";
import type {
  Project,
  ProjectSceneCellMerge,
  ProjectSceneItem,
  ProjectSceneMergeColumn
} from "@/lib/types";

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

type PersistedMergeSnapshot = {
  merges: ProjectSceneCellMerge[];
  materialized: boolean;
  updatedAt: string | null;
};

type MergeSaveJob = {
  projectId: string;
  version: number;
  merges: ProjectSceneCellMerge[];
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
  previousValues: Map<string, string>;
  previousVersions: Map<string, number | undefined>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

// SPA 내부 이동으로 page instance가 교체되어도 같은 프로젝트의 저장 완료를
// 다음 load가 기다릴 수 있도록 module scope에서 pending tail을 공유합니다.
const projectMergeMutationTails = new Map<string, Promise<void>>();
const projectClearMutationTails = new Map<string, Promise<void>>();

/** 프로젝트 공통 씬리스트를 수동 저장하며 Cut 값은 일촬표 컷수와 공유합니다. */
export default function ProjectSceneListPage() {
  const projectId = useProjectId();
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const viewportMode = useSceneListViewportMode();
  const [project, setProject] = useState<Project | null>(null);
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
  const [errorMessage, setErrorMessage] = useState("");
  const [cutInputErrors, setCutInputErrors] = useState<Record<string, string>>({});
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
  const mergeMutationVersionsRef = useRef(new Map<string, number>());
  const mergeSaveQueueRef = useRef<MergeSaveJob[]>([]);
  const mergeSaveRunningRef = useRef(false);
  const sceneCellMutationVersionRef = useRef(0);
  const sceneCellVersionsRef = useRef(new Map<string, number>());
  const clearSaveQueueRef = useRef<ClearSaveJob[]>([]);
  const clearSaveRunningRef = useRef(false);
  activeProjectIdRef.current = projectId;
  useUnsavedChangesGuard(isDirty || isMergePersisting || isClearPersisting);

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

  const load = useCallback(async () => {
    if (!projectId) return;
    const requestVersion = ++loadRequestVersionRef.current;
    setIsLoading(true);
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
      const [projectData, sceneList] = await Promise.all([
        auditQuery(
          "sceneList.loadProject",
          "app/projects/[id]/scene-list/page.tsx:load",
          () => getProject(projectId)
        ),
        auditQuery(
          "sceneList.loadSceneItems",
          "app/projects/[id]/scene-list/page.tsx:load",
          () => getProjectSceneList(projectId)
        )
      ]);
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
      setProject(projectData);
      setLoadedProjectId(projectId);
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
    } catch (error) {
      if (
        mountedRef.current
        && activeProjectIdRef.current === projectId
        && loadRequestVersionRef.current === requestVersion
      ) {
        setProject(null);
        setLoadedProjectId(projectId);
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
  }, [projectId]);

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
    setIsDirty(true);
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
    if (!canEdit) return;
    setItems((current) => {
      const next = current
        .filter((candidate) => candidate.id !== item.id)
        .map((candidate, index) => ({ ...candidate, sortOrder: index + 1 }));
      itemsRef.current = next;
      return next;
    });
    const remainingMerges = cellMergesRef.current.filter((merge) => !merge.sceneIds.includes(item.id));
    if (remainingMerges.length !== cellMergesRef.current.length) {
      cellMergesRef.current = remainingMerges;
      cellMergesMaterializedRef.current = true;
      setCellMerges(remainingMerges);
      setCellMergesMaterialized(true);
      setMergeMetadataDirty(true);
    }
    setCutInputErrors((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setIsDirty(true);
    setErrorMessage("");
  }, [canEdit]);

  const drainMergeSaveQueue = useCallback(async () => {
    if (mergeSaveRunningRef.current) return;
    mergeSaveRunningRef.current = true;
    if (mountedRef.current) setIsMergePersisting(true);
    try {
      while (mergeSaveQueueRef.current.length > 0) {
        const job = mergeSaveQueueRef.current.shift()!;
        try {
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
    const promise = new Promise<void>((resolve, reject) => {
      mergeSaveQueueRef.current.push({
        projectId,
        version,
        merges: nextMerges,
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
  }, [drainMergeSaveQueue, projectId]);

  const drainClearSaveQueue = useCallback(async () => {
    if (clearSaveRunningRef.current) return;
    clearSaveRunningRef.current = true;
    if (mountedRef.current) setIsClearPersisting(true);
    try {
      while (clearSaveQueueRef.current.length > 0) {
        const job = clearSaveQueueRef.current.shift()!;
        try {
          await clearProjectSceneCells(job.projectId, job.cells);
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
  }, []);

  const clearCells = useCallback((cells: SceneListMergeCell[]) => {
    if (!projectId) return Promise.reject(new Error("프로젝트 ID를 확인할 수 없습니다."));
    const previous = itemsRef.current;
    const columnsById = new Map<string, Set<ProjectSceneMergeColumn>>();
    for (const cell of cells) {
      const columns = columnsById.get(cell.sceneId) ?? new Set<ProjectSceneMergeColumn>();
      columns.add(cell.column);
      columnsById.set(cell.sceneId, columns);
    }
    const nextItems = previous.map((item) => clearSceneItemColumns(item, columnsById.get(item.id)));
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
        previousValues,
        previousVersions,
        resolve,
        reject
      });
    });
    trackProjectMutationTail(projectClearMutationTails, projectId, promise);
    void drainClearSaveQueue();
    return promise;
  }, [drainClearSaveQueue, projectId]);

  const reorderLocal = useCallback((nextItems: ProjectSceneItem[]) => {
    const ordered = nextItems.map((item, index) => ({ ...item, sortOrder: index + 1 }));
    itemsRef.current = ordered;
    setItems(ordered);
    setErrorMessage("");
  }, []);

  const commitReorder = useCallback(async (nextItems: ProjectSceneItem[]) => {
    if (!projectId) throw new Error("프로젝트 ID를 확인할 수 없습니다.");
    try {
      await reorderProjectSceneItems(projectId, nextItems.map((item) => item.id));
    } catch (error) {
      if (activeProjectIdRef.current === projectId) throw error;
    }
  }, [projectId]);

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
  ]);

  if (isLoading || loadedProjectId !== projectId) return <PixelDogLoader size="lg" />;

  if (!project) {
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
    <section className="mx-auto w-full min-w-0 max-w-[1480px] pb-20">
      <section className="border border-field-border bg-field-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-field-border bg-field-soft px-3 py-2">
          <div className="min-w-0">
            <h1 className="font-display truncate text-lg font-black text-field-text">
              {project.name} 씬리스트
            </h1>
            {isMergePersisting || isClearPersisting ? (
              <p className="text-[10px] font-bold text-field-muted" role="status">변경사항 저장 중</p>
            ) : null}
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
                {isSaving ? <PixelDogLoader size="xs" compact /> : <Save className="h-3.5 w-3.5" aria-hidden />}
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

        <div className="light-workspace scene-workspace workspace-canvas min-w-0 max-w-full">
          {viewportMode === null ? (
            <div
              data-scene-list-mode="pending"
              className="grid min-h-40 w-full place-items-center border-b border-[#d2d2d2] bg-[#f5f5f5]"
              role="status"
              aria-label="씬리스트 화면 준비 중"
            >
              <PixelDogLoader size="sm" compact />
            </div>
          ) : viewportMode === "portrait" ? (
            <SceneListPortraitReadOnly
              items={items}
              actorRoles={actorRoles}
              cellMerges={cellMerges}
              expandedSceneIds={expandedPortraitSceneIds}
              onToggle={togglePortraitScene}
            />
          ) : (
            <div data-scene-list-mode="editor">
              <SceneListNativeTable
                items={items}
                actorRoles={actorRoles}
                cellMerges={cellMerges}
                canEdit={canEdit && !isSaving}
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
            시나리오 참고
          </summary>
          <div className="workspace-border border-t p-3">
            {canEdit ? (
              <textarea
                value={scenarioReference}
                disabled={isSaving}
                onChange={(event) => {
                  setScenarioReference(event.target.value);
                  setIsDirty(true);
                }}
                rows={7}
                aria-label="시나리오 참고"
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
        <details className="mt-3 border border-field-divider bg-field-section text-field-text">
          <summary className="cursor-pointer border-0 px-3 py-2 text-center text-sm font-bold">
            메모
          </summary>
          <p className="min-w-0 whitespace-pre-wrap border-t border-field-divider p-3 text-center text-[13px] font-medium leading-[1.5] text-field-text [overflow-wrap:anywhere]">
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

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

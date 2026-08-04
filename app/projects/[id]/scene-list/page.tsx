"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Save } from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { SceneListNativeTable } from "@/components/SceneListNativeTable";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import {
  clearProjectSceneCells,
  createBlankProjectSceneItem,
  getProjectSceneList,
  reorderProjectSceneItems,
  saveProjectSceneCellMerges,
  saveProjectSceneList,
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

/** 프로젝트 공통 씬리스트를 수동 저장하며 Cut 값은 일촬표 컷수와 공유합니다. */
export default function ProjectSceneListPage() {
  const projectId = useProjectId();
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<ProjectSceneItem[]>([]);
  const [actorRoles, setActorRoles] = useState<string[]>([]);
  const [scenarioReference, setScenarioReference] = useState("");
  const [cellMerges, setCellMerges] = useState<ProjectSceneCellMerge[]>([]);
  const [cellMergesMaterialized, setCellMergesMaterialized] = useState(false);
  const [cellMergesUpdatedAt, setCellMergesUpdatedAt] = useState<string | null>(null);
  const [mergeMetadataDirty, setMergeMetadataDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [cutInputErrors, setCutInputErrors] = useState<Record<string, string>>({});
  const itemsRef = useRef(items);
  const cellMergesRef = useRef(cellMerges);
  const cellMergesMaterializedRef = useRef(cellMergesMaterialized);
  const cellMergesUpdatedAtRef = useRef(cellMergesUpdatedAt);
  useUnsavedChangesGuard(isDirty);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
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
    setIsLoading(true);
    try {
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
      setProject(projectData);
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
      setErrorMessage(getErrorMessage(error, "씬리스트를 불러오지 못했습니다."));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateItem = useCallback((id: string, patch: Partial<ProjectSceneItem>) => {
    if (!canEdit) return;
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    setIsDirty(true);
    setErrorMessage("");
  }, [canEdit]);

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
    setItems((current) => [
      ...current,
      createBlankProjectSceneItem(projectId, current.length + 1)
    ]);
    setIsDirty(true);
    setErrorMessage("");
  }, [canEdit, projectId]);

  const deleteItem = useCallback((item: ProjectSceneItem) => {
    if (!canEdit) return;
    setItems((current) => current
      .filter((candidate) => candidate.id !== item.id)
      .map((candidate, index) => ({ ...candidate, sortOrder: index + 1 }))
    );
    const remainingMerges = cellMergesRef.current.filter((merge) => !merge.sceneIds.includes(item.id));
    if (remainingMerges.length !== cellMergesRef.current.length) {
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

  const persistMerges = useCallback(async (nextMerges: ProjectSceneCellMerge[]) => {
    if (!projectId) throw new Error("프로젝트 ID를 확인할 수 없습니다.");
    const previous = cellMergesRef.current;
    const previousMaterialized = cellMergesMaterializedRef.current;
    setCellMerges(nextMerges);
    setCellMergesMaterialized(true);
    setErrorMessage("");
    try {
      const saved = await saveProjectSceneCellMerges(
        projectId,
        nextMerges,
        cellMergesUpdatedAtRef.current
      );
      setCellMerges(saved.cellMerges);
      setCellMergesMaterialized(true);
      setCellMergesUpdatedAt(saved.updatedAt);
      setMergeMetadataDirty(false);
    } catch (error) {
      setCellMerges(previous);
      setCellMergesMaterialized(previousMaterialized);
      throw error;
    }
  }, [projectId]);

  const clearCells = useCallback(async (cells: SceneListMergeCell[]) => {
    if (!projectId) throw new Error("프로젝트 ID를 확인할 수 없습니다.");
    const previous = itemsRef.current;
    const columnsById = new Map<string, Set<ProjectSceneMergeColumn>>();
    for (const cell of cells) {
      const columns = columnsById.get(cell.sceneId) ?? new Set<ProjectSceneMergeColumn>();
      columns.add(cell.column);
      columnsById.set(cell.sceneId, columns);
    }
    const nextItems = previous.map((item) => clearSceneItemColumns(item, columnsById.get(item.id)));
    setItems(nextItems);
    setErrorMessage("");
    try {
      await clearProjectSceneCells(projectId, cells as ProjectSceneClearCell[]);
    } catch (error) {
      const previousById = new Map(previous.map((item) => [item.id, item]));
      setItems((current) => current.map((item) => restoreSceneItemColumns(
        item,
        previousById.get(item.id),
        columnsById.get(item.id)
      )));
      throw error;
    }
  }, [projectId]);

  const reorderLocal = useCallback((nextItems: ProjectSceneItem[]) => {
    setItems(nextItems.map((item, index) => ({ ...item, sortOrder: index + 1 })));
    setErrorMessage("");
  }, []);

  const commitReorder = useCallback(async (nextItems: ProjectSceneItem[]) => {
    if (!projectId) throw new Error("프로젝트 ID를 확인할 수 없습니다.");
    await reorderProjectSceneItems(projectId, nextItems.map((item) => item.id));
  }, [projectId]);

  const save = useCallback(async () => {
    if (!canEdit || !projectId) return;
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
      const visibleMerges = saved.cellMergesMaterialized
        ? saved.cellMerges
        : deriveLegacySceneListMerges(saved.items);
      setItems(saved.items);
      setScenarioReference(saved.scenarioReference);
      setCellMerges(visibleMerges);
      setCellMergesMaterialized(saved.cellMergesMaterialized);
      setCellMergesUpdatedAt(saved.cellMergesUpdatedAt);
      setMergeMetadataDirty(false);
      setCutInputErrors({});
      setIsDirty(false);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "씬리스트를 저장하지 못했습니다."));
    } finally {
      setIsSaving(false);
    }
  }, [
    canEdit,
    cellMerges,
    cellMergesUpdatedAt,
    cutInputErrors,
    items,
    mergeMetadataDirty,
    projectId,
    scenarioReference
  ]);

  if (isLoading) return <PixelDogLoader size="lg" />;

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
    <main className="mx-auto w-full min-w-0 max-w-[1480px] pb-20">
      <section className="overflow-clip border border-field-border bg-field-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-field-border bg-field-soft px-3 py-2">
          <h1 className="font-display min-w-0 truncate text-lg font-black text-field-text">
            {project.name} 씬리스트
          </h1>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex min-h-9 items-center gap-1 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition-colors hover:bg-field-hover"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              프로젝트
            </Link>
            {canEdit ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={isSaving || !isDirty}
                className="scene-list-edit-action inline-flex min-h-9 items-center gap-1 border border-field-primary/70 bg-field-primary/10 px-3 text-xs font-bold text-field-primary transition-colors hover:bg-field-primary/15 disabled:cursor-not-allowed disabled:opacity-40"
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

        <div className="light-workspace scene-workspace workspace-canvas">
          <SceneListNativeTable
            items={items}
            actorRoles={actorRoles}
            cellMerges={cellMerges}
            canEdit={canEdit && !isSaving}
            onUpdate={updateItem}
            onReorderLocal={reorderLocal}
            onReorderCommit={commitReorder}
            onPersistMerges={persistMerges}
            onClearCells={clearCells}
            onDelete={deleteItem}
            onError={setErrorMessage}
            onCutValidationChange={updateCutInputError}
          />
          {canEdit ? (
            <div className="workspace-surface-subtle workspace-border border-t p-2">
              <button
                type="button"
                onClick={addItem}
                disabled={isSaving}
                className="workspace-button inline-flex min-h-9 items-center gap-1 border px-3 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                씬 추가
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {(canEdit || scenarioReference) ? (
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

      {!cellMergesMaterialized && cellMerges.length > 0 ? (
        <p className="sr-only">기존 셀 병합 표시를 호환 모드로 불러왔습니다.</p>
      ) : null}
    </main>
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

function restoreSceneItemColumns(
  item: ProjectSceneItem,
  previous: ProjectSceneItem | undefined,
  columns: Set<ProjectSceneMergeColumn> | undefined
) {
  if (!previous || !columns?.size) return item;
  const next = { ...item };
  if (columns.has("location")) next.mainLocation = previous.mainLocation;
  if (columns.has("subLocation")) next.subLocation = previous.subLocation;
  if (columns.has("day")) next.dayLabel = previous.dayLabel;
  if (columns.has("time")) next.dayNight = previous.dayNight;
  if (columns.has("intExt")) next.interiorExterior = previous.interiorExterior;
  return next;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

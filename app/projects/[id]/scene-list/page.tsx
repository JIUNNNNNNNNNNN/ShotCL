"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { SceneReorderList } from "@/components/SceneReorderList";
import {
  createBlankProjectSceneItem,
  getProjectSceneList,
  saveProjectSceneList
} from "@/lib/data/sceneList";
import { getProject } from "@/lib/data/projects";
import type { Project, ProjectSceneItem } from "@/lib/types";

const inputClassName =
  "min-h-8 w-full min-w-0 select-text border-0 bg-transparent px-1.5 py-1 text-center text-[12px] font-semibold leading-5 text-field-text outline-none [-webkit-touch-callout:default] focus:bg-field-light focus:ring-1 focus:ring-inset focus:ring-field-primary";
const selectClassName = `${inputClassName} appearance-none`;

type SceneValueColumn =
  | "sceneNo"
  | "mainLocation"
  | "subLocation"
  | "dayLabel"
  | "dayNight"
  | "interiorExterior"
  | "sceneContent"
  | "props";

type SceneActorColumn = `actor:${string}`;
type SceneCellColumn = SceneValueColumn | SceneActorColumn;
type SceneFillColumn = Exclude<SceneValueColumn, "sceneNo" | "sceneContent">;

type SelectedSceneCell = {
  rowId: string;
  column: SceneCellColumn;
};

type SceneCellRange = {
  column: SceneCellColumn;
  startIndex: number;
  endIndex: number;
};

type CellDragState = SceneCellRange & {
  initialStartIndex: number;
  initialEndIndex: number;
  originIndex: number;
  pointerId: number;
  startX: number;
  startY: number;
  sourceValue: string;
  didDrag: boolean;
};

type MergePosition = "single" | "start" | "middle" | "end";

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

/** 일촬표와 분리된 프로젝트 공통 씬리스트를 수동 저장 방식으로 편집합니다. */
export default function ProjectSceneListPage() {
  const projectId = useProjectId();
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<ProjectSceneItem[]>([]);
  const [actorRoles, setActorRoles] = useState<string[]>([]);
  const [scenarioReference, setScenarioReference] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedCell, setSelectedCell] = useState<SelectedSceneCell | null>(null);
  const [selectedRange, setSelectedRange] = useState<SceneCellRange | null>(null);
  const itemsRef = useRef(items);
  const selectedCellRef = useRef(selectedCell);
  const selectedRangeRef = useRef(selectedRange);
  const sceneGridRef = useRef<HTMLDivElement | null>(null);
  const copiedValueRef = useRef("");
  const cellDragRef = useRef<CellDragState | null>(null);
  const cellDragCleanupRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [projectData, sceneList] = await Promise.all([
        getProject(projectId),
        getProjectSceneList(projectId)
      ]);
      setProject(projectData);
      setItems(sceneList.items);
      setScenarioReference(sceneList.scenarioReference);
      setActorRoles(sceneList.actorRoles);
      setIsDirty(false);
      setErrorMessage("");
      setSelectedCell(null);
      setSelectedRange(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "씬리스트를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    itemsRef.current = items;
    const activeCell = selectedCellRef.current;
    if (!activeCell) return;
    const rowIndex = items.findIndex((item) => item.id === activeCell.rowId);
    if (rowIndex < 0) {
      selectedCellRef.current = null;
      selectedRangeRef.current = null;
      setSelectedCell(null);
      setSelectedRange(null);
      return;
    }
    const nextRange = getVisualMergeRange(items, rowIndex, activeCell.column);
    selectedRangeRef.current = nextRange;
    setSelectedRange(nextRange);
  }, [items]);

  useEffect(() => {
    selectedCellRef.current = selectedCell;
    selectedRangeRef.current = selectedRange;
  }, [selectedCell, selectedRange]);

  useEffect(() => () => {
    cellDragCleanupRef.current?.();
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
  }, []);

  const gridTemplateColumns = useMemo(
    () => [
      "minmax(0,.5fr)",
      "minmax(0,.75fr)",
      "minmax(0,.9fr)",
      "minmax(0,.48fr)",
      "minmax(0,.36fr)",
      "minmax(0,.36fr)",
      "minmax(0,2.8fr)",
      ...actorRoles.map(() => "minmax(0,.42fr)"),
      "minmax(0,1.05fr)",
      "2.25rem"
    ].join(" "),
    [actorRoles]
  );

  const commitItems = useCallback((nextItems: ProjectSceneItem[]) => {
    setItems(nextItems.map((item, index) => ({ ...item, sortOrder: index + 1 })));
    setIsDirty(true);
    setErrorMessage("");
    setSelectedCell(null);
    setSelectedRange(null);
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<ProjectSceneItem>) => {
    if (!canEdit) return;
    setItems((current) => current.map((item) => (
      item.id === id ? { ...item, ...patch } : item
    )));
    setIsDirty(true);
    setErrorMessage("");
  }, [canEdit]);

  const selectCell = useCallback((
    rowId: string,
    column: SceneCellColumn,
    rowIndex: number
  ) => {
    const nextCell = { rowId, column };
    const nextRange = getVisualMergeRange(itemsRef.current, rowIndex, column);
    selectedCellRef.current = nextCell;
    selectedRangeRef.current = nextRange;
    setSelectedCell(nextCell);
    setSelectedRange(nextRange);
  }, []);

  const applyCellValueRange = useCallback((
    column: SceneCellColumn,
    startIndex: number,
    endIndex: number,
    value: string
  ) => {
    if (!canEdit) return;
    const lower = Math.min(startIndex, endIndex);
    const upper = Math.max(startIndex, endIndex);
    setItems((current) => current.map((item, index) => (
      index >= lower && index <= upper ? setSceneCellValue(item, column, value) : item
    )));
    setIsDirty(true);
    setErrorMessage("");
  }, [canEdit]);

  useEffect(() => {
    const shouldHandleGridClipboard = (target: EventTarget | null) => {
      const grid = sceneGridRef.current;
      return target instanceof Node && Boolean(grid?.contains(target));
    };

    const handleCopy = (event: ClipboardEvent) => {
      const activeCell = selectedCellRef.current;
      if (!activeCell || !shouldHandleGridClipboard(event.target)) return;
      if (hasEditableTextSelection(event.target)) return;
      const item = itemsRef.current.find((candidate) => candidate.id === activeCell.rowId);
      if (!item) return;
      const value = getSceneCellValue(item, activeCell.column);
      copiedValueRef.current = value;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", value);
    };

    const handlePaste = (event: ClipboardEvent) => {
      const activeCell = selectedCellRef.current;
      const range = selectedRangeRef.current;
      if (!canEdit || !activeCell || !range || !shouldHandleGridClipboard(event.target)) return;
      const rangeSize = Math.abs(range.endIndex - range.startIndex) + 1;
      if (isTextEditingTarget(event.target) && rangeSize === 1) return;
      const value = event.clipboardData?.getData("text/plain") ?? copiedValueRef.current;
      event.preventDefault();
      applyCellValueRange(activeCell.column, range.startIndex, range.endIndex, value);
    };

    window.addEventListener("copy", handleCopy);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("paste", handlePaste);
    };
  }, [applyCellValueRange, canEdit]);

  const startCellDrag = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    rowId: string,
    column: SceneCellColumn,
    rowIndex: number,
    value: string
  ) => {
    if (!canEdit || event.button !== 0 || !isFillColumn(column)) return;
    event.stopPropagation();
    cellDragCleanupRef.current?.();
    selectCell(rowId, column, rowIndex);
    const initialRange = getVisualMergeRange(itemsRef.current, rowIndex, column);

    const drag: CellDragState = {
      pointerId: event.pointerId,
      column,
      startIndex: initialRange.startIndex,
      endIndex: initialRange.endIndex,
      initialStartIndex: initialRange.startIndex,
      initialEndIndex: initialRange.endIndex,
      originIndex: rowIndex,
      startX: event.clientX,
      startY: event.clientY,
      sourceValue: value,
      didDrag: false
    };
    cellDragRef.current = drag;

    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleCancel);
      cellDragCleanupRef.current = null;
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
    };

    const findTargetIndex = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      const cell = element?.closest("[data-scene-cell-column]") as HTMLElement | null;
      if (!cell || cell.dataset.sceneCellColumn !== column) return null;
      const targetRowId = cell.dataset.sceneRowId;
      const targetIndex = itemsRef.current.findIndex((item) => item.id === targetRowId);
      return targetIndex >= 0 ? targetIndex : null;
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const current = cellDragRef.current;
      if (!current || moveEvent.pointerId !== current.pointerId) return;
      const horizontalDistance = Math.abs(moveEvent.clientX - current.startX);
      const verticalDistance = Math.abs(moveEvent.clientY - current.startY);
      const targetIndex = findTargetIndex(moveEvent.clientX, moveEvent.clientY);
      if (!current.didDrag) {
        if (
          verticalDistance < 8 ||
          verticalDistance <= horizontalDistance * 1.2 ||
          targetIndex === null ||
          targetIndex === current.originIndex
        ) {
          return;
        }
        current.didDrag = true;
        window.getSelection()?.removeAllRanges();
        document.body.style.userSelect = "none";
        document.body.style.cursor = "cell";
      }
      moveEvent.preventDefault();
      if (targetIndex === null) return;
      const nextRange = getDraggedRange(current, targetIndex);
      if (
        nextRange.startIndex === current.startIndex &&
        nextRange.endIndex === current.endIndex
      ) return;
      current.startIndex = nextRange.startIndex;
      current.endIndex = nextRange.endIndex;
      setSelectedRange({
        column: current.column,
        startIndex: nextRange.startIndex,
        endIndex: nextRange.endIndex
      });
    };

    const finish = (commit: boolean) => {
      const current = cellDragRef.current;
      cellDragRef.current = null;
      cleanup();
      if (commit && current?.didDrag) {
        const nextLower = Math.min(current.startIndex, current.endIndex);
        const nextUpper = Math.max(current.startIndex, current.endIndex);
        const initialLower = Math.min(current.initialStartIndex, current.initialEndIndex);
        const initialUpper = Math.max(current.initialStartIndex, current.initialEndIndex);
        setItems((items) => items.map((item, index) => {
          if (index >= nextLower && index <= nextUpper) {
            return setSceneCellValue(item, current.column, current.sourceValue);
          }
          if (
            initialLower !== initialUpper &&
            index >= initialLower &&
            index <= initialUpper &&
            (index < nextLower || index > nextUpper)
          ) {
            return setSceneCellValue(item, current.column, "");
          }
          return item;
        }));
        setIsDirty(true);
        setErrorMessage("");
      }
    };

    const handleEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== drag.pointerId) return;
      finish(true);
    };

    const handleCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== drag.pointerId) return;
      finish(false);
    };

    cellDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleCancel);
  }, [canEdit, selectCell]);

  function addItem() {
    if (!canEdit || !projectId) return;
    commitItems([
      ...items,
      createBlankProjectSceneItem(projectId, items.length + 1)
    ]);
  }

  const deleteItem = useCallback((item: ProjectSceneItem) => {
    if (!canEdit) return;
    const hasContent = [
      item.sceneNo,
      item.mainLocation,
      item.subLocation,
      item.dayLabel,
      item.dayNight,
      item.interiorExterior,
      item.sceneContent,
      item.characters,
      item.props
    ].some(Boolean);
    if (hasContent && !window.confirm(`${item.sceneNo || "이"} 씬 행을 삭제할까요?`)) return;
    commitItems(items.filter((currentItem) => currentItem.id !== item.id));
  }, [canEdit, commitItems, items]);

  async function save() {
    if (!canEdit || !projectId) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const saved = await saveProjectSceneList(projectId, { items, scenarioReference });
      setItems(saved.items);
      setScenarioReference(saved.scenarioReference);
      setIsDirty(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "씬리스트를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  if (!project) {
    return (
      <div className="rounded-2xl border border-field-danger bg-white p-6 text-center">
        <p className="font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</p>
        <Link
          href="/"
          className="mt-4 inline-flex min-h-10 items-center rounded-full border border-field-border px-4 text-sm font-bold text-field-primary"
        >
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1480px] pb-20">
      <section className="overflow-hidden rounded-xl border border-field-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-field-border bg-field-soft px-3 py-2">
          <h1 className="font-display min-w-0 truncate text-lg font-black text-field-primary">
            {project.name} 씬리스트
          </h1>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border bg-white px-3 text-xs font-bold text-field-primary transition hover:border-field-primary active:scale-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              프로젝트
            </Link>
            {canEdit ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={isSaving || !isDirty}
                className="inline-flex min-h-9 items-center gap-1 rounded-full bg-field-primary px-3 text-xs font-black text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSaving
                  ? <PixelDogLoader size="xs" compact />
                  : <Save className="h-3.5 w-3.5" aria-hidden />}
                저장
              </button>
            ) : null}
          </div>
        </div>

        {errorMessage ? (
          <p className="border-b border-field-danger bg-red-50 px-3 py-2 text-xs font-bold text-field-danger">
            {errorMessage}
          </p>
        ) : null}

        <div className="scene-list-portrait-notice min-h-52 items-center justify-center px-6 text-center text-sm font-bold leading-6 text-field-primary">
          씬리스트는 가로 화면에 최적화되어 있습니다. 화면을 돌려서 확인해주세요.
        </div>

        <div
          ref={sceneGridRef}
          role="grid"
          aria-label={`${project.name} 씬리스트`}
          className="scene-list-landscape min-w-0 select-none [&_input]:select-text [&_textarea]:select-text"
          style={{
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none"
          } as CSSProperties}
        >
          <div
            role="row"
            className="grid border-b border-[#bfc5bf] bg-[#e9eee9] text-center text-[11px] font-black leading-4 text-field-primary"
            style={{ gridTemplateColumns }}
          >
            {["씬", "대장소", "세부장소", "Day", "D/N", "I/E", "씬 내용"].map((label) => (
              <div role="columnheader" key={label} className="min-w-0 border-r border-[#bfc5bf] px-1 py-1.5 last:border-r-0">
                {label}
              </div>
            ))}
            {actorRoles.map((role) => (
              <div
                key={role}
                title={role}
                role="columnheader"
                className="min-w-0 truncate border-r border-[#bfc5bf] px-0.5 py-1.5"
              >
                {role}
              </div>
            ))}
            <div role="columnheader" className="min-w-0 border-r border-[#bfc5bf] px-1 py-1.5">주요 소품</div>
            <div role="columnheader" aria-label="행 작업" />
          </div>

          <SceneReorderList
            items={items}
            disabled={!canEdit}
            onReorder={commitItems}
            renderRow={(item, index) => (
              <SceneTableRow
                item={item}
                index={index}
                canEdit={canEdit}
                actorRoles={actorRoles}
                gridTemplateColumns={gridTemplateColumns}
                allItems={items}
                selectedRange={selectedRange}
                onCellSelect={selectCell}
                onCellPointerDown={startCellDrag}
                onUpdate={updateItem}
                onDelete={deleteItem}
              />
            )}
          />

          {canEdit ? (
            <div className="border-t border-field-border bg-field-soft/40 p-2">
              <button
                type="button"
                onClick={addItem}
                className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border bg-white px-3 text-xs font-bold text-field-primary transition hover:border-field-primary active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                씬 추가
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {(canEdit || scenarioReference) ? (
        <details className="mt-3 overflow-hidden rounded-xl border border-field-border bg-white">
          <summary className="cursor-pointer px-3 py-2 text-sm font-black text-field-primary">
            시나리오 참고
          </summary>
          <div className="border-t border-field-border p-3">
            {canEdit ? (
              <textarea
                value={scenarioReference}
                onChange={(event) => {
                  setScenarioReference(event.target.value);
                  setIsDirty(true);
                }}
                rows={7}
                aria-label="시나리오 참고"
                className="w-full resize-y rounded-lg border border-field-border bg-white px-3 py-2 text-sm font-medium leading-6 text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-light"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-field-text">
                {scenarioReference}
              </p>
            )}
          </div>
        </details>
      ) : null}
    </main>
  );
}

const SceneTableRow = memo(function SceneTableRow({
  item,
  index,
  canEdit,
  actorRoles,
  gridTemplateColumns,
  allItems,
  selectedRange,
  onCellSelect,
  onCellPointerDown,
  onUpdate,
  onDelete
}: {
  item: ProjectSceneItem;
  index: number;
  canEdit: boolean;
  actorRoles: string[];
  gridTemplateColumns: string;
  allItems: ProjectSceneItem[];
  selectedRange: SceneCellRange | null;
  onCellSelect: (rowId: string, column: SceneCellColumn, rowIndex: number) => void;
  onCellPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    rowId: string,
    column: SceneCellColumn,
    rowIndex: number,
    value: string
  ) => void;
  onUpdate: (id: string, patch: Partial<ProjectSceneItem>) => void;
  onDelete: (item: ProjectSceneItem) => void;
}) {
  const locationStyle = getLocationStyle(item.mainLocation);
  const selectedCharacters = useMemo(
    () => parseCharacters(item.characters),
    [item.characters]
  );
  const getCellInteraction = (column: SceneCellColumn): SceneCellInteraction => {
    const mergeRange = getVisualMergeRange(allItems, index, column);
    const rangeStart = selectedRange ? Math.min(selectedRange.startIndex, selectedRange.endIndex) : -1;
    const rangeEnd = selectedRange ? Math.max(selectedRange.startIndex, selectedRange.endIndex) : -1;
    const isInRange = selectedRange?.column === column && index >= rangeStart && index <= rangeEnd;
    const selectionRange = isInRange && selectedRange
      ? { ...selectedRange, startIndex: rangeStart, endIndex: rangeEnd }
      : { column, startIndex: index, endIndex: index };
    return {
      rowId: item.id,
      rowIndex: index,
      column,
      canEdit,
      canDrag: canEdit && isFillColumn(column),
      isInRange,
      selectionPosition: getMergePosition(index, selectionRange),
      mergeRange,
      mergePosition: getMergePosition(index, mergeRange),
      onSelect: onCellSelect,
      onPointerDown: onCellPointerDown
    };
  };
  const sceneNoInteraction = getCellInteraction("sceneNo");
  const mainLocationInteraction = getCellInteraction("mainLocation");
  const concealMainLocation = isVisuallyMerged(mainLocationInteraction);
  const dayNightInteraction = getCellInteraction("dayNight");
  const concealDayNight = isVisuallyMerged(dayNightInteraction);
  const interiorExteriorInteraction = getCellInteraction("interiorExterior");
  const concealInteriorExterior = isVisuallyMerged(interiorExteriorInteraction);
  const sceneContentInteraction = getCellInteraction("sceneContent");

  function toggleCharacter(role: string) {
    const normalizedRole = role.trim();
    const exists = selectedCharacters.some(
      (character) => character.toLocaleLowerCase() === normalizedRole.toLocaleLowerCase()
    );
    const next = exists
      ? selectedCharacters.filter(
          (character) => character.toLocaleLowerCase() !== normalizedRole.toLocaleLowerCase()
        )
      : [...selectedCharacters, normalizedRole];
    onUpdate(item.id, { characters: next.join(", ") });
  }

  return (
    <div
      role="row"
      className="grid h-9 bg-white text-[12px]"
      style={{ gridTemplateColumns }}
    >
      <SceneCell
        value={item.sceneNo}
        ariaLabel={`${index + 1}행 씬`}
        canEdit={canEdit}
        interaction={sceneNoInteraction}
        onChange={(sceneNo) => onUpdate(item.id, { sceneNo })}
      />

      <SceneCellFrame
        interaction={mainLocationInteraction}
        value={item.mainLocation}
        style={{ backgroundColor: locationStyle.background, color: locationStyle.color }}
      >
        {canEdit ? (
          <input
            value={item.mainLocation}
            onChange={(event) => onUpdate(item.id, { mainLocation: event.target.value })}
            onFocus={() => onCellSelect(item.id, "mainLocation", index)}
            aria-label={`${item.sceneNo || index + 1} 씬 대장소`}
            className={`${inputClassName} font-bold ${
              concealMainLocation ? "text-transparent" : ""
            }`}
            style={{ color: concealMainLocation ? "transparent" : locationStyle.color }}
          />
        ) : (
          <span
            className="block truncate px-1.5 py-2 text-center font-bold"
            style={{ color: locationStyle.color }}
            title={item.mainLocation}
          >
            {concealMainLocation ? "" : item.mainLocation}
          </span>
        )}
      </SceneCellFrame>

      <SceneCell
        value={item.subLocation}
        ariaLabel={`${item.sceneNo || index + 1} 씬 세부장소`}
        canEdit={canEdit}
        interaction={getCellInteraction("subLocation")}
        onChange={(subLocation) => onUpdate(item.id, { subLocation })}
      />
      <SceneCell
        value={item.dayLabel}
        ariaLabel={`${item.sceneNo || index + 1} 씬 Day`}
        canEdit={canEdit}
        interaction={getCellInteraction("dayLabel")}
        onChange={(dayLabel) => onUpdate(item.id, { dayLabel })}
      />

      <SceneCellFrame interaction={dayNightInteraction} value={item.dayNight}>
        {canEdit ? (
          <select
            value={item.dayNight}
            onChange={(event) => onUpdate(item.id, { dayNight: event.target.value })}
            onFocus={() => onCellSelect(item.id, "dayNight", index)}
            aria-label={`${item.sceneNo || index + 1} 씬 D/N`}
            className={`${selectClassName} ${concealDayNight ? "text-transparent" : ""}`}
          >
            <option value="" />
            <option value="D">D</option>
            <option value="N">N</option>
          </select>
        ) : (
          <span className="block px-1 py-2 text-center font-bold">
            {concealDayNight ? "" : item.dayNight}
          </span>
        )}
      </SceneCellFrame>

      <SceneCellFrame interaction={interiorExteriorInteraction} value={item.interiorExterior}>
        {canEdit ? (
          <select
            value={item.interiorExterior}
            onChange={(event) => onUpdate(item.id, { interiorExterior: event.target.value })}
            onFocus={() => onCellSelect(item.id, "interiorExterior", index)}
            aria-label={`${item.sceneNo || index + 1} 씬 I/E`}
            className={`${selectClassName} ${concealInteriorExterior ? "text-transparent" : ""}`}
          >
            <option value="" />
            <option value="I">I</option>
            <option value="E">E</option>
          </select>
        ) : (
          <span className="block px-1 py-2 text-center font-bold">
            {concealInteriorExterior ? "" : item.interiorExterior}
          </span>
        )}
      </SceneCellFrame>

      <SceneCellFrame interaction={sceneContentInteraction} value={item.sceneContent}>
        {canEdit ? (
          <input
            value={item.sceneContent}
            onChange={(event) => onUpdate(item.id, { sceneContent: event.target.value })}
            onFocus={() => onCellSelect(item.id, "sceneContent", index)}
            aria-label={`${item.sceneNo || index + 1} 씬 내용`}
            className={`${inputClassName} text-left`}
          />
        ) : (
          <p className="truncate px-1.5 py-2 text-left font-medium" title={item.sceneContent}>
            {item.sceneContent}
          </p>
        )}
      </SceneCellFrame>

      {actorRoles.map((role) => {
        const selected = selectedCharacters.some(
          (character) => character.toLocaleLowerCase() === role.toLocaleLowerCase()
        );
        const actorInteraction = getCellInteraction(`actor:${role}`);
        return (
          <SceneCellFrame
            key={role}
            interaction={actorInteraction}
            value={selected ? "O" : ""}
            className="grid place-items-center"
          >
            {canEdit ? (
              <button
                type="button"
                onClick={() => toggleCharacter(role)}
                aria-label={`${item.sceneNo || index + 1} 씬 ${role} ${selected ? "제외" : "포함"}`}
                aria-pressed={selected}
                className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-black transition active:scale-90 ${
                  selected
                    ? "bg-field-primary text-white"
                    : "text-transparent hover:bg-field-soft"
                }`}
              >
                O
              </button>
            ) : (
              <span className="font-black text-field-primary">{selected ? "O" : ""}</span>
            )}
          </SceneCellFrame>
        );
      })}

      <SceneCell
        value={item.props}
        ariaLabel={`${item.sceneNo || index + 1} 씬 주요 소품`}
        canEdit={canEdit}
        interaction={getCellInteraction("props")}
        textAlign="left"
        onChange={(props) => onUpdate(item.id, { props })}
      />

      <div
        role="gridcell"
        data-scene-row-handle={canEdit ? "" : undefined}
        title={canEdit ? "셀 바깥의 이 영역을 드래그해 행 순서 변경" : undefined}
        className={`grid place-items-center border-b border-[#cbd0cb] ${
          canEdit ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        {canEdit ? (
          <button
            type="button"
            onClick={() => onDelete(item)}
            aria-label={`${item.sceneNo || index + 1} 씬 삭제`}
            className="grid h-6 w-6 place-items-center rounded-full text-field-danger transition hover:bg-red-50 active:scale-90"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
});

type SceneCellInteraction = {
  rowId: string;
  rowIndex: number;
  column: SceneCellColumn;
  canEdit: boolean;
  canDrag: boolean;
  isInRange: boolean;
  selectionPosition: MergePosition;
  mergeRange: SceneCellRange;
  mergePosition: MergePosition;
  onSelect: (rowId: string, column: SceneCellColumn, rowIndex: number) => void;
  onPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    rowId: string,
    column: SceneCellColumn,
    rowIndex: number,
    value: string
  ) => void;
};

function SceneCell({
  value,
  ariaLabel,
  canEdit,
  interaction,
  textAlign = "center",
  onChange
}: {
  value: string;
  ariaLabel: string;
  canEdit: boolean;
  interaction?: SceneCellInteraction;
  textAlign?: "left" | "center";
  onChange: (value: string) => void;
}) {
  const concealRepeatedValue = Boolean(
    interaction &&
    isVisuallyMerged(interaction)
  );

  return (
    <SceneCellFrame interaction={interaction} value={value}>
      {canEdit ? (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => {
            if (interaction) {
              interaction.onSelect(interaction.rowId, interaction.column, interaction.rowIndex);
            }
          }}
          aria-label={ariaLabel}
          className={`${inputClassName} ${textAlign === "left" ? "text-left" : ""} ${
            concealRepeatedValue ? "text-transparent" : ""
          }`}
        />
      ) : (
        <span
          className={`block truncate px-1.5 py-2 font-medium ${
            textAlign === "left" ? "text-left" : "text-center"
          }`}
          title={value}
        >
          {concealRepeatedValue ? "" : value}
        </span>
      )}
    </SceneCellFrame>
  );
}

function SceneCellFrame({
  interaction,
  value,
  className = "",
  style,
  children
}: {
  interaction?: SceneCellInteraction;
  value: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const mergesWithNext = interaction?.mergePosition === "start" || interaction?.mergePosition === "middle";
  const mergeSpan = interaction
    ? Math.abs(interaction.mergeRange.endIndex - interaction.mergeRange.startIndex) + 1
    : 1;
  const showsMergedValue = Boolean(
    interaction?.mergePosition === "start" &&
    mergeSpan > 1 &&
    value.trim()
  );
  return (
    <div
      role="gridcell"
      tabIndex={-1}
      data-scene-row-id={interaction?.rowId}
      data-scene-cell-column={interaction?.column}
      aria-selected={interaction?.isInRange || undefined}
      onPointerDown={interaction
        ? (event) => {
            event.stopPropagation();
            interaction.onSelect(interaction.rowId, interaction.column, interaction.rowIndex);
            if (!isInteractiveTarget(event.target)) {
              event.currentTarget.focus({ preventScroll: true });
            }
            if (interaction.canDrag) {
              interaction.onPointerDown(
                event,
                interaction.rowId,
                interaction.column,
                interaction.rowIndex,
                value
              );
            }
          }
        : undefined}
      className={`relative min-w-0 border-r border-[#cbd0cb] ${
        mergesWithNext ? "border-b border-b-transparent" : "border-b border-b-[#cbd0cb]"
      } ${interaction ? "cursor-cell outline-none" : ""} ${
        interaction?.isInRange ? "z-10" : ""
      } ${
        interaction?.mergePosition === "start" ? "z-[5]" : ""
      } ${className}`}
      style={{
        ...style,
        touchAction: interaction?.canDrag ? "none" : style?.touchAction,
        boxShadow: interaction?.isInRange
          ? getSelectionBoxShadow(interaction.selectionPosition)
          : style?.boxShadow
      }}
    >
      {children}
      {showsMergedValue ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-center truncate px-1 text-center font-bold"
          style={{
            height: `calc(${mergeSpan} * 2.25rem)`,
            color: style?.color
          }}
        >
          {value}
        </span>
      ) : null}
    </div>
  );
}

function isVisuallyMerged(interaction: Pick<SceneCellInteraction, "mergeRange">) {
  return interaction.mergeRange.startIndex !== interaction.mergeRange.endIndex;
}

function getMergePosition(rowIndex: number, range: SceneCellRange): MergePosition {
  if (range.startIndex === range.endIndex) return "single";
  if (rowIndex === range.startIndex) return "start";
  if (rowIndex === range.endIndex) return "end";
  return "middle";
}

function getSelectionBoxShadow(position: MergePosition) {
  const left = "inset 2px 0 0 #0f3d2e";
  const right = "inset -2px 0 0 #0f3d2e";
  const top = "inset 0 2px 0 #0f3d2e";
  const bottom = "inset 0 -2px 0 #0f3d2e";
  if (position === "start") return `${left}, ${right}, ${top}`;
  if (position === "middle") return `${left}, ${right}`;
  if (position === "end") return `${left}, ${right}, ${bottom}`;
  return "inset 0 0 0 2px #0f3d2e";
}

function getVisualMergeRange(
  items: ProjectSceneItem[],
  rowIndex: number,
  column: SceneCellColumn
): SceneCellRange {
  const single = { column, startIndex: rowIndex, endIndex: rowIndex };
  if (!isVisualMergeColumn(column)) return single;
  const value = getSceneCellValue(items[rowIndex], column).trim();
  if (!value) return single;

  let startIndex = rowIndex;
  let endIndex = rowIndex;
  while (
    startIndex > 0 &&
    getSceneCellValue(items[startIndex - 1], column).trim() === value
  ) {
    startIndex -= 1;
  }
  while (
    endIndex < items.length - 1 &&
    getSceneCellValue(items[endIndex + 1], column).trim() === value
  ) {
    endIndex += 1;
  }
  return { column, startIndex, endIndex };
}

function getDraggedRange(drag: CellDragState, targetIndex: number) {
  if (targetIndex < drag.initialStartIndex) {
    return { startIndex: targetIndex, endIndex: drag.initialEndIndex };
  }
  if (targetIndex > drag.initialEndIndex) {
    return { startIndex: drag.initialStartIndex, endIndex: targetIndex };
  }
  if (drag.initialStartIndex === drag.initialEndIndex) {
    return { startIndex: drag.originIndex, endIndex: targetIndex };
  }
  const midpoint = (drag.initialStartIndex + drag.initialEndIndex) / 2;
  return drag.originIndex <= midpoint
    ? { startIndex: drag.initialStartIndex, endIndex: targetIndex }
    : { startIndex: targetIndex, endIndex: drag.initialEndIndex };
}

function isVisualMergeColumn(column: SceneCellColumn): column is SceneFillColumn {
  return [
    "mainLocation",
    "subLocation",
    "dayLabel",
    "dayNight",
    "interiorExterior"
  ].includes(column);
}

function isFillColumn(column: SceneCellColumn): column is SceneFillColumn {
  return [
    "mainLocation",
    "subLocation",
    "dayLabel",
    "dayNight",
    "interiorExterior",
    "props"
  ].includes(column);
}

function isActorColumn(column: SceneCellColumn): column is SceneActorColumn {
  return column.startsWith("actor:");
}

function getSceneCellValue(item: ProjectSceneItem | undefined, column: SceneCellColumn) {
  if (!item) return "";
  if (!isActorColumn(column)) return item[column];
  const role = column.slice("actor:".length);
  const selected = parseCharacters(item.characters).some(
    (character) => character.toLocaleLowerCase() === role.toLocaleLowerCase()
  );
  return selected ? "O" : "";
}

function setSceneCellValue(
  item: ProjectSceneItem,
  column: SceneCellColumn,
  rawValue: string
): ProjectSceneItem {
  if (isActorColumn(column)) {
    const role = column.slice("actor:".length).trim();
    if (!role) return item;
    const selectedCharacters = parseCharacters(item.characters);
    const hasRole = selectedCharacters.some(
      (character) => character.toLocaleLowerCase() === role.toLocaleLowerCase()
    );
    const shouldSelect = /^(o|1|true)$/i.test(rawValue.trim());
    const nextCharacters = shouldSelect
      ? (hasRole ? selectedCharacters : [...selectedCharacters, role])
      : selectedCharacters.filter(
          (character) => character.toLocaleLowerCase() !== role.toLocaleLowerCase()
        );
    return { ...item, characters: nextCharacters.join(", ") };
  }

  let value = rawValue.replace(/\r?\n/g, " ");
  if (column === "dayNight") {
    const normalized = value.trim().toUpperCase();
    value = normalized === "D" || normalized === "N" ? normalized : "";
  } else if (column === "interiorExterior") {
    const normalized = value.trim().toUpperCase();
    value = normalized === "I" || normalized === "E" ? normalized : "";
  }
  return { ...item, [column]: value };
}

function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable);
}

function hasEditableTextSelection(target: EventTarget | null) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return (
      target.selectionStart !== null &&
      target.selectionEnd !== null &&
      target.selectionStart !== target.selectionEnd
    );
  }
  return target instanceof HTMLElement && target.isContentEditable && !window.getSelection()?.isCollapsed;
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(
    target.closest("input, textarea, select, button, a, [role='button']")
  );
}

function parseCharacters(value: string) {
  return Array.from(new Set(
    value
      .split(/[,，/|\n]+/)
      .map((character) => character.trim())
      .filter(Boolean)
  ));
}

const locationPalette = [
  { background: "#f6ebbd", color: "#4d4109" },
  { background: "#d8ead8", color: "#184520" },
  { background: "#f5dac9", color: "#5b2b18" },
  { background: "#d8ebee", color: "#17434a" },
  { background: "#e3ddef", color: "#36264e" },
  { background: "#f0dce4", color: "#552438" },
  { background: "#e2ebc9", color: "#374a13" }
];

function getLocationStyle(location: string) {
  const normalized = location.trim();
  if (!normalized) return { background: "#fff", color: "#1c1c1a" };
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return locationPalette[Math.abs(hash) % locationPalette.length];
}

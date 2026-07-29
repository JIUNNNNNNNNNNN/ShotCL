"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Save } from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { SceneReorderList } from "@/components/SceneReorderList";
import {
  createBlankProjectSceneItem,
  getProjectSceneList,
  saveProjectSceneList
} from "@/lib/data/sceneList";
import { getProject } from "@/lib/data/projects";
import { auditQuery } from "@/lib/queryAudit";
import {
  MAX_SCENE_CUT_COUNT,
  validateSceneCutCountInput
} from "@/lib/sceneCutCount";
import type {
  Project,
  ProjectSceneActorCell,
  ProjectSceneItem
} from "@/lib/types";

const inputClassName =
  "h-full min-h-8 w-full min-w-0 select-text border-0 bg-transparent px-1.5 py-1 text-center text-[12px] font-semibold leading-5 text-field-text outline-none [-webkit-touch-callout:default] focus:bg-field-light focus:ring-1 focus:ring-inset focus:ring-field-primary";
const selectClassName = `${inputClassName} appearance-none`;

type SceneValueColumn =
  | "sceneNo"
  | "mainLocation"
  | "subLocation"
  | "dayLabel"
  | "dayNight"
  | "interiorExterior"
  | "sceneContent"
  | "cutCount"
  | "props";

type SceneActorColumn = `actor:${string}`;
type SceneCellColumn = SceneValueColumn | SceneActorColumn;
type SceneFillColumn =
  Exclude<SceneValueColumn, "sceneNo" | "sceneContent">;
type SceneVisualMergeColumn = SceneFillColumn | SceneActorColumn;
type ActorCellState =
  | { mode: "empty"; text: "" }
  | { mode: "color"; text: "" }
  | { mode: "text"; text: string };

const ACTOR_COLOR_CELL_VALUE = "__actor_color__";
const ACTOR_TEXT_CELL_PREFIX = "__actor_text__:";

type SelectedSceneCell = {
  rowId: string;
  column: SceneCellColumn;
};

type SceneCellRange = {
  column: SceneCellColumn;
  startIndex: number;
  endIndex: number;
};

type VisualSceneCell = {
  representative: SceneCellColumn;
  logicalColumns: SceneCellColumn[];
};

type CellDragMode = "pending" | "vertical-fill" | "horizontal-location";

type CellDragState = SceneCellRange & {
  initialStartIndex: number;
  initialEndIndex: number;
  originIndex: number;
  pointerId: number;
  startX: number;
  startY: number;
  sourceValue: string;
  didDrag: boolean;
  mode: CellDragMode;
  horizontalTargetReached: boolean;
};

type MergePosition = "single" | "start" | "middle" | "end";

type PaletteStyle = {
  background: string;
  color: string;
};

type ActorPaletteStyle = PaletteStyle & {
  headerBackground: string;
};

type DeletePopoverState = {
  itemId: string;
  label: string;
  left: number;
  top: number;
};

type HeaderHelpPopoverState = {
  description: string;
  left: number;
  top: number;
};

type ActorCellTextPopoverState = {
  rowId: string;
  role: string;
  left: number;
  top: number;
  readOnly: boolean;
};

type HeaderLongPressHandler = (
  event: ReactPointerEvent<HTMLElement>,
  description: string
) => void;

function isMobileSceneListInteraction(
  event?: Pick<ReactPointerEvent<HTMLElement>, "pointerType">
) {
  if (event?.pointerType === "touch") return true;
  return typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px) and (orientation: portrait)").matches;
}

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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [cutInputErrors, setCutInputErrors] = useState<Record<string, string>>({});
  const [selectedCell, setSelectedCell] = useState<SelectedSceneCell | null>(null);
  const [selectedRange, setSelectedRange] = useState<SceneCellRange | null>(null);
  const [editingCell, setEditingCell] = useState<SelectedSceneCell | null>(null);
  const [deletePopover, setDeletePopover] = useState<DeletePopoverState | null>(null);
  const [headerHelpPopover, setHeaderHelpPopover] = useState<HeaderHelpPopoverState | null>(null);
  const [actorCellTextPopover, setActorCellTextPopover] =
    useState<ActorCellTextPopoverState | null>(null);
  const itemsRef = useRef(items);
  const selectedCellRef = useRef(selectedCell);
  const selectedRangeRef = useRef(selectedRange);
  const sceneGridRef = useRef<HTMLDivElement | null>(null);
  const copiedValueRef = useRef("");
  const cellDragRef = useRef<CellDragState | null>(null);
  const cellDragCleanupRef = useRef<(() => void) | null>(null);
  const sceneLongPressCleanupRef = useRef<(() => void) | null>(null);
  const headerLongPressCleanupRef = useRef<(() => void) | null>(null);
  const actorCellLongPressCleanupRef = useRef<(() => void) | null>(null);
  const suppressActorCellClickRef = useRef<string | null>(null);
  const deletePopoverRef = useRef<HTMLDivElement | null>(null);
  const headerHelpPopoverRef = useRef<HTMLDivElement | null>(null);
  const actorCellTextPopoverRef = useRef<HTMLDivElement | null>(null);
  useUnsavedChangesGuard(isDirty);

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
      setProject(projectData);
      setItems(sceneList.items);
      setScenarioReference(sceneList.scenarioReference);
      setActorRoles(sceneList.actorRoles);
      setIsDirty(false);
      setErrorMessage("");
      setSelectedCell(null);
      setSelectedRange(null);
      setEditingCell(null);
      setCutInputErrors({});
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
    const nextRange = getActiveVisualRange(items, rowIndex, activeCell.column);
    selectedRangeRef.current = nextRange;
    setSelectedRange(nextRange);
  }, [items]);

  useEffect(() => {
    selectedCellRef.current = selectedCell;
    selectedRangeRef.current = selectedRange;
  }, [selectedCell, selectedRange]);

  useEffect(() => {
    const mobileQuery = window.matchMedia(
      "(max-width: 767px) and (orientation: portrait)"
    );
    const clearDesktopInteractions = () => {
      if (!mobileQuery.matches) return;
      cellDragCleanupRef.current?.();
      sceneLongPressCleanupRef.current?.();
      headerLongPressCleanupRef.current?.();
      actorCellLongPressCleanupRef.current?.();
      selectedCellRef.current = null;
      selectedRangeRef.current = null;
      setSelectedCell(null);
      setSelectedRange(null);
      setEditingCell(null);
      setDeletePopover(null);
      setHeaderHelpPopover(null);
      setActorCellTextPopover(null);
    };
    clearDesktopInteractions();
    mobileQuery.addEventListener("change", clearDesktopInteractions);
    return () => mobileQuery.removeEventListener("change", clearDesktopInteractions);
  }, []);

  useEffect(() => () => {
    cellDragCleanupRef.current?.();
    sceneLongPressCleanupRef.current?.();
    headerLongPressCleanupRef.current?.();
    actorCellLongPressCleanupRef.current?.();
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
  }, []);

  useEffect(() => {
    if (!deletePopover) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && deletePopoverRef.current?.contains(event.target)) return;
      setDeletePopover(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [deletePopover]);

  useEffect(() => {
    if (!headerHelpPopover && !actorCellTextPopover) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        (
          headerHelpPopoverRef.current?.contains(event.target) ||
          actorCellTextPopoverRef.current?.contains(event.target)
        )
      ) {
        return;
      }
      setHeaderHelpPopover(null);
      setActorCellTextPopover(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [actorCellTextPopover, headerHelpPopover]);

  const cellColumns = useMemo<SceneCellColumn[]>(
    () => [
      "sceneNo",
      "mainLocation",
      "subLocation",
      "dayLabel",
      "dayNight",
      "interiorExterior",
      "sceneContent",
      ...actorRoles.map((role): SceneActorColumn => `actor:${role}`),
      "cutCount",
      "props"
    ],
    [actorRoles]
  );

  const compactLocationLayout = useMemo(() => {
    const locationRows = items.filter((item) => (
      item.mainLocation.trim() || item.subLocation.trim()
    ));
    if (locationRows.length === 0) return false;
    const mergedRows = locationRows.filter(isSameHorizontalLocation);
    return mergedRows.length / locationRows.length >= 0.7;
  }, [items]);

  const gridTemplateColumns = useMemo(
    () => [
      "minmax(0,.5fr)",
      compactLocationLayout ? "minmax(0,.54fr)" : "minmax(0,.75fr)",
      compactLocationLayout ? "minmax(0,.54fr)" : "minmax(0,.9fr)",
      "minmax(0,.48fr)",
      "minmax(0,.36fr)",
      "minmax(0,.36fr)",
      compactLocationLayout ? "minmax(0,3.37fr)" : "minmax(0,2.8fr)",
      ...actorRoles.map(() => "minmax(0,.42fr)"),
      "minmax(3.75rem,.5fr)",
      "minmax(0,1.05fr)"
    ].join(" "),
    [actorRoles, compactLocationLayout]
  );

  const locationStyles = useMemo(() => {
    const locations = Array.from(new Set(
      items
        .map((item) => item.mainLocation.trim())
        .filter(Boolean)
    )).sort((first, second) => first.localeCompare(second, "ko"));
    const usedPaletteIndexes = new Set<number>();
    return new Map(locations.map((location) => {
      let paletteIndex = getLocationPaletteIndex(location);
      let attempts = 0;
      while (
        usedPaletteIndexes.has(paletteIndex) &&
        attempts < locationPalette.length
      ) {
        paletteIndex = (paletteIndex + 1) % locationPalette.length;
        attempts += 1;
      }
      usedPaletteIndexes.add(paletteIndex);
      return [
        location.toLocaleLowerCase(),
        locationPalette[paletteIndex] ?? neutralPaletteStyle
      ];
    }));
  }, [items]);

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

  const updateCutInputError = useCallback((id: string, message: string) => {
    setCutInputErrors((current) => {
      if (!message && !(id in current)) return current;
      const next = { ...current };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }, []);

  const selectCell = useCallback((
    rowId: string,
    column: SceneCellColumn,
    rowIndex: number
  ) => {
    const nextCell = { rowId, column };
    const nextRange = getActiveVisualRange(itemsRef.current, rowIndex, column);
    selectedCellRef.current = nextCell;
    selectedRangeRef.current = nextRange;
    setSelectedCell(nextCell);
    setSelectedRange(nextRange);
  }, []);

  const startEditingCell = useCallback((rowId: string, column: SceneCellColumn) => {
    if (isActorColumn(column)) return;
    setEditingCell({ rowId, column });
  }, []);

  const stopEditingCell = useCallback((rowId: string, column: SceneCellColumn) => {
    setEditingCell((current) => (
      current?.rowId === rowId && current.column === column ? null : current
    ));
  }, []);

  const findCellElement = useCallback((rowId: string, column: SceneCellColumn) => {
    const cells = sceneGridRef.current?.querySelectorAll<HTMLElement>(
      "[data-scene-row-id][data-scene-cell-column]"
    );
    return Array.from(cells ?? []).find((cell) => (
      cell.dataset.sceneRowId === rowId &&
      cell.dataset.sceneCellColumn === column
    )) ?? null;
  }, []);

  useEffect(() => {
    if (!editingCell || !canEdit) return;
    if (isActorColumn(editingCell.column)) {
      setEditingCell(null);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const editor = findCellElement(editingCell.rowId, editingCell.column)
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          "input, textarea, select"
        );
      if (!editor) return;
      editor.focus({ preventScroll: true });
      if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
        const caretPosition = editor.value.length;
        editor.setSelectionRange(caretPosition, caretPosition);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canEdit, editingCell, findCellElement]);

  const focusCell = useCallback((
    rowIndex: number,
    requestedColumn: SceneCellColumn
  ) => {
    if (itemsRef.current.length === 0) return;
    const safeRowIndex = Math.max(0, Math.min(rowIndex, itemsRef.current.length - 1));
    const item = itemsRef.current[safeRowIndex];
    const column = getVisualRepresentative(item, requestedColumn);
    selectCell(item.id, column, safeRowIndex);
    window.requestAnimationFrame(() => {
      const cell = findCellElement(item.id, column);
      if (!cell) return;
      cell.focus({ preventScroll: true });
      cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [findCellElement, selectCell]);

  const handleGridKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const activeCell = selectedCellRef.current;
    if (!activeCell) return;

    const activeRowIndex = itemsRef.current.findIndex((item) => item.id === activeCell.rowId);
    if (activeRowIndex < 0 || !cellColumns.includes(activeCell.column)) return;

    const target = event.target;
    const isEditingActiveCell = editingCell?.rowId === activeCell.rowId
      && editingCell.column === activeCell.column;
    if (isEditingActiveCell) {
      if (event.key === "Enter") {
        if (
          (target instanceof HTMLTextAreaElement ||
            (target instanceof HTMLElement && target.isContentEditable)) &&
          (event.metaKey || event.altKey || event.shiftKey)
        ) {
          return;
        }
        event.preventDefault();
        setEditingCell(null);
        if (target instanceof HTMLElement) target.blur();
        window.requestAnimationFrame(() => {
          findCellElement(activeCell.rowId, activeCell.column)?.focus({ preventScroll: true });
        });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setEditingCell(null);
        (target as HTMLElement).blur();
        findCellElement(activeCell.rowId, activeCell.column)?.focus({ preventScroll: true });
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && ["c", "v", "x"].includes(event.key.toLowerCase())) {
      return;
    }
    if (
      isActorColumn(activeCell.column) &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      if (canEdit) {
        findCellElement(activeCell.rowId, activeCell.column)
          ?.querySelector<HTMLButtonElement>("button")
          ?.click();
      }
      return;
    }
    if (target instanceof HTMLButtonElement && (event.key === "Enter" || event.key === " ")) {
      return;
    }

    const activeRange = selectedRangeRef.current;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusCell(
        (activeRange?.startIndex ?? activeRowIndex) - 1,
        activeCell.column
      );
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusCell(
        (activeRange?.endIndex ?? activeRowIndex) + 1,
        activeCell.column
      );
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const nextColumn = getAdjacentVisualColumn(
        itemsRef.current[activeRowIndex],
        cellColumns,
        activeCell.column,
        -1
      );
      focusCell(
        activeRowIndex,
        nextColumn
      );
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const nextColumn = getAdjacentVisualColumn(
        itemsRef.current[activeRowIndex],
        cellColumns,
        activeCell.column,
        1
      );
      focusCell(
        activeRowIndex,
        nextColumn
      );
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const nextCell = getAdjacentVisualCell(
        itemsRef.current,
        cellColumns,
        activeRowIndex,
        activeCell.column,
        event.shiftKey ? -1 : 1
      );
      focusCell(
        nextCell.rowIndex,
        nextCell.column
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (canEdit) {
        const cell = findCellElement(activeCell.rowId, activeCell.column);
        const editor = cell?.querySelector("input, textarea, select");
        if (editor) {
          setEditingCell(activeCell);
        } else {
          cell?.querySelector<HTMLButtonElement>("button")?.click();
        }
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      selectedCellRef.current = null;
      selectedRangeRef.current = null;
      setSelectedCell(null);
      setSelectedRange(null);
      (event.currentTarget.ownerDocument.activeElement as HTMLElement | null)?.blur();
    }
  }, [canEdit, cellColumns, editingCell, findCellElement, focusCell]);

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
      index >= lower && index <= upper
        ? setVisualSceneCellValue(item, column, value)
        : item
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
    if (
      !canEdit ||
      event.button !== 0 ||
      !isFillColumn(column) ||
      isMobileSceneListInteraction(event)
    ) return;
    if (
      (event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement) &&
      document.activeElement === event.target
    ) {
      return;
    }
    event.stopPropagation();
    cellDragCleanupRef.current?.();
    selectCell(rowId, column, rowIndex);
    const initialRange = getActiveVisualRange(itemsRef.current, rowIndex, column);

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
      didDrag: false,
      mode: "pending",
      horizontalTargetReached: false
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

    const findTargetCell = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      const cell = element?.closest("[data-scene-cell-column]") as HTMLElement | null;
      if (!cell) return null;
      const targetRowId = cell.dataset.sceneRowId;
      const targetColumn = cell.dataset.sceneCellColumn as SceneCellColumn | undefined;
      if (!targetRowId || !targetColumn) return null;
      const targetIndex = itemsRef.current.findIndex((item) => item.id === targetRowId);
      return targetIndex >= 0 ? { targetColumn, targetIndex, targetRowId } : null;
    };

    const reachesOtherLocationCell = (clientX: number, clientY: number) => {
      if (!isLocationColumn(column)) return false;
      const target = findTargetCell(clientX, clientY);
      return Boolean(
        target &&
        target.targetRowId === rowId &&
        isLocationColumn(target.targetColumn) &&
        target.targetColumn !== column
      );
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const current = cellDragRef.current;
      if (!current || moveEvent.pointerId !== current.pointerId) return;
      const horizontalDistance = Math.abs(moveEvent.clientX - current.startX);
      const verticalDistance = Math.abs(moveEvent.clientY - current.startY);
      const target = findTargetCell(moveEvent.clientX, moveEvent.clientY);
      if (!current.didDrag) {
        if (
          isLocationColumn(column) &&
          horizontalDistance >= 8 &&
          horizontalDistance > verticalDistance * 1.2 &&
          reachesOtherLocationCell(moveEvent.clientX, moveEvent.clientY)
        ) {
          current.mode = "horizontal-location";
          current.horizontalTargetReached = true;
        } else if (
          verticalDistance >= 8 &&
          verticalDistance > horizontalDistance * 1.2 &&
          target?.targetColumn === column &&
          target.targetIndex !== current.originIndex
        ) {
          current.mode = "vertical-fill";
        } else {
          return;
        }
        current.didDrag = true;
        window.getSelection()?.removeAllRanges();
        document.body.style.userSelect = "none";
        document.body.style.cursor = current.mode === "horizontal-location"
          ? "col-resize"
          : "cell";
      }
      moveEvent.preventDefault();
      if (current.mode === "horizontal-location") {
        current.horizontalTargetReached = reachesOtherLocationCell(
          moveEvent.clientX,
          moveEvent.clientY
        );
        return;
      }
      if (target?.targetColumn !== column) return;
      const nextRange = getDraggedRange(current, target.targetIndex);
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
        if (current.mode === "horizontal-location") {
          if (!current.horizontalTargetReached) return;
          setItems((currentItems) => currentItems.map((item) => (
            item.id === rowId
              ? {
                  ...item,
                  mainLocation: current.sourceValue,
                  subLocation: current.sourceValue
                }
              : item
          )));
          setEditingCell(null);
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          const nextCell: SelectedSceneCell = { rowId, column: "mainLocation" };
          const nextRange: SceneCellRange = {
            column: "mainLocation",
            startIndex: current.originIndex,
            endIndex: current.originIndex
          };
          selectedCellRef.current = nextCell;
          selectedRangeRef.current = nextRange;
          setSelectedCell(nextCell);
          setSelectedRange(nextRange);
          setIsDirty(true);
          setErrorMessage("");
          return;
        }
        const nextLower = Math.min(current.startIndex, current.endIndex);
        const nextUpper = Math.max(current.startIndex, current.endIndex);
        const initialLower = Math.min(current.initialStartIndex, current.initialEndIndex);
        const initialUpper = Math.max(current.initialStartIndex, current.initialEndIndex);
        setItems((items) => items.map((item, index) => {
          if (index >= nextLower && index <= nextUpper) {
            return setVisualSceneCellValue(item, current.column, current.sourceValue);
          }
          if (
            initialLower !== initialUpper &&
            index >= initialLower &&
            index <= initialUpper &&
            (index < nextLower || index > nextUpper)
          ) {
            return setVisualSceneCellValue(item, current.column, "");
          }
          return item;
        }));
        setIsDirty(true);
        setErrorMessage("");
      }
    };

    const handleEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== drag.pointerId) return;
      const current = cellDragRef.current;
      if (current?.mode === "horizontal-location") {
        current.horizontalTargetReached = reachesOtherLocationCell(
          endEvent.clientX,
          endEvent.clientY
        );
      }
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

  const startSceneDeleteLongPress = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    item: ProjectSceneItem
  ) => {
    if (!canEdit || event.button !== 0 || isMobileSceneListInteraction(event)) return;
    event.stopPropagation();
    sceneLongPressCleanupRef.current?.();
    setDeletePopover(null);

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const pressedElement = event.target instanceof HTMLElement ? event.target : null;
    let didOpen = false;
    let timer: number | null = null;

    const cleanup = () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      sceneLongPressCleanupRef.current = null;
      document.body.style.removeProperty("user-select");
    };

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || didOpen) return;
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 8) {
        cleanup();
      }
    };

    const handleEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      cleanup();
    };

    timer = window.setTimeout(() => {
      didOpen = true;
      window.getSelection()?.removeAllRanges();
      pressedElement?.blur();
      document.body.style.userSelect = "none";
      const popoverWidth = 96;
      const left = Math.min(
        window.innerWidth - popoverWidth - 8,
        Math.max(8, startX - popoverWidth / 2)
      );
      const preferredTop = startY + 14;
      const top = preferredTop + 48 < window.innerHeight
        ? preferredTop
        : Math.max(8, startY - 52);
      setDeletePopover({
        itemId: item.id,
        label: item.sceneNo || "이 씬",
        left,
        top
      });
    }, 550);

    sceneLongPressCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
  }, [canEdit]);

  const startHeaderHelpLongPress = useCallback<HeaderLongPressHandler>((event, description) => {
    headerLongPressCleanupRef.current?.();
    setHeaderHelpPopover(null);
    headerLongPressCleanupRef.current = beginHeaderHelpLongPress(
      event,
      ({ x, y }) => {
        const width = 150;
        setHeaderHelpPopover({
          description,
          left: clampPopoverLeft(x, width),
          top: getPopoverTop(y, 44)
        });
      },
      () => setHeaderHelpPopover(null)
    );
  }, []);

  const startActorCellTextLongPress = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    item: ProjectSceneItem,
    role: string,
    readOnly: boolean
  ) => {
    actorCellLongPressCleanupRef.current?.();
    setActorCellTextPopover(null);
    actorCellLongPressCleanupRef.current = beginLongPress(event, ({ x, y }) => {
      const cellKey = getActorCellKey(item.id, role);
      suppressActorCellClickRef.current = cellKey;
      const currentState = getActorCellState(item, role);
      if (!readOnly) {
        const nextItem = setActorCellState(item, role, {
          mode: "text",
          text: currentState.mode === "text" ? currentState.text : ""
        });
        updateItem(item.id, {
          characters: nextItem.characters,
          actorCells: nextItem.actorCells
        });
      }
      const width = 280;
      setActorCellTextPopover({
        rowId: item.id,
        role,
        left: clampPopoverLeft(x, width),
        top: getPopoverTop(y, 132),
        readOnly
      });
    });
  }, [updateItem]);

  const consumeActorCellClickSuppression = useCallback((rowId: string, role: string) => {
    const cellKey = getActorCellKey(rowId, role);
    if (suppressActorCellClickRef.current !== cellKey) return false;
    suppressActorCellClickRef.current = null;
    return true;
  }, []);

  function addItem() {
    if (!canEdit || !projectId) return;
    commitItems([
      ...items,
      createBlankProjectSceneItem(projectId, items.length + 1)
    ]);
  }

  const deleteItem = useCallback((item: ProjectSceneItem) => {
    if (!canEdit) return;
    updateCutInputError(item.id, "");
    commitItems(items.filter((currentItem) => currentItem.id !== item.id));
  }, [canEdit, commitItems, items, updateCutInputError]);

  async function save() {
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
      const saved = await saveProjectSceneList(projectId, { items, scenarioReference });
      setItems(saved.items);
      setScenarioReference(saved.scenarioReference);
      setIsDirty(false);
      setCutInputErrors({});
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
          className="mt-4 inline-flex min-h-10 items-center rounded-[3px] border border-field-border px-4 text-sm font-bold text-field-primary"
        >
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1480px] pb-20">
      <section className="overflow-clip rounded-xl border border-field-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-field-border bg-field-soft px-3 py-2">
          <h1 className="font-display min-w-0 truncate text-lg font-black text-field-primary">
            {project.name} 씬리스트
          </h1>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex min-h-9 items-center gap-1 rounded-[3px] border border-field-border bg-white px-3 text-xs font-bold text-field-primary transition hover:border-field-primary active:scale-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              프로젝트
            </Link>
            {canEdit ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={isSaving || !isDirty}
                className="scene-list-edit-action inline-flex min-h-9 items-center gap-1 rounded-[3px] bg-field-primary px-3 text-xs font-black text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
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

        <MobileSceneList
          items={items}
          actorRoles={actorRoles}
          locationStyles={locationStyles}
          canEdit={canEdit}
          onHeaderLongPress={startHeaderHelpLongPress}
          onUpdate={updateItem}
          onCutValidationChange={updateCutInputError}
        />

        <div
          ref={sceneGridRef}
          role="grid"
          aria-label={`${project.name} 씬리스트`}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDownCapture={handleGridKeyDown}
          className="scene-list-landscape min-w-0 select-none [&_input]:select-text [&_textarea]:select-text"
          style={{
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none"
          } as CSSProperties}
        >
          <div
            role="row"
            className="sticky top-0 z-[60] grid border-b border-[#aeb6ae] bg-[#e9eee9] text-center text-[11px] font-black leading-4 text-field-primary shadow-[0_1px_0_rgba(15,61,46,0.08)] print:static print:shadow-none"
            style={{ gridTemplateColumns }}
          >
            <SceneHeaderCell
              label="Scene"
              description="씬"
              className="border-r border-[#bfc5bf]"
              onLongPress={startHeaderHelpLongPress}
            />
            <SceneHeaderCell
              label="Location"
              description="대장소"
              className="border-r border-[#bfc5bf]"
              onLongPress={startHeaderHelpLongPress}
            />
            <SceneHeaderCell
              label="Sub-Location"
              description="세부장소"
              className="border-r border-[#bfc5bf]"
              onLongPress={startHeaderHelpLongPress}
            />
            <SceneHeaderCell
              label="Day"
              className="border-r border-[#bfc5bf]"
              onLongPress={startHeaderHelpLongPress}
            />
            {([
              ["Time", "D/N"],
              ["Int/Ext", "I/E"],
              ["Content", "씬 내용"]
            ] as const).map(([label, description]) => (
              <SceneHeaderCell
                key={label}
                label={label}
                description={description}
                className="border-r border-[#bfc5bf]"
                onLongPress={startHeaderHelpLongPress}
              />
            ))}
            {actorRoles.map((role, actorIndex) => {
              const actorStyle = getActorStyle(actorIndex);
              return (
                <SceneHeaderCell
                  key={role}
                  label={role}
                  title={role}
                  ariaLabel={`Characters: ${role}`}
                  description="등장인물"
                  className="border-r border-[#bfc5bf] px-0.5"
                  style={{
                    backgroundColor: actorStyle.headerBackground,
                    color: actorStyle.color
                  }}
                  onLongPress={startHeaderHelpLongPress}
                />
              );
            })}
            <SceneHeaderCell
              label="Cut"
              description="총 컷수"
              helpId="scene-list-cut-help-landscape"
              className="border-r border-[#bfc5bf]"
              onLongPress={startHeaderHelpLongPress}
            />
            <SceneHeaderCell
              label="Memo"
              description="소품&특이사항"
              onLongPress={startHeaderHelpLongPress}
            />
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
                locationStyle={getMappedLocationStyle(item.mainLocation, locationStyles)}
                editingCell={editingCell}
                selectedRange={selectedRange}
                onCellSelect={selectCell}
                onCellPointerDown={startCellDrag}
                onCellEditStart={startEditingCell}
                onCellEditEnd={stopEditingCell}
                onSceneLongPress={startSceneDeleteLongPress}
                onHeaderLongPress={startHeaderHelpLongPress}
                onActorCellTextLongPress={startActorCellTextLongPress}
                onConsumeActorCellClickSuppression={consumeActorCellClickSuppression}
                onUpdate={updateItem}
                onCutValidationChange={updateCutInputError}
              />
            )}
          />

          {canEdit ? (
            <div className="border-t border-field-border bg-field-soft/40 p-2">
              <button
                type="button"
                onClick={addItem}
                className="inline-flex min-h-9 items-center gap-1 rounded-[3px] border border-field-border bg-white px-3 text-xs font-bold text-field-primary transition hover:border-field-primary active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                씬 추가
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {canEdit && deletePopover ? (
        <div
          ref={deletePopoverRef}
          role="dialog"
          aria-label={`${deletePopover.label} 삭제 메뉴`}
          className="fixed z-[80] min-w-24 overflow-hidden rounded-xl border border-red-200 bg-white p-1 shadow-[0_8px_24px_rgba(75,20,20,0.18)]"
          style={{ left: deletePopover.left, top: deletePopover.top }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex min-h-9 w-full items-center justify-center rounded-lg px-3 text-xs font-black text-field-danger transition hover:bg-red-50 active:scale-[0.97]"
            onClick={() => {
              const item = items.find((candidate) => candidate.id === deletePopover.itemId);
              setDeletePopover(null);
              if (item) deleteItem(item);
            }}
          >
            삭제
          </button>
        </div>
      ) : null}

      {headerHelpPopover ? (
        <div
          ref={headerHelpPopoverRef}
          role="tooltip"
          className="fixed z-[90] flex min-h-9 w-[150px] items-center justify-center rounded-xl border border-field-border bg-white px-3 py-2 text-center text-xs font-bold text-field-primary shadow-[0_8px_22px_rgba(15,61,46,0.14)] print:hidden"
          style={{ left: headerHelpPopover.left, top: headerHelpPopover.top }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {headerHelpPopover.description}
        </div>
      ) : null}

      {actorCellTextPopover ? (
        <ActorCellTextPopover
          ref={actorCellTextPopoverRef}
          item={items.find((item) => item.id === actorCellTextPopover.rowId)}
          role={actorCellTextPopover.role}
          canEdit={canEdit && !actorCellTextPopover.readOnly}
          left={actorCellTextPopover.left}
          top={actorCellTextPopover.top}
          onChange={(text) => {
            const item = items.find((candidate) => candidate.id === actorCellTextPopover.rowId);
            if (!item) return;
            const nextItem = setActorCellState(
              item,
              actorCellTextPopover.role,
              text
                ? { mode: "text", text }
                : { mode: "empty", text: "" }
            );
            updateItem(actorCellTextPopover.rowId, {
              characters: nextItem.characters,
              actorCells: nextItem.actorCells
            });
          }}
        />
      ) : null}

      {(canEdit || scenarioReference) ? (
        <details className="scene-list-landscape mt-3 overflow-hidden rounded-xl border border-field-border bg-white">
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
                onKeyDown={(event) => handleMultilineEnterShortcut(
                  event,
                  scenarioReference,
                  (nextValue) => {
                    setScenarioReference(nextValue);
                    setIsDirty(true);
                  }
                )}
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

      {scenarioReference ? (
        <details className="scene-list-mobile mt-3 overflow-hidden rounded-xl border border-field-border bg-white">
          <summary className="cursor-pointer px-3 py-2 text-sm font-black text-field-primary">
            시나리오 참고
          </summary>
          <p className="whitespace-pre-wrap border-t border-field-border p-3 text-sm font-medium leading-6 text-field-text">
            {scenarioReference}
          </p>
        </details>
      ) : null}
    </main>
  );
}

const mobileSceneGridTemplate = ".42fr .78fr .42fr .56fr 1.28fr .96fr .5fr .98fr";

function MobileSceneList({
  items,
  actorRoles,
  locationStyles,
  canEdit,
  onHeaderLongPress,
  onUpdate,
  onCutValidationChange
}: {
  items: ProjectSceneItem[];
  actorRoles: string[];
  locationStyles: Map<string, PaletteStyle>;
  canEdit: boolean;
  onHeaderLongPress: HeaderLongPressHandler;
  onUpdate: (id: string, patch: Partial<ProjectSceneItem>) => void;
  onCutValidationChange: (id: string, message: string) => void;
}) {
  return (
    <div
      className="scene-list-mobile min-w-0 touch-pan-y select-none"
      aria-label="모바일 씬리스트"
      draggable={false}
      style={{
        touchAction: "pan-y",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none"
      }}
    >
      <div className="sticky top-0 z-[60] grid border-l border-t border-[#bfc5bf] bg-[#e9eee9] text-center text-[9px] font-black leading-[1.25] text-field-primary shadow-[0_1px_0_rgba(15,61,46,0.08)] print:static print:shadow-none"
        style={{ gridTemplateColumns: mobileSceneGridTemplate }}
      >
        <MobileSceneHeader entries={[["#S", "씬"]]} />
        <MobileSceneHeader
          entries={[
            ["Location", "대장소"],
            ["Sub-Location", "세부장소"]
          ]}
        />
        <MobileSceneHeader entries={[["Day"]]} />
        <MobileSceneHeader
          entries={[
            ["Time", "D/N"],
            ["Int/Ext", "I/E"]
          ]}
        />
        <MobileSceneHeader entries={[["Content", "씬 내용"]]} />
        <MobileSceneHeader entries={[["Characters", "등장인물"]]} />
        <MobileSceneHeader
          entries={[["Cut", "총 컷수"]]}
          helpId="scene-list-cut-help-mobile"
          onLongPress={onHeaderLongPress}
        />
        <MobileSceneHeader entries={[["Memo", "소품&특이사항"]]} />
      </div>

      {items.length > 0 ? items.map((item, index) => (
        <MobileSceneRow
          key={item.id}
          item={item}
          index={index}
          actorRoles={actorRoles}
          locationStyle={getMappedLocationStyle(item.mainLocation, locationStyles)}
          canEdit={canEdit}
          onUpdate={onUpdate}
          onCutValidationChange={onCutValidationChange}
        />
      )) : (
        <p className="border-x border-b border-[#bfc5bf] px-3 py-8 text-center text-xs font-semibold text-field-muted">
          등록된 씬이 없습니다.
        </p>
      )}
    </div>
  );
}

function MobileSceneRow({
  item,
  index,
  actorRoles,
  locationStyle,
  canEdit,
  onUpdate,
  onCutValidationChange
}: {
  item: ProjectSceneItem;
  index: number;
  actorRoles: string[];
  locationStyle: PaletteStyle;
  canEdit: boolean;
  onUpdate: (id: string, patch: Partial<ProjectSceneItem>) => void;
  onCutValidationChange: (id: string, message: string) => void;
}) {
  const actorCells = actorRoles
    .map((role, actorIndex) => ({
      role,
      actorIndex,
      state: getActorCellState(item, role)
    }))
    .filter(({ state }) => state.mode !== "empty");
  const mergedLocation = isSameHorizontalLocation(item);
  return (
    <div
      role="row"
      className="grid min-w-0 touch-pan-y select-none border-l text-[9px] font-semibold leading-[1.35] text-field-text"
      draggable={false}
      style={{
        gridTemplateColumns: mobileSceneGridTemplate,
        gridTemplateRows: "minmax(2rem, auto) minmax(2rem, auto)",
        touchAction: "pan-y",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none"
      }}
    >
      <MobileSceneCell className="row-span-2" align="center">
        {item.sceneNo || index + 1}
      </MobileSceneCell>
      <MobileSceneCell
        className={mergedLocation ? "row-span-2" : ""}
        align="center"
        style={{ backgroundColor: locationStyle.background, color: locationStyle.color }}
      >
        {item.mainLocation}
      </MobileSceneCell>
      <MobileSceneCell className="row-span-2" align="center">
        {item.dayLabel}
      </MobileSceneCell>
      <MobileSceneCell align="center">{item.dayNight}</MobileSceneCell>
      <MobileSceneCell className="row-span-2" align="left">
        {item.sceneContent}
      </MobileSceneCell>
      <MobileSceneCell
        className="row-span-2"
        align="left"
      >
        <span className="flex w-full min-w-0 max-w-full flex-col items-start gap-0.5 overflow-hidden">
          <span className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-0.5">
          {actorCells.map(({ role, actorIndex, state }) => {
            const actorStyle = getActorStyle(actorIndex);
            const isColored = state.mode === "color";
            return (
              <span
                key={role}
                className={`max-w-full px-0.5 py-px font-bold [overflow-wrap:anywhere] ${
                  isColored ? "rounded" : ""
                }`}
                style={isColored
                  ? { backgroundColor: actorStyle.background, color: actorStyle.color }
                  : { color: "#2d332f" }}
              >
                {state.mode === "text" ? `${role}: ${state.text}` : role}
              </span>
            );
          })}
          </span>
          {item.characterNotes ? (
            <span
              data-scene-character-note-row-id={item.id}
              className="block max-h-10 w-full min-w-0 max-w-full overflow-y-auto whitespace-pre-wrap text-[8px] font-medium leading-3 text-field-muted [overflow-wrap:anywhere]"
            >
              {item.characterNotes}
            </span>
          ) : null}
        </span>
      </MobileSceneCell>
      <MobileSceneCell className="row-span-2 !overflow-visible !p-0" align="center">
        <SceneCutInput
          item={item}
          canEdit={canEdit}
          compact
          onChange={(cutCount) => onUpdate(item.id, { cutCount })}
          onValidationChange={(message) => onCutValidationChange(item.id, message)}
        />
      </MobileSceneCell>
      <MobileSceneCell className="row-span-2" align="left">
        {item.props}
      </MobileSceneCell>
      {!mergedLocation ? (
        <MobileSceneCell
          align="center"
          style={{ backgroundColor: locationStyle.background, color: locationStyle.color }}
        >
          {item.subLocation}
        </MobileSceneCell>
      ) : null}
      <MobileSceneCell align="center">{item.interiorExterior}</MobileSceneCell>
    </div>
  );
}

function MobileSceneHeader({
  entries,
  helpId,
  onLongPress
}: {
  entries: ReadonlyArray<readonly [label: string, description?: string]>;
  helpId?: string;
  onLongPress?: HeaderLongPressHandler;
}) {
  return (
    <div
      role="columnheader"
      className="flex min-w-0 flex-col items-stretch justify-center border-b border-r border-[#bfc5bf] text-center [overflow-wrap:anywhere]"
    >
      {entries.map(([label, description]) => {
        const isSubLocation = label === "Sub-Location";
        const isHelpTrigger = label === "Cut" && Boolean(description && helpId && onLongPress);
        const labelContent = isSubLocation ? (
          <span
            aria-hidden
            className="flex flex-col items-center justify-center text-[8px] leading-[0.85]"
          >
            <span>Sub-</span>
            <span>Location</span>
          </span>
        ) : label;
        const entryClassName = `flex min-h-5 flex-1 touch-pan-y select-none flex-col items-center justify-center py-0.5 text-center ${
          label === "Int/Ext" || label === "#S"
            ? "whitespace-nowrap px-0 text-[8px] tracking-[-0.03em]"
            : isSubLocation
              ? "overflow-hidden px-0"
              : "px-0.5"
        }`;

        return isHelpTrigger ? (
          <button
            key={label}
            type="button"
            className={`${entryClassName} w-full cursor-default bg-transparent font-black text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d7b95f]`}
            aria-label={label}
            aria-describedby={helpId}
            onPointerDown={(event) => onLongPress?.(event, description ?? "")}
          >
            {labelContent}
            <span id={helpId} className="sr-only">{description}</span>
          </button>
        ) : (
          <span
            key={label}
            aria-label={isSubLocation ? label : undefined}
            className={entryClassName}
            draggable={false}
          >
            {labelContent}
          </span>
        );
      })}
    </div>
  );
}

function MobileSceneCell({
  children,
  className = "",
  align = "left",
  style
}: {
  children: ReactNode;
  className?: string;
  align?: "left" | "center";
  style?: CSSProperties;
}) {
  return (
    <div
      role="gridcell"
      className={`flex min-w-0 touch-pan-y select-none items-center overflow-hidden border-b border-r border-[#cbd0cb] px-0.5 py-1 [overflow-wrap:anywhere] ${
        align === "center" ? "justify-center text-center" : "justify-start whitespace-pre-wrap text-left"
      } ${className}`}
      draggable={false}
      style={{
        ...style,
        maxWidth: "100%",
        boxSizing: "border-box",
        touchAction: "pan-y",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none"
      }}
    >
      {children}
    </div>
  );
}

function SceneHeaderCell({
  label,
  description,
  className = "",
  style,
  title,
  ariaLabel,
  onLongPress,
  helpId
}: {
  label: string;
  description?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  ariaLabel?: string;
  onLongPress: HeaderLongPressHandler;
  helpId?: string;
}) {
  const isSubLocation = label === "Sub-Location";
  const labelContent = isSubLocation ? (
    <span
      aria-hidden
      className="flex flex-col items-center justify-center text-[10px] leading-[0.9]"
    >
      <span>Sub-</span>
      <span>Location</span>
    </span>
  ) : (
    <span className="block leading-4">{label}</span>
  );

  return (
    <div
      role="columnheader"
      title={title}
      aria-label={ariaLabel ?? label}
      className={`flex min-w-0 touch-pan-y select-none flex-col items-center justify-center overflow-hidden py-1 text-center ${
        isSubLocation ? "px-0.5" : "px-1"
      } ${className}`}
      style={style}
      onPointerDown={!helpId && description
        ? (event) => onLongPress(event, description)
        : undefined}
    >
      {helpId && description ? (
        <button
          type="button"
          className="flex h-full min-h-6 w-full cursor-default touch-pan-y items-center justify-center bg-transparent font-black text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d7b95f]"
          aria-label={label}
          aria-describedby={helpId}
          onPointerDown={(event) => onLongPress(event, description)}
        >
          {labelContent}
          <span id={helpId} className="sr-only">{description}</span>
        </button>
      ) : labelContent}
    </div>
  );
}

const ActorCellTextPopover = forwardRef<HTMLDivElement, {
  item: ProjectSceneItem | undefined;
  role: string;
  canEdit: boolean;
  left: number;
  top: number;
  onChange: (value: string) => void;
}>(function ActorCellTextPopover({
  item,
  role,
  canEdit,
  left,
  top,
  onChange
}, ref) {
  if (!item) return null;
  const cellState = getActorCellState(item, role);
  const text = cellState.mode === "text" ? cellState.text : "";
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${item.sceneNo || "현재"} Scene ${role} 메모`}
      className="fixed z-[90] w-[min(280px,calc(100vw-16px))] overflow-hidden rounded-xl border border-field-border bg-white shadow-[0_10px_28px_rgba(15,61,46,0.16)]"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p className="border-b border-field-border bg-field-soft px-3 py-2 text-xs font-black text-field-primary">
        {role} · Scene {item.sceneNo || "—"}
      </p>
      {canEdit ? (
        <input
          autoFocus
          value={text}
          onChange={(event) => onChange(event.target.value)}
          maxLength={120}
          aria-label={`${role} 배우칸 메모`}
          placeholder="V.O. / 실루엣 / 대역"
          className="block min-h-11 w-full bg-white px-3 py-2 text-sm font-medium leading-5 text-field-text outline-none placeholder:text-field-muted"
        />
      ) : (
        <p className="min-h-11 px-3 py-2 text-sm font-medium leading-5 text-field-text [overflow-wrap:anywhere]">
          {text || "등록된 메모가 없습니다."}
        </p>
      )}
    </div>
  );
});

const SceneTableRow = memo(function SceneTableRow({
  item,
  index,
  canEdit,
  actorRoles,
  gridTemplateColumns,
  allItems,
  locationStyle,
  editingCell,
  selectedRange,
  onCellSelect,
  onCellPointerDown,
  onCellEditStart,
  onCellEditEnd,
  onSceneLongPress,
  onHeaderLongPress,
  onActorCellTextLongPress,
  onConsumeActorCellClickSuppression,
  onUpdate,
  onCutValidationChange,
}: {
  item: ProjectSceneItem;
  index: number;
  canEdit: boolean;
  actorRoles: string[];
  gridTemplateColumns: string;
  allItems: ProjectSceneItem[];
  locationStyle: PaletteStyle;
  editingCell: SelectedSceneCell | null;
  selectedRange: SceneCellRange | null;
  onCellSelect: (rowId: string, column: SceneCellColumn, rowIndex: number) => void;
  onCellPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    rowId: string,
    column: SceneCellColumn,
    rowIndex: number,
    value: string
  ) => void;
  onCellEditStart: (rowId: string, column: SceneCellColumn) => void;
  onCellEditEnd: (rowId: string, column: SceneCellColumn) => void;
  onSceneLongPress: (
    event: ReactPointerEvent<HTMLDivElement>,
    item: ProjectSceneItem
  ) => void;
  onHeaderLongPress: HeaderLongPressHandler;
  onActorCellTextLongPress: (
    event: ReactPointerEvent<HTMLElement>,
    item: ProjectSceneItem,
    role: string,
    readOnly: boolean
  ) => void;
  onConsumeActorCellClickSuppression: (itemId: string, role: string) => boolean;
  onUpdate: (id: string, patch: Partial<ProjectSceneItem>) => void;
  onCutValidationChange: (id: string, message: string) => void;
}) {
  const getCellInteraction = (
    column: SceneCellColumn,
    mergeRangeOverride?: SceneCellRange
  ): SceneCellInteraction => {
    const mergeRange = mergeRangeOverride
      ?? getVisualMergeRange(allItems, index, column, editingCell);
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
      isEditing: editingCell?.rowId === item.id && editingCell.column === column,
      canDrag: canEdit && isFillColumn(column),
      isInRange,
      selectionPosition: getMergePosition(index, selectionRange),
      mergeRange,
      mergePosition: getMergePosition(index, mergeRange),
      mergeEndRowId: allItems[mergeRange.endIndex]?.id ?? item.id,
      onSelect: onCellSelect,
      onPointerDown: onCellPointerDown,
      onEditStart: onCellEditStart,
      onEditEnd: onCellEditEnd,
      onLongPress: canEdit && column === "sceneNo"
        ? (event: ReactPointerEvent<HTMLDivElement>) => onSceneLongPress(event, item)
        : undefined
    };
  };
  const sceneNoInteraction = getCellInteraction("sceneNo");
  const horizontallyMergedLocation = (
    isSameHorizontalLocation(item) &&
    !isEditingLocationCell(item, editingCell)
  );
  const horizontalLocationRange = horizontallyMergedLocation
    ? getHorizontalLocationMergeRange(allItems, index, editingCell)
    : undefined;
  const mainLocationInteraction = {
    ...getCellInteraction("mainLocation", horizontalLocationRange),
    onLongPress: (event: ReactPointerEvent<HTMLDivElement>) => onHeaderLongPress(
      event,
      horizontallyMergedLocation ? "장소" : "대장소"
    )
  };
  const subLocationInteraction = {
    ...getCellInteraction("subLocation"),
    onLongPress: (event: ReactPointerEvent<HTMLDivElement>) => onHeaderLongPress(
      event,
      "세부장소"
    )
  };
  const concealMainLocation = isVisuallyMerged(mainLocationInteraction);
  const dayNightInteraction = getCellInteraction("dayNight");
  const concealDayNight = isVisuallyMerged(dayNightInteraction);
  const interiorExteriorInteraction = getCellInteraction("interiorExterior");
  const concealInteriorExterior = isVisuallyMerged(interiorExteriorInteraction);
  const sceneContentInteraction = getCellInteraction("sceneContent");
  const cutCountInteraction = getCellInteraction("cutCount");
  const propsInteraction = getCellInteraction("props");

  function toggleActorColor(role: string) {
    const currentState = getActorCellState(item, role);
    if (currentState.mode === "text") return;
    const nextItem = setActorCellState(
      item,
      role,
      currentState.mode === "color"
        ? { mode: "empty", text: "" }
        : { mode: "color", text: "" }
    );
    onUpdate(item.id, {
      characters: nextItem.characters,
      actorCells: nextItem.actorCells
    });
  }

  return (
    <div
      role="row"
      data-scene-row-handle={canEdit ? "" : undefined}
      className="grid min-h-9 bg-white text-[12px]"
      style={{ gridTemplateColumns }}
    >
      <SceneCell
        value={item.sceneNo}
        ariaLabel={`${index + 1} row Scene`}
        canEdit={canEdit}
        interaction={sceneNoInteraction}
        onChange={(sceneNo) => onUpdate(item.id, { sceneNo })}
      />

      {horizontallyMergedLocation ? (
        <SceneCellFrame
          interaction={mainLocationInteraction}
          value={item.mainLocation}
          className="col-span-2"
          style={{ backgroundColor: locationStyle.background, color: locationStyle.color }}
        >
          {canEdit ? (
            <input
              value={item.mainLocation}
              onChange={(event) => onUpdate(item.id, {
                mainLocation: event.target.value,
                subLocation: event.target.value
              })}
              onFocus={() => {
                onCellSelect(item.id, "mainLocation", index);
                onCellEditStart(item.id, "mainLocation");
              }}
              onBlur={() => onCellEditEnd(item.id, "mainLocation")}
              aria-label={`${item.sceneNo || index + 1} Scene Location`}
              className={`${inputClassName} font-bold ${
                concealMainLocation ? "text-transparent" : ""
              }`}
              style={{ color: concealMainLocation ? "transparent" : locationStyle.color }}
            />
          ) : (
            <span
              className="flex h-full min-h-9 items-center justify-center px-1.5 py-2 text-center font-bold"
              style={{ color: locationStyle.color }}
              title={item.mainLocation}
            >
              {concealMainLocation ? "" : item.mainLocation}
            </span>
          )}
        </SceneCellFrame>
      ) : (
        <>
          <SceneCellFrame
            interaction={mainLocationInteraction}
            value={item.mainLocation}
            style={{ backgroundColor: locationStyle.background, color: locationStyle.color }}
          >
            {canEdit ? (
              <input
                value={item.mainLocation}
                onChange={(event) => onUpdate(item.id, { mainLocation: event.target.value })}
                onFocus={() => {
                  onCellSelect(item.id, "mainLocation", index);
                  onCellEditStart(item.id, "mainLocation");
                }}
                onBlur={() => onCellEditEnd(item.id, "mainLocation")}
                aria-label={`${item.sceneNo || index + 1} Scene Location`}
                className={`${inputClassName} font-bold ${
                  concealMainLocation ? "text-transparent" : ""
                }`}
                style={{ color: concealMainLocation ? "transparent" : locationStyle.color }}
              />
            ) : (
              <span
                className="flex h-full min-h-9 items-center justify-center px-1.5 py-2 text-center font-bold"
                style={{ color: locationStyle.color }}
                title={item.mainLocation}
              >
                {concealMainLocation ? "" : item.mainLocation}
              </span>
            )}
          </SceneCellFrame>

          <SceneCell
            value={item.subLocation}
            ariaLabel={`${item.sceneNo || index + 1} Scene Sub-Location`}
            canEdit={canEdit}
            interaction={subLocationInteraction}
            onChange={(subLocation) => onUpdate(item.id, { subLocation })}
          />
        </>
      )}
      <SceneCell
        value={item.dayLabel}
        ariaLabel={`${item.sceneNo || index + 1} Scene Day`}
        canEdit={canEdit}
        interaction={getCellInteraction("dayLabel")}
        onChange={(dayLabel) => onUpdate(item.id, { dayLabel })}
      />

      <SceneCellFrame interaction={dayNightInteraction} value={item.dayNight}>
        {canEdit ? (
          <select
            value={item.dayNight}
            onChange={(event) => onUpdate(item.id, { dayNight: event.target.value })}
            onFocus={() => {
              onCellSelect(item.id, "dayNight", index);
              onCellEditStart(item.id, "dayNight");
            }}
            onBlur={() => onCellEditEnd(item.id, "dayNight")}
            aria-label={`${item.sceneNo || index + 1} Scene Time`}
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
            onFocus={() => {
              onCellSelect(item.id, "interiorExterior", index);
              onCellEditStart(item.id, "interiorExterior");
            }}
            onBlur={() => onCellEditEnd(item.id, "interiorExterior")}
            aria-label={`${item.sceneNo || index + 1} Scene Int/Ext`}
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
          <AutoGrowSceneTextarea
            value={item.sceneContent}
            onChange={(sceneContent) => onUpdate(item.id, { sceneContent })}
            onFocus={() => {
              onCellSelect(item.id, "sceneContent", index);
              onCellEditStart(item.id, "sceneContent");
            }}
            onBlur={() => onCellEditEnd(item.id, "sceneContent")}
            aria-label={`${item.sceneNo || index + 1} Scene Content`}
          />
        ) : (
          <p className="whitespace-pre-wrap px-1.5 py-2 text-left font-medium leading-5 [overflow-wrap:anywhere]">
            {item.sceneContent}
          </p>
        )}
      </SceneCellFrame>

      {actorRoles.length > 0 ? (
        <div
          data-scene-characters-row-id={item.id}
          className="grid min-w-0 max-w-full content-start overflow-hidden"
          style={{
            gridColumn: `span ${actorRoles.length}`,
            gridTemplateColumns: `repeat(${actorRoles.length}, minmax(0, 1fr))`,
            gridTemplateRows: item.characterNotes
              ? "minmax(2.25rem, 1fr) auto"
              : "minmax(2.25rem, 1fr)"
          }}
        >
          {actorRoles.map((role, actorIndex) => {
            const state = getActorCellState(item, role);
            const column: SceneActorColumn = `actor:${role}`;
            const mergeRange = getVisualMergeRange(allItems, index, column);
            const mergePosition = getMergePosition(index, mergeRange);
            const selectionStart = selectedRange
              ? Math.min(selectedRange.startIndex, selectedRange.endIndex)
              : -1;
            const selectionEnd = selectedRange
              ? Math.max(selectedRange.startIndex, selectedRange.endIndex)
              : -1;
            const isInRange = selectedRange?.column === column &&
              index >= selectionStart &&
              index <= selectionEnd;
            const selectionPosition = isInRange
              ? getMergePosition(index, {
                  column,
                  startIndex: selectionStart,
                  endIndex: selectionEnd
                })
              : "single";
            const actorStyle = getActorStyle(actorIndex);
            return (
              <ActorSceneCell
                key={role}
                rowId={item.id}
                rowIndex={index}
                column={column}
                role={role}
                sceneLabel={item.sceneNo || String(index + 1)}
                state={state}
                canEdit={canEdit}
                actorStyle={actorStyle}
                mergePosition={mergePosition}
                isInRange={isInRange}
                selectionPosition={selectionPosition}
                onSelect={onCellSelect}
                onToggle={() => {
                  if (onConsumeActorCellClickSuppression(item.id, role)) return;
                  toggleActorColor(role);
                }}
                onLongPress={(event) => onActorCellTextLongPress(event, item, role, !canEdit)}
              />
            );
          })}

          {item.characterNotes ? (
            <div
              data-scene-character-note-row-id={item.id}
              aria-label={`Characters 세부 메모: ${item.characterNotes}`}
              className="col-span-full max-h-10 min-w-0 max-w-full overflow-y-auto whitespace-pre-wrap border-b border-r border-t border-[#cbd0cb] bg-white/95 px-1 py-0.5 text-[8px] font-semibold leading-3 text-field-muted [overflow-wrap:anywhere]"
            >
              {item.characterNotes}
            </div>
          ) : null}
        </div>
      ) : null}

      <SceneCellFrame interaction={cutCountInteraction} value={getSceneCellValue(item, "cutCount")}>
        <SceneCutInput
          item={item}
          canEdit={canEdit}
          onFocus={() => {
            onCellSelect(item.id, "cutCount", index);
            onCellEditStart(item.id, "cutCount");
          }}
          onBlur={() => onCellEditEnd(item.id, "cutCount")}
          onChange={(cutCount) => onUpdate(item.id, { cutCount })}
          onValidationChange={(message) => onCutValidationChange(item.id, message)}
        />
      </SceneCellFrame>

      <SceneCellFrame interaction={propsInteraction} value={item.props}>
        {canEdit ? (
          <AutoGrowSceneTextarea
            value={item.props}
            onChange={(props) => onUpdate(item.id, { props })}
            onFocus={() => {
              onCellSelect(item.id, "props", index);
              onCellEditStart(item.id, "props");
            }}
            onBlur={() => onCellEditEnd(item.id, "props")}
            aria-label={`${item.sceneNo || index + 1} Scene Memo`}
          />
        ) : (
          <p className="whitespace-pre-wrap px-1.5 py-2 text-left font-medium leading-5 [overflow-wrap:anywhere]">
            {item.props}
          </p>
        )}
      </SceneCellFrame>
    </div>
  );
});

function ActorSceneCell({
  rowId,
  rowIndex,
  column,
  role,
  sceneLabel,
  state,
  canEdit,
  actorStyle,
  mergePosition,
  isInRange,
  selectionPosition,
  onSelect,
  onToggle,
  onLongPress
}: {
  rowId: string;
  rowIndex: number;
  column: SceneActorColumn;
  role: string;
  sceneLabel: string;
  state: ActorCellState;
  canEdit: boolean;
  actorStyle: ActorPaletteStyle;
  mergePosition: MergePosition;
  isInRange: boolean;
  selectionPosition: MergePosition;
  onSelect: (rowId: string, column: SceneCellColumn, rowIndex: number) => void;
  onToggle: () => void;
  onLongPress: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const isColored = state.mode === "color";
  const showText = state.mode === "text";
  const mergesWithNext = isColored &&
    (mergePosition === "start" || mergePosition === "middle");
  const ariaLabel = showText
    ? `${sceneLabel} Scene Character ${role} 메모 ${state.text}`
    : `${sceneLabel} Scene Character ${role} ${isColored ? "색 제거" : "색 지정"}`;

  return (
    <div
      role="gridcell"
      tabIndex={-1}
      data-scene-row-id={rowId}
      data-scene-cell-column={column}
      aria-selected={isInRange || undefined}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(rowId, column, rowIndex);
        onLongPress(event);
      }}
      className={`relative grid min-h-9 min-w-0 place-items-center border-r outline-none ${
        mergesWithNext
          ? "border-b border-b-transparent"
          : "border-b border-b-[#cbd0cb]"
      } ${canEdit ? "cursor-pointer" : "cursor-default"}`}
      style={{
        backgroundColor: isColored ? actorStyle.background : "#ffffff",
        color: showText ? "#2d332f" : actorStyle.color,
        boxShadow: isInRange
          ? getSelectionBoxShadow(selectionPosition)
          : undefined
      }}
    >
      {canEdit ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={ariaLabel}
          aria-pressed={isColored}
          className="grid h-full min-h-9 w-full min-w-0 place-items-center overflow-hidden bg-transparent px-1 text-[10px] font-bold leading-4 transition active:scale-95"
          title={showText ? state.text : undefined}
        >
          {showText ? (
            <span className="block w-full truncate">{state.text}</span>
          ) : null}
        </button>
      ) : (
        <span className="block w-full truncate px-1 text-center text-[10px] font-bold">
          {showText ? state.text : ""}
        </span>
      )}
    </div>
  );
}

type SceneCellInteraction = {
  rowId: string;
  rowIndex: number;
  column: SceneCellColumn;
  canEdit: boolean;
  isEditing: boolean;
  canDrag: boolean;
  isInRange: boolean;
  selectionPosition: MergePosition;
  mergeRange: SceneCellRange;
  mergePosition: MergePosition;
  mergeEndRowId: string;
  onSelect: (rowId: string, column: SceneCellColumn, rowIndex: number) => void;
  onPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    rowId: string,
    column: SceneCellColumn,
    rowIndex: number,
    value: string
  ) => void;
  onEditStart: (rowId: string, column: SceneCellColumn) => void;
  onEditEnd: (rowId: string, column: SceneCellColumn) => void;
  onLongPress?: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

function SceneCutInput({
  item,
  canEdit,
  compact = false,
  onFocus,
  onBlur,
  onChange,
  onValidationChange
}: {
  item: ProjectSceneItem;
  canEdit: boolean;
  compact?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onChange: (value: number | null) => void;
  onValidationChange: (message: string) => void;
}) {
  const formattedValue = item.cutCount == null ? "" : String(item.cutCount);
  const [draft, setDraft] = useState(formattedValue);
  const [validationMessage, setValidationMessage] = useState("");
  const onValidationChangeRef = useRef(onValidationChange);

  useEffect(() => {
    onValidationChangeRef.current = onValidationChange;
  }, [onValidationChange]);

  useEffect(() => {
    setDraft(formattedValue);
    setValidationMessage("");
    onValidationChangeRef.current("");
  }, [formattedValue]);

  if (!canEdit) {
    return (
      <span className="flex h-full min-h-9 items-center justify-center px-1 py-1.5 text-center font-bold">
        {formattedValue}
      </span>
    );
  }

  return (
    <div className="flex h-full min-h-9 min-w-0 flex-col items-stretch justify-center">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={String(MAX_SCENE_CUT_COUNT).length}
        value={draft}
        aria-label={`${item.sceneNo || "현재 씬"} 총 컷수`}
        aria-invalid={Boolean(validationMessage)}
        aria-describedby={validationMessage ? `scene-cut-error-${item.id}` : undefined}
        className={`${inputClassName} !min-h-8 px-1 text-center ${
          compact ? "!text-[16px]" : ""
        } ${validationMessage ? "text-field-danger ring-1 ring-inset ring-field-danger" : ""}`}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(event) => {
          const nextDraft = event.currentTarget.value;
          const validation = validateSceneCutCountInput(nextDraft);
          setDraft(nextDraft);
          setValidationMessage(validation.error);
          onValidationChange(validation.error);
          if (!validation.error) onChange(validation.value);
        }}
      />
      {validationMessage ? (
        <small
          id={`scene-cut-error-${item.id}`}
          className="block px-0.5 pb-0.5 text-center text-[8px] font-bold leading-3 text-field-danger"
        >
          0–{MAX_SCENE_CUT_COUNT}
        </small>
      ) : null}
    </div>
  );
}

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
              interaction.onEditStart(interaction.rowId, interaction.column);
            }
          }}
          onBlur={() => {
            if (interaction) {
              interaction.onEditEnd(interaction.rowId, interaction.column);
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

function AutoGrowSceneTextarea({
  value,
  onChange,
  onFocus,
  onBlur,
  "aria-label": ariaLabel
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  "aria-label": string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return undefined;
    const resize = () => {
      textarea.style.height = "0px";
      textarea.style.height = `${Math.max(36, textarea.scrollHeight)}px`;
    };
    resize();
    let previousWidth = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === previousWidth) return;
      previousWidth = textarea.clientWidth;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => handleMultilineEnterShortcut(event, value, onChange)}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-label={ariaLabel}
      className="block min-h-9 w-full min-w-0 resize-none overflow-hidden whitespace-pre-wrap border-0 bg-transparent px-1.5 py-2 text-left text-[12px] font-semibold leading-5 text-field-text outline-none [overflow-wrap:anywhere] focus:bg-field-light focus:ring-1 focus:ring-inset focus:ring-field-primary"
    />
  );
}

function handleMultilineEnterShortcut(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  value: string,
  onChange: (value: string) => void
) {
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (!event.metaKey && !event.altKey && !event.shiftKey) return;

  const textarea = event.currentTarget;
  const selectionStart = textarea.selectionStart ?? value.length;
  const selectionEnd = textarea.selectionEnd ?? selectionStart;
  const nextValue = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
  const nextCaretPosition = selectionStart + 1;
  onChange(nextValue);
  window.requestAnimationFrame(() => {
    textarea.setSelectionRange(nextCaretPosition, nextCaretPosition);
  });
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
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [mergedHeight, setMergedHeight] = useState<number | null>(null);
  const mergesWithNext = interaction?.mergePosition === "start" || interaction?.mergePosition === "middle";
  const mergeSpan = interaction
    ? Math.abs(interaction.mergeRange.endIndex - interaction.mergeRange.startIndex) + 1
    : 1;
  const showsMergedValue = Boolean(
    interaction?.mergePosition === "start" &&
    mergeSpan > 1 &&
    value.trim()
  );

  useLayoutEffect(() => {
    if (!showsMergedValue || !interaction) {
      setMergedHeight(null);
      return undefined;
    }
    const frame = frameRef.current;
    const grid = frame?.closest("[role='grid']");
    if (!frame || !grid) return undefined;

    const updateHeight = () => {
      const cells = grid.querySelectorAll<HTMLElement>(
        "[data-scene-row-id][data-scene-cell-column]"
      );
      const endCell = Array.from(cells).find((cell) => (
        cell.dataset.sceneRowId === interaction.mergeEndRowId &&
        cell.dataset.sceneCellColumn === interaction.column
      ));
      if (!endCell) return;
      const startRect = frame.getBoundingClientRect();
      const endRect = endCell.getBoundingClientRect();
      setMergedHeight(Math.max(startRect.height, endRect.bottom - startRect.top));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [
    interaction?.column,
    interaction?.mergeEndRowId,
    mergeSpan,
    showsMergedValue,
    value
  ]);

  return (
    <div
      ref={frameRef}
      role="gridcell"
      tabIndex={-1}
      data-scene-row-id={interaction?.rowId}
      data-scene-cell-column={interaction?.column}
      aria-selected={interaction?.isInRange || undefined}
      onPointerDownCapture={interaction
        ? (event) => {
            if (
              interaction.canEdit &&
              !interaction.isEditing &&
              isCellTextEditorTarget(event.target)
            ) {
              event.preventDefault();
            }
          }
        : undefined}
      onPointerDown={interaction
        ? (event) => {
            if (interaction.canDrag || interaction.onLongPress) {
              event.stopPropagation();
            }
            interaction.onSelect(interaction.rowId, interaction.column, interaction.rowIndex);
            if (!interaction.isEditing && !(event.target instanceof HTMLButtonElement)) {
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
            } else if (!isInteractiveTarget(event.target)) {
              event.currentTarget.focus({ preventScroll: true });
            }
            interaction.onLongPress?.(event);
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
      onDoubleClick={interaction?.canEdit
        ? (event) => {
            if (!event.currentTarget.querySelector("input, textarea, select")) return;
            event.preventDefault();
            interaction.onSelect(interaction.rowId, interaction.column, interaction.rowIndex);
            interaction.onEditStart(interaction.rowId, interaction.column);
          }
        : undefined}
      className={`relative min-w-0 border-r border-[#cbd0cb] ${
        mergesWithNext ? "border-b border-b-transparent" : "border-b border-b-[#cbd0cb]"
      } ${interaction ? "cursor-cell outline-none" : ""} ${
        interaction?.isInRange ? "z-10" : ""
      } ${
        interaction?.mergePosition === "start" ? "z-[5]" : ""
      } ${
        interaction?.onLongPress ? "[&_input]:select-none" : ""
      } ${className}`}
      style={{
        ...style,
        touchAction: interaction?.canDrag || interaction?.onLongPress ? "none" : style?.touchAction,
        WebkitTouchCallout: interaction?.onLongPress ? "none" : style?.WebkitTouchCallout,
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
            height: mergedHeight ?? `calc(${mergeSpan} * 2.25rem)`,
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
  column: SceneCellColumn,
  editingCell?: SelectedSceneCell | null
): SceneCellRange {
  const single = { column, startIndex: rowIndex, endIndex: rowIndex };
  if (!isVisualMergeColumn(column)) return single;
  const value = getSceneCellValue(items[rowIndex], column).trim();
  if (!value) return single;
  if (isActorColumn(column) && value !== ACTOR_COLOR_CELL_VALUE) return single;
  const locationColumn = isLocationColumn(column);
  const isEditingCurrent = locationColumn
    ? isEditingLocationCell(items[rowIndex], editingCell)
    : isEditingCell(items[rowIndex], column, editingCell);
  if (isEditingCurrent) return single;
  const matchesCurrentGroup = (candidate: ProjectSceneItem | undefined) => (
    locationColumn
      ? hasSameLocationPair(items[rowIndex], candidate)
      : getSceneCellValue(candidate, column).trim() === value
  );
  const isEditingCandidate = (candidate: ProjectSceneItem | undefined) => (
    locationColumn
      ? isEditingLocationCell(candidate, editingCell)
      : isEditingCell(candidate, column, editingCell)
  );

  let startIndex = rowIndex;
  let endIndex = rowIndex;
  while (
    startIndex > 0 &&
    !isEditingCandidate(items[startIndex - 1]) &&
    matchesCurrentGroup(items[startIndex - 1])
  ) {
    startIndex -= 1;
  }
  while (
    endIndex < items.length - 1 &&
    !isEditingCandidate(items[endIndex + 1]) &&
    matchesCurrentGroup(items[endIndex + 1])
  ) {
    endIndex += 1;
  }
  return { column, startIndex, endIndex };
}

function getActiveVisualRange(
  items: ProjectSceneItem[],
  rowIndex: number,
  column: SceneCellColumn
) {
  if (
    isLocationColumn(column) &&
    isSameHorizontalLocation(items[rowIndex])
  ) {
    return getHorizontalLocationMergeRange(items, rowIndex);
  }
  return getVisualMergeRange(items, rowIndex, column);
}

function getHorizontalLocationMergeRange(
  items: ProjectSceneItem[],
  rowIndex: number,
  editingCell?: SelectedSceneCell | null
): SceneCellRange {
  const column: SceneCellColumn = "mainLocation";
  const single = { column, startIndex: rowIndex, endIndex: rowIndex };
  const item = items[rowIndex];
  if (!item || !isSameHorizontalLocation(item)) return single;
  if (isEditingLocationCell(item, editingCell)) return single;

  let startIndex = rowIndex;
  let endIndex = rowIndex;
  while (
    startIndex > 0 &&
    isSameHorizontalLocation(items[startIndex - 1]) &&
    !isEditingLocationCell(items[startIndex - 1], editingCell) &&
    hasSameLocationPair(item, items[startIndex - 1])
  ) {
    startIndex -= 1;
  }
  while (
    endIndex < items.length - 1 &&
    isSameHorizontalLocation(items[endIndex + 1]) &&
    !isEditingLocationCell(items[endIndex + 1], editingCell) &&
    hasSameLocationPair(item, items[endIndex + 1])
  ) {
    endIndex += 1;
  }
  return { column, startIndex, endIndex };
}

function isSameHorizontalLocation(item: ProjectSceneItem | undefined) {
  if (!item) return false;
  const mainLocation = item.mainLocation.trim();
  return Boolean(
    mainLocation &&
    mainLocation === item.subLocation.trim()
  );
}

function hasSameLocationPair(
  left: ProjectSceneItem | undefined,
  right: ProjectSceneItem | undefined
) {
  if (!left || !right) return false;
  const leftMain = normalizeLocationMergeValue(left.mainLocation);
  const leftSub = normalizeLocationMergeValue(left.subLocation);
  if (!leftMain && !leftSub) return false;
  return (
    leftMain === normalizeLocationMergeValue(right.mainLocation) &&
    leftSub === normalizeLocationMergeValue(right.subLocation)
  );
}

function normalizeLocationMergeValue(value: unknown) {
  return String(value ?? "").trim();
}

function isEditingLocationCell(
  item: ProjectSceneItem | undefined,
  editingCell?: SelectedSceneCell | null
) {
  return Boolean(
    item &&
    editingCell?.rowId === item.id &&
    (editingCell.column === "mainLocation" || editingCell.column === "subLocation")
  );
}

function isEditingCell(
  item: ProjectSceneItem | undefined,
  column: SceneCellColumn,
  editingCell?: SelectedSceneCell | null
) {
  return Boolean(
    item &&
    editingCell?.rowId === item.id &&
    editingCell.column === column
  );
}

function getVisualCellsForRow(
  item: ProjectSceneItem | undefined,
  columns: SceneCellColumn[]
): VisualSceneCell[] {
  const mergesLocation = isSameHorizontalLocation(item);
  return columns.flatMap((column) => {
    if (mergesLocation && column === "subLocation") return [];
    if (mergesLocation && column === "mainLocation") {
      return [{
        representative: "mainLocation",
        logicalColumns: ["mainLocation", "subLocation"]
      }];
    }
    return [{ representative: column, logicalColumns: [column] }];
  });
}

function getVisualRepresentative(
  item: ProjectSceneItem | undefined,
  column: SceneCellColumn
) {
  const visualCells = getVisualCellsForRow(item, [column]);
  if (visualCells.length > 0) return visualCells[0].representative;
  return isLocationColumn(column) && isSameHorizontalLocation(item)
    ? "mainLocation"
    : column;
}

function getAdjacentVisualColumn(
  item: ProjectSceneItem | undefined,
  columns: SceneCellColumn[],
  currentColumn: SceneCellColumn,
  direction: -1 | 1
) {
  const visualCells = getVisualCellsForRow(item, columns);
  if (visualCells.length === 0) return currentColumn;
  const representative = getVisualRepresentative(item, currentColumn);
  const currentIndex = visualCells.findIndex(
    (cell) => cell.representative === representative
  );
  const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = Math.max(
    0,
    Math.min(safeCurrentIndex + direction, visualCells.length - 1)
  );
  return visualCells[nextIndex].representative;
}

function getAdjacentVisualCell(
  items: ProjectSceneItem[],
  columns: SceneCellColumn[],
  currentRowIndex: number,
  currentColumn: SceneCellColumn,
  direction: -1 | 1
) {
  const visualGrid = items.flatMap((item, rowIndex) => (
    getVisualCellsForRow(item, columns).map((cell) => ({
      rowIndex,
      column: cell.representative
    }))
  ));
  if (visualGrid.length === 0) {
    return { rowIndex: currentRowIndex, column: currentColumn };
  }
  const representative = getVisualRepresentative(
    items[currentRowIndex],
    currentColumn
  );
  const currentIndex = visualGrid.findIndex((cell) => (
    cell.rowIndex === currentRowIndex && cell.column === representative
  ));
  const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = Math.max(
    0,
    Math.min(safeCurrentIndex + direction, visualGrid.length - 1)
  );
  return visualGrid[nextIndex];
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

function isVisualMergeColumn(column: SceneCellColumn): column is SceneVisualMergeColumn {
  return isActorColumn(column) || [
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

function isLocationColumn(
  column: SceneCellColumn
): column is "mainLocation" | "subLocation" {
  return column === "mainLocation" || column === "subLocation";
}

function getSceneCellValue(item: ProjectSceneItem | undefined, column: SceneCellColumn) {
  if (!item) return "";
  if (!isActorColumn(column)) {
    if (column === "cutCount") return item.cutCount == null ? "" : String(item.cutCount);
    return item[column];
  }
  const role = column.slice("actor:".length);
  const state = getActorCellState(item, role);
  if (state.mode === "color") return ACTOR_COLOR_CELL_VALUE;
  if (state.mode === "text") return `${ACTOR_TEXT_CELL_PREFIX}${state.text}`;
  return "";
}

function setSceneCellValue(
  item: ProjectSceneItem,
  column: SceneCellColumn,
  rawValue: string
): ProjectSceneItem {
  if (isActorColumn(column)) {
    const role = column.slice("actor:".length).trim();
    if (!role) return item;
    const value = rawValue.trim();
    if (!value) return setActorCellState(item, role, { mode: "empty", text: "" });
    if (
      value === ACTOR_COLOR_CELL_VALUE ||
      /^(o|color|1|true)$/i.test(value)
    ) {
      return setActorCellState(item, role, { mode: "color", text: "" });
    }
    const text = value.startsWith(ACTOR_TEXT_CELL_PREFIX)
      ? value.slice(ACTOR_TEXT_CELL_PREFIX.length)
      : value;
    return setActorCellState(item, role, { mode: "text", text });
  }

  let value = rawValue.replace(/\r?\n/g, " ");
  if (column === "cutCount") {
    const validation = validateSceneCutCountInput(value);
    return validation.error ? item : { ...item, cutCount: validation.value };
  } else if (column === "dayNight") {
    const normalized = value.trim().toUpperCase();
    value = normalized === "D" || normalized === "N" ? normalized : "";
  } else if (column === "interiorExterior") {
    const normalized = value.trim().toUpperCase();
    value = normalized === "I" || normalized === "E" ? normalized : "";
  }
  return { ...item, [column]: value };
}

function getActorCellState(item: ProjectSceneItem, role: string): ActorCellState {
  const normalizedRole = role.trim().toLocaleLowerCase();
  const storedEntry = Object.entries(item.actorCells ?? {}).find(
    ([key]) => key.trim().toLocaleLowerCase() === normalizedRole
  );
  const stored = storedEntry?.[1];
  if (stored?.mode === "text" && String(stored.text ?? "").trim()) {
    return { mode: "text", text: String(stored.text).slice(0, 120) };
  }
  if (stored?.mode === "color") return { mode: "color", text: "" };
  const legacyColor = parseCharacters(item.characters).some(
    (character) => character.toLocaleLowerCase() === normalizedRole
  );
  return legacyColor
    ? { mode: "color", text: "" }
    : { mode: "empty", text: "" };
}

function setActorCellState(
  item: ProjectSceneItem,
  role: string,
  state: ActorCellState
): ProjectSceneItem {
  const normalizedRole = role.trim();
  if (!normalizedRole) return item;
  const roleKey = normalizedRole.toLocaleLowerCase();
  const actorCells: Record<string, ProjectSceneActorCell> = { ...(item.actorCells ?? {}) };
  for (const key of Object.keys(actorCells)) {
    if (key.trim().toLocaleLowerCase() === roleKey) delete actorCells[key];
  }

  let characters = parseCharacters(item.characters).filter(
    (character) => character.toLocaleLowerCase() !== roleKey
  );
  if (state.mode === "color") {
    actorCells[normalizedRole] = { mode: "color" };
    characters = [...characters, normalizedRole];
  } else if (state.mode === "text" && state.text.trim()) {
    actorCells[normalizedRole] = {
      mode: "text",
      text: state.text.slice(0, 120)
    };
  }
  return {
    ...item,
    characters: characters.join(", "),
    actorCells
  };
}

function getActorCellKey(rowId: string, role: string) {
  return `${rowId}::${role.trim().toLocaleLowerCase()}`;
}

function setVisualSceneCellValue(
  item: ProjectSceneItem,
  column: SceneCellColumn,
  rawValue: string
) {
  const candidateColumns: SceneCellColumn[] = isLocationColumn(column)
    ? ["mainLocation", "subLocation"]
    : [column];
  const visualCell = getVisualCellsForRow(item, candidateColumns).find(
    (cell) => cell.logicalColumns.includes(column)
  );
  const logicalColumns = visualCell?.logicalColumns ?? [column];
  return logicalColumns.reduce(
    (currentItem, logicalColumn) => (
      setSceneCellValue(currentItem, logicalColumn, rawValue)
    ),
    item
  );
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

function isCellTextEditorTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(
    target.closest("input, textarea, select")
  );
}

function beginLongPress(
  event: ReactPointerEvent<HTMLElement>,
  onTrigger: (point: { x: number; y: number }) => void
) {
  if (event.button !== 0) return () => undefined;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let timer: number | null = null;

  const cleanup = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleEnd);
    window.removeEventListener("pointercancel", handleEnd);
  };
  const handleMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 8) {
      cleanup();
    }
  };
  const handleEnd = (endEvent: PointerEvent) => {
    if (endEvent.pointerId === pointerId) cleanup();
  };

  timer = window.setTimeout(() => {
    window.getSelection()?.removeAllRanges();
    onTrigger({ x: startX, y: startY });
  }, 520);
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleEnd);
  window.addEventListener("pointercancel", handleEnd);
  return cleanup;
}

function beginHeaderHelpLongPress(
  event: ReactPointerEvent<HTMLElement>,
  onTrigger: (point: { x: number; y: number }) => void,
  onFinish: () => void
) {
  if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
    return () => undefined;
  }
  const pressedElement = event.currentTarget;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let timer: number | null = null;
  let isActive = true;

  const cleanup = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleEnd);
    window.removeEventListener("pointercancel", handleEnd);
    window.removeEventListener("scroll", handleScroll, true);
    window.removeEventListener("resize", finish);
    if (pressedElement.hasPointerCapture(pointerId)) {
      try {
        pressedElement.releasePointerCapture(pointerId);
      } catch {
        // 브라우저가 먼저 capture를 해제한 경우에도 나머지 정리는 계속합니다.
      }
    }
  };
  const finish = () => {
    if (!isActive) return;
    isActive = false;
    cleanup();
    onFinish();
  };
  const handleMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 9) {
      finish();
    }
  };
  const handleEnd = (endEvent: PointerEvent) => {
    if (endEvent.pointerId === pointerId) finish();
  };
  const handleScroll = () => finish();

  try {
    pressedElement.setPointerCapture(pointerId);
  } catch {
    // capture 미지원 환경에서도 window 이벤트로 long press를 추적합니다.
  }
  timer = window.setTimeout(() => {
    if (!isActive) return;
    timer = null;
    window.getSelection()?.removeAllRanges();
    onTrigger({ x: startX, y: startY });
  }, 600);
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleEnd);
  window.addEventListener("pointercancel", handleEnd);
  window.addEventListener("scroll", handleScroll, true);
  window.addEventListener("resize", finish);
  return finish;
}

function clampPopoverLeft(pointerX: number, width: number) {
  return Math.min(
    window.innerWidth - width - 8,
    Math.max(8, pointerX - width / 2)
  );
}

function getPopoverTop(pointerY: number, height: number) {
  const preferredTop = pointerY + 14;
  return preferredTop + height < window.innerHeight
    ? preferredTop
    : Math.max(8, pointerY - height - 14);
}

function parseCharacters(value: string) {
  return Array.from(new Set(
    value
      .split(/[,，/|\n]+/)
      .map((character) => character.trim())
      .filter(Boolean)
  ));
}

const neutralPaletteStyle: PaletteStyle = {
  background: "#ffffff",
  color: "#1c1c1a"
};

const actorPalette: ActorPaletteStyle[] = [
  { background: "#fce4ec", headerBackground: "#f8bbd0", color: "#6b1835" },
  { background: "#e3f2fd", headerBackground: "#bbdefb", color: "#17486b" },
  { background: "#e8f5e9", headerBackground: "#c8e6c9", color: "#24532a" },
  { background: "#fff8e1", headerBackground: "#ffecb3", color: "#66510b" },
  { background: "#f3e5f5", headerBackground: "#e1bee7", color: "#53305d" },
  { background: "#fff3e0", headerBackground: "#ffe0b2", color: "#6a3b10" },
  { background: "#e0f7fa", headerBackground: "#b2ebf2", color: "#15515a" },
  { background: "#fbe9e7", headerBackground: "#ffccbc", color: "#683126" },
  { background: "#f1f8e9", headerBackground: "#dcedc8", color: "#3b5720" },
  { background: "#ede7f6", headerBackground: "#d1c4e9", color: "#423565" }
];

const locationPalette: PaletteStyle[] = [
  { background: "#fff4c7", color: "#584607" },
  { background: "#dff1df", color: "#224d29" },
  { background: "#f8dfd1", color: "#62311d" },
  { background: "#dcedf2", color: "#204955" },
  { background: "#e8e0f2", color: "#45325b" },
  { background: "#f4dfe8", color: "#5e2b40" },
  { background: "#e8efcf", color: "#41521c" },
  { background: "#dce8fb", color: "#28466d" },
  { background: "#f5e5c9", color: "#60461c" },
  { background: "#d9efea", color: "#1e5048" },
  { background: "#f1dfd8", color: "#64392c" },
  { background: "#e4ebd8", color: "#40502b" },
  { background: "#e9dded", color: "#50345a" },
  { background: "#dce9e2", color: "#294b3a" },
  { background: "#fae1df", color: "#6a302d" },
  { background: "#e1e5f3", color: "#36405f" },
  { background: "#f4ead6", color: "#5e4a25" },
  { background: "#d8eff4", color: "#20515c" },
  { background: "#e8e2d4", color: "#50452d" },
  { background: "#f1e1f0", color: "#5c345a" },
  { background: "#dff0d3", color: "#345524" },
  { background: "#f7e6d7", color: "#633f25" },
  { background: "#dce5ef", color: "#304a62" },
  { background: "#efe1cc", color: "#5b4324" },
  { background: "#e0ede7", color: "#2c4d40" },
  { background: "#f0dfe4", color: "#5b3340" },
  { background: "#e5e8ce", color: "#4a4e1e" },
  { background: "#e1e0f0", color: "#403b60" },
  { background: "#f6e3cb", color: "#64421f" },
  { background: "#dcebea", color: "#28504d" }
];

function getActorStyle(index: number) {
  return actorPalette[index % actorPalette.length] ?? actorPalette[0];
}

function getMappedLocationStyle(
  location: string,
  styles: Map<string, PaletteStyle>
): PaletteStyle {
  const normalized = location.trim().toLocaleLowerCase();
  return normalized ? styles.get(normalized) ?? neutralPaletteStyle : neutralPaletteStyle;
}

function getLocationPaletteIndex(location: string) {
  const normalized = location.trim().toLocaleLowerCase();
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % locationPalette.length;
}

"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { SceneReorderList, type SceneReorderRowProps } from "@/components/SceneReorderList";
import { useContextualGuideAnchor } from "@/components/guides/ContextualGuideProvider";
import {
  SCENE_LIST_MERGE_COLUMNS,
  buildSceneListMergeLayout,
  createSceneListCellMergeFromRange,
  getSceneListCellMergeState,
  getSceneListMergesIntersectingRange,
  listSceneListCellsInRange,
  removeSceneListCellMergesInRange,
  resolveSceneListCellRange,
  validateSceneListCellMerges,
  validateSceneListReorderWithMerges,
  type SceneListMergeCell,
  type SceneListMergeSelection,
  type SceneListResolvedCellRange
} from "@/lib/sceneListMergeModel";
import { MAX_SCENE_CUT_COUNT, validateSceneCutCountInput } from "@/lib/sceneCutCount";
import {
  createLocationStyles,
  getActorCellState,
  getActorStyle,
  getLocationStyle,
  setActorCellState,
  type SceneListPaletteStyle
} from "@/lib/sceneListDisplay";
import {
  getSceneListEditorKeyAction,
  resolveSceneListCompositionEnd
} from "@/lib/sceneListIme";
import type {
  ProjectSceneCellMerge,
  ProjectSceneItem,
  ProjectSceneMergeColumn
} from "@/lib/types";

type SceneEditableColumn =
  | "sceneNo"
  | "location"
  | "subLocation"
  | "day"
  | "time"
  | "intExt"
  | "content"
  | `actor:${string}`
  | "cut"
  | "memo";

type CellMenuState = { left: number; top: number };
type ConfirmState = {
  kind: "merge";
  title: string;
  description: string;
};

type PendingSelectionDrag = {
  pointerId: number;
  pointerType: string;
  start: SceneListMergeCell;
  focus: SceneListMergeCell;
  startX: number;
  startY: number;
  didDrag: boolean;
  longPressTriggered: boolean;
  captureTarget: HTMLTableCellElement;
  timer: number | null;
};

type PaletteStyle = SceneListPaletteStyle;

const mergeColumnField: Record<ProjectSceneMergeColumn, keyof ProjectSceneItem> = {
  location: "mainLocation",
  subLocation: "subLocation",
  day: "dayLabel",
  time: "dayNight",
  intExt: "interiorExterior"
};

const tableInputClass =
  "h-full min-h-9 w-full min-w-0 border-0 bg-transparent px-1.5 py-1 text-center text-[12px] font-semibold leading-5 text-[#151515] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#111111]";
const sceneTableBaseWidth = 1087;
const sceneActorColumnWidth = 72;

export function SceneListNativeTable({
  items,
  actorRoles,
  cellMerges,
  canEdit,
  hasPendingMutation,
  onUpdate,
  onReorderLocal,
  onReorderCommit,
  onPersistMerges,
  onClearCells,
  onDelete,
  onError,
  onCutValidationChange
}: {
  items: ProjectSceneItem[];
  actorRoles: string[];
  cellMerges: ProjectSceneCellMerge[];
  canEdit: boolean;
  hasPendingMutation: boolean;
  onUpdate: (id: string, patch: Partial<ProjectSceneItem>) => void;
  onReorderLocal: (items: ProjectSceneItem[]) => void;
  onReorderCommit: (items: ProjectSceneItem[], previous: ProjectSceneItem[]) => Promise<void>;
  onPersistMerges: (merges: ProjectSceneCellMerge[]) => Promise<void>;
  onClearCells: (cells: SceneListMergeCell[]) => Promise<void>;
  onDelete: (item: ProjectSceneItem) => void;
  onError: (message: string) => void;
  onCutValidationChange: (id: string, message: string) => void;
}) {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const tableNaturalWidth = sceneTableBaseWidth + actorRoles.length * sceneActorColumnWidth;
  const orderedSceneIds = useStableSceneIds(items);
  const mergeLayout = useMemo(
    () => buildSceneListMergeLayout(orderedSceneIds, cellMerges),
    [cellMerges, orderedSceneIds]
  );
  const [selection, setSelection] = useState<SceneListMergeSelection | null>(null);
  const [menu, setMenu] = useState<CellMenuState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [editingCell, setEditingCell] = useState<{ sceneId: string; column: SceneEditableColumn } | null>(null);
  const [sceneMenu, setSceneMenu] = useState<{ itemId: string; left: number; top: number } | null>(null);
  const [actorTextEditor, setActorTextEditor] = useState<{ sceneId: string; role: string } | null>(null);
  const pointerCleanupRef = useRef<(() => void) | null>(null);
  const actorPointerCleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const suppressActorClickRef = useRef(false);

  const resolvedSelection = useMemo(() => (
    selection
      ? resolveSceneListCellRange(selection, orderedSceneIds, cellMerges, true)
      : null
  ), [cellMerges, orderedSceneIds, selection]);
  const intersectingMerges = useMemo(() => (
    resolvedSelection
      ? getSceneListMergesIntersectingRange(resolvedSelection, orderedSceneIds, cellMerges)
      : []
  ), [cellMerges, orderedSceneIds, resolvedSelection]);
  const selectionCellCount = resolvedSelection
    ? resolvedSelection.sceneIds.length * resolvedSelection.columns.length
    : 0;
  const canMergeSelection = Boolean(
    canEdit &&
    resolvedSelection &&
    selectionCellCount >= 2 &&
    intersectingMerges.length === 0 &&
    validateSceneListCellMerges(orderedSceneIds, [
      createSceneListCellMergeFromRange("selection-check", resolvedSelection)
    ]).ok
  );

  useEffect(() => {
    if (!mergeLayout.errors.length) return;
    onError(mergeLayout.errors[0]?.message ?? "저장된 셀 병합 범위가 올바르지 않습니다.");
  }, [mergeLayout.errors, onError]);

  useEffect(() => {
    if (!selection && !menu && !sceneMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.isComposing || event.keyCode === 229) return;
      setSelection(null);
      setMenu(null);
      setSceneMenu(null);
      setConfirmState(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menu, sceneMenu, selection]);

  useEffect(() => {
    if (!selection && !menu && !sceneMenu && !confirmState && !actorTextEditor) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (
        tableRef.current?.contains(event.target) ||
        event.target.closest("[data-scene-floating-ui]")
      ) {
        return;
      }
      setSelection(null);
      setMenu(null);
      setSceneMenu(null);
      setConfirmState(null);
      setActorTextEditor(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [actorTextEditor, confirmState, menu, sceneMenu, selection]);

  useEffect(() => () => {
    pointerCleanupRef.current?.();
    actorPointerCleanupRef.current?.();
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
  }, []);

  const closeSelection = useCallback(() => {
    setSelection(null);
    setMenu(null);
    setConfirmState(null);
  }, []);

  const showMenuAt = useCallback((x: number, y: number) => {
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const width = 184;
    const height = 128;
    const navigationReserve = window.innerWidth >= 768 ? 76 : 8;
    setMenu({
      left: Math.max(
        viewportLeft + 8,
        Math.min(x, viewportLeft + viewportWidth - width - navigationReserve)
      ),
      top: Math.max(viewportTop + 8, Math.min(y + 8, viewportTop + viewportHeight - height - 8))
    });
  }, []);

  const selectionFromCells = useCallback((
    anchor: SceneListMergeCell,
    focus: SceneListMergeCell
  ): SceneListMergeSelection => {
    const allowedFocus = isLocationMergeColumn(anchor.column)
      ? {
          ...focus,
          column: isLocationMergeColumn(focus.column) ? focus.column : anchor.column
        }
      : { ...focus, column: anchor.column };
    return { anchor, focus: allowedFocus };
  }, []);

  const findMergeCellAt = useCallback((clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(
      "[data-scene-merge-scene-id][data-scene-merge-column]"
    );
    if (!target || !tableRef.current?.contains(target)) return null;
    const sceneId = target?.dataset.sceneMergeSceneId;
    const column = target?.dataset.sceneMergeColumn as ProjectSceneMergeColumn | undefined;
    return sceneId && column ? { sceneId, column } : null;
  }, []);

  const beginSelectionPointer = useCallback((
    event: ReactPointerEvent<HTMLTableCellElement>,
    cell: SceneListMergeCell
  ) => {
    if (!canEdit || event.button !== 0) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    pointerCleanupRef.current?.();
    setSceneMenu(null);
    setMenu(null);
    // A touch tap should remain a normal edit/scroll gesture. Selection starts
    // only after the long-press threshold, while desktop keeps immediate focus.
    setSelection(event.pointerType === "touch" ? null : selectionFromCells(cell, cell));

    const pending: PendingSelectionDrag = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      start: cell,
      focus: cell,
      startX: event.clientX,
      startY: event.clientY,
      didDrag: false,
      longPressTriggered: false,
      captureTarget: event.currentTarget,
      timer: null
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window listeners below keep the interaction alive when capture is unavailable.
    }

    const cleanup = () => {
      if (pending.timer !== null) window.clearTimeout(pending.timer);
      pending.timer = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      try {
        if (pending.captureTarget.hasPointerCapture(pending.pointerId)) {
          pending.captureTarget.releasePointerCapture(pending.pointerId);
        }
      } catch {
        // Safari can release capture before pointercancel reaches the listener.
      }
      pointerCleanupRef.current = null;
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
    };

    const activateSelection = () => {
      pending.didDrag = true;
      suppressClickRef.current = true;
      window.getSelection()?.removeAllRanges();
      document.body.style.userSelect = "none";
      document.body.style.cursor = "cell";
      setEditingCell(null);
      setMenu(null);
      setSelection(selectionFromCells(pending.start, pending.focus));
    };

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pending.pointerId) return;
      const distance = Math.hypot(
        moveEvent.clientX - pending.startX,
        moveEvent.clientY - pending.startY
      );

      if (!pending.didDrag) {
        if (pending.pointerType === "touch") {
          if (!pending.longPressTriggered && distance > 9) cleanup();
          return;
        }
        if (distance < 7) return;
        activateSelection();
      }

      moveEvent.preventDefault();
      const target = findMergeCellAt(moveEvent.clientX, moveEvent.clientY);
      if (!target) return;
      const nextSelection = selectionFromCells(pending.start, target);
      pending.focus = nextSelection.focus;
      setSelection(nextSelection);
    };

    const finish = (cancelled: boolean, endEvent: PointerEvent) => {
      const wasSelecting = pending.didDrag;
      cleanup();
      if (cancelled) {
        setSelection(null);
        setMenu(null);
      } else if (wasSelecting) {
        setSelection(selectionFromCells(pending.start, pending.focus));
        showMenuAt(endEvent.clientX, endEvent.clientY);
      }
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    const handlePointerUp = (endEvent: PointerEvent) => {
      if (endEvent.pointerId === pending.pointerId) finish(false, endEvent);
    };
    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pending.pointerId) finish(true, cancelEvent);
    };

    if (event.pointerType === "touch") {
      pending.timer = window.setTimeout(() => {
        pending.longPressTriggered = true;
        activateSelection();
        if (navigator.vibrate) navigator.vibrate(8);
      }, 520);
    }
    pointerCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
  }, [canEdit, findMergeCellAt, selectionFromCells, showMenuAt]);

  const handleMergeCellContextMenu = useCallback((
    event: React.MouseEvent<HTMLTableCellElement>,
    cell: SceneListMergeCell
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canEdit) return;
    const activeRange = selection
      ? resolveSceneListCellRange(selection, orderedSceneIds, cellMerges, true)
      : null;
    const isInside = Boolean(activeRange && activeRange.sceneIds.includes(cell.sceneId) &&
      activeRange.columns.includes(cell.column));
    if (!isInside) setSelection(selectionFromCells(cell, cell));
    setEditingCell(null);
    setSceneMenu(null);
    showMenuAt(event.clientX, event.clientY);
  }, [canEdit, cellMerges, orderedSceneIds, selection, selectionFromCells, showMenuAt]);

  const valuesInSelection = useCallback((range: SceneListResolvedCellRange) => {
    const byId = new Map(items.map((item) => [item.id, item]));
    return listSceneListCellsInRange(range)
      .map((cell) => String(byId.get(cell.sceneId)?.[mergeColumnField[cell.column]] ?? "").trim())
      .filter(Boolean);
  }, [items]);

  const executeMerge = useCallback(() => {
    if (!resolvedSelection || !canMergeSelection) return;
    const validation = validateSceneListCellMerges(orderedSceneIds, [
      ...cellMerges,
      createSceneListCellMergeFromRange(createClientId(), resolvedSelection)
    ]);
    if (!validation.ok) {
      onError(validation.errors[0]?.message ?? "선택한 범위를 병합할 수 없습니다.");
      return;
    }
    closeSelectionAfterMutation(setSelection, setMenu, setConfirmState);
    void onPersistMerges(validation.validMerges).catch((error) => {
      onError(getErrorMessage(error, "셀 병합 상태를 저장하지 못했습니다."));
    });
  }, [canMergeSelection, cellMerges, onError, onPersistMerges, orderedSceneIds, resolvedSelection]);

  const executeUnmerge = useCallback(() => {
    if (!canEdit || !resolvedSelection || intersectingMerges.length === 0) return;
    const nextMerges = removeSceneListCellMergesInRange(
      resolvedSelection,
      orderedSceneIds,
      cellMerges
    );
    closeSelectionAfterMutation(setSelection, setMenu, setConfirmState);
    void onPersistMerges(nextMerges).catch((error) => {
      onError(getErrorMessage(error, "병합을 해제하지 못했습니다."));
    });
  }, [canEdit, cellMerges, intersectingMerges.length, onError, onPersistMerges, orderedSceneIds, resolvedSelection]);

  const executeClear = useCallback(() => {
    if (!canEdit || !resolvedSelection) return;
    const cells = listSceneListCellsInRange(resolvedSelection);
    closeSelectionAfterMutation(setSelection, setMenu, setConfirmState);
    void onClearCells(cells).catch((error) => {
      onError(getErrorMessage(error, "선택 칸을 비우지 못했습니다."));
    });
  }, [canEdit, onClearCells, onError, resolvedSelection]);

  const actorStyles = useMemo(() => actorRoles.map((_, index) => getActorStyle(index)), [actorRoles]);
  const locationStyles = useMemo(() => createLocationStyles(items), [items]);

  return (
    <>
      <div
        data-scene-table-scroller
        className="workspace-surface relative w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable]"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) closeSelection();
        }}
      >
        <div
          className="relative"
          style={{ width: `${tableNaturalWidth}px` }}
        >
          <table
            ref={tableRef}
            aria-label="프로젝트 씬리스트"
            className="table-fixed border-separate border-spacing-0 text-[12px] text-[#151515]"
            style={{ width: `${tableNaturalWidth}px`, minWidth: `${tableNaturalWidth}px` }}
          >
            <SceneTableColGroup actorRoles={actorRoles} />
            <thead className="sticky top-0 z-[60] bg-[#eeeeee] text-[11px] font-black leading-4">
              <SceneTableHeaderRow actorRoles={actorRoles} actorStyles={actorStyles} />
            </thead>

            <SceneReorderList
              items={items}
              disabled={!canEdit || Boolean(menu) || hasPendingMutation}
              fitScale={1}
              onReorder={onReorderLocal}
              validateReorder={(next, previous) => {
                const validation = validateSceneListReorderWithMerges(
                  next.map((item) => item.id),
                  cellMerges,
                  previous.map((item) => item.id)
                );
                if (!validation.ok) return { ok: false, message: validation.error ?? undefined };
                return { ok: true };
              }}
              onCommit={async (next, previous) => {
                await onReorderCommit(next, previous);
                return { ok: true };
              }}
              onCommitError={onError}
              renderRow={(item, index, { trProps }) => (
                <SceneNativeRow
                  key={item.id}
                  trProps={trProps}
                  item={item}
                  index={index}
                  actorRoles={actorRoles}
                  actorStyles={actorStyles}
                  locationStyle={getLocationStyle(item, locationStyles)}
                  mergeLayout={mergeLayout}
                  resolvedSelection={resolvedSelection}
                  canEdit={canEdit}
                  hasMultipleScenes={items.length >= 2}
                  hasPendingMutation={hasPendingMutation}
                  editingCell={editingCell}
                  suppressClickRef={suppressClickRef}
                  suppressActorClickRef={suppressActorClickRef}
                  actorPointerCleanupRef={actorPointerCleanupRef}
                  onBeginSelection={beginSelectionPointer}
                  onMergeContextMenu={handleMergeCellContextMenu}
                  onEdit={(column) => setEditingCell({ sceneId: item.id, column })}
                  onEditEnd={() => setEditingCell(null)}
                  onUpdate={onUpdate}
                  onSceneContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!canEdit || hasPendingMutation) return;
                    setSelection(null);
                    setMenu(null);
                    setSceneMenu({
                      itemId: item.id,
                      ...clampFixedPosition(event.clientX, event.clientY, 112, 48)
                    });
                  }}
                  onActorTextEdit={(role) => setActorTextEditor({ sceneId: item.id, role })}
                  onCutValidationChange={onCutValidationChange}
                />
              )}
            />
          </table>

          {items.length === 0 ? (
            <p className="border-x border-b border-[#d6d6d6] bg-white px-3 py-10 text-center text-xs font-semibold text-[#777]">
              등록된 씬이 없습니다.
            </p>
          ) : null}
        </div>
      </div>

      {menu && resolvedSelection && typeof document !== "undefined"
        ? createPortal(
            <div
              data-scene-floating-ui
              className="light-workspace scene-workspace workspace-popup fixed z-[120] w-[184px] border p-1 shadow-lg"
              style={{ left: menu.left, top: menu.top, paddingBottom: "max(.25rem, env(safe-area-inset-bottom))" }}
              role="menu"
              aria-label="선택 칸 기능"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <SceneMenuButton
                disabled={!canMergeSelection}
                onClick={() => {
                  const values = valuesInSelection(resolvedSelection);
                  if (new Set(values).size > 1) {
                    setConfirmState({
                      kind: "merge",
                      title: "선택 칸을 병합할까요?",
                      description: "병합 후에는 왼쪽 위 칸의 값만 표시됩니다. 다른 칸의 값은 삭제되지 않으며 병합 해제 시 다시 표시됩니다."
                    });
                    return;
                  }
                  void executeMerge();
                }}
              >
                선택 칸 병합
              </SceneMenuButton>
              <SceneMenuButton
                disabled={!canEdit || intersectingMerges.length === 0}
                onClick={() => void executeUnmerge()}
              >
                병합 해제
              </SceneMenuButton>
              <SceneMenuButton
                disabled={!canEdit}
                onClick={() => {
                  void executeClear();
                }}
              >
                선택 칸 비우기
              </SceneMenuButton>
            </div>,
            document.body
          )
        : null}

      {sceneMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              data-scene-floating-ui
              className="light-workspace scene-workspace workspace-popup workspace-popup-danger fixed z-[120] w-28 border p-1 shadow-lg"
              style={{ left: sceneMenu.left, top: sceneMenu.top }}
              role="menu"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <SceneMenuButton
                disabled={!canEdit || hasPendingMutation}
                onClick={() => {
                  if (!canEdit) return;
                  const item = items.find((candidate) => candidate.id === sceneMenu.itemId);
                  setSceneMenu(null);
                  if (item) onDelete(item);
                }}
              >
                씬 삭제
              </SceneMenuButton>
            </div>,
            document.body
          )
        : null}

      {confirmState && typeof document !== "undefined"
        ? createPortal(
            <SceneConfirmDialog
              state={confirmState}
              busy={false}
              onCancel={() => setConfirmState(null)}
              onConfirm={() => {
                setConfirmState(null);
                void executeMerge();
              }}
            />,
            document.body
          )
        : null}

      {actorTextEditor && typeof document !== "undefined"
        ? createPortal(
            <ActorTextDialog
              item={items.find((item) => item.id === actorTextEditor.sceneId)}
              role={actorTextEditor.role}
              canEdit={canEdit}
              onClose={() => setActorTextEditor(null)}
              onChange={(text) => {
                const item = items.find((candidate) => candidate.id === actorTextEditor.sceneId);
                if (!item) return;
                const next = setActorCellState(item, actorTextEditor.role, text
                  ? { mode: "text", text }
                  : { mode: "empty", text: "" });
                onUpdate(item.id, { characters: next.characters, actorCells: next.actorCells });
              }}
            />,
            document.body
          )
        : null}
    </>
  );
}

type SceneNativeRowProps = {
  trProps: SceneReorderRowProps;
  item: ProjectSceneItem;
  index: number;
  actorRoles: string[];
  actorStyles: Array<ReturnType<typeof getActorStyle>>;
  locationStyle: PaletteStyle;
  mergeLayout: ReturnType<typeof buildSceneListMergeLayout>;
  resolvedSelection: SceneListResolvedCellRange | null;
  canEdit: boolean;
  hasMultipleScenes: boolean;
  hasPendingMutation: boolean;
  editingCell: { sceneId: string; column: SceneEditableColumn } | null;
  suppressClickRef: React.MutableRefObject<boolean>;
  suppressActorClickRef: React.MutableRefObject<boolean>;
  actorPointerCleanupRef: React.MutableRefObject<(() => void) | null>;
  onBeginSelection: (event: ReactPointerEvent<HTMLTableCellElement>, cell: SceneListMergeCell) => void;
  onMergeContextMenu: (event: React.MouseEvent<HTMLTableCellElement>, cell: SceneListMergeCell) => void;
  onEdit: (column: SceneEditableColumn) => void;
  onEditEnd: () => void;
  onUpdate: (id: string, patch: Partial<ProjectSceneItem>) => void;
  onSceneContextMenu: (event: React.MouseEvent<HTMLTableCellElement>) => void;
  onActorTextEdit: (role: string) => void;
  onCutValidationChange: (id: string, message: string) => void;
};

const SceneNativeRow = memo(function SceneNativeRow({
  trProps,
  item,
  index,
  actorRoles,
  actorStyles,
  locationStyle,
  mergeLayout,
  resolvedSelection,
  canEdit,
  hasMultipleScenes,
  hasPendingMutation,
  editingCell,
  suppressClickRef,
  suppressActorClickRef,
  actorPointerCleanupRef,
  onBeginSelection,
  onMergeContextMenu,
  onEdit,
  onEditEnd,
  onUpdate,
  onSceneContextMenu,
  onActorTextEdit,
  onCutValidationChange
}: SceneNativeRowProps) {
  const mergeCellGuideAnchorRef = useContextualGuideAnchor<HTMLTableCellElement>(
    canEdit && index === 0 ? "scene-list.merge-cell" : null
  );
  const mergeRangeGuideAnchorRef = useContextualGuideAnchor<HTMLTableCellElement>(
    canEdit && hasMultipleScenes && index === 0 ? "scene-list.merge-range-cell" : null
  );
  const sceneNumberGuideAnchorRef = useContextualGuideAnchor<HTMLTableCellElement>(
    canEdit && index === 0 ? "scene-list.scene-number" : null
  );
  const sceneReorderGuideAnchorRef = useContextualGuideAnchor<HTMLTableCellElement>(
    canEdit && hasMultipleScenes && index === 0 ? "scene-list.scene-reorder" : null
  );
  const actorCellGuideAnchorRef = useContextualGuideAnchor<HTMLButtonElement>(
    canEdit && index === 0 && actorRoles.length > 0 ? "scene-list.actor-cell" : null
  );
  const combinedMergeCellGuideAnchorRef = useCallback((element: HTMLTableCellElement | null) => {
    mergeCellGuideAnchorRef(element);
    mergeRangeGuideAnchorRef(element);
  }, [mergeCellGuideAnchorRef, mergeRangeGuideAnchorRef]);
  const combinedSceneNumberGuideAnchorRef = useCallback((element: HTMLTableCellElement | null) => {
    sceneNumberGuideAnchorRef(element);
    sceneReorderGuideAnchorRef(element);
  }, [sceneNumberGuideAnchorRef, sceneReorderGuideAnchorRef]);
  const isEditing = (column: SceneEditableColumn) => (
    editingCell?.sceneId === item.id && editingCell.column === column
  );

  const mergeCell = (
    column: ProjectSceneMergeColumn,
    value: string,
    patchKey: keyof ProjectSceneItem,
    style?: CSSProperties
  ) => {
    const state = getSceneListCellMergeState(mergeLayout, item.id, column);
    if (state?.kind === "covered") return null;
    const cell = { sceneId: item.id, column };
    const selected = isCellInResolvedRange(cell, resolvedSelection);
    const rowSpan = state?.kind === "anchor" ? state.rowSpan : 1;
    const colSpan = state?.kind === "anchor" ? state.colSpan : 1;
    const columnIndex = SCENE_LIST_MERGE_COLUMNS.indexOf(column);
    const selectionEdges = selected && resolvedSelection
      ? {
          top: index === resolvedSelection.rowStartIndex,
          right: columnIndex + colSpan - 1 === resolvedSelection.columnEndIndex,
          bottom: index + rowSpan - 1 === resolvedSelection.rowEndIndex,
          left: columnIndex === resolvedSelection.columnStartIndex
        }
      : null;
    const selectionShadows = selectionEdges
      ? [
          "inset 0 0 0 9999px rgba(213,255,64,.24)",
          selectionEdges.top ? "inset 0 2px rgba(17,17,17,.88)" : null,
          selectionEdges.right ? "inset -2px 0 rgba(17,17,17,.88)" : null,
          selectionEdges.bottom ? "inset 0 -2px rgba(17,17,17,.88)" : null,
          selectionEdges.left ? "inset 2px 0 rgba(17,17,17,.88)" : null
        ].filter(Boolean).join(", ")
      : undefined;
    const selectionRadius = selectionEdges
      ? [
          selectionEdges.top && selectionEdges.left ? "var(--radius-selection)" : "0",
          selectionEdges.top && selectionEdges.right ? "var(--radius-selection)" : "0",
          selectionEdges.bottom && selectionEdges.right ? "var(--radius-selection)" : "0",
          selectionEdges.bottom && selectionEdges.left ? "var(--radius-selection)" : "0"
        ].join(" ")
      : undefined;
    const columnKey = column as SceneEditableColumn;
    const editor = isEditing(columnKey);
    return (
      <td
        ref={column === "location" ? combinedMergeCellGuideAnchorRef : undefined}
        key={column}
        rowSpan={state?.kind === "anchor" ? rowSpan : undefined}
        colSpan={state?.kind === "anchor" ? colSpan : undefined}
        data-scene-merge-scene-id={item.id}
        data-scene-merge-column={column}
        aria-selected={selected || undefined}
        tabIndex={0}
        className="relative h-9 border-b border-r border-[#d6d6d6] bg-white p-0 align-middle outline-none"
        style={{
          ...style,
          borderRadius: selectionRadius,
          boxShadow: selectionShadows
        }}
        onPointerDown={(event) => onBeginSelection(event, cell)}
        onContextMenu={(event) => onMergeContextMenu(event, cell)}
        onClick={() => {
          if (!suppressClickRef.current && canEdit) onEdit(columnKey);
        }}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && event.key === "Enter" && canEdit) {
            onEdit(columnKey);
          }
        }}
      >
        {editor ? renderMergeEditor(column, value, item, patchKey, onUpdate, onEditEnd) : (
          <span className="block min-h-9 whitespace-normal break-words px-1.5 py-2 text-center font-semibold [overflow-wrap:anywhere]" title={value}>
            {value}
          </span>
        )}
      </td>
    );
  };

  return (
    <tr
      {...trProps}
      data-scene-item-id={item.id}
      className={`${trProps.className ?? ""} bg-white hover:bg-[#f7f7f7]`}
    >
      <td
        ref={combinedSceneNumberGuideAnchorRef}
        className={`relative h-9 border-b border-r border-[#d6d6d6] bg-white p-0 text-center align-middle ${
          canEdit ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        onContextMenu={onSceneContextMenu}
        onClick={() => {
          if (!suppressClickRef.current && canEdit) onEdit("sceneNo");
        }}
        title={canEdit ? "드래그하여 씬 순서 변경 · 우클릭하여 삭제" : undefined}
      >
        {isEditing("sceneNo") ? (
          <SceneListTextEditor
            autoFocus
            value={item.sceneNo}
            onChange={(value) => onUpdate(item.id, { sceneNo: value })}
            onEditEnd={onEditEnd}
            aria-label={`${index + 1}번째 씬 번호`}
            className={tableInputClass}
          />
        ) : (
          <span
            data-scene-reorder-handle={canEdit ? "" : undefined}
            className="inline-flex min-h-9 min-w-9 items-center justify-center px-1 py-2 font-bold"
          >
            {item.sceneNo || index + 1}
          </span>
        )}
      </td>

      {mergeCell("location", item.mainLocation, "mainLocation", {
        backgroundColor: locationStyle.background,
        color: locationStyle.color
      })}
      {mergeCell("subLocation", item.subLocation, "subLocation", {
        backgroundColor: locationStyle.background,
        color: locationStyle.color
      })}
      {mergeCell("day", item.dayLabel, "dayLabel")}
      {mergeCell("time", item.dayNight, "dayNight")}
      {mergeCell("intExt", item.interiorExterior, "interiorExterior")}

      <EditableTextCell
        value={item.sceneContent}
        ariaLabel={`${item.sceneNo || index + 1} Scene Content`}
        editing={isEditing("content")}
        canEdit={canEdit}
        multiline
        onEdit={() => onEdit("content")}
        onEditEnd={onEditEnd}
        onChange={(sceneContent) => onUpdate(item.id, { sceneContent })}
      />

      {actorRoles.length > 0 ? (
        <td
          colSpan={actorRoles.length}
          className="h-9 border-b border-r border-[#d6d6d6] bg-white p-0 align-middle"
        >
          <table className="h-full w-full table-fixed border-collapse" aria-label={`${item.sceneNo || index + 1} Scene Characters`}>
            <tbody>
              <tr>
                {actorRoles.map((role, actorIndex) => {
                  const state = getActorCellState(item, role);
                  const actorStyle = actorStyles[actorIndex] ?? getActorStyle(actorIndex);
                  return (
                    <td
                      key={role}
                      className={`h-9 p-0 text-center align-middle ${
                        actorIndex < actorRoles.length - 1 ? "border-r border-[#d6d6d6]" : ""
                      } ${item.characterNotes ? "border-b border-[#e1e1e1]" : ""}`}
                      style={{
                        backgroundColor: state.mode === "color" ? actorStyle.background : "#ffffff",
                        color: actorStyle.color
                      }}
                    >
                      <button
                        ref={actorIndex === 0 ? actorCellGuideAnchorRef : undefined}
                        type="button"
                        disabled={!canEdit}
                        className="h-full min-h-9 w-full touch-pan-y overflow-hidden px-1 text-[10px] font-bold disabled:cursor-default"
                        aria-label={`${item.sceneNo || index + 1} Scene ${role}`}
                        onClick={() => {
                          if (suppressActorClickRef.current) {
                            suppressActorClickRef.current = false;
                            return;
                          }
                          if (state.mode === "text") return;
                          const next = setActorCellState(item, role, state.mode === "color"
                            ? { mode: "empty", text: "" }
                            : { mode: "color", text: "" });
                          onUpdate(item.id, { characters: next.characters, actorCells: next.actorCells });
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onActorTextEdit(role);
                        }}
                        onPointerDown={(event) => {
                          if (event.pointerType !== "touch" || !canEdit) return;
                          actorPointerCleanupRef.current?.();
                          const pointerId = event.pointerId;
                          const startX = event.clientX;
                          const startY = event.clientY;
                          let didLongPress = false;
                          let timer: number | null = window.setTimeout(() => {
                            timer = null;
                            didLongPress = true;
                            suppressActorClickRef.current = true;
                            onActorTextEdit(role);
                            if (navigator.vibrate) navigator.vibrate(8);
                          }, 540);
                          const cleanup = () => {
                            if (timer !== null) window.clearTimeout(timer);
                            timer = null;
                            window.removeEventListener("pointermove", handleMove);
                            window.removeEventListener("pointerup", handlePointerUp);
                            window.removeEventListener("pointercancel", handlePointerCancel);
                            if (actorPointerCleanupRef.current === cleanup) {
                              actorPointerCleanupRef.current = null;
                            }
                          };
                          const handleMove = (moveEvent: PointerEvent) => {
                            if (moveEvent.pointerId !== pointerId) return;
                            if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 8) {
                              cleanup();
                            }
                          };
                          const handlePointerUp = (upEvent: PointerEvent) => {
                            if (upEvent.pointerId !== pointerId) return;
                            cleanup();
                            if (didLongPress) {
                              window.setTimeout(() => {
                                suppressActorClickRef.current = false;
                              }, 350);
                            }
                          };
                          const handlePointerCancel = (cancelEvent: PointerEvent) => {
                            if (cancelEvent.pointerId !== pointerId) return;
                            cleanup();
                            suppressActorClickRef.current = false;
                          };
                          actorPointerCleanupRef.current = cleanup;
                          window.addEventListener("pointermove", handleMove);
                          window.addEventListener("pointerup", handlePointerUp);
                          window.addEventListener("pointercancel", handlePointerCancel);
                        }}
                        title={state.mode === "text" ? state.text : undefined}
                      >
                        {state.mode === "text" ? state.text : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
              {item.characterNotes ? (
                <tr>
                  <td
                    colSpan={actorRoles.length}
                    data-scene-character-note-row-id={item.id}
                    aria-label={`Characters 세부 메모: ${item.characterNotes}`}
                    className="max-h-10 overflow-y-auto whitespace-pre-wrap bg-white px-1.5 py-1 text-left text-[9px] font-semibold leading-4 text-[#666] [overflow-wrap:anywhere]"
                  >
                    {item.characterNotes}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </td>
      ) : null}

      <td className="h-9 border-b border-r border-[#d6d6d6] bg-white p-0 align-middle">
        <SceneCutInput
          item={item}
          canEdit={canEdit}
          onChange={(cutCount) => onUpdate(item.id, { cutCount })}
          onValidationChange={(message) => onCutValidationChange(item.id, message)}
        />
      </td>
      <EditableTextCell
        value={item.props}
        ariaLabel={`${item.sceneNo || index + 1} Scene 메모`}
        editing={isEditing("memo")}
        canEdit={canEdit}
        multiline
        onEdit={() => onEdit("memo")}
        onEditEnd={onEditEnd}
        onChange={(props) => onUpdate(item.id, { props })}
      />
    </tr>
  );
}, areSceneNativeRowPropsEqual);

function areSceneNativeRowPropsEqual(
  previous: SceneNativeRowProps,
  next: SceneNativeRowProps
) {
  if (
    previous.item !== next.item
    || previous.index !== next.index
    || previous.actorRoles !== next.actorRoles
    || previous.actorStyles !== next.actorStyles
    || previous.canEdit !== next.canEdit
    || previous.hasMultipleScenes !== next.hasMultipleScenes
    || previous.hasPendingMutation !== next.hasPendingMutation
    || previous.locationStyle.background !== next.locationStyle.background
    || previous.locationStyle.color !== next.locationStyle.color
  ) {
    return false;
  }

  const previousEditingColumn = previous.editingCell?.sceneId === previous.item.id
    ? previous.editingCell.column
    : null;
  const nextEditingColumn = next.editingCell?.sceneId === next.item.id
    ? next.editingCell.column
    : null;
  if (previousEditingColumn !== nextEditingColumn) return false;

  for (const column of ["location", "subLocation", "day", "time", "intExt"] as const) {
    const previousState = getSceneListCellMergeState(previous.mergeLayout, previous.item.id, column);
    const nextState = getSceneListCellMergeState(next.mergeLayout, next.item.id, column);
    if (!sameMergeCellState(previousState, nextState)) return false;
    const cell = { sceneId: previous.item.id, column };
    const wasSelected = isCellInResolvedRange(cell, previous.resolvedSelection);
    const isSelected = isCellInResolvedRange(cell, next.resolvedSelection);
    if (wasSelected !== isSelected) {
      return false;
    }
    if (wasSelected && !sameResolvedSelectionBounds(previous.resolvedSelection, next.resolvedSelection)) return false;
  }

  const previousStyle = previous.trProps.style;
  const nextStyle = next.trProps.style;
  return (
    previous.trProps.className === next.trProps.className
    && previous.trProps["aria-grabbed"] === next.trProps["aria-grabbed"]
    && previous.trProps["data-scene-reorder-state"] === next.trProps["data-scene-reorder-state"]
    && previousStyle?.transform === nextStyle?.transform
    && previousStyle?.opacity === nextStyle?.opacity
    && previousStyle?.zIndex === nextStyle?.zIndex
    && previousStyle?.touchAction === nextStyle?.touchAction
  );
}

function sameResolvedSelectionBounds(
  previous: SceneListResolvedCellRange | null,
  next: SceneListResolvedCellRange | null
) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.rowStartIndex === next.rowStartIndex
    && previous.rowEndIndex === next.rowEndIndex
    && previous.columnStartIndex === next.columnStartIndex
    && previous.columnEndIndex === next.columnEndIndex;
}

function sameMergeCellState(
  previous: ReturnType<typeof getSceneListCellMergeState>,
  next: ReturnType<typeof getSceneListCellMergeState>
) {
  if (previous === next) return true;
  if (!previous || !next || previous.kind !== next.kind) return false;
  if (previous.merge.id !== next.merge.id) return false;
  if (previous.kind === "anchor" && next.kind === "anchor") {
    return previous.rowSpan === next.rowSpan && previous.colSpan === next.colSpan;
  }
  if (previous.kind === "covered" && next.kind === "covered") {
    return (
      previous.anchorSceneId === next.anchorSceneId
      && previous.anchorColumn === next.anchorColumn
    );
  }
  return false;
}

function renderMergeEditor(
  column: ProjectSceneMergeColumn,
  value: string,
  item: ProjectSceneItem,
  patchKey: keyof ProjectSceneItem,
  onUpdate: (id: string, patch: Partial<ProjectSceneItem>) => void,
  onEditEnd: () => void
) {
  if (column === "time" || column === "intExt") {
    const options = column === "time" ? ["D", "N"] : ["I", "E"];
    return (
      <select
        autoFocus
        value={value}
        onChange={(event) => onUpdate(item.id, { [patchKey]: event.target.value })}
        onBlur={onEditEnd}
        className={`${tableInputClass} appearance-none`}
        aria-label={`${item.sceneNo || "현재 씬"} ${column}`}
      >
        <option value="" />
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  return (
    <SceneListTextEditor
      autoFocus
      value={value}
      onChange={(nextValue) => onUpdate(item.id, { [patchKey]: nextValue })}
      onEditEnd={onEditEnd}
      className={tableInputClass}
      aria-label={`${item.sceneNo || "현재 씬"} ${column}`}
    />
  );
}

function EditableTextCell({
  value,
  ariaLabel,
  editing,
  canEdit,
  multiline,
  onEdit,
  onEditEnd,
  onChange
}: {
  value: string;
  ariaLabel: string;
  editing: boolean;
  canEdit: boolean;
  multiline?: boolean;
  onEdit: () => void;
  onEditEnd: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <td
      className="h-9 border-b border-r border-[#d6d6d6] bg-white p-0 align-middle"
      onClick={() => {
        if (canEdit && !editing) onEdit();
      }}
    >
      {editing && canEdit ? (
        multiline ? (
          <SceneListTextEditor
            autoFocus
            multiline
            value={value}
            onChange={onChange}
            onEditEnd={onEditEnd}
            rows={Math.max(1, Math.min(5, value.split("\n").length))}
            aria-label={ariaLabel}
            className="block min-h-9 w-full resize-none border-0 bg-transparent px-1.5 py-2 text-left text-[12px] font-medium leading-5 text-[#151515] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#111111]"
          />
        ) : null
      ) : (
        <p className="min-h-9 whitespace-pre-wrap px-1.5 py-2 text-left font-medium leading-5 [overflow-wrap:anywhere]">
          {value}
        </p>
      )}
    </td>
  );
}

function SceneListTextEditor({
  value,
  onChange,
  onEditEnd,
  multiline = false,
  autoFocus,
  rows,
  className,
  "aria-label": ariaLabel
}: {
  value: string;
  onChange: (value: string) => void;
  onEditEnd: () => void;
  multiline?: boolean;
  autoFocus?: boolean;
  rows?: number;
  className?: string;
  "aria-label": string;
}) {
  const compositionActiveRef = useRef(false);
  const compositionJustEndedRef = useRef(false);
  const pendingEnterExitRef = useRef(false);
  const deferredBlurTimerRef = useRef<number | null>(null);
  const compositionBoundaryTimerRef = useRef<number | null>(null);

  const clearDeferredBlur = useCallback(() => {
    if (deferredBlurTimerRef.current == null) return;
    window.clearTimeout(deferredBlurTimerRef.current);
    deferredBlurTimerRef.current = null;
  }, []);

  const clearCompositionBoundary = useCallback(() => {
    if (compositionBoundaryTimerRef.current == null) return;
    window.clearTimeout(compositionBoundaryTimerRef.current);
    compositionBoundaryTimerRef.current = null;
  }, []);

  useEffect(() => () => {
    clearDeferredBlur();
    clearCompositionBoundary();
  }, [clearCompositionBoundary, clearDeferredBlur]);

  const deferBlurUntilFinalInput = useCallback((target: HTMLInputElement | HTMLTextAreaElement) => {
    clearDeferredBlur();
    deferredBlurTimerRef.current = window.setTimeout(() => {
      deferredBlurTimerRef.current = null;
      if (target.isConnected && document.activeElement === target) target.blur();
    }, 0);
  }, [clearDeferredBlur]);

  const handleCompositionStart = useCallback(() => {
    clearCompositionBoundary();
    compositionActiveRef.current = true;
    compositionJustEndedRef.current = false;
    pendingEnterExitRef.current = false;
  }, [clearCompositionBoundary]);

  const handleCompositionEnd = useCallback((event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    const result = resolveSceneListCompositionEnd(
      value,
      target.value,
      pendingEnterExitRef.current
    );
    compositionActiveRef.current = false;
    compositionJustEndedRef.current = true;
    clearCompositionBoundary();
    compositionBoundaryTimerRef.current = window.setTimeout(() => {
      compositionBoundaryTimerRef.current = null;
      compositionJustEndedRef.current = false;
    }, 0);

    // Some browser/IME combinations emit the final input after compositionend.
    // Capture the DOM's completed replacement value now; never append a key.
    if (result.replacementValue != null) onChange(result.replacementValue);

    if (!result.shouldExit) return;
    pendingEnterExitRef.current = false;
    deferBlurUntilFinalInput(target);
  }, [clearCompositionBoundary, deferBlurUntilFinalInput, onChange, value]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const action = getSceneListEditorKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      multiline,
      compositionActive: compositionActiveRef.current,
      compositionJustEnded: compositionJustEndedRef.current,
      nativeIsComposing: event.nativeEvent.isComposing,
      legacyKeyCode: event.nativeEvent.keyCode
    });

    if (action === "allow") return;

    // The focused editor owns Enter/Escape. This prevents the parent table cell
    // from reopening the editor while the same physical key is completing IME.
    event.stopPropagation();

    if (action === "ime-only") return;
    if (action === "defer-enter-exit") {
      pendingEnterExitRef.current = true;
      // Safari can expose only keyCode 229 after compositionend. In that case
      // there will be no later compositionend callback, so exit next task.
      if (!compositionActiveRef.current && !event.nativeEvent.isComposing) {
        pendingEnterExitRef.current = false;
        deferBlurUntilFinalInput(event.currentTarget);
      }
      return;
    }

    event.preventDefault();
    event.currentTarget.blur();
  }, [deferBlurUntilFinalInput, multiline]);

  const handleBlur = useCallback(() => {
    clearDeferredBlur();
    pendingEnterExitRef.current = false;
    onEditEnd();
  }, [clearDeferredBlur, onEditEnd]);

  const sharedProps = {
    autoFocus,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.currentTarget.value),
    onBlur: handleBlur,
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
    onKeyDown: handleKeyDown,
    "aria-label": ariaLabel,
    className
  };

  return multiline
    ? <textarea {...sharedProps} rows={rows} />
    : <input {...sharedProps} />;
}

function SceneTableHeader({
  label,
  description,
  style
}: {
  label: string;
  description?: string;
  style?: CSSProperties;
}) {
  return (
    <th
      scope="col"
      className="h-11 border-b border-r border-[#bebebe] bg-[#eeeeee] px-1 py-1 text-center align-middle"
      style={style}
    >
      <span className="block leading-4">{label}</span>
      {description ? <span className="block text-[9px] font-semibold leading-3">{description}</span> : null}
    </th>
  );
}

function SceneTableColGroup({ actorRoles }: { actorRoles: string[] }) {
  return (
    <colgroup>
      <col className="w-[70px]" />
      <col className="w-[105px]" />
      <col className="w-[128px]" />
      <col className="w-[68px]" />
      <col className="w-[54px]" />
      <col className="w-[60px]" />
      <col className="w-[380px]" />
      {actorRoles.map((role) => <col key={role} className="w-[72px]" />)}
      <col className="w-[66px]" />
      <col className="w-[156px]" />
    </colgroup>
  );
}

function SceneTableHeaderRow({
  actorRoles,
  actorStyles
}: {
  actorRoles: string[];
  actorStyles: Array<ReturnType<typeof getActorStyle>>;
}) {
  return (
    <tr>
      {[
        ["Scene", "씬"],
        ["Location", "대장소"],
        ["Sub-Location", "세부장소"],
        ["Day", ""],
        ["Time", "D/N"],
        ["Int/Ext", "I/E"],
        ["Content", "씬 내용"]
      ].map(([label, description]) => (
        <SceneTableHeader key={label} label={label} description={description} />
      ))}
      {actorRoles.map((role, index) => (
        <SceneTableHeader
          key={role}
          label={role}
          description="등장인물"
          style={{
            backgroundColor: actorStyles[index]?.headerBackground,
            color: actorStyles[index]?.color
          }}
        />
      ))}
      <SceneTableHeader label="Cut" description="총 컷수" />
      <SceneTableHeader label="메모" description="소품&특이사항" />
    </tr>
  );
}

function SceneMenuButton({
  children,
  disabled = false,
  onClick
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="workspace-button flex min-h-10 w-full items-center border-0 px-3 text-left text-xs font-bold transition-colors hover:bg-[#f0f0f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#111111] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function SceneConfirmDialog({
  state,
  busy,
  onCancel,
  onConfirm
}: {
  state: ConfirmState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      data-scene-floating-ui
      className="light-workspace scene-workspace fixed inset-0 z-[140] grid place-items-center bg-black/35 p-4"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="workspace-popup w-full max-w-sm border p-4 shadow-xl" role="alertdialog" aria-modal="true">
        <h2 className="text-sm font-black text-[#151515]">{state.title}</h2>
        <p className="mt-2 text-xs font-medium leading-5 text-[#555]">{state.description}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="workspace-button min-h-10 border px-3 text-xs font-bold"
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="workspace-primary-action min-h-10 border px-3 text-xs font-bold"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

function ActorTextDialog({
  item,
  role,
  canEdit,
  onClose,
  onChange
}: {
  item: ProjectSceneItem | undefined;
  role: string;
  canEdit: boolean;
  onClose: () => void;
  onChange: (text: string) => void;
}) {
  const current = item ? getActorCellState(item, role) : { mode: "empty" as const, text: "" };
  const text = current.mode === "text" ? current.text : "";
  return (
    <div
      data-scene-floating-ui
      data-scene-character-note-row-id={item?.id}
      className="light-workspace scene-workspace fixed inset-0 z-[130] grid place-items-center bg-black/25 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="workspace-popup w-full max-w-xs border p-3 shadow-xl" role="dialog" aria-modal="true">
        <p className="text-xs font-black">{role} · Scene {item?.sceneNo || "—"}</p>
        {canEdit ? (
          <input
            autoFocus
            value={text}
            maxLength={120}
            onChange={(event) => onChange(event.target.value)}
            placeholder="V.O. / 실루엣 / 대역"
            className="workspace-control mt-2 min-h-11 w-full border px-3 py-2 text-sm font-medium outline-none"
          />
        ) : <p className="mt-2 text-sm">{text || "등록된 메모가 없습니다."}</p>}
        <button type="button" onClick={onClose} className="workspace-primary-action mt-3 min-h-10 w-full border px-3 text-xs font-bold">
          완료
        </button>
      </div>
    </div>
  );
}

function SceneCutInput({
  item,
  canEdit,
  onChange,
  onValidationChange
}: {
  item: ProjectSceneItem;
  canEdit: boolean;
  onChange: (value: number | null) => void;
  onValidationChange: (message: string) => void;
}) {
  const formattedValue = item.cutCount == null ? "" : String(item.cutCount);
  const [draft, setDraft] = useState(formattedValue);
  const [validationMessage, setValidationMessage] = useState("");
  useEffect(() => {
    setDraft(formattedValue);
    setValidationMessage("");
    onValidationChange("");
  }, [formattedValue]);
  if (!canEdit) return <span className="block px-1 py-2 text-center font-bold">{formattedValue}</span>;
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={String(MAX_SCENE_CUT_COUNT).length}
        value={draft}
        aria-label={`${item.sceneNo || "현재 씬"} 총 컷수`}
        aria-invalid={Boolean(validationMessage)}
        className={`${tableInputClass} ${validationMessage ? "text-red-700 ring-1 ring-inset ring-red-600" : ""}`}
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
        <span className="absolute inset-x-0 bottom-0 text-center text-[8px] font-bold leading-3 text-red-700">
          0–{MAX_SCENE_CUT_COUNT}
        </span>
      ) : null}
    </div>
  );
}

function isCellInResolvedRange(
  cell: SceneListMergeCell,
  range: SceneListResolvedCellRange | null
) {
  return Boolean(range?.sceneIds.includes(cell.sceneId) && range.columns.includes(cell.column));
}

function useStableSceneIds(items: ProjectSceneItem[]) {
  const nextIds = items.map((item) => item.id);
  const stableIdsRef = useRef(nextIds);
  const previous = stableIdsRef.current;
  if (
    previous.length !== nextIds.length
    || previous.some((id, index) => id !== nextIds[index])
  ) {
    stableIdsRef.current = nextIds;
  }
  return stableIdsRef.current;
}

function isLocationMergeColumn(column: ProjectSceneMergeColumn) {
  return column === "location" || column === "subLocation";
}

function createClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `merge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clampFixedPosition(x: number, y: number, width: number, height: number) {
  const viewport = window.visualViewport;
  const leftEdge = viewport?.offsetLeft ?? 0;
  const topEdge = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  return {
    left: Math.max(leftEdge + 8, Math.min(x, leftEdge + viewportWidth - width - 8)),
    top: Math.max(topEdge + 8, Math.min(y + 8, topEdge + viewportHeight - height - 8))
  };
}

function closeSelectionAfterMutation(
  setSelection: React.Dispatch<React.SetStateAction<SceneListMergeSelection | null>>,
  setMenu: React.Dispatch<React.SetStateAction<CellMenuState | null>>,
  setConfirm: React.Dispatch<React.SetStateAction<ConfirmState | null>>
) {
  setSelection(null);
  setMenu(null);
  setConfirm(null);
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

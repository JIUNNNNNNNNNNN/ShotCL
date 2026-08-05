"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from "react";

const DEFAULT_LONG_PRESS_MS = 575;
const DEFAULT_MOVEMENT_TOLERANCE = 8;
const DEFAULT_EDGE_THRESHOLD = 72;
const DEFAULT_MAX_SCROLL_STEP = 10;

export type DailyPlanTimetableDragGhost = {
  rowKey: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type DailyPlanTimetableInsertion = {
  /** 드래그 중인 행을 제외한 배열에 삽입할 index입니다. */
  index: number;
  beforeRowKey: string | null;
  afterRowKey: string | null;
  /** viewport 기준 삽입선 위치입니다. */
  left: number;
  top: number;
  width: number;
};

export type DailyPlanTimetableInteractionState = {
  selectedRowKey: string | null;
  draggingRowKey: string | null;
  ghost: DailyPlanTimetableDragGhost | null;
  insertion: DailyPlanTimetableInsertion | null;
  isOverTrash: boolean;
};

export type DailyPlanTimetableReorder = {
  rowKey: string;
  insertionIndex: number;
  orderedRowKeys: string[];
};

export type DailyPlanTimetableDragEnd = {
  rowKey: string;
  outcome: "selected" | "reordered" | "trash" | "cancelled" | "unchanged";
};

export type UseDailyPlanTimetableInteractionOptions = {
  /** 현재 화면 순서의 stable row key 배열입니다. */
  rowKeys: string[];
  disabled?: boolean;
  trashRef?: RefObject<HTMLElement | null>;
  longPressMs?: number;
  movementTolerance?: number;
  edgeScrollThreshold?: number;
  maxScrollStep?: number;
  /** 같은 drag scope에 속한 행만 재정렬 후보로 제한할 때 사용합니다. */
  getRowScopeKey?: (rowKey: string) => string | null;
  /** 특정 행만 mutation 중인 경우 그 행의 새 gesture를 막습니다. */
  isRowDisabled?: (rowKey: string) => boolean;
  /** 현재 pointer 위치가 source scope 안의 유효한 drop 지점인지 판정합니다. */
  isDropAllowed?: (input: { rowKey: string; clientX: number; clientY: number }) => boolean;
  /** pointermove 상태 발행을 animation frame당 한 번으로 제한합니다. */
  throttleWithAnimationFrame?: boolean;
  onReorder: (change: DailyPlanTimetableReorder) => void;
  onTrashDrop: (rowKey: string) => void;
  onDragStart?: (rowKey: string) => void;
  onDragEnd?: (result: DailyPlanTimetableDragEnd) => void;
};

type PendingPress = {
  rowKey: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  row: HTMLElement;
  timerId: number;
};

type ActiveDrag = {
  rowKey: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  row: HTMLElement;
  originalRowKeys: string[];
  insertionIndex: number;
  isOverTrash: boolean;
  isDropAllowed: boolean;
  didMove: boolean;
  previousTouchAction: string;
  previousUserSelect: string;
  previousCursor: string;
};

type SuppressedClick = {
  rowKey: string;
  expiresAt: number;
};

const emptyState: DailyPlanTimetableInteractionState = {
  selectedRowKey: null,
  draggingRowKey: null,
  ghost: null,
  insertion: null,
  isOverTrash: false
};

/**
 * TIME TABLE 행 전체에 long-press 선택·drag를 연결합니다.
 *
 * pointerdown 단계에서는 기본 동작을 막지 않으므로 input/select/button의 짧은
 * click은 그대로 동작합니다. 설정 시간이 지난 뒤에만 pointer capture와
 * `touch-action: none`을 활성화하며, window listener를 capture fallback으로
 * 함께 사용합니다.
 */
export function useDailyPlanTimetableInteraction({
  rowKeys,
  disabled = false,
  trashRef,
  longPressMs = DEFAULT_LONG_PRESS_MS,
  movementTolerance = DEFAULT_MOVEMENT_TOLERANCE,
  edgeScrollThreshold = DEFAULT_EDGE_THRESHOLD,
  maxScrollStep = DEFAULT_MAX_SCROLL_STEP,
  getRowScopeKey,
  isRowDisabled,
  isDropAllowed,
  throttleWithAnimationFrame = false,
  onReorder,
  onTrashDrop,
  onDragStart,
  onDragEnd
}: UseDailyPlanTimetableInteractionOptions) {
  const [state, setState] = useState<DailyPlanTimetableInteractionState>(emptyState);
  const rowElementsRef = useRef(new Map<string, HTMLElement>());
  const rowRefCallbacksRef = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const rowKeysRef = useRef(rowKeys);
  const disabledRef = useRef(disabled);
  const pendingRef = useRef<PendingPress | null>(null);
  const activeRef = useRef<ActiveDrag | null>(null);
  const selectedRowKeyRef = useRef<string | null>(null);
  const suppressedClickRef = useRef<SuppressedClick | null>(null);
  const suppressClickTimerRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const publishFrameRef = useRef<number | null>(null);
  const finishingRef = useRef(false);
  const optionsRef = useRef({
    trashRef,
    longPressMs,
    movementTolerance,
    edgeScrollThreshold,
    maxScrollStep,
    getRowScopeKey,
    isRowDisabled,
    isDropAllowed,
    throttleWithAnimationFrame,
    onReorder,
    onTrashDrop,
    onDragStart,
    onDragEnd
  });

  rowKeysRef.current = rowKeys;
  disabledRef.current = disabled;
  optionsRef.current = {
    trashRef,
    longPressMs,
    movementTolerance,
    edgeScrollThreshold,
    maxScrollStep,
    getRowScopeKey,
    isRowDisabled,
    isDropAllowed,
    throttleWithAnimationFrame,
    onReorder,
    onTrashDrop,
    onDragStart,
    onDragEnd
  };

  const setSelectedRowKey = useCallback((rowKey: string | null) => {
    selectedRowKeyRef.current = rowKey;
    setState((current) => (
      current.selectedRowKey === rowKey
        ? current
        : { ...current, selectedRowKey: rowKey }
    ));
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }, []);

  const cancelScheduledPublish = useCallback(() => {
    if (publishFrameRef.current !== null) {
      window.cancelAnimationFrame(publishFrameRef.current);
      publishFrameRef.current = null;
    }
  }, []);

  const clearSuppressedClick = useCallback(() => {
    suppressedClickRef.current = null;
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = null;
    }
  }, []);

  const suppressNextClick = useCallback((rowKey: string) => {
    clearSuppressedClick();
    suppressedClickRef.current = { rowKey, expiresAt: Date.now() + 180 };
    suppressClickTimerRef.current = window.setTimeout(clearSuppressedClick, 220);
  }, [clearSuppressedClick]);

  const clearPendingPress = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    pendingRef.current = null;
  }, []);

  const restoreDraggedRow = useCallback((drag: ActiveDrag) => {
    drag.row.style.touchAction = drag.previousTouchAction;
    drag.row.style.userSelect = drag.previousUserSelect;
    drag.row.style.cursor = drag.previousCursor;
    try {
      if (drag.row.hasPointerCapture(drag.pointerId)) {
        drag.row.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Window listeners keep the session safe when pointer capture is unavailable.
    }
  }, []);

  const getTrashHit = useCallback((clientX: number, clientY: number) => {
    const trash = optionsRef.current.trashRef?.current;
    if (!trash) return false;
    const rect = trash.getBoundingClientRect();
    return clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom;
  }, []);

  const calculateInsertion = useCallback((drag: ActiveDrag) => {
    const remainingKeys = drag.originalRowKeys.filter((rowKey) => rowKey !== drag.rowKey);
    const candidates = remainingKeys.flatMap((rowKey) => {
      const element = rowElementsRef.current.get(rowKey);
      if (!element || element.getClientRects().length === 0) return [];
      return [{ rowKey, rect: element.getBoundingClientRect() }];
    });

    if (candidates.length === 0) {
      const rect = drag.row.getBoundingClientRect();
      return {
        index: 0,
        beforeRowKey: null,
        afterRowKey: null,
        left: rect.left,
        top: rect.top,
        width: rect.width
      } satisfies DailyPlanTimetableInsertion;
    }

    let visibleIndex = candidates.length;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (drag.latestY < candidate.rect.top + candidate.rect.height / 2) {
        visibleIndex = index;
        break;
      }
    }

    const beforeCandidate = candidates[visibleIndex] ?? null;
    const afterCandidate = visibleIndex > 0 ? candidates[visibleIndex - 1] : null;
    const insertionIndex = beforeCandidate
      ? remainingKeys.indexOf(beforeCandidate.rowKey)
      : remainingKeys.length;
    const firstRect = candidates[0].rect;
    const lastRect = candidates[candidates.length - 1].rect;
    const top = beforeCandidate?.rect.top ?? lastRect.bottom;

    return {
      index: Math.max(0, insertionIndex),
      beforeRowKey: beforeCandidate?.rowKey ?? null,
      afterRowKey: afterCandidate?.rowKey ?? null,
      left: Math.min(firstRect.left, lastRect.left),
      top,
      width: Math.max(firstRect.right, lastRect.right) - Math.min(firstRect.left, lastRect.left)
    } satisfies DailyPlanTimetableInsertion;
  }, []);

  const publishActiveDrag = useCallback((drag: ActiveDrag) => {
    const isOverTrash = getTrashHit(drag.latestX, drag.latestY);
    drag.isOverTrash = isOverTrash;
    const isDropAllowed = !isOverTrash && (
      optionsRef.current.isDropAllowed?.({
        rowKey: drag.rowKey,
        clientX: drag.latestX,
        clientY: drag.latestY
      }) ?? true
    );
    drag.isDropAllowed = isDropAllowed;
    const insertion = isDropAllowed ? calculateInsertion(drag) : null;
    if (insertion) drag.insertionIndex = insertion.index;

    setState({
      selectedRowKey: drag.rowKey,
      draggingRowKey: drag.rowKey,
      ghost: {
        rowKey: drag.rowKey,
        left: drag.latestX - drag.offsetX,
        top: drag.latestY - drag.offsetY,
        width: drag.width,
        height: drag.height
      },
      insertion,
      isOverTrash
    });
  }, [calculateInsertion, getTrashHit]);

  const scheduleActiveDragPublish = useCallback((drag: ActiveDrag) => {
    if (!optionsRef.current.throttleWithAnimationFrame) {
      publishActiveDrag(drag);
      return;
    }
    if (publishFrameRef.current !== null) return;
    publishFrameRef.current = window.requestAnimationFrame(() => {
      publishFrameRef.current = null;
      if (activeRef.current === drag) publishActiveDrag(drag);
    });
  }, [publishActiveDrag]);

  const getAutoScrollDelta = useCallback((clientY: number) => {
    const visualViewport = window.visualViewport;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const viewportBottom = viewportTop + viewportHeight;
    const threshold = Math.max(24, optionsRef.current.edgeScrollThreshold);
    const maxStep = Math.max(1, optionsRef.current.maxScrollStep);

    if (clientY < viewportTop + threshold) {
      const strength = Math.min(1, (viewportTop + threshold - clientY) / threshold);
      return -Math.max(1, Math.round(maxStep * strength));
    }
    if (clientY > viewportBottom - threshold) {
      const strength = Math.min(1, (clientY - (viewportBottom - threshold)) / threshold);
      return Math.max(1, Math.round(maxStep * strength));
    }
    return 0;
  }, []);

  const runAutoScroll = useCallback(() => {
    autoScrollFrameRef.current = null;
    const drag = activeRef.current;
    if (!drag) return;
    const delta = getAutoScrollDelta(drag.latestY);
    if (delta === 0) return;

    const before = window.scrollY;
    window.scrollBy({ top: delta, left: 0, behavior: "auto" });
    if (window.scrollY === before) return;
    publishActiveDrag(drag);
    autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
  }, [getAutoScrollDelta, publishActiveDrag]);

  const ensureAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) return;
    if (!activeRef.current || getAutoScrollDelta(activeRef.current.latestY) === 0) return;
    autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
  }, [getAutoScrollDelta, runAutoScroll]);

  const endActiveDrag = useCallback((mode: "drop" | "cancel") => {
    const drag = activeRef.current;
    if (!drag || finishingRef.current) return;
    finishingRef.current = true;
    activeRef.current = null;
    cancelScheduledPublish();
    stopAutoScroll();
    restoreDraggedRow(drag);

    let outcome: DailyPlanTimetableDragEnd["outcome"] = "cancelled";
    if (mode === "drop") {
      if (drag.isOverTrash) {
        optionsRef.current.onTrashDrop(drag.rowKey);
        outcome = "trash";
      } else if (drag.didMove) {
        if (drag.isDropAllowed) {
          const remainingKeys = drag.originalRowKeys.filter((rowKey) => rowKey !== drag.rowKey);
          const insertionIndex = Math.max(0, Math.min(drag.insertionIndex, remainingKeys.length));
          const orderedRowKeys = [...remainingKeys];
          orderedRowKeys.splice(insertionIndex, 0, drag.rowKey);
          if (!areStringArraysEqual(orderedRowKeys, drag.originalRowKeys)) {
            optionsRef.current.onReorder({ rowKey: drag.rowKey, insertionIndex, orderedRowKeys });
            outcome = "reordered";
          } else {
            outcome = "unchanged";
          }
        } else {
          outcome = "unchanged";
        }
      } else {
        outcome = "selected";
      }
    }

    // A long press must never be followed by the input/select/button click.
    suppressNextClick(drag.rowKey);
    if (outcome === "selected") {
      setSelectedRowKey(drag.rowKey);
      setState({ ...emptyState, selectedRowKey: drag.rowKey });
    } else {
      setSelectedRowKey(null);
      setState(emptyState);
    }
    optionsRef.current.onDragEnd?.({ rowKey: drag.rowKey, outcome });
    finishingRef.current = false;
  }, [cancelScheduledPublish, restoreDraggedRow, setSelectedRowKey, stopAutoScroll, suppressNextClick]);

  const cancelInteraction = useCallback((clearSelection = true) => {
    clearPendingPress();
    if (activeRef.current) endActiveDrag("cancel");
    if (clearSelection) {
      setSelectedRowKey(null);
      setState(emptyState);
    }
  }, [clearPendingPress, endActiveDrag, setSelectedRowKey]);

  const activatePendingPress = useCallback((press: PendingPress) => {
    if (
      disabledRef.current
      || optionsRef.current.isRowDisabled?.(press.rowKey)
      || pendingRef.current !== press
      || activeRef.current
    ) return;
    pendingRef.current = null;
    const rect = press.row.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && press.row.contains(activeElement)) activeElement.blur();
    window.getSelection()?.removeAllRanges();

    const allRowKeys = [...rowKeysRef.current];
    const sourceScopeKey = optionsRef.current.getRowScopeKey?.(press.rowKey);
    const originalRowKeys = optionsRef.current.getRowScopeKey
      ? allRowKeys.filter((rowKey) => optionsRef.current.getRowScopeKey?.(rowKey) === sourceScopeKey)
      : allRowKeys;
    const originalIndex = Math.max(0, originalRowKeys.indexOf(press.rowKey));
    const drag: ActiveDrag = {
      rowKey: press.rowKey,
      pointerId: press.pointerId,
      pointerType: press.pointerType,
      startX: press.startX,
      startY: press.startY,
      latestX: press.latestX,
      latestY: press.latestY,
      offsetX: press.latestX - rect.left,
      offsetY: press.latestY - rect.top,
      width: rect.width,
      height: rect.height,
      row: press.row,
      originalRowKeys,
      insertionIndex: Math.min(originalIndex, Math.max(0, originalRowKeys.length - 1)),
      isOverTrash: false,
      isDropAllowed: true,
      didMove: false,
      previousTouchAction: press.row.style.touchAction,
      previousUserSelect: press.row.style.userSelect,
      previousCursor: press.row.style.cursor
    };

    press.row.style.touchAction = "none";
    press.row.style.userSelect = "none";
    press.row.style.cursor = "grabbing";
    try {
      press.row.setPointerCapture(press.pointerId);
    } catch {
      // iOS versions without reliable capture continue through the window listeners.
    }

    activeRef.current = drag;
    selectedRowKeyRef.current = press.rowKey;
    publishActiveDrag(drag);
    optionsRef.current.onDragStart?.(press.rowKey);
  }, [publishActiveDrag]);

  const assignRow = useCallback((rowKey: string, element: HTMLElement | null) => {
    if (element) {
      rowElementsRef.current.set(rowKey, element);
      return;
    }
    rowElementsRef.current.delete(rowKey);
    if (pendingRef.current?.rowKey === rowKey) clearPendingPress();
    if (activeRef.current?.rowKey === rowKey) cancelInteraction();
    else if (selectedRowKeyRef.current === rowKey) setSelectedRowKey(null);
  }, [cancelInteraction, clearPendingPress, setSelectedRowKey]);

  /** `ref={interaction.registerRow(rowKey)}` 형태로 사용합니다. */
  const registerRow = useCallback((rowKey: string) => {
    const existing = rowRefCallbacksRef.current.get(rowKey);
    if (existing) return existing;
    const callback = (element: HTMLElement | null) => assignRow(rowKey, element);
    rowRefCallbacksRef.current.set(rowKey, callback);
    return callback;
  }, [assignRow]);

  const onRowPointerDownCapture = useCallback((
    rowKey: string,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (
      disabledRef.current
      || optionsRef.current.isRowDisabled?.(rowKey)
      || !event.isPrimary
      || event.button !== 0
      || activeRef.current
    ) return;
    const row = rowElementsRef.current.get(rowKey) ?? event.currentTarget;
    clearPendingPress();

    const press: PendingPress = {
      rowKey,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
      row,
      timerId: 0
    };
    press.timerId = window.setTimeout(
      () => activatePendingPress(press),
      Math.max(0, optionsRef.current.longPressMs)
    );
    pendingRef.current = press;
    // Deliberately no preventDefault/stopPropagation/pointer capture here.
  }, [activatePendingPress, clearPendingPress]);

  const onRowClickCapture = useCallback((rowKey: string, event: ReactMouseEvent<HTMLElement>) => {
    const suppressed = suppressedClickRef.current;
    if (!suppressed || suppressed.rowKey !== rowKey || suppressed.expiresAt < Date.now()) return;
    event.preventDefault();
    event.stopPropagation();
    clearSuppressedClick();
  }, [clearSuppressedClick]);

  const onRowContextMenu = useCallback((rowKey: string, event: ReactMouseEvent<HTMLElement>) => {
    if (
      pendingRef.current?.rowKey === rowKey
      || activeRef.current?.rowKey === rowKey
      || suppressedClickRef.current?.rowKey === rowKey
    ) {
      event.preventDefault();
    }
  }, []);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const pending = pendingRef.current;
      if (pending?.pointerId === event.pointerId) {
        pending.latestX = event.clientX;
        pending.latestY = event.clientY;
        if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) > optionsRef.current.movementTolerance) {
          clearPendingPress();
        }
        return;
      }

      const drag = activeRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.cancelable) event.preventDefault();
      drag.latestX = event.clientX;
      drag.latestY = event.clientY;
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 2) drag.didMove = true;
      scheduleActiveDragPublish(drag);
      if (getAutoScrollDelta(drag.latestY) === 0) stopAutoScroll();
      else ensureAutoScroll();
    }

    function handlePointerUp(event: PointerEvent) {
      if (pendingRef.current?.pointerId === event.pointerId) {
        clearPendingPress();
        return;
      }
      const drag = activeRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.cancelable) event.preventDefault();
      drag.latestX = event.clientX;
      drag.latestY = event.clientY;
      drag.isOverTrash = getTrashHit(event.clientX, event.clientY);
      cancelScheduledPublish();
      publishActiveDrag(drag);
      endActiveDrag("drop");
    }

    function handlePointerCancel(event: PointerEvent) {
      if (pendingRef.current?.pointerId === event.pointerId) clearPendingPress();
      if (activeRef.current?.pointerId === event.pointerId) endActiveDrag("cancel");
    }

    function handleTouchMove(event: TouchEvent) {
      // iOS Safari can keep the scroll gesture that started before the
      // long-press was activated. Block it only while an actual row drag is
      // active; ordinary timetable taps and page scrolling remain native.
      if (activeRef.current && event.cancelable) event.preventDefault();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && (pendingRef.current || activeRef.current || selectedRowKeyRef.current)) {
        event.preventDefault();
        cancelInteraction();
      }
    }

    function handleOutsidePointerDown(event: PointerEvent) {
      if (activeRef.current || pendingRef.current || !selectedRowKeyRef.current) return;
      const selectedRow = rowElementsRef.current.get(selectedRowKeyRef.current);
      if (!selectedRow?.contains(event.target as Node)) setSelectedRowKey(null);
    }

    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerUp, { capture: true, passive: false });
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("touchmove", handleTouchMove, { capture: true, passive: false });
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("touchmove", handleTouchMove, true);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      cancelInteraction();
      clearSuppressedClick();
      cancelScheduledPublish();
      stopAutoScroll();
    };
  }, [cancelInteraction, cancelScheduledPublish, clearPendingPress, clearSuppressedClick, endActiveDrag, ensureAutoScroll, getAutoScrollDelta, getTrashHit, publishActiveDrag, scheduleActiveDragPublish, setSelectedRowKey, stopAutoScroll]);

  useEffect(() => {
    if (disabled) cancelInteraction();
  }, [cancelInteraction, disabled]);

  return {
    ...state,
    isDragging: state.draggingRowKey !== null,
    registerRow,
    onRowPointerDownCapture,
    onRowClickCapture,
    onRowContextMenu,
    clearSelection: () => cancelInteraction()
  };
}

function areStringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

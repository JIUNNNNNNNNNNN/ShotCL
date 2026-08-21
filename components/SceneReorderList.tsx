"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefCallback
} from "react";
import type { ProjectSceneItem } from "@/lib/types";

type DragState = {
  itemId: string;
  pointerId: number;
  phase: "armed" | "dragging";
  startY: number;
  currentY: number;
  targetId: string;
  insertAfter: boolean;
};

type PendingDrag = {
  itemId: string;
  pointerId: number;
  startX: number;
  startY: number;
  captureTarget: HTMLTableRowElement;
  timer: number | null;
};

type RowDropMetric = {
  itemId: string;
  centerY: number;
};

export type SceneReorderCommitResult =
  | void
  | {
      ok: boolean;
      message?: string;
    };

export type SceneReorderRowProps = {
  ref: RefCallback<HTMLTableRowElement>;
  onPointerDown: (event: ReactPointerEvent<HTMLTableRowElement>) => void;
  onClickCapture: (event: React.MouseEvent<HTMLTableRowElement>) => void;
  onContextMenuCapture: (event: React.MouseEvent<HTMLTableRowElement>) => void;
  className: string;
  style: CSSProperties;
  "aria-grabbed": boolean;
  "data-scene-reorder-state": "idle" | "armed" | "dragging" | "drop-target";
};

export type SceneReorderRenderState = {
  trProps: SceneReorderRowProps;
  isArmed: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  insertAfter: boolean;
};

const sceneReorderHoldMs = 700;
const preHoldMovementTolerancePx = 8;
const activeDragMovementThresholdPx = 3;
const reorderIgnoredTargetSelector = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[data-scene-reorder-ignore]"
].join(",");

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "씬 순서를 변경하지 못했습니다.";
}

function reorderedItems(
  items: ProjectSceneItem[],
  sourceId: string,
  targetId: string,
  insertAfter: boolean
) {
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceId === targetId) return items;

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  let insertIndex = next.findIndex((item) => item.id === targetId);
  if (insertIndex < 0) insertIndex = next.length;
  if (insertAfter) insertIndex += 1;
  next.splice(insertIndex, 0, moved);

  const changed = next.some((item, index) => item.id !== items[index]?.id);
  return changed ? next : items;
}

function restorePreviousStableIdOrder(
  latestItems: ProjectSceneItem[],
  previousItems: ProjectSceneItem[]
) {
  const previousIds = new Set(previousItems.map((item) => item.id));
  const latestById = new Map(latestItems.map((item) => [item.id, item]));
  const survivingPrevious = previousItems
    .map((item) => latestById.get(item.id))
    .filter((item): item is ProjectSceneItem => Boolean(item));
  let previousCursor = 0;

  return latestItems.map((item) => {
    if (!previousIds.has(item.id)) return item;
    const restored = survivingPrevious[previousCursor];
    previousCursor += 1;
    return restored ?? item;
  });
}

export function SceneReorderList({
  items,
  disabled,
  fitScale = 1,
  onReorder,
  validateReorder,
  onCommit,
  onCommitError,
  renderRow,
  className
}: {
  items: ProjectSceneItem[];
  disabled: boolean;
  fitScale?: number;
  onReorder: (items: ProjectSceneItem[]) => void;
  validateReorder?: (
    nextItems: ProjectSceneItem[],
    previousItems: ProjectSceneItem[]
  ) => SceneReorderCommitResult;
  onCommit?: (
    nextItems: ProjectSceneItem[],
    previousItems: ProjectSceneItem[]
  ) => Promise<SceneReorderCommitResult>;
  onCommitError?: (message: string) => void;
  renderRow: (
    item: ProjectSceneItem,
    index: number,
    state: SceneReorderRenderState
  ) => ReactNode;
  className?: string;
}) {
  const itemsRef = useRef(items);
  const disabledRef = useRef(disabled);
  const onReorderRef = useRef(onReorder);
  const validateReorderRef = useRef(validateReorder);
  const onCommitRef = useRef(onCommit);
  const onCommitErrorRef = useRef(onCommitError);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const rowDropMetricsRef = useRef<RowDropMetric[]>([]);
  const pendingRef = useRef<PendingDrag | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragAnimationFrameRef = useRef<number | null>(null);
  const removePointerListenersRef = useRef<(() => void) | null>(null);
  const committingRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const safeFitScale = Number.isFinite(fitScale) && fitScale > 0
    ? Math.min(1, Math.max(0.01, fitScale))
    : 1;

  itemsRef.current = items;
  disabledRef.current = disabled;
  onReorderRef.current = onReorder;
  validateReorderRef.current = validateReorder;
  onCommitRef.current = onCommit;
  onCommitErrorRef.current = onCommitError;

  useEffect(
    () => () => {
      const pending = pendingRef.current;
      if (pending?.timer !== null && pending?.timer !== undefined) {
        window.clearTimeout(pending.timer);
      }
      if (pending) releasePointerCapture(pending);
      removePointerListenersRef.current?.();
      removePointerListenersRef.current = null;
      if (dragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(dragAnimationFrameRef.current);
        dragAnimationFrameRef.current = null;
      }
      pendingRef.current = null;
      dragRef.current = null;
      rowDropMetricsRef.current = [];
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
    },
    []
  );

  function armDrag(pending: PendingDrag) {
    if (
      pendingRef.current !== pending
      || disabledRef.current
      || committingRef.current
    ) {
      if (pendingRef.current === pending) clearPending();
      return;
    }
    pending.timer = null;
    try {
      pending.captureTarget.setPointerCapture(pending.pointerId);
    } catch {
      // Window listeners below keep the active drag alive when capture is unavailable.
    }
    rowDropMetricsRef.current = itemsRef.current.flatMap((item) => {
      const row = rowRefs.current.get(item.id);
      if (!row) return [];
      const rect = row.getBoundingClientRect();
      return [{ itemId: item.id, centerY: rect.top + window.scrollY + rect.height / 2 }];
    });
    const next: DragState = {
      itemId: pending.itemId,
      pointerId: pending.pointerId,
      phase: "armed",
      startY: pending.startY,
      currentY: pending.startY,
      targetId: pending.itemId,
      insertAfter: false
    };
    dragRef.current = next;
    setDrag(next);
    suppressClickRef.current = true;
    window.getSelection()?.removeAllRanges();
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
  }

  function updateDrag(clientY: number, pageY: number) {
    const current = dragRef.current;
    if (!current) return;
    const target = findClosestRowDropMetric(rowDropMetricsRef.current, pageY);
    const targetId = target?.itemId ?? current.itemId;
    const insertAfter = target ? pageY >= target.centerY : false;

    const next: DragState = {
      ...current,
      phase: "dragging",
      currentY: clientY,
      targetId,
      insertAfter
    };
    dragRef.current = next;
    if (dragAnimationFrameRef.current === null) {
      dragAnimationFrameRef.current = window.requestAnimationFrame(() => {
        dragAnimationFrameRef.current = null;
        setDrag(dragRef.current);
      });
    }
  }

  function clearPending() {
    const pending = pendingRef.current;
    if (pending?.timer !== null && pending?.timer !== undefined) {
      window.clearTimeout(pending.timer);
    }
    pendingRef.current = null;
  }

  function resetDragVisuals() {
    clearPending();
    if (dragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAnimationFrameRef.current);
      dragAnimationFrameRef.current = null;
    }
    dragRef.current = null;
    rowDropMetricsRef.current = [];
    setDrag(null);
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
  }

  function finishDrag() {
    const current = dragRef.current;
    const previousItems = itemsRef.current;
    resetDragVisuals();
    if (!current || current.phase !== "dragging") return;

    const nextItems = reorderedItems(
      previousItems,
      current.itemId,
      current.targetId,
      current.insertAfter
    );
    if (nextItems === previousItems) return;

    const validation = validateReorderRef.current?.(nextItems, previousItems);
    if (validation && !validation.ok) {
      onCommitErrorRef.current?.(validation.message || "씬 순서를 변경하지 못했습니다.");
      return;
    }

    // The list updates immediately. A failed server commit restores the exact
    // stable-id order that existed before this drag.
    onReorderRef.current(nextItems);
    const commit = onCommitRef.current;
    if (!commit) return;

    committingRef.current = true;
    void Promise.resolve()
      .then(() => commit(nextItems, previousItems))
      .then((result) => {
        if (result && !result.ok) {
          throw new Error(result.message || "씬 순서를 변경하지 못했습니다.");
        }
      })
      .catch((error: unknown) => {
        // Restore the previous order only for rows that still exist. New rows
        // stay present, deleted rows stay deleted, and the latest cell values survive.
        onReorderRef.current(restorePreviousStableIdOrder(itemsRef.current, previousItems));
        onCommitErrorRef.current?.(getErrorMessage(error));
      })
      .finally(() => {
        committingRef.current = false;
      });
  }

  function releasePointerCapture(pending: PendingDrag) {
    try {
      if (pending.captureTarget.hasPointerCapture(pending.pointerId)) {
        pending.captureTarget.releasePointerCapture(pending.pointerId);
      }
    } catch {
      // The browser may already have released capture after pointercancel.
    }
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLTableRowElement>,
    itemId: string
  ) {
    if (
      disabledRef.current ||
      committingRef.current ||
      event.button !== 0 ||
      !event.isPrimary ||
      pendingRef.current ||
      dragRef.current ||
      isReorderIgnoredTarget(event.target)
    ) {
      return;
    }

    const pending: PendingDrag = {
      itemId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      captureTarget: event.currentTarget,
      timer: null
    };
    pendingRef.current = pending;

    const removePointerListeners = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("touchmove", preventActiveTouchScroll);
      if (removePointerListenersRef.current === removePointerListeners) {
        removePointerListenersRef.current = null;
      }
    };

    const completePointerInteraction = (wasCancelled: boolean) => {
      removePointerListeners();
      releasePointerCapture(pending);
      if (wasCancelled) resetDragVisuals();
      else if (dragRef.current) finishDrag();
      else clearPending();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pending.pointerId) return;
      const distance = Math.hypot(
        moveEvent.clientX - pending.startX,
        moveEvent.clientY - pending.startY
      );

      if (!dragRef.current) {
        // Native click, text-selection and touch scrolling retain ownership
        // unless the pointer remains stationary through the full hold.
        if (distance > preHoldMovementTolerancePx) {
          completePointerInteraction(true);
        }
        return;
      }

      if (dragRef.current) {
        if (
          dragRef.current.phase === "armed"
          && distance < activeDragMovementThresholdPx
        ) {
          return;
        }
        moveEvent.preventDefault();
        updateDrag(moveEvent.clientY, moveEvent.pageY);
      }
    };

    const handlePointerUp = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pending.pointerId) return;
      completePointerInteraction(false);
    };

    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pending.pointerId) return;
      completePointerInteraction(true);
    };

    const preventActiveTouchScroll = (touchEvent: TouchEvent) => {
      if (dragRef.current?.pointerId === pending.pointerId) touchEvent.preventDefault();
    };

    removePointerListenersRef.current = removePointerListeners;
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("touchmove", preventActiveTouchScroll, { passive: false });
    pending.timer = window.setTimeout(() => armDrag(pending), sceneReorderHoldMs);
  }

  return (
    <tbody className={className}>
      {items.map((item, index) => {
        const isActive = drag?.itemId === item.id;
        const isArmed = Boolean(isActive && drag?.phase === "armed");
        const isDragging = Boolean(isActive && drag?.phase === "dragging");
        const isDropTarget = Boolean(
          drag?.phase === "dragging" && drag.targetId === item.id && !isActive
        );
        const insertAfter = Boolean(isDropTarget && drag?.insertAfter);
        const indicatorClass = isDropTarget
          ? insertAfter
            ? "[&>td]:!border-b-2 [&>td]:!border-b-field-primary"
            : "[&>td]:!border-t-2 [&>td]:!border-t-field-primary"
          : "";
        const trProps: SceneReorderRowProps = {
          ref: (node) => {
            if (node) rowRefs.current.set(item.id, node);
            else rowRefs.current.delete(item.id);
          },
          onClickCapture: (event) => {
            if (suppressClickRef.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          },
          onContextMenuCapture: (event) => {
            const pending = pendingRef.current;
            const active = dragRef.current;
            const isThisRowsPendingHold = pending?.itemId === item.id && !active;
            const isThisRowsArmedHold =
              pending?.itemId === item.id
              && active?.itemId === item.id
              && active.phase === "armed";
            if (!isThisRowsPendingHold && !isThisRowsArmedHold) return;
            // Safari may synthesize contextmenu before the stationary hold arms.
            // Suppress only this row's primary hold lifecycle; ordinary right-click
            // still reaches the Scene Number delete menu when no hold is pending.
            event.preventDefault();
            event.stopPropagation();
          },
          onPointerDown: (event) => handlePointerDown(event, item.id),
          className: `relative ${indicatorClass} ${
            isActive
              ? "[&_*]:!cursor-grabbing [&>td]:brightness-[0.98] [&>td]:shadow-[inset_0_0_0_1px_#9bb91c]"
              : ""
          }`,
          style: {
            transform: isDragging
              ? `translateY(${((drag?.currentY ?? 0) - (drag?.startY ?? 0)) / safeFitScale}px)`
              : undefined,
            opacity: isActive ? 0.82 : 1,
            zIndex: isActive ? 20 : undefined,
            touchAction: isActive ? "none" : undefined,
            cursor: isActive ? "grabbing" : undefined
          },
          "aria-grabbed": Boolean(isActive),
          "data-scene-reorder-state": isArmed
            ? "armed"
            : isDragging
            ? "dragging"
            : isDropTarget
              ? "drop-target"
              : "idle"
        };
        return (
          <Fragment key={item.id}>
            {renderRow(item, index, {
              trProps,
              isArmed,
              isDragging,
              isDropTarget,
              insertAfter
            })}
          </Fragment>
        );
      })}
    </tbody>
  );
}

function isReorderIgnoredTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(reorderIgnoredTargetSelector));
}

function findClosestRowDropMetric(metrics: RowDropMetric[], clientY: number) {
  if (metrics.length === 0) return null;
  let low = 0;
  let high = metrics.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((metrics[middle]?.centerY ?? Number.POSITIVE_INFINITY) < clientY) low = middle + 1;
    else high = middle;
  }
  const after = metrics[Math.min(low, metrics.length - 1)];
  const before = metrics[Math.max(0, low - 1)];
  if (!before) return after ?? null;
  if (!after) return before;
  return Math.abs(clientY - before.centerY) <= Math.abs(clientY - after.centerY)
    ? before
    : after;
}

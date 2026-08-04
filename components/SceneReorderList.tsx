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
  startY: number;
  currentY: number;
  targetId: string;
  insertAfter: boolean;
};

type PendingDrag = {
  itemId: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  captureTarget: HTMLTableRowElement;
  timer: number | null;
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
  className: string;
  style: CSSProperties;
  "aria-grabbed": boolean;
  "data-scene-reorder-state": "idle" | "dragging" | "drop-target";
};

export type SceneReorderRenderState = {
  trProps: SceneReorderRowProps;
  isDragging: boolean;
  isDropTarget: boolean;
  insertAfter: boolean;
};

const interactiveSelector = "input, textarea, select, button, a, [role='button']";
const sceneReorderHandleSelector = "[data-scene-reorder-handle]";
const mobileLongPressMs = 480;

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
  onReorder,
  validateReorder,
  onCommit,
  onCommitError,
  renderRow,
  className
}: {
  items: ProjectSceneItem[];
  disabled: boolean;
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
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const pendingRef = useRef<PendingDrag | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const removePointerListenersRef = useRef<(() => void) | null>(null);
  const committingRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const suppressClickRef = useRef(false);

  itemsRef.current = items;

  useEffect(
    () => () => {
      const pending = pendingRef.current;
      if (pending?.timer) window.clearTimeout(pending.timer);
      removePointerListenersRef.current?.();
      removePointerListenersRef.current = null;
      pendingRef.current = null;
      dragRef.current = null;
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
    },
    []
  );

  function beginDrag(pending: PendingDrag) {
    if (pendingRef.current !== pending) return;
    const next: DragState = {
      itemId: pending.itemId,
      pointerId: pending.pointerId,
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

  function updateDrag(clientY: number) {
    const current = dragRef.current;
    if (!current) return;
    let targetId = current.itemId;
    let insertAfter = false;
    let closestDistance = Number.POSITIVE_INFINITY;

    itemsRef.current.forEach((item) => {
      const row = rowRefs.current.get(item.id);
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const distance = Math.abs(clientY - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        targetId = item.id;
        insertAfter = clientY >= center;
      }
    });

    const next = { ...current, currentY: clientY, targetId, insertAfter };
    dragRef.current = next;
    setDrag(next);
  }

  function clearPending() {
    const pending = pendingRef.current;
    if (pending?.timer) window.clearTimeout(pending.timer);
    pendingRef.current = null;
  }

  function resetDragVisuals() {
    clearPending();
    dragRef.current = null;
    setDrag(null);
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
  }

  function finishDrag() {
    const current = dragRef.current;
    const previousItems = itemsRef.current;
    resetDragVisuals();
    if (!current) return;

    const nextItems = reorderedItems(
      previousItems,
      current.itemId,
      current.targetId,
      current.insertAfter
    );
    if (nextItems === previousItems) return;

    const validation = validateReorder?.(nextItems, previousItems);
    if (validation && !validation.ok) {
      onCommitError?.(validation.message || "씬 순서를 변경하지 못했습니다.");
      return;
    }

    // The list updates immediately. A failed server commit restores the exact
    // stable-id order that existed before this drag.
    onReorder(nextItems);
    if (!onCommit) return;

    committingRef.current = true;
    void Promise.resolve()
      .then(() => onCommit(nextItems, previousItems))
      .then((result) => {
        if (result && !result.ok) {
          throw new Error(result.message || "씬 순서를 변경하지 못했습니다.");
        }
      })
      .catch((error: unknown) => {
        // Restore the previous order only for rows that still exist. New rows
        // stay present, deleted rows stay deleted, and the latest cell values survive.
        onReorder(restorePreviousStableIdOrder(itemsRef.current, previousItems));
        onCommitError?.(getErrorMessage(error));
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
      disabled ||
      committingRef.current ||
      event.button !== 0 ||
      pendingRef.current ||
      dragRef.current
    ) {
      return;
    }

    const target = event.target as HTMLElement;
    const handle = target.closest(sceneReorderHandleSelector);
    if (!handle || !event.currentTarget.contains(handle)) return;
    if (target.closest(interactiveSelector)) return;

    const pending: PendingDrag = {
      itemId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      captureTarget: event.currentTarget,
      timer: null
    };
    pendingRef.current = pending;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window-level listeners below still keep the drag alive.
    }

    if (event.pointerType === "touch") {
      pending.timer = window.setTimeout(() => beginDrag(pending), mobileLongPressMs);
    }

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
        if (pending.pointerType === "touch") {
          // A normal swipe before the long-press threshold is not a reorder.
          if (distance > 10) {
            completePointerInteraction(true);
          }
          return;
        }
        if (distance > 4) beginDrag(pending);
      }

      if (dragRef.current) {
        moveEvent.preventDefault();
        updateDrag(moveEvent.clientY);
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
  }

  return (
    <tbody
      className={`${className ?? ""} [&_[data-scene-reorder-handle]]:touch-pan-y`}
    >
      {items.map((item, index) => {
        const isDragging = drag?.itemId === item.id;
        const isDropTarget = drag?.targetId === item.id && !isDragging;
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
          onPointerDown: (event) => handlePointerDown(event, item.id),
          onClickCapture: (event) => {
            if (suppressClickRef.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          },
          className: `relative ${indicatorClass}`,
          style: {
            transform: isDragging
              ? `translateY(${(drag?.currentY ?? 0) - (drag?.startY ?? 0)}px)`
              : undefined,
            opacity: isDragging ? 0.82 : 1,
            zIndex: isDragging ? 20 : undefined,
            touchAction: isDragging ? "none" : undefined
          },
          "aria-grabbed": isDragging,
          "data-scene-reorder-state": isDragging
            ? "dragging"
            : isDropTarget
              ? "drop-target"
              : "idle"
        };

        return (
          <Fragment key={item.id}>
            {renderRow(item, index, {
              trProps,
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

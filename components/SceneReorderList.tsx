"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
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
  timer: number | null;
};

const interactiveSelector = "input, textarea, select, button, a, [role='button']";

export function SceneReorderList({
  items,
  disabled,
  onReorder,
  renderRow
}: {
  items: ProjectSceneItem[];
  disabled: boolean;
  onReorder: (items: ProjectSceneItem[]) => void;
  renderRow: (item: ProjectSceneItem, index: number) => ReactNode;
}) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingRef = useRef<PendingDrag | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => () => {
    const pending = pendingRef.current;
    if (pending?.timer) window.clearTimeout(pending.timer);
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
  }, []);

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
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
  }

  function updateDrag(clientY: number) {
    const current = dragRef.current;
    if (!current) return;
    let targetId = current.itemId;
    let insertAfter = false;
    let closestDistance = Number.POSITIVE_INFINITY;

    items.forEach((item) => {
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

  function finishDrag() {
    const current = dragRef.current;
    const pending = pendingRef.current;
    if (pending?.timer) window.clearTimeout(pending.timer);
    pendingRef.current = null;
    dragRef.current = null;
    setDrag(null);
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");

    if (!current || current.targetId === current.itemId) return;
    const sourceIndex = items.findIndex((item) => item.id === current.itemId);
    const targetIndex = items.findIndex((item) => item.id === current.targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const next = [...items];
    const [moved] = next.splice(sourceIndex, 1);
    let insertIndex = next.findIndex((item) => item.id === current.targetId);
    if (insertIndex < 0) insertIndex = next.length;
    if (current.insertAfter) insertIndex += 1;
    next.splice(insertIndex, 0, moved);
    onReorder(next);
  }

  function cancelPending() {
    const pending = pendingRef.current;
    if (pending?.timer) window.clearTimeout(pending.timer);
    pendingRef.current = null;
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    itemId: string
  ) {
    if (disabled || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(interactiveSelector)) return;

    const pending: PendingDrag = {
      itemId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      timer: null
    };
    if (event.pointerType === "touch") {
      pending.timer = window.setTimeout(() => beginDrag(pending), 260);
    }
    pendingRef.current = pending;

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pending.pointerId) return;
      const distance = Math.hypot(
        moveEvent.clientX - pending.startX,
        moveEvent.clientY - pending.startY
      );
      if (!dragRef.current) {
        if (pending.pointerType === "touch") {
          if (distance > 10) cancelPending();
          return;
        }
        if (distance > 4) beginDrag(pending);
      }
      if (dragRef.current) {
        moveEvent.preventDefault();
        updateDrag(moveEvent.clientY);
      }
    };

    const handleEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pending.pointerId) return;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      if (dragRef.current) finishDrag();
      else cancelPending();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
  }

  return (
    <>
      {items.map((item, index) => {
        const isDragging = drag?.itemId === item.id;
        const isTarget = drag?.targetId === item.id && !isDragging;
        return (
          <div
            key={item.id}
            ref={(node) => {
              if (node) rowRefs.current.set(item.id, node);
              else rowRefs.current.delete(item.id);
            }}
            onPointerDown={(event) => handlePointerDown(event, item.id)}
            onClickCapture={(event) => {
              if (suppressClickRef.current) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            className={`relative ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
            style={{
              transform: isDragging
                ? `translateY(${(drag?.currentY ?? 0) - (drag?.startY ?? 0)}px)`
                : undefined,
              opacity: isDragging ? 0.82 : 1,
              zIndex: isDragging ? 20 : 1,
              touchAction: isDragging ? "none" : "pan-y"
            }}
          >
            {isTarget ? (
              <span
                className={`pointer-events-none absolute inset-x-1 z-30 h-0.5 rounded-full bg-field-primary ${
                  drag?.insertAfter ? "-bottom-px" : "-top-px"
                }`}
              />
            ) : null}
            {renderRow(item, index)}
          </div>
        );
      })}
    </>
  );
}

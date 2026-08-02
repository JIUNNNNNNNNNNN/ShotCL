"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { DailyPlanLocation } from "@/lib/types";

type DailyPlanLocationReorderListProps = {
  items: DailyPlanLocation[];
  onChange: (next: DailyPlanLocation[]) => void;
  disabled?: boolean;
  renderItem: (
    item: DailyPlanLocation,
    index: number,
    state: { isDragging: boolean }
  ) => ReactNode;
};

type DragSession = {
  pointerId: number;
  itemId: string;
  startX: number;
  startY: number;
  row: HTMLDivElement;
  timer: number | null;
  activated: boolean;
  originalOrder: DailyPlanLocation[];
};

const LONG_PRESS_MS = 575;
const MOVE_TOLERANCE_PX = 9;

/** 촬영지 카드 전체를 길게 눌러 순서를 바꾸는 pointer 기반 목록입니다. */
export function DailyPlanLocationReorderList({
  items,
  onChange,
  disabled = false,
  renderItem
}: DailyPlanLocationReorderListProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragOrderRef = useRef(items);
  const previousBodyUserSelectRef = useRef("");
  const suppressClickUntilRef = useRef(0);

  useEffect(() => {
    if (!dragSessionRef.current?.activated) dragOrderRef.current = items;
  }, [items]);

  const finishDragSession = useCallback((pointerId?: number) => {
    const session = dragSessionRef.current;
    if (!session || (pointerId !== undefined && session.pointerId !== pointerId)) return;
    if (session.timer !== null) window.clearTimeout(session.timer);
    if (session.row.hasPointerCapture?.(session.pointerId)) {
      try {
        session.row.releasePointerCapture(session.pointerId);
      } catch {
        // capture가 브라우저에서 먼저 해제된 경우에도 나머지 상태는 정리합니다.
      }
    }
    session.row.style.touchAction = "pan-y";
    if (session.activated) {
      document.body.style.userSelect = previousBodyUserSelectRef.current;
      suppressClickUntilRef.current = Date.now() + 700;
    }
    dragSessionRef.current = null;
    setDraggingId(null);
  }, []);

  useEffect(() => () => finishDragSession(), [finishDragSession]);

  useEffect(() => {
    if (disabled) finishDragSession();
  }, [disabled, finishDragSession]);

  const trackPointer = useCallback((event: PointerEvent) => {
    const session = dragSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    const moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);

    if (!session.activated) {
      if (moved > MOVE_TOLERANCE_PX && session.timer !== null) {
        window.clearTimeout(session.timer);
        session.timer = null;
      }
      return;
    }

    event.preventDefault();
    const listRect = listRef.current?.getBoundingClientRect();
    const isInsideList = Boolean(listRect)
      && event.clientX >= listRect!.left
      && event.clientX <= listRect!.right
      && event.clientY >= listRect!.top
      && event.clientY <= listRect!.bottom;
    if (!isInsideList) return;

    const order = dragOrderRef.current;
    const sourceIndex = order.findIndex((item) => item.id === session.itemId);
    if (sourceIndex < 0) return;
    let targetIndex = sourceIndex;
    let closestDistance = Number.POSITIVE_INFINITY;
    order.forEach((item, index) => {
      const row = rowRefs.current.get(item.id);
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        targetIndex = index;
      }
    });
    if (targetIndex === sourceIndex) return;

    const next = [...order];
    const [movedItem] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, movedItem);
    dragOrderRef.current = next;
    onChange(next);
  }, [onChange]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      trackPointer(event);
    }

    function handleTouchMove(event: TouchEvent) {
      // 길게 누르기가 성립하기 전에는 스크롤을 그대로 두고, 활성 drag에서만 차단합니다.
      if (dragSessionRef.current?.activated) event.preventDefault();
    }

    function handlePointerEnd(event: PointerEvent) {
      const session = dragSessionRef.current;
      if (session?.activated && session.pointerId === event.pointerId) {
        const listRect = listRef.current?.getBoundingClientRect();
        const endedInsideList = event.type !== "pointercancel"
          && Boolean(listRect)
          && event.clientX >= listRect!.left
          && event.clientX <= listRect!.right
          && event.clientY >= listRect!.top
          && event.clientY <= listRect!.bottom;
        if (!endedInsideList) {
          dragOrderRef.current = session.originalOrder;
          onChange(session.originalOrder);
        }
      }
      finishDragSession(event.pointerId);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [finishDragSession, onChange, trackPointer]);

  function beginLongPress(event: ReactPointerEvent<HTMLDivElement>, itemId: string) {
    if (disabled) return;
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-no-location-reorder]")) return;
    const explicitlyAllowed = target.closest("[data-location-reorder-press]");
    if (!explicitlyAllowed && target.closest("button, input, textarea, select, a, [contenteditable='true']")) return;

    finishDragSession();
    const row = event.currentTarget;
    row.style.touchAction = "pan-y";
    const session: DragSession = {
      pointerId: event.pointerId,
      itemId,
      startX: event.clientX,
      startY: event.clientY,
      row,
      timer: null,
      activated: false,
      originalOrder: [...items]
    };
    session.timer = window.setTimeout(() => {
      if (dragSessionRef.current !== session) return;
      session.activated = true;
      session.timer = null;
      previousBodyUserSelectRef.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      row.style.touchAction = "none";
      try {
        row.setPointerCapture(session.pointerId);
      } catch {
        // pointer capture가 없는 환경에서도 window pointer listener가 추적합니다.
      }
      dragOrderRef.current = [...items];
      window.getSelection()?.removeAllRanges();
      setDraggingId(itemId);
    }, LONG_PRESS_MS);
    dragSessionRef.current = session;
  }

  return (
    <div ref={listRef} className="grid gap-1.5" data-testid="daily-plan-location-reorder-list">
      {items.map((item, index) => {
        const isDragging = draggingId === item.id;
        return (
          <div
            key={item.id}
            ref={(node) => {
              if (node) rowRefs.current.set(item.id, node);
              else rowRefs.current.delete(item.id);
            }}
            className={`relative min-w-0 ${isDragging ? "z-10" : ""}`}
            style={{ touchAction: "pan-y", WebkitTouchCallout: "none" }}
            data-location-dragging={isDragging ? "true" : undefined}
            onPointerDown={(event) => beginLongPress(event, item.id)}
            onClickCapture={(event) => {
              if (Date.now() < suppressClickUntilRef.current) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            {renderItem(item, index, { isDragging })}
          </div>
        );
      })}
    </div>
  );
}

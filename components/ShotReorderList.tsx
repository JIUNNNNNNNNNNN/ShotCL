"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Shot } from "@/lib/types";
import { cn } from "@/lib/utils";

type DragState = {
  shotId: string;
  startY: number;
  currentY: number;
  targetId: string | null;
  insertAfter: boolean;
};

type ShotReorderListProps = {
  allShots: Shot[];
  visibleShots: Shot[];
  disabled?: boolean;
  onReorder: (shots: Shot[]) => Promise<void> | void;
  renderShot: (shot: Shot) => ReactNode;
};

const MOUSE_LONG_PRESS_MS = 300;
const TOUCH_LONG_PRESS_MS = 420;
const PRESS_MOVE_TOLERANCE_PX = 10;

function isDragExcludedTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest("button, a, input, textarea, select, [data-no-drag]"));
}

function reorderShots(
  shots: Shot[],
  draggedId: string,
  targetId: string,
  insertAfter: boolean
) {
  if (draggedId === targetId) return shots;

  const draggedShot = shots.find((shot) => shot.id === draggedId);
  if (!draggedShot) return shots;

  const remaining = shots.filter((shot) => shot.id !== draggedId);
  const targetIndex = remaining.findIndex((shot) => shot.id === targetId);
  if (targetIndex < 0) return shots;

  const insertIndex = targetIndex + (insertAfter ? 1 : 0);
  const nextShots = [...remaining];
  nextShots.splice(insertIndex, 0, draggedShot);
  if (nextShots.every((shot, index) => shots[index]?.id === shot.id)) return shots;
  return nextShots.map((shot, index) => ({ ...shot, orderIndex: index + 1 }));
}

/**
 * 카드 본문을 길게 누른 뒤 위아래로 움직여 정렬합니다.
 * 짧은 클릭과 카드 안 버튼은 기존 이벤트를 그대로 사용합니다.
 */
export function ShotReorderList({
  allShots,
  visibleShots,
  disabled = false,
  onReorder,
  renderShot
}: ShotReorderListProps) {
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const cleanupPointerSessionRef = useRef<(() => void) | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => () => cleanupPointerSessionRef.current?.(), []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>, shotId: string) {
    if (disabled || event.button !== 0 || isDragExcludedTarget(event.target)) return;

    cleanupPointerSessionRef.current?.();

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const pressedCard = event.currentTarget;
    const delay = event.pointerType === "mouse" ? MOUSE_LONG_PRESS_MS : TOUCH_LONG_PRESS_MS;
    const originalUserSelect = document.body.style.userSelect;
    const originalWebkitUserSelect = document.body.style.webkitUserSelect;
    let activated = false;
    let latestTargetId: string | null = shotId;
    let latestInsertAfter = false;
    let latestClientY = startY;
    let isCleanedUp = false;

    const restoreDocumentInteraction = () => {
      document.body.style.userSelect = originalUserSelect;
      document.body.style.webkitUserSelect = originalWebkitUserSelect;
    };

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      window.clearTimeout(longPressTimer);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("touchmove", preventTouchScroll);
      window.removeEventListener("keydown", handleKeyDown);
      restoreDocumentInteraction();
      setDragState(null);
      cleanupPointerSessionRef.current = null;
      if (pressedCard.hasPointerCapture(pointerId)) pressedCard.releasePointerCapture(pointerId);
    };

    const cancelBeforeActivation = () => {
      if (!activated) {
        suppressClickUntilRef.current = Date.now() + 400;
        cleanup();
      }
    };

    const findDropTarget = (clientY: number) => {
      let closest: { id: string; distance: number; insertAfter: boolean } | null = null;

      for (const visibleShot of visibleShots) {
        if (visibleShot.id === shotId) continue;
        const card = cardRefs.current.get(visibleShot.id);
        if (!card) continue;
        const rect = card.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const distance = Math.abs(clientY - centerY);
        if (!closest || distance < closest.distance) {
          closest = {
            id: visibleShot.id,
            distance,
            insertAfter: clientY >= centerY
          };
        }
      }

      latestTargetId = closest?.id ?? shotId;
      latestInsertAfter = closest?.insertAfter ?? false;
    };

    const activateDrag = () => {
      if (isCleanedUp) return;
      activated = true;
      suppressClickUntilRef.current = Date.now() + 700;
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      if (event.pointerType !== "mouse") {
        window.addEventListener("touchmove", preventTouchScroll, { passive: false });
      }
      try {
        pressedCard.setPointerCapture(pointerId);
      } catch {
        // 일부 모바일 브라우저는 long press 시점의 pointer capture를 지원하지 않습니다.
      }
      setDragState({
        shotId,
        startY,
        currentY: latestClientY,
        targetId: latestTargetId,
        insertAfter: latestInsertAfter
      });
    };

    function preventTouchScroll(touchEvent: TouchEvent) {
      touchEvent.preventDefault();
    }

    function handlePointerMove(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      latestClientY = pointerEvent.clientY;

      if (!activated) {
        const distance = Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY);
        if (distance > PRESS_MOVE_TOLERANCE_PX) cancelBeforeActivation();
        return;
      }

      pointerEvent.preventDefault();
      findDropTarget(pointerEvent.clientY);
      setDragState({
        shotId,
        startY,
        currentY: pointerEvent.clientY,
        targetId: latestTargetId,
        insertAfter: latestInsertAfter
      });
    }

    function handlePointerUp(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      if (!activated) {
        cleanup();
        return;
      }

      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      suppressClickUntilRef.current = Date.now() + 700;
      const targetId = latestTargetId;
      const nextShots = targetId
        ? reorderShots(allShots, shotId, targetId, latestInsertAfter)
        : allShots;
      cleanup();
      if (nextShots !== allShots) void onReorder(nextShots);
    }

    function handlePointerCancel(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
    }

    function handleKeyDown(keyboardEvent: KeyboardEvent) {
      if (keyboardEvent.key !== "Escape") return;
      suppressClickUntilRef.current = Date.now() + 400;
      cleanup();
    }

    const longPressTimer = window.setTimeout(activateDrag, delay);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);
    cleanupPointerSessionRef.current = cleanup;
  }

  return (
    <div className="grid gap-2 pb-24">
      {visibleShots.map((shot) => {
        const isDragging = dragState?.shotId === shot.id;
        const isDropTarget = dragState?.targetId === shot.id && !isDragging;
        return (
          <div
            key={shot.id}
            ref={(element) => {
              if (element) cardRefs.current.set(shot.id, element);
              else cardRefs.current.delete(shot.id);
            }}
            onPointerDown={(event) => handlePointerDown(event, shot.id)}
            onContextMenu={(event) => {
              if (!disabled && !isDragExcludedTarget(event.target)) event.preventDefault();
            }}
            onClickCapture={(event) => {
              if (Date.now() >= suppressClickUntilRef.current) return;
              event.preventDefault();
              event.stopPropagation();
            }}
            aria-grabbed={isDragging}
            className={cn(
              "relative rounded-[1.5rem]",
              !disabled && "cursor-grab",
              isDragging && "z-50 cursor-grabbing opacity-95",
              isDropTarget
                && (dragState?.insertAfter
                  ? "after:absolute after:-bottom-1.5 after:left-5 after:right-5 after:h-1 after:rounded-full after:bg-[#d77b32]"
                  : "before:absolute before:-top-1.5 before:left-5 before:right-5 before:h-1 before:rounded-full before:bg-[#d77b32]")
            )}
            style={isDragging ? {
              transform: `translate3d(0, ${dragState.currentY - dragState.startY}px, 0) scale(1.015)`,
              boxShadow: "0 16px 32px rgba(35, 42, 37, 0.18)",
              touchAction: "none",
              willChange: "transform"
            } : undefined}
          >
            {renderShot(shot)}
          </div>
        );
      })}
    </div>
  );
}

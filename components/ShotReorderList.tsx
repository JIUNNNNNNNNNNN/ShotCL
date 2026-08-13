"use client";

import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useContextualGuideAnchor } from "@/components/guides/ContextualGuideProvider";
import { usePersistentProjectShell } from "@/hooks/useProjectShellMode";
import {
  PROGRESS_SWIPE_COMMIT_RATIO,
  resolveProgressPointerIntent,
  resolveProgressStatusToggle,
  resolveProgressSwipeStatus
} from "@/lib/progress/shotCardInteraction";
import type { Shot, ShotStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type DragState = {
  shotId: string;
  startY: number;
  currentY: number;
  targetId: string | null;
  insertAfter: boolean;
};

export type ShotReorderListProps = {
  allShots: Shot[];
  visibleShots: Shot[];
  className?: string;
  disabled?: boolean;
  statusReadOnly: boolean;
  interactionGuideTarget?: boolean;
  onReorder: (shots: Shot[]) => Promise<void> | void;
  onStatusChange: (shot: Shot, status: ShotStatus) => Promise<void> | void;
  renderShot: (shot: Shot) => ReactNode;
  renderRowsBeforeIndex?: (index: number) => ReactNode;
};

const MOUSE_LONG_PRESS_MS = 220;
const TOUCH_LONG_PRESS_MS = 330;
const CLICK_MOVE_TOLERANCE_PX = 10;

function isGestureExcludedTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest(
      "button, a, input, textarea, select, option, label, [contenteditable='true'], [role='button'], [data-progress-interactive], [data-no-drag]"
    ));
}

function reorderVisibleShots(
  allShots: Shot[],
  visibleShots: Shot[],
  draggedId: string,
  targetId: string,
  insertAfter: boolean
) {
  if (draggedId === targetId) return allShots;

  const draggedShot = visibleShots.find((shot) => shot.id === draggedId);
  if (!draggedShot) return allShots;

  const remaining = visibleShots.filter((shot) => shot.id !== draggedId);
  const targetIndex = remaining.findIndex((shot) => shot.id === targetId);
  if (targetIndex < 0) return allShots;

  const insertIndex = targetIndex + (insertAfter ? 1 : 0);
  const nextVisibleShots = [...remaining];
  nextVisibleShots.splice(insertIndex, 0, draggedShot);
  if (nextVisibleShots.every((shot, index) => visibleShots[index]?.id === shot.id)) return allShots;

  const visibleIds = new Set(visibleShots.map((shot) => shot.id));
  let visibleIndex = 0;
  return allShots.map((shot) => (
    visibleIds.has(shot.id) ? nextVisibleShots[visibleIndex++] : shot
  )).map((shot, index) => ({ ...shot, orderIndex: index + 1 }));
}

/**
 * 카드와 부감도/콘티 영역을 길게 누른 뒤 위아래로 움직여 정렬합니다.
 * 짧은 클릭은 기존 동작을 유지하고, 대화형 자식 요소는 모든 카드 제스처에서 제외합니다.
 */
export function ShotReorderList({
  allShots,
  visibleShots,
  className,
  disabled = false,
  statusReadOnly,
  interactionGuideTarget = false,
  onReorder,
  onStatusChange,
  renderShot,
  renderRowsBeforeIndex
}: ShotReorderListProps) {
  const persistentInteraction = usePersistentProjectShell();
  const listRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const swipeSurfaceRefs = useRef(new Map<string, HTMLDivElement>());
  const swipeOkRevealRefs = useRef(new Map<string, HTMLSpanElement>());
  const swipeOmitRevealRefs = useRef(new Map<string, HTMLSpanElement>());
  const swipeResetTimersRef = useRef(new Map<string, number>());
  const cleanupPointerSessionRef = useRef<(() => void) | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const reorderGuideAnchorRef = useContextualGuideAnchor<HTMLDivElement>(
    interactionGuideTarget && !disabled && visibleShots.length >= 2 ? "progress.shot-card" : null
  );
  const reorderGuideShotId = interactionGuideTarget && !disabled && visibleShots.length >= 2
    ? visibleShots[0]?.id ?? null
    : null;

  useEffect(() => () => {
    cleanupPointerSessionRef.current?.();
    for (const timer of swipeResetTimersRef.current.values()) window.clearTimeout(timer);
    swipeResetTimersRef.current.clear();
  }, []);

  useEffect(() => {
    reorderGuideAnchorRef(
      reorderGuideShotId ? cardRefs.current.get(reorderGuideShotId) ?? null : null
    );
    return () => {
      reorderGuideAnchorRef(null);
    };
  }, [reorderGuideAnchorRef, reorderGuideShotId]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const preventTextSelection = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
    };

    list.addEventListener("selectstart", preventTextSelection);
    return () => list.removeEventListener("selectstart", preventTextSelection);
  }, []);

  function clearSwipeResetTimer(shotId: string) {
    const timer = swipeResetTimersRef.current.get(shotId);
    if (timer !== undefined) window.clearTimeout(timer);
    swipeResetTimersRef.current.delete(shotId);
  }

  function setSwipeReveal(shotId: string, deltaX: number, width: number) {
    const progress = Math.min(
      1,
      Math.abs(deltaX) / Math.max(1, width * PROGRESS_SWIPE_COMMIT_RATIO)
    );
    const activeOpacity = String(0.18 + progress * 0.72);
    const okReveal = swipeOkRevealRefs.current.get(shotId);
    const omitReveal = swipeOmitRevealRefs.current.get(shotId);
    if (okReveal) okReveal.style.opacity = deltaX > 0 ? activeOpacity : "0";
    if (omitReveal) omitReveal.style.opacity = deltaX < 0 ? activeOpacity : "0";
  }

  function updateSwipeVisual(shotId: string, deltaX: number, width: number) {
    const surface = swipeSurfaceRefs.current.get(shotId);
    if (!surface) return;
    const boundedDeltaX = Math.max(-width * 1.1, Math.min(width * 1.1, deltaX));
    surface.style.transition = "none";
    surface.style.willChange = "transform, opacity";
    surface.style.transform = `translate3d(${boundedDeltaX}px, 0, 0)`;
    surface.style.opacity = String(1 - Math.min(0.2, Math.abs(boundedDeltaX) / Math.max(1, width) * 0.2));
    setSwipeReveal(shotId, boundedDeltaX, width);
  }

  function animateSwipeVisual(shotId: string, targetX: number, targetOpacity: number) {
    const surface = swipeSurfaceRefs.current.get(shotId);
    const okReveal = swipeOkRevealRefs.current.get(shotId);
    const omitReveal = swipeOmitRevealRefs.current.get(shotId);
    if (!surface) return;

    clearSwipeResetTimer(shotId);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reducedMotion ? 1 : 180;
    const transition = `transform ${duration}ms ease-out, opacity ${duration}ms ease-out`;
    surface.style.transition = transition;
    surface.style.transform = `translate3d(${targetX}px, 0, 0)`;
    surface.style.opacity = String(targetOpacity);
    if (okReveal) okReveal.style.transition = `opacity ${duration}ms ease-out`;
    if (omitReveal) omitReveal.style.transition = `opacity ${duration}ms ease-out`;
    if (targetX === 0) {
      if (okReveal) okReveal.style.opacity = "0";
      if (omitReveal) omitReveal.style.opacity = "0";
    }

    const timer = window.setTimeout(() => {
      if (surface.isConnected) {
        surface.style.removeProperty("transition");
        surface.style.removeProperty("will-change");
        if (targetX !== 0) {
          surface.style.transform = "translate3d(0, 0, 0)";
          surface.style.opacity = "1";
        }
      }
      if (okReveal?.isConnected) {
        okReveal.style.opacity = "0";
        okReveal.style.removeProperty("transition");
      }
      if (omitReveal?.isConnected) {
        omitReveal.style.opacity = "0";
        omitReveal.style.removeProperty("transition");
      }
      swipeResetTimersRef.current.delete(shotId);
    }, duration + 24);
    swipeResetTimersRef.current.set(shotId, timer);
  }

  function resetSwipeVisualImmediately(shotId: string) {
    clearSwipeResetTimer(shotId);
    const surface = swipeSurfaceRefs.current.get(shotId);
    const okReveal = swipeOkRevealRefs.current.get(shotId);
    const omitReveal = swipeOmitRevealRefs.current.get(shotId);
    if (surface) {
      surface.style.transition = "none";
      surface.style.transform = "translate3d(0, 0, 0)";
      surface.style.opacity = "1";
      surface.style.removeProperty("will-change");
    }
    if (okReveal) okReveal.style.opacity = "0";
    if (omitReveal) omitReveal.style.opacity = "0";
  }

  function animateCommittedSwipeGhost(shotId: string, direction: -1 | 1) {
    const surface = swipeSurfaceRefs.current.get(shotId);
    if (!surface) return;

    const rect = surface.getBoundingClientRect();
    const ghost = surface.cloneNode(true) as HTMLDivElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reducedMotion ? 1 : 180;
    Object.assign(ghost.style, {
      position: "fixed",
      zIndex: "2147483000",
      pointerEvents: "none",
      contain: "layout paint style",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      opacity: surface.style.opacity || "1",
      // getBoundingClientRect already includes the live swipe transform. Start
      // the fixed ghost at that visual position instead of applying it twice.
      transform: "translate3d(0, 0, 0)",
      transformOrigin: "center",
      transition: "none"
    });
    ghost.setAttribute("aria-hidden", "true");
    document.body.appendChild(ghost);

    // Hide the source until React applies the release-only optimistic regroup.
    // The ghost owns the outgoing visual and the new processed node starts clean.
    clearSwipeResetTimer(shotId);
    surface.style.transition = "none";
    surface.style.transform = "translate3d(0, 0, 0)";
    surface.style.opacity = "0";
    const okReveal = swipeOkRevealRefs.current.get(shotId);
    const omitReveal = swipeOmitRevealRefs.current.get(shotId);
    if (okReveal) okReveal.style.opacity = "0";
    if (omitReveal) omitReveal.style.opacity = "0";
    window.requestAnimationFrame(() => {
      if (ghost.isConnected) {
        ghost.style.transition = `transform ${duration}ms ease-out, opacity ${duration}ms ease-out`;
        ghost.style.transform = `translate3d(${direction * Math.max(rect.width * 1.05, window.innerWidth)}px, 0, 0)`;
        ghost.style.opacity = "0";
      }
      // A processed-to-processed toggle can reuse the exact source node. Restore
      // that captured node only; never look it up through the now-updated id map.
      if (surface.isConnected) {
        surface.style.removeProperty("transition");
        surface.style.removeProperty("will-change");
        surface.style.transform = "translate3d(0, 0, 0)";
        surface.style.opacity = "1";
      }
    });
    window.setTimeout(() => ghost.remove(), duration + 40);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>, shot: Shot) {
    if (event.button !== 0 || event.ctrlKey || !event.isPrimary || isGestureExcludedTarget(event.target)) return;

    const shotId = shot.id;
    const canReorder = !disabled;
    const canSwipe = !persistentInteraction
      && event.pointerType !== "mouse"
      && !statusReadOnly;
    if (!canReorder && !canSwipe) return;

    cleanupPointerSessionRef.current?.();
    resetSwipeVisualImmediately(shotId);

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const pressedCard = event.currentTarget;
    const swipeWidth = canSwipe
      ? swipeSurfaceRefs.current.get(shotId)?.getBoundingClientRect().width ?? pressedCard.getBoundingClientRect().width
      : 0;
    const delay = event.pointerType === "mouse" ? MOUSE_LONG_PRESS_MS : TOUCH_LONG_PRESS_MS;
    const originalUserSelect = document.body.style.userSelect;
    const originalWebkitUserSelect = document.body.style.webkitUserSelect;
    let mode: "pending" | "swipe" | "reorder" = "pending";
    let movedBeyondClickTolerance = false;
    let latestTargetId: string | null = shotId;
    let latestInsertAfter = false;
    let latestClientX = startX;
    let latestClientY = startY;
    let isCleanedUp = false;
    let dragFrame = 0;
    let swipeFrame = 0;
    let longPressTimer = 0;

    const restoreDocumentInteraction = () => {
      document.body.style.userSelect = originalUserSelect;
      document.body.style.webkitUserSelect = originalWebkitUserSelect;
    };

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      window.clearTimeout(longPressTimer);
      if (dragFrame) window.cancelAnimationFrame(dragFrame);
      if (swipeFrame) window.cancelAnimationFrame(swipeFrame);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("touchmove", preventTouchScroll);
      window.removeEventListener("keydown", handleKeyDown);
      restoreDocumentInteraction();
      if (mode === "reorder") setDragState(null);
      if (cleanupPointerSessionRef.current === cleanup) cleanupPointerSessionRef.current = null;
      try {
        if (pressedCard.hasPointerCapture(pointerId)) pressedCard.releasePointerCapture(pointerId);
      } catch {
        // The node may already have moved groups after a release-only status commit.
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

    const scheduleDragUpdate = () => {
      if (dragFrame) return;
      dragFrame = window.requestAnimationFrame(() => {
        dragFrame = 0;
        if (isCleanedUp || mode !== "reorder") return;
        findDropTarget(latestClientY);
        setDragState({
          shotId,
          startY,
          currentY: latestClientY,
          targetId: latestTargetId,
          insertAfter: latestInsertAfter
        });
      });
    };

    const activateDrag = () => {
      if (isCleanedUp || mode !== "pending" || !canReorder) return;
      mode = "reorder";
      suppressClickUntilRef.current = Date.now() + 700;
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      window.getSelection()?.removeAllRanges();
      findDropTarget(latestClientY);
      try {
        if (!pressedCard.hasPointerCapture(pointerId)) pressedCard.setPointerCapture(pointerId);
      } catch {
        // 일부 모바일 브라우저는 long press 시점의 pointer capture를 지원하지 않습니다.
      }
      if (event.pointerType !== "mouse") {
        window.addEventListener("touchmove", preventTouchScroll, { passive: false });
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
      if (mode === "reorder" && touchEvent.cancelable) touchEvent.preventDefault();
    }

    const scheduleSwipeUpdate = () => {
      if (swipeFrame) return;
      swipeFrame = window.requestAnimationFrame(() => {
        swipeFrame = 0;
        if (isCleanedUp || mode !== "swipe") return;
        updateSwipeVisual(shotId, latestClientX - startX, swipeWidth);
      });
    };

    function handlePointerMove(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      latestClientX = pointerEvent.clientX;
      latestClientY = pointerEvent.clientY;

      if (mode === "pending") {
        const deltaX = latestClientX - startX;
        const deltaY = latestClientY - startY;
        const intent = resolveProgressPointerIntent(deltaX, deltaY, CLICK_MOVE_TOLERANCE_PX);
        if (intent === "pending") return;

        movedBeyondClickTolerance = true;
        window.clearTimeout(longPressTimer);
        longPressTimer = 0;
        suppressClickUntilRef.current = Date.now() + 400;

        if (intent === "vertical") {
          // Do not capture or prevent this event: native page scrolling owns it.
          cleanup();
          return;
        }

        if (!canSwipe) {
          // A deliberate horizontal move must not later activate long-press reorder.
          cleanup();
          return;
        }

        mode = "swipe";
        try {
          if (!pressedCard.hasPointerCapture(pointerId)) pressedCard.setPointerCapture(pointerId);
        } catch {
          // Pointer capture is an enhancement; the window listeners remain authoritative.
        }
        if (pointerEvent.cancelable) pointerEvent.preventDefault();
        scheduleSwipeUpdate();
        return;
      }

      if (mode === "swipe") {
        if (pointerEvent.cancelable) pointerEvent.preventDefault();
        scheduleSwipeUpdate();
        return;
      }

      if (pointerEvent.cancelable) pointerEvent.preventDefault();
      scheduleDragUpdate();
    }

    function handlePointerUp(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      if (mode === "pending") {
        if (movedBeyondClickTolerance) suppressClickUntilRef.current = Date.now() + 400;
        cleanup();
        return;
      }

      if (pointerEvent.cancelable) pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      suppressClickUntilRef.current = Date.now() + 700;

      if (mode === "swipe") {
        if (swipeFrame) {
          window.cancelAnimationFrame(swipeFrame);
          swipeFrame = 0;
        }
        latestClientX = pointerEvent.clientX;
        const deltaX = latestClientX - startX;
        const requestedStatus = resolveProgressSwipeStatus(deltaX, swipeWidth);
        if (!requestedStatus) {
          animateSwipeVisual(shotId, 0, 1);
          cleanup();
          return;
        }

        animateCommittedSwipeGhost(shotId, deltaX > 0 ? 1 : -1);
        cleanup();
        void onStatusChange(shot, resolveProgressStatusToggle(shot.status, requestedStatus));
        return;
      }

      if (dragFrame) {
        window.cancelAnimationFrame(dragFrame);
        dragFrame = 0;
      }
      findDropTarget(pointerEvent.clientY);
      const targetId = latestTargetId;
      const nextShots = targetId
        ? reorderVisibleShots(allShots, visibleShots, shotId, targetId, latestInsertAfter)
        : allShots;
      cleanup();
      if (nextShots !== allShots) void onReorder(nextShots);
    }

    function handlePointerCancel(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      if (mode === "swipe") animateSwipeVisual(shotId, 0, 1);
      cleanup();
    }

    function handleKeyDown(keyboardEvent: KeyboardEvent) {
      if (keyboardEvent.key !== "Escape") return;
      suppressClickUntilRef.current = Date.now() + 400;
      if (mode === "swipe") animateSwipeVisual(shotId, 0, 1);
      cleanup();
    }

    if (canReorder) longPressTimer = window.setTimeout(activateDrag, delay);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);
    cleanupPointerSessionRef.current = cleanup;
  }

  return (
    <div ref={listRef} className={cn("grid gap-2", className)}>
      {visibleShots.map((shot, index) => {
        const isDragging = dragState?.shotId === shot.id;
        const isDropTarget = dragState?.targetId === shot.id && !isDragging;
        return (
          <Fragment key={shot.id}>
            {renderRowsBeforeIndex?.(index)}
            <div
              ref={(element) => {
                if (element) cardRefs.current.set(shot.id, element);
                else cardRefs.current.delete(shot.id);
              }}
              onPointerDown={(event) => handlePointerDown(event, shot)}
              onDragStart={(event) => event.preventDefault()}
              onClickCapture={(event) => {
                if (Date.now() >= suppressClickUntilRef.current) return;
                event.preventDefault();
                event.stopPropagation();
              }}
              aria-grabbed={isDragging}
              className={cn(
                "relative select-none rounded-[var(--radius-selection)] [-webkit-touch-callout:none] [&_[contenteditable='true']]:select-text [&_input]:select-text [&_textarea]:select-text",
                !disabled && "cursor-grab",
                isDragging && "z-50 cursor-grabbing overflow-hidden ring-2 ring-field-primary",
                isDropTarget
                  && (dragState?.insertAfter
                    ? "after:absolute after:-bottom-1.5 after:left-5 after:right-5 after:h-1 after:rounded-full after:bg-field-primary"
                    : "before:absolute before:-top-1.5 before:left-5 before:right-5 before:h-1 before:rounded-full before:bg-field-primary")
              )}
              style={isDragging ? {
                transform: `translate3d(0, ${dragState.currentY - dragState.startY}px, 0) scale(1.015)`,
                touchAction: "none",
                willChange: "transform"
              } : undefined}
            >
              <div
                className="relative isolate overflow-hidden rounded-[var(--radius-card)]"
                style={!persistentInteraction && !statusReadOnly
                  ? { touchAction: "pan-y pinch-zoom" }
                  : undefined}
              >
                {!persistentInteraction && !statusReadOnly ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-0 grid grid-cols-2 overflow-hidden rounded-[inherit]"
                  >
                    <span
                      ref={(element) => {
                        if (element) swipeOkRevealRefs.current.set(shot.id, element);
                        else swipeOkRevealRefs.current.delete(shot.id);
                      }}
                      className="flex items-center justify-start bg-status-ok/15 px-5 text-sm font-black tracking-[0.08em] text-status-ok opacity-0 motion-reduce:transition-none"
                    >
                      OK
                    </span>
                    <span
                      ref={(element) => {
                        if (element) swipeOmitRevealRefs.current.set(shot.id, element);
                        else swipeOmitRevealRefs.current.delete(shot.id);
                      }}
                      className="flex items-center justify-end bg-field-danger/15 px-5 text-sm font-black tracking-[0.08em] text-field-danger opacity-0 motion-reduce:transition-none"
                    >
                      OMIT
                    </span>
                  </div>
                ) : null}
                <div
                  ref={(element) => {
                    if (element) swipeSurfaceRefs.current.set(shot.id, element);
                    else swipeSurfaceRefs.current.delete(shot.id);
                  }}
                  className="relative z-10 min-w-0 transform-gpu transition-[transform,opacity] duration-200 ease-out motion-reduce:duration-[1ms]"
                >
                  {renderShot(shot)}
                </div>
              </div>
            </div>
          </Fragment>
        );
      })}
      {renderRowsBeforeIndex?.(visibleShots.length)}
    </div>
  );
}

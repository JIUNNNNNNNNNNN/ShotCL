"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent
} from "react";
import {
  getBalancedCarouselSlot,
  getCarouselItemDistance,
  getDailyPlanCarouselMetrics,
  getDailyPlanCarouselVisualTransform,
  getDirectionalCarouselTarget,
  getNearestCarouselItemTarget,
  getNearestCarouselSnap,
  normalizeCarouselPosition
} from "@/lib/dailyPlan/carouselGeometry";

export type DailyPlanCarouselItem = {
  id: string;
  kind: "new" | "plan";
  label: string;
  dateLabel?: string;
  metaLabel?: string;
  progressPercent?: number;
  ariaLabel?: string;
  planId?: string;
};

type DailyPlanCoverflowProps = {
  items: DailyPlanCarouselItem[];
  disabled?: boolean;
  onActivate: (item: DailyPlanCarouselItem) => boolean | void;
  onOpenContextMenu?: (item: DailyPlanCarouselItem, clientX: number, clientY: number) => void;
  ariaLabel?: string;
};

type PointerSession = {
  pointerId: number;
  pointerType: string;
  itemId: string | null;
  captureTarget: HTMLDivElement;
  didCapture: boolean;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  lastX: number;
  lastTime: number;
  startPosition: number;
  cardStep: number;
  velocity: number;
  intent: "pending" | "horizontal" | "vertical";
  longPressed: boolean;
};

type InteractionPhase = "idle" | "dragging" | "snapping" | "activating";
type ActivationSource = "click" | "drag" | "keyboard";

type SnapOptions = {
  focusCard?: boolean;
  activationItemKey?: string;
  activationSource?: ActivationSource;
};

const DRAG_THRESHOLD_PX = 8;
const LONG_PRESS_MS = 600;
const INERTIA_FRICTION = 0.91;
const INERTIA_STOP_VELOCITY = 0.00075;
const MAX_INERTIA_MS = 950;
const SNAP_DURATION_MS = 280;
const REDUCED_MOTION_SNAP_DURATION_MS = 80;
const DRAG_SENSITIVITY = 1.15;
const ACTIVATION_LOCK_MS = 1_500;

/** 카드 수와 무관하게 logical item 하나당 DOM 카드 하나만 사용하는 순환 coverflow입니다. */
export function DailyPlanCoverflow({
  items,
  disabled = false,
  onActivate,
  onOpenContextMenu,
  ariaLabel = "일촬표 선택 카드"
}: DailyPlanCoverflowProps) {
  const logicalItems = useMemo(() => dedupeLogicalItems(items), [items]);
  const [activeItemKey, setActiveItemKey] = useState("");
  const [interactionPhase, setInteractionPhase] = useState<InteractionPhase>("idle");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const selectionSlotRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const itemsRef = useRef(logicalItems);
  const onActivateRef = useRef(onActivate);
  const positionRef = useRef(0);
  const activeItemKeyRef = useRef("");
  const pendingActivationItemKeyRef = useRef<string | null>(null);
  const activationSourceRef = useRef<ActivationSource | null>(null);
  const hasExplicitUserIntentRef = useRef(false);
  const activationLockedRef = useRef(false);
  const activationUnlockTimerRef = useRef<number | null>(null);
  const pointerSessionRef = useRef<PointerSession | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const motionFrameRef = useRef<number | null>(null);
  const activationFrameRef = useRef<number | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const suppressGeneratedClickRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const itemsKey = JSON.stringify(logicalItems.map(getItemKey));

  const updateInteractionPhase = useCallback((phase: InteractionPhase) => {
    setInteractionPhase(phase);
  }, []);

  const cancelMotion = useCallback(() => {
    if (motionFrameRef.current !== null) {
      cancelAnimationFrame(motionFrameRef.current);
      motionFrameRef.current = null;
    }
    if (activationFrameRef.current !== null) {
      cancelAnimationFrame(activationFrameRef.current);
      activationFrameRef.current = null;
    }
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const clearActivationIntent = useCallback((nextPhase: InteractionPhase = "idle") => {
    pendingActivationItemKeyRef.current = null;
    activationSourceRef.current = null;
    hasExplicitUserIntentRef.current = false;
    if (!activationLockedRef.current) updateInteractionPhase(nextPhase);
  }, [updateInteractionPhase]);

  const renderCards = useCallback(() => {
    const currentItems = itemsRef.current;
    const count = currentItems.length;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    const metrics = getDailyPlanCarouselMetrics(viewportRect.width);
    if (selectionSlotRef.current) selectionSlotRef.current.style.width = `${metrics.cardWidth + 8}px`;
    if (count === 0) return;
    const reduceMotion = reducedMotionRef.current;

    currentItems.forEach((item, index) => {
      const card = cardRefs.current.get(getItemKey(item));
      if (!card) return;
      const visualSlot = getBalancedCarouselSlot(index);
      const distance = getCarouselItemDistance(index, positionRef.current, count);
      const visual = getDailyPlanCarouselVisualTransform(distance, metrics, reduceMotion);

      card.dataset.logicalIndex = String(index);
      card.dataset.visualSlot = String(visualSlot);
      card.dataset.visualDistance = distance.toFixed(4);
      card.style.width = `${metrics.cardWidth}px`;
      card.style.transform = `translate(-50%, -50%) translate3d(${visual.translateX}px, 0, ${visual.translateZ}px) rotateY(${visual.rotationY}deg) scale(${visual.scale})`;
      card.style.opacity = String(visual.opacity);
      card.style.zIndex = String(visual.zIndex);
      card.style.pointerEvents = visual.interactive ? "auto" : "none";
      card.style.visibility = visual.visible ? "visible" : "hidden";
      card.tabIndex = visual.interactive && !disabled ? 0 : -1;
      if (visual.interactive) card.removeAttribute("aria-hidden");
      else card.setAttribute("aria-hidden", "true");
    });
  }, [disabled]);

  const scheduleRender = useCallback(() => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = requestAnimationFrame(() => {
      renderFrameRef.current = null;
      renderCards();
    });
  }, [renderCards]);

  const cancelScheduledRender = useCallback(() => {
    if (renderFrameRef.current === null) return;
    cancelAnimationFrame(renderFrameRef.current);
    renderFrameRef.current = null;
  }, []);

  const commitCenteredItem = useCallback((logicalPosition: number, focusCard = false) => {
    const currentItems = itemsRef.current;
    if (currentItems.length === 0) {
      activeItemKeyRef.current = "";
      setActiveItemKey("");
      return null;
    }
    const snap = getNearestCarouselSnap(logicalPosition, currentItems.length);
    const nextItem = snap ? currentItems[snap.index] : undefined;
    if (!nextItem) return null;
    const nextItemKey = getItemKey(nextItem);
    activeItemKeyRef.current = nextItemKey;
    setActiveItemKey(nextItemKey);
    if (focusCard) {
      requestAnimationFrame(() => cardRefs.current.get(nextItemKey)?.focus());
    }
    return nextItem;
  }, []);

  const finishActivation = useCallback((centeredItem: DailyPlanCarouselItem | null) => {
    const pendingItemKey = pendingActivationItemKeyRef.current;
    const hasExplicitIntent = hasExplicitUserIntentRef.current;
    const source = activationSourceRef.current;
    pendingActivationItemKeyRef.current = null;
    activationSourceRef.current = null;
    hasExplicitUserIntentRef.current = false;

    if (
      !centeredItem
      || !hasExplicitIntent
      || !source
      || pendingItemKey !== getItemKey(centeredItem)
      || activationLockedRef.current
    ) {
      updateInteractionPhase("idle");
      return;
    }

    activationLockedRef.current = true;
    updateInteractionPhase("activating");
    cancelScheduledRender();

    let accepted = true;
    try {
      accepted = onActivateRef.current(centeredItem) !== false;
    } catch {
      accepted = false;
    }

    if (!accepted) {
      activationLockedRef.current = false;
      updateInteractionPhase("idle");
      return;
    }

    if (activationUnlockTimerRef.current !== null) {
      window.clearTimeout(activationUnlockTimerRef.current);
    }
    activationUnlockTimerRef.current = window.setTimeout(() => {
      activationLockedRef.current = false;
      activationUnlockTimerRef.current = null;
      updateInteractionPhase("idle");
    }, ACTIVATION_LOCK_MS);
  }, [cancelScheduledRender, updateInteractionPhase]);

  const settleSnap = useCallback((target: number, focusCard: boolean) => {
    const settledPosition = normalizeCarouselPosition(target, itemsRef.current.length);
    positionRef.current = settledPosition;
    const centeredItem = commitCenteredItem(settledPosition, focusCard);
    renderCards();
    activationFrameRef.current = requestAnimationFrame(() => {
      activationFrameRef.current = null;
      finishActivation(centeredItem);
    });
  }, [commitCenteredItem, finishActivation, renderCards]);

  const snapTo = useCallback((target: number, options: SnapOptions = {}) => {
    cancelMotion();
    const { focusCard = false, activationItemKey, activationSource } = options;
    if (activationItemKey && activationSource) {
      pendingActivationItemKeyRef.current = activationItemKey;
      activationSourceRef.current = activationSource;
      hasExplicitUserIntentRef.current = true;
    } else {
      pendingActivationItemKeyRef.current = null;
      activationSourceRef.current = null;
      hasExplicitUserIntentRef.current = false;
    }
    updateInteractionPhase("snapping");
    const start = positionRef.current;
    if (Math.abs(target - start) < 0.001) {
      motionFrameRef.current = requestAnimationFrame(() => {
        motionFrameRef.current = null;
        settleSnap(target, focusCard);
      });
      return;
    }

    const startedAt = performance.now();
    const duration = reducedMotionRef.current ? REDUCED_MOTION_SNAP_DURATION_MS : SNAP_DURATION_MS;
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      positionRef.current = start + (target - start) * eased;
      renderCards();
      if (progress < 1) {
        motionFrameRef.current = requestAnimationFrame(step);
        return;
      }
      motionFrameRef.current = null;
      settleSnap(target, focusCard);
    };
    motionFrameRef.current = requestAnimationFrame(step);
  }, [cancelMotion, renderCards, settleSnap, updateInteractionPhase]);

  const snapAfterDrag = useCallback((position: number) => {
    const currentItems = itemsRef.current;
    const snap = getNearestCarouselSnap(position, currentItems.length);
    const targetItem = snap ? currentItems[snap.index] : undefined;
    if (!snap || !targetItem) {
      clearActivationIntent();
      return;
    }
    snapTo(snap.target, {
      activationItemKey: getItemKey(targetItem),
      activationSource: "drag"
    });
  }, [clearActivationIntent, snapTo]);

  const startInertia = useCallback((initialVelocity: number) => {
    cancelMotion();
    hasExplicitUserIntentRef.current = true;
    activationSourceRef.current = "drag";
    pendingActivationItemKeyRef.current = null;
    updateInteractionPhase("snapping");
    if (itemsRef.current.length === 0) {
      clearActivationIntent();
      return;
    }
    if (reducedMotionRef.current || Math.abs(initialVelocity) < INERTIA_STOP_VELOCITY) {
      snapAfterDrag(positionRef.current);
      return;
    }

    let velocity = Math.max(-0.018, Math.min(0.018, initialVelocity));
    let previousTime = performance.now();
    const startedAt = previousTime;
    const step = (now: number) => {
      const elapsed = Math.min(32, Math.max(1, now - previousTime));
      previousTime = now;
      positionRef.current += velocity * elapsed;
      velocity *= Math.pow(INERTIA_FRICTION, elapsed / 16.67);
      renderCards();
      if (Math.abs(velocity) > INERTIA_STOP_VELOCITY && now - startedAt < MAX_INERTIA_MS) {
        motionFrameRef.current = requestAnimationFrame(step);
        return;
      }
      motionFrameRef.current = null;
      snapAfterDrag(positionRef.current);
    };
    motionFrameRef.current = requestAnimationFrame(step);
  }, [cancelMotion, clearActivationIntent, renderCards, snapAfterDrag, updateInteractionPhase]);

  const markGeneratedClickForSuppression = useCallback(() => {
    suppressGeneratedClickRef.current = true;
  }, []);

  const resetPointerSession = useCallback((startInertialMotion: boolean) => {
    const current = pointerSessionRef.current;
    const viewport = viewportRef.current;
    clearLongPress();
    pointerSessionRef.current = null;
    viewport?.removeAttribute("data-dragging");
    if (!current) return null;
    if (current.didCapture) {
      try {
        if (current.captureTarget.hasPointerCapture(current.pointerId)) {
          current.captureTarget.releasePointerCapture(current.pointerId);
        }
      } catch {
        // pointercancel/lostpointercapture 뒤에는 브라우저가 capture를 먼저 해제할 수 있습니다.
      }
    }
    if (current.intent === "horizontal" || current.intent === "vertical" || current.longPressed) {
      markGeneratedClickForSuppression();
    }
    if (startInertialMotion && current.intent === "horizontal") startInertia(current.velocity);
    return current;
  }, [clearLongPress, markGeneratedClickForSuppression, startInertia]);

  const finishPointerInteraction = useCallback((pointerId: number, cancelled: boolean) => {
    const current = pointerSessionRef.current;
    if (!current || current.pointerId !== pointerId) return;
    // 마지막 move 뒤 멈춰 있다가 손을 놓은 동작에는 이전 속도를 관성으로 재사용하지 않습니다.
    if (!cancelled && current.intent === "horizontal" && performance.now() - current.lastTime > 80) {
      current.velocity = 0;
    }
    const finishedSession = resetPointerSession(!cancelled);
    if (cancelled) {
      clearActivationIntent();
      if (finishedSession?.intent === "horizontal") {
        const snap = getNearestCarouselSnap(positionRef.current, itemsRef.current.length);
        if (snap) snapTo(snap.target);
      }
    } else if (finishedSession?.intent !== "horizontal") {
      updateInteractionPhase("idle");
    }
  }, [clearActivationIntent, resetPointerSession, snapTo, updateInteractionPhase]);

  useLayoutEffect(() => {
    itemsRef.current = logicalItems;
    onActivateRef.current = onActivate;
  }, [logicalItems, onActivate]);

  useLayoutEffect(() => {
    const currentItems = logicalItems;
    resetPointerSession(false);
    cancelMotion();
    cancelScheduledRender();
    clearActivationIntent();

    if (activationUnlockTimerRef.current !== null) {
      window.clearTimeout(activationUnlockTimerRef.current);
      activationUnlockTimerRef.current = null;
    }
    activationLockedRef.current = false;
    suppressGeneratedClickRef.current = false;
    updateInteractionPhase("idle");

    const liveItemKeys = new Set(currentItems.map(getItemKey));
    cardRefs.current.forEach((_card, itemKey) => {
      if (!liveItemKeys.has(itemKey)) cardRefs.current.delete(itemKey);
    });

    // ID 목록이 바뀌면 copy/delete/mount 모두 같은 빈 중앙·균형 side slot으로 재구성합니다.
    positionRef.current = 0;
    activeItemKeyRef.current = "";
    setActiveItemKey("");
    scheduleRender();
  // itemsKey intentionally represents stable logical item identity and ordering.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const resizeObserver = new ResizeObserver(scheduleRender);
    resizeObserver.observe(viewport);
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateReducedMotion = () => {
      reducedMotionRef.current = mediaQuery.matches;
      scheduleRender();
    };
    updateReducedMotion();
    mediaQuery.addEventListener?.("change", updateReducedMotion);
    return () => {
      resizeObserver.disconnect();
      mediaQuery.removeEventListener?.("change", updateReducedMotion);
    };
  }, [scheduleRender]);

  useEffect(() => {
    const cancelInteraction = () => {
      const current = resetPointerSession(false);
      cancelMotion();
      clearActivationIntent();
      if (current?.intent === "horizontal") {
        const snap = getNearestCarouselSnap(positionRef.current, itemsRef.current.length);
        if (snap) snapTo(snap.target);
      }
    };
    window.addEventListener("blur", cancelInteraction);
    return () => window.removeEventListener("blur", cancelInteraction);
  }, [cancelMotion, clearActivationIntent, resetPointerSession, snapTo]);

  useEffect(() => {
    const finishOutsideStage = (event: globalThis.PointerEvent) => {
      finishPointerInteraction(event.pointerId, false);
    };
    const cancelOutsideStage = (event: globalThis.PointerEvent) => {
      finishPointerInteraction(event.pointerId, true);
    };
    window.addEventListener("pointerup", finishOutsideStage);
    window.addEventListener("pointercancel", cancelOutsideStage);
    return () => {
      window.removeEventListener("pointerup", finishOutsideStage);
      window.removeEventListener("pointercancel", cancelOutsideStage);
    };
  }, [finishPointerInteraction]);

  useEffect(() => () => {
    clearLongPress();
    cancelMotion();
    cancelScheduledRender();
    if (activationUnlockTimerRef.current !== null) window.clearTimeout(activationUnlockTimerRef.current);
  }, [cancelMotion, cancelScheduledRender, clearLongPress]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      disabled
      || activationLockedRef.current
      || !event.isPrimary
      || pointerSessionRef.current
      || (event.pointerType === "mouse" && event.button !== 0)
    ) return;
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-carousel-item-id]");
    const itemId = target?.dataset.carouselItemId;
    const item = itemId
      ? itemsRef.current.find((candidate) => getItemKey(candidate) === itemId)
      : undefined;

    cancelMotion();
    clearActivationIntent();
    clearLongPress();
    // 앞선 pointer sequence가 합성 click을 만들지 않았더라도 새 정상 탭/클릭은 막지 않습니다.
    suppressGeneratedClickRef.current = false;
    pointerSessionRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      itemId: item ? getItemKey(item) : null,
      captureTarget: event.currentTarget,
      didCapture: false,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      lastX: event.clientX,
      lastTime: performance.now(),
      startPosition: positionRef.current,
      cardStep: getDailyPlanCarouselMetrics(event.currentTarget.getBoundingClientRect().width).cardStep,
      velocity: 0,
      intent: "pending",
      longPressed: false
    };

    if (event.pointerType !== "mouse" && item?.kind === "plan" && onOpenContextMenu) {
      longPressTimerRef.current = window.setTimeout(() => {
        const current = pointerSessionRef.current;
        if (!current || current.pointerId !== event.pointerId || current.intent !== "pending") return;
        current.longPressed = true;
        markGeneratedClickForSuppression();
        cancelMotion();
        clearActivationIntent();
        onOpenContextMenu(item, current.clientX, current.clientY);
      }, LONG_PRESS_MS);
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = pointerSessionRef.current;
    const viewport = viewportRef.current;
    if (!current || !viewport || current.pointerId !== event.pointerId) return;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    // long press 메뉴가 열린 뒤에는 같은 pointer가 캐러셀 drag로 재진입하지 않습니다.
    if (current.longPressed) return;
    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;

    if (current.intent === "pending") {
      const absoluteX = Math.abs(deltaX);
      const absoluteY = Math.abs(deltaY);
      if (absoluteY >= DRAG_THRESHOLD_PX && absoluteY > absoluteX) {
        clearLongPress();
        current.intent = "vertical";
        return;
      }
      if (absoluteX < DRAG_THRESHOLD_PX || absoluteX <= absoluteY) return;
      clearLongPress();
      current.intent = "horizontal";
      // stage가 gesture를 소유하므로 카드 밖으로 나가도 같은 pointer를 계속 추적합니다.
      try {
        current.captureTarget.setPointerCapture(event.pointerId);
        current.didCapture = true;
      } catch {
        current.didCapture = false;
      }
      viewport.setAttribute("data-dragging", "true");
      updateInteractionPhase("dragging");
    }

    if (current.intent !== "horizontal") return;
    if (event.cancelable) event.preventDefault();
    const cardStep = current.cardStep;
    const logicalDelta = (deltaX / cardStep) * DRAG_SENSITIVITY;
    positionRef.current = current.startPosition - logicalDelta;
    const now = performance.now();
    const elapsed = Math.max(1, now - current.lastTime);
    const instantaneousVelocity = -(
      ((event.clientX - current.lastX) / cardStep) * DRAG_SENSITIVITY
    ) / elapsed;
    current.velocity = current.velocity * 0.62 + instantaneousVelocity * 0.38;
    current.lastX = event.clientX;
    current.lastTime = now;
    scheduleRender();
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    finishPointerInteraction(event.pointerId, false);
  }

  function handlePointerCancel(event: PointerEvent<HTMLDivElement>) {
    finishPointerInteraction(event.pointerId, true);
  }

  function handleLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
    const current = pointerSessionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    // 모바일의 원래 카드 implicit capture가 stage capture로 넘어가며 발생한
    // bubbling lostpointercapture는 현재 stage drag 종료 신호가 아닙니다.
    if (event.target !== current.captureTarget) return;
    finishPointerInteraction(event.pointerId, true);
  }

  function requestItemActivation(item: DailyPlanCarouselItem, source: ActivationSource, focusCard: boolean) {
    const currentItems = itemsRef.current;
    const count = currentItems.length;
    const itemKey = getItemKey(item);
    const itemIndex = currentItems.findIndex((candidate) => getItemKey(candidate) === itemKey);
    if (itemIndex < 0 || count === 0 || activationLockedRef.current) return;
    const target = getNearestCarouselItemTarget(itemIndex, positionRef.current, count);
    if (target === null) return;
    snapTo(target, {
      focusCard,
      activationItemKey: itemKey,
      activationSource: source
    });
  }

  function handleCardClick(event: MouseEvent<HTMLButtonElement>, item: DailyPlanCarouselItem) {
    if (suppressGeneratedClickRef.current && event.detail > 0) {
      suppressGeneratedClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    suppressGeneratedClickRef.current = false;
    if (disabled || pointerSessionRef.current?.longPressed) {
      event.preventDefault();
      return;
    }

    requestItemActivation(item, "click", true);
  }

  function handleContextMenu(event: MouseEvent<HTMLButtonElement>, item: DailyPlanCarouselItem) {
    event.preventDefault();
    cancelMotion();
    clearActivationIntent();
    if (!onOpenContextMenu || item.kind !== "plan" || disabled || pointerSessionRef.current?.intent === "horizontal") return;
    const current = pointerSessionRef.current;
    if (current?.intent === "pending") {
      current.longPressed = true;
      markGeneratedClickForSuppression();
    }
    clearLongPress();
    onOpenContextMenu(item, event.clientX, event.clientY);
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLButtonElement>, item: DailyPlanCarouselItem) {
    if (item.kind === "plan" && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
      event.preventDefault();
      if (!onOpenContextMenu) return;
      cancelMotion();
      clearActivationIntent();
      const rect = event.currentTarget.getBoundingClientRect();
      onOpenContextMenu(item, rect.left + rect.width / 2, rect.top + rect.height / 2);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!event.repeat) requestItemActivation(item, "keyboard", true);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      clearActivationIntent();
      const target = getDirectionalCarouselTarget(
        positionRef.current,
        itemsRef.current.length,
        direction
      );
      if (target !== null) snapTo(target, { focusCard: true });
    }
  }

  const interactionProps = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onLostPointerCapture: handleLostPointerCapture,
    onDragStart: (event: DragEvent<HTMLDivElement>) => event.preventDefault()
  };

  return (
    <div
      {...interactionProps}
      ref={viewportRef}
      className="relative mt-5 h-[clamp(14.5rem,62vw,18rem)] w-full min-w-0 cursor-grab overflow-hidden [perspective:1200px] data-[dragging=true]:cursor-grabbing md:mt-6"
      style={{ touchAction: "pan-y", WebkitTouchCallout: "none" }}
      data-carousel-stage
      data-interaction-phase={interactionPhase}
      role="region"
      aria-roledescription="순환 캐러셀"
      aria-label={ariaLabel}
    >
      <div
        ref={selectionSlotRef}
        aria-hidden="true"
        data-carousel-selection-slot
        className="neon-selected pointer-events-none absolute left-1/2 top-1/2 z-0 aspect-[3/4] w-[140px] -translate-x-1/2 -translate-y-1/2 border-2"
      />
      <div className="pointer-events-none absolute inset-0 z-[1] [transform-style:preserve-3d]">
        {logicalItems.map((item) => (
          <CarouselCard
            key={getItemKey(item)}
            ref={(element) => {
              const itemKey = getItemKey(item);
              if (element) cardRefs.current.set(itemKey, element);
              else cardRefs.current.delete(itemKey);
            }}
            item={item}
            itemKey={getItemKey(item)}
            disabled={disabled}
            active={getItemKey(item) === activeItemKey}
            className="absolute left-1/2 top-1/2 w-[132px] will-change-transform motion-reduce:transition-none"
            tabIndex={0}
            onClick={handleCardClick}
            onContextMenu={handleContextMenu}
            onKeyDown={handleCardKeyDown}
          />
        ))}
      </div>
      {activeItemKey ? (
        <span className="sr-only" aria-live="polite">
          {logicalItems.find((item) => getItemKey(item) === activeItemKey)?.ariaLabel
            ?? logicalItems.find((item) => getItemKey(item) === activeItemKey)?.label} 선택됨
        </span>
      ) : null}
    </div>
  );
}

type CarouselCardProps = {
  item: DailyPlanCarouselItem;
  itemKey: string;
  disabled: boolean;
  active?: boolean;
  className?: string;
  tabIndex?: number;
  onClick: (event: MouseEvent<HTMLButtonElement>, item: DailyPlanCarouselItem) => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>, item: DailyPlanCarouselItem) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, item: DailyPlanCarouselItem) => void;
};

const CarouselCard = forwardRef<HTMLButtonElement, CarouselCardProps>(function CarouselCard({
  item,
  itemKey,
  disabled,
  active = false,
  className = "",
  tabIndex,
  onClick,
  onContextMenu,
  onKeyDown
}, ref) {
  const progressPercent = clamp(item.progressPercent ?? 0, 0, 100);
  const titleParts = item.kind === "plan"
    ? [item.label, item.dateLabel ?? "날짜 미정", item.metaLabel].filter(Boolean)
    : [];

  return (
    <button
      ref={ref}
      type="button"
      data-carousel-item-id={itemKey}
      data-plan-id={item.planId}
      disabled={disabled}
      aria-label={item.kind === "new"
        ? active ? "새 일촬표 만들기, 현재 선택됨" : "새 일촬표 만들기 선택"
        : active ? `${item.ariaLabel ?? item.label}, 현재 선택됨` : `${item.ariaLabel ?? item.label} 선택`
      }
      aria-current={active ? "true" : undefined}
      tabIndex={tabIndex}
      className={`${className} flex aspect-[3/4] shrink-0 select-none items-center justify-center overflow-hidden rounded-[10px] border-2 bg-field-panel px-3 text-center outline-none transition-[border-color,background-color] hover:border-field-subtle hover:bg-field-hover focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
        active ? "neon-selected" : "border-field-divider"
      } ${
        item.kind === "new"
          ? "text-5xl font-light leading-none text-field-text"
          : "text-lg font-black leading-[1.35] text-field-text md:text-xl"
      }`}
      title={titleParts.length > 0 ? titleParts.join(" · ") : undefined}
      onClick={(event) => onClick(event, item)}
      onContextMenu={(event) => onContextMenu(event, item)}
      onKeyDown={(event) => onKeyDown(event, item)}
    >
      {item.kind === "new" ? (
        <span className="relative z-[1] block max-w-full truncate">+</span>
      ) : (
        <>
          {item.progressPercent !== undefined ? (
            <span
              aria-hidden="true"
              data-progress-fill
              className="pointer-events-none absolute inset-x-0 bottom-0 z-0 bg-field-primary-soft-strong transition-[height] duration-300 ease-out motion-reduce:transition-none"
              style={{ height: `${progressPercent}%` }}
            />
          ) : null}
          <span className="relative z-[1] grid max-w-full gap-2">
            <span className="block max-w-full truncate">{item.label}</span>
            <span className="block whitespace-nowrap text-sm font-bold leading-[1.35] tabular-nums text-field-muted md:text-[15px]">
              {item.dateLabel ?? "날짜 미정"}
            </span>
            {item.metaLabel ? (
              <span className="block whitespace-nowrap text-sm font-black leading-[1.35] tabular-nums text-field-subtle md:text-[15px]">
                {item.metaLabel}
              </span>
            ) : null}
          </span>
        </>
      )}
    </button>
  );
});

function getItemKey(item: DailyPlanCarouselItem) {
  const planId = String(item.planId ?? "").trim();
  if (item.kind === "plan") return planId ? `daily-plan:${planId}` : "";
  return String(item.id ?? "").trim();
}

/** 잘못 중복된 조회 결과도 DOM/React key 계층으로 들어오기 전에 stable ID로 한 번만 남깁니다. */
function dedupeLogicalItems(items: DailyPlanCarouselItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const itemKey = getItemKey(item);
    if (!itemKey || seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

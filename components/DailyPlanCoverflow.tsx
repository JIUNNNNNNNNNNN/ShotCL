"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent
} from "react";

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
const SINGLE_CARD_ELASTIC_FACTOR = 0.2;
const SINGLE_CARD_ELASTIC_LIMIT = 0.55;
const INITIAL_EMPTY_POSITION = 0.5;
const INITIAL_EMPTY_SPREAD = 1.8;
const ACTIVATION_LOCK_MS = 1_500;

/** 카드 수와 무관하게 logical item 하나당 DOM 카드 하나만 사용하는 순환 coverflow입니다. */
export function DailyPlanCoverflow({
  items,
  disabled = false,
  onActivate,
  onOpenContextMenu,
  ariaLabel = "일촬표 선택 카드"
}: DailyPlanCoverflowProps) {
  const [activeItemKey, setActiveItemKey] = useState("");
  const [interactionPhase, setInteractionPhase] = useState<InteractionPhase>("idle");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const selectionSlotRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const itemsRef = useRef(items);
  const onActivateRef = useRef(onActivate);
  const positionRef = useRef(INITIAL_EMPTY_POSITION);
  const activeItemKeyRef = useRef("");
  const pendingActivationItemKeyRef = useRef<string | null>(null);
  const activationSourceRef = useRef<ActivationSource | null>(null);
  const hasExplicitUserIntentRef = useRef(false);
  const activationLockedRef = useRef(false);
  const activationUnlockTimerRef = useRef<number | null>(null);
  const didInitializeRef = useRef(false);
  const pointerSessionRef = useRef<PointerSession | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const motionFrameRef = useRef<number | null>(null);
  const activationFrameRef = useRef<number | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const suppressGeneratedClickRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const itemsKey = items.map((item) => item.id).join("|");
  itemsRef.current = items;
  onActivateRef.current = onActivate;

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
    if (!viewport || count === 0) return;
    const { cardWidth, cardStep } = getCardMetrics(viewport.clientWidth);
    if (selectionSlotRef.current) selectionSlotRef.current.style.width = `${cardWidth + 8}px`;
    const normalizedPosition = count === 1 ? positionRef.current : positiveModulo(positionRef.current, count);
    const reduceMotion = reducedMotionRef.current;

    currentItems.forEach((item, index) => {
      const card = cardRefs.current.get(item.id);
      if (!card) return;
      const distance = count === 1
        ? -normalizedPosition
        : getCircularDistance(index, normalizedPosition, count);
      const absoluteDistance = Math.abs(distance);
      const visible = absoluteDistance <= 3.1;
      const baseSpreadDistance = absoluteDistance <= 1
        ? absoluteDistance
        : 1 + (absoluteDistance - 1) * 0.85;
      const spreadDistance = activeItemKeyRef.current
        ? baseSpreadDistance
        : baseSpreadDistance * INITIAL_EMPTY_SPREAD;
      const rotation = reduceMotion ? 0 : -Math.sign(distance) * Math.min(24, absoluteDistance * 16);
      const scale = absoluteDistance <= 1
        ? 1 - absoluteDistance * 0.09
        : Math.max(0.72, 0.91 - (absoluteDistance - 1) * 0.1);
      const translateX = Math.sign(distance) * spreadDistance * cardStep;
      const translateZ = -Math.min(260, absoluteDistance * 86);

      card.style.width = `${cardWidth}px`;
      card.style.transform = `translate(-50%, -50%) translate3d(${translateX}px, 0, ${translateZ}px) rotateY(${rotation}deg) scale(${scale})`;
      card.style.opacity = visible ? String(Math.max(0.24, 1 - absoluteDistance * 0.18)) : "0";
      card.style.zIndex = String(Math.max(1, 100 - Math.round(absoluteDistance * 20)));
      card.style.pointerEvents = visible ? "auto" : "none";
      card.style.visibility = visible ? "visible" : "hidden";
    });
  }, []);

  const scheduleRender = useCallback(() => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = requestAnimationFrame(() => {
      renderFrameRef.current = null;
      renderCards();
    });
  }, [renderCards]);

  const commitCenteredItem = useCallback((logicalPosition: number, focusCard = false) => {
    const currentItems = itemsRef.current;
    if (currentItems.length === 0) {
      activeItemKeyRef.current = "";
      setActiveItemKey("");
      return null;
    }
    const nextIndex = positiveModulo(Math.round(logicalPosition), currentItems.length);
    const nextItem = currentItems[nextIndex];
    activeItemKeyRef.current = nextItem.id;
    setActiveItemKey(nextItem.id);
    if (focusCard) {
      requestAnimationFrame(() => cardRefs.current.get(nextItem.id)?.focus());
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
      || pendingItemKey !== centeredItem.id
      || activationLockedRef.current
    ) {
      updateInteractionPhase("idle");
      return;
    }

    activationLockedRef.current = true;
    updateInteractionPhase("activating");
    if (renderFrameRef.current !== null) {
      cancelAnimationFrame(renderFrameRef.current);
      renderFrameRef.current = null;
    }

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
  }, [updateInteractionPhase]);

  const settleSnap = useCallback((target: number, focusCard: boolean) => {
    const settledPosition = normalizeSnappedPosition(target, itemsRef.current.length);
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

  const snapAfterDrag = useCallback((target: number) => {
    const targetItem = getItemAtTargetPosition(target, itemsRef.current);
    if (!targetItem) {
      clearActivationIntent();
      return;
    }
    snapTo(target, {
      activationItemKey: targetItem.id,
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
    if (itemsRef.current.length === 1) {
      snapAfterDrag(0);
      return;
    }
    if (reducedMotionRef.current || Math.abs(initialVelocity) < INERTIA_STOP_VELOCITY) {
      snapAfterDrag(Math.round(positionRef.current));
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
      snapAfterDrag(Math.round(positionRef.current));
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
        snapTo(itemsRef.current.length <= 1 ? 0 : Math.round(positionRef.current));
      }
    } else if (finishedSession?.intent !== "horizontal") {
      updateInteractionPhase("idle");
    }
  }, [clearActivationIntent, resetPointerSession, snapTo, updateInteractionPhase]);

  useLayoutEffect(() => {
    const currentItems = itemsRef.current;
    resetPointerSession(false);
    cancelMotion();
    clearActivationIntent();
    const preservedIndex = currentItems.findIndex((item) => item.id === activeItemKeyRef.current);
    if (!didInitializeRef.current || preservedIndex < 0) {
      positionRef.current = INITIAL_EMPTY_POSITION;
      activeItemKeyRef.current = "";
      setActiveItemKey("");
      didInitializeRef.current = true;
    } else {
      positionRef.current = preservedIndex;
      activeItemKeyRef.current = currentItems[preservedIndex]?.id ?? "";
      setActiveItemKey(currentItems[preservedIndex]?.id ?? "");
    }
    renderCards();
  // itemsKey intentionally represents stable logical item identity and ordering.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const resizeObserver = new ResizeObserver(renderCards);
    resizeObserver.observe(viewport);
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateReducedMotion = () => {
      reducedMotionRef.current = mediaQuery.matches;
      renderCards();
    };
    updateReducedMotion();
    mediaQuery.addEventListener?.("change", updateReducedMotion);
    return () => {
      resizeObserver.disconnect();
      mediaQuery.removeEventListener?.("change", updateReducedMotion);
    };
  }, [renderCards]);

  useEffect(() => {
    const cancelInteraction = () => {
      const current = resetPointerSession(false);
      cancelMotion();
      clearActivationIntent();
      if (current?.intent === "horizontal") {
        snapTo(itemsRef.current.length <= 1 ? 0 : Math.round(positionRef.current));
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
    if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current);
    if (activationUnlockTimerRef.current !== null) window.clearTimeout(activationUnlockTimerRef.current);
  }, [cancelMotion, clearLongPress]);

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
    const item = itemId ? items.find((candidate) => candidate.id === itemId) : undefined;

    cancelMotion();
    clearActivationIntent();
    clearLongPress();
    // 앞선 pointer sequence가 합성 click을 만들지 않았더라도 새 정상 탭/클릭은 막지 않습니다.
    suppressGeneratedClickRef.current = false;
    pointerSessionRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      itemId: item?.id ?? null,
      captureTarget: event.currentTarget,
      didCapture: false,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      lastX: event.clientX,
      lastTime: performance.now(),
      startPosition: positionRef.current,
      cardStep: getCardMetrics(event.currentTarget.clientWidth).cardStep,
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
    positionRef.current = itemsRef.current.length <= 1
      ? clamp(
        current.startPosition - logicalDelta * SINGLE_CARD_ELASTIC_FACTOR,
        -SINGLE_CARD_ELASTIC_LIMIT,
        SINGLE_CARD_ELASTIC_LIMIT
      )
      : current.startPosition - logicalDelta;
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
    const itemIndex = currentItems.findIndex((candidate) => candidate.id === item.id);
    if (itemIndex < 0 || count === 0 || activationLockedRef.current) return;
    snapTo(getNearestTargetPosition(itemIndex, positionRef.current, count), {
      focusCard,
      activationItemKey: item.id,
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
      snapTo(getDirectionalTargetPosition(
        positionRef.current,
        itemsRef.current.length,
        direction,
        Boolean(activeItemKeyRef.current)
      ), { focusCard: true });
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
        className="pointer-events-none absolute left-1/2 top-1/2 z-0 aspect-[3/4] w-[140px] -translate-x-1/2 -translate-y-1/2 border-2 border-field-primary/45"
      />
      <div className="pointer-events-none absolute inset-0 z-[1] [transform-style:preserve-3d]">
        {items.map((item) => (
          <CarouselCard
            key={item.id}
            ref={(element) => {
              if (element) cardRefs.current.set(item.id, element);
              else cardRefs.current.delete(item.id);
            }}
            item={item}
            disabled={disabled}
            active={item.id === activeItemKey}
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
          {items.find((item) => item.id === activeItemKey)?.ariaLabel
            ?? items.find((item) => item.id === activeItemKey)?.label} 선택됨
        </span>
      ) : null}
    </div>
  );
}

type CarouselCardProps = {
  item: DailyPlanCarouselItem;
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
      data-carousel-item-id={item.id}
      data-plan-id={item.planId}
      disabled={disabled}
      aria-label={item.kind === "new"
        ? active ? "새 일촬표 만들기, 현재 선택됨" : "새 일촬표 만들기 선택"
        : active ? `${item.ariaLabel ?? item.label}, 현재 선택됨` : `${item.ariaLabel ?? item.label} 선택`
      }
      aria-current={active ? "true" : undefined}
      tabIndex={tabIndex}
      className={`${className} flex aspect-[3/4] shrink-0 select-none items-center justify-center overflow-hidden border-2 bg-field-panel px-3 text-center outline-none transition-[border-color,background-color] hover:border-field-subtle hover:bg-field-hover focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
        active ? "border-field-primary/80 bg-field-primary/10" : "border-field-divider"
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
              className="pointer-events-none absolute inset-x-0 bottom-0 z-0 bg-field-primary/20 transition-[height] duration-300 ease-out motion-reduce:transition-none"
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

function getCardMetrics(viewportWidth: number) {
  const cardWidth = clamp(viewportWidth * 0.34, 124, 168);
  const cardGap = clamp(viewportWidth * 0.055, 24, 52);
  return {
    cardWidth,
    cardGap,
    cardStep: cardWidth + cardGap
  };
}

function getCircularDistance(itemIndex: number, position: number, count: number) {
  if (count <= 1 || !Number.isFinite(position)) return 0;
  return wrappedDistance(itemIndex - positiveModulo(position, count), count);
}

function getNearestTargetPosition(itemIndex: number, position: number, count: number) {
  if (count <= 1 || !Number.isFinite(position)) return 0;
  return position + getCircularDistance(itemIndex, position, count);
}

function getItemAtTargetPosition(target: number, items: DailyPlanCarouselItem[]) {
  if (items.length === 0) return null;
  return items[positiveModulo(Math.round(target), items.length)] ?? null;
}

function getDirectionalTargetPosition(position: number, count: number, direction: -1 | 1, hasCenteredItem: boolean) {
  if (count <= 1 || !Number.isFinite(position)) return 0;
  if (!hasCenteredItem) return direction > 0 ? Math.ceil(position) : Math.floor(position);
  return Math.round(position) + direction;
}

function normalizeSnappedPosition(position: number, count: number) {
  if (count <= 1 || !Number.isFinite(position)) return 0;
  return positiveModulo(Math.round(position), count);
}

function wrappedDistance(value: number, count: number) {
  if (count <= 1 || !Number.isFinite(value)) return 0;
  let result = value;
  const half = count / 2;
  while (result > half) result -= count;
  while (result < -half) result += count;
  return result;
}

function positiveModulo(value: number, divisor: number) {
  if (divisor <= 0 || !Number.isFinite(value)) return 0;
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

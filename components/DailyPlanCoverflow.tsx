"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent
} from "react";

export type DailyPlanCarouselItem = {
  id: string;
  kind: "new" | "plan";
  label: string;
  planId?: string;
};

type DailyPlanCoverflowProps = {
  items: DailyPlanCarouselItem[];
  disabled?: boolean;
  onActivate: (item: DailyPlanCarouselItem) => void;
  onOpenContextMenu: (item: DailyPlanCarouselItem, clientX: number, clientY: number) => void;
};

type PointerSession = {
  pointerId: number;
  pointerType: string;
  itemId: string;
  captureTarget: HTMLButtonElement;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  lastX: number;
  lastTime: number;
  startPosition: number;
  velocity: number;
  intent: "pending" | "horizontal" | "vertical" | "cancelled";
  longPressed: boolean;
};

const DRAG_THRESHOLD_PX = 8;
const LONG_PRESS_MS = 600;
const INERTIA_FRICTION = 0.91;
const INERTIA_STOP_VELOCITY = 0.00075;
const MAX_INERTIA_MS = 950;
const SNAP_DURATION_MS = 280;

/** 4장 이상에서는 실제 item을 복제하지 않고 logical index를 순환시키는 coverflow입니다. */
export function DailyPlanCoverflow({
  items,
  disabled = false,
  onActivate,
  onOpenContextMenu
}: DailyPlanCoverflowProps) {
  const coverflowActive = items.length >= 4;
  const [activeIndex, setActiveIndex] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const itemsRef = useRef(items);
  const positionRef = useRef(0);
  const activeItemIdRef = useRef(items[0]?.id ?? "");
  const pointerSessionRef = useRef<PointerSession | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const motionFrameRef = useRef<number | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const suppressGeneratedClickRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const itemsKey = items.map((item) => item.id).join("|");
  itemsRef.current = items;

  const cancelMotion = useCallback(() => {
    if (motionFrameRef.current !== null) {
      cancelAnimationFrame(motionFrameRef.current);
      motionFrameRef.current = null;
    }
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const renderCards = useCallback(() => {
    const currentItems = itemsRef.current;
    const count = currentItems.length;
    const viewport = viewportRef.current;
    if (!viewport || count === 0 || count < 4) return;
    const spacing = getCardSpacing(viewport.clientWidth);
    const normalizedPosition = positiveModulo(positionRef.current, count);
    const reduceMotion = reducedMotionRef.current;

    currentItems.forEach((item, index) => {
      const card = cardRefs.current.get(item.id);
      if (!card) return;
      const distance = wrappedDistance(index - normalizedPosition, count);
      const absoluteDistance = Math.abs(distance);
      const visible = absoluteDistance <= 3.1;
      const rotation = reduceMotion ? 0 : Math.sign(distance) * -Math.min(22, 14 + absoluteDistance * 3);
      const scale = Math.max(0.68, 1 - absoluteDistance * 0.13);
      const translateX = distance * spacing;
      const translateZ = -Math.min(260, absoluteDistance * 86);

      card.style.transform = `translate(-50%, -50%) translate3d(${translateX}px, 0, ${translateZ}px) rotateY(${rotation}deg) scale(${scale})`;
      card.style.opacity = visible ? String(Math.max(0.22, 1 - absoluteDistance * 0.19)) : "0";
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

  const commitActiveIndex = useCallback((logicalPosition: number, focusCard = false) => {
    const currentItems = itemsRef.current;
    if (currentItems.length === 0) return;
    const nextIndex = positiveModulo(Math.round(logicalPosition), currentItems.length);
    const nextItem = currentItems[nextIndex];
    activeItemIdRef.current = nextItem.id;
    setActiveIndex(nextIndex);
    if (focusCard) {
      requestAnimationFrame(() => cardRefs.current.get(nextItem.id)?.focus());
    }
  }, []);

  const snapTo = useCallback((target: number, focusCard = false) => {
    cancelMotion();
    const start = positionRef.current;
    if (reducedMotionRef.current || Math.abs(target - start) < 0.001) {
      positionRef.current = target;
      renderCards();
      commitActiveIndex(target, focusCard);
      return;
    }

    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / SNAP_DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      positionRef.current = start + (target - start) * eased;
      renderCards();
      if (progress < 1) {
        motionFrameRef.current = requestAnimationFrame(step);
        return;
      }
      motionFrameRef.current = null;
      positionRef.current = target;
      renderCards();
      commitActiveIndex(target, focusCard);
    };
    motionFrameRef.current = requestAnimationFrame(step);
  }, [cancelMotion, commitActiveIndex, renderCards]);

  const startInertia = useCallback((initialVelocity: number) => {
    cancelMotion();
    if (reducedMotionRef.current || Math.abs(initialVelocity) < INERTIA_STOP_VELOCITY) {
      snapTo(Math.round(positionRef.current));
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
      snapTo(Math.round(positionRef.current));
    };
    motionFrameRef.current = requestAnimationFrame(step);
  }, [cancelMotion, renderCards, snapTo]);

  const markGeneratedClickForSuppression = useCallback(() => {
    suppressGeneratedClickRef.current = true;
  }, []);

  const resetPointerSession = useCallback((startInertialMotion: boolean) => {
    const current = pointerSessionRef.current;
    const viewport = viewportRef.current;
    clearLongPress();
    pointerSessionRef.current = null;
    viewport?.removeAttribute("data-dragging");
    if (!current) return;
    if (current.captureTarget.hasPointerCapture(current.pointerId)) {
      current.captureTarget.releasePointerCapture(current.pointerId);
    }
    if (current.intent === "horizontal" || current.intent === "cancelled" || current.longPressed) {
      markGeneratedClickForSuppression();
    }
    if (startInertialMotion && current.intent === "horizontal") startInertia(current.velocity);
  }, [clearLongPress, markGeneratedClickForSuppression, startInertia]);

  useLayoutEffect(() => {
    const currentItems = itemsRef.current;
    cancelMotion();
    const preservedIndex = currentItems.findIndex((item) => item.id === activeItemIdRef.current);
    const nextIndex = preservedIndex >= 0
      ? preservedIndex
      : Math.min(activeIndex, Math.max(0, currentItems.length - 1));
    positionRef.current = nextIndex;
    activeItemIdRef.current = currentItems[nextIndex]?.id ?? "";
    setActiveIndex(nextIndex);
    renderCards();
  // itemsKey intentionally represents stable logical item identity and ordering.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, coverflowActive]);

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
      resetPointerSession(false);
      cancelMotion();
      if (coverflowActive) snapTo(Math.round(positionRef.current));
    };
    window.addEventListener("blur", cancelInteraction);
    return () => window.removeEventListener("blur", cancelInteraction);
  }, [cancelMotion, coverflowActive, resetPointerSession, snapTo]);

  useEffect(() => () => {
    clearLongPress();
    cancelMotion();
    if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current);
  }, [cancelMotion, clearLongPress]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-carousel-item-id]");
    const itemId = target?.dataset.carouselItemId;
    if (!itemId) return;
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;

    cancelMotion();
    clearLongPress();
    // 앞선 pointer sequence가 합성 click을 만들지 않았더라도 새 정상 탭/클릭은 막지 않습니다.
    suppressGeneratedClickRef.current = false;
    pointerSessionRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      itemId,
      captureTarget: target,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      lastX: event.clientX,
      lastTime: performance.now(),
      startPosition: positionRef.current,
      velocity: 0,
      intent: "pending",
      longPressed: false
    };
    // 부모 stage가 capture하면 일부 브라우저에서 합성 click도 부모로 재지정됩니다.
    // 실제 카드 button이 capture해야 짧은 click/tap의 target을 그대로 보존할 수 있습니다.
    target.setPointerCapture(event.pointerId);

    if (event.pointerType !== "mouse" && item.kind === "plan") {
      longPressTimerRef.current = window.setTimeout(() => {
        const current = pointerSessionRef.current;
        if (!current || current.pointerId !== event.pointerId || current.intent !== "pending") return;
        current.longPressed = true;
        cancelMotion();
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
    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;

    if (current.intent === "pending" && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD_PX) {
      clearLongPress();
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        current.intent = "vertical";
        return;
      }
      if (!coverflowActive) {
        current.intent = "cancelled";
        return;
      }
      current.intent = "horizontal";
      viewport.setAttribute("data-dragging", "true");
    }

    if (current.intent !== "horizontal") return;
    if (event.cancelable) event.preventDefault();
    const spacing = getCardSpacing(viewport.clientWidth);
    positionRef.current = current.startPosition - deltaX / spacing;
    const now = performance.now();
    const elapsed = Math.max(1, now - current.lastTime);
    const instantaneousVelocity = -((event.clientX - current.lastX) / spacing) / elapsed;
    current.velocity = current.velocity * 0.62 + instantaneousVelocity * 0.38;
    current.lastX = event.clientX;
    current.lastTime = now;
    scheduleRender();
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = pointerSessionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    // 마지막 move 뒤 멈춰 있다가 손을 놓은 동작에는 이전 속도를 관성으로 재사용하지 않습니다.
    if (current.intent === "horizontal" && performance.now() - current.lastTime > 80) {
      current.velocity = 0;
    }
    resetPointerSession(true);
  }

  function handlePointerCancel(event: PointerEvent<HTMLDivElement>) {
    const current = pointerSessionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    resetPointerSession(false);
    if (coverflowActive) snapTo(Math.round(positionRef.current));
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
    onActivate(item);
  }

  function handleContextMenu(event: MouseEvent<HTMLButtonElement>, item: DailyPlanCarouselItem) {
    event.preventDefault();
    if (item.kind !== "plan" || disabled || pointerSessionRef.current?.intent === "horizontal") return;
    clearLongPress();
    cancelMotion();
    onOpenContextMenu(item, event.clientX, event.clientY);
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLButtonElement>, item: DailyPlanCarouselItem) {
    if (item.kind === "plan" && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
      event.preventDefault();
      cancelMotion();
      const rect = event.currentTarget.getBoundingClientRect();
      onOpenContextMenu(item, rect.left + rect.width / 2, rect.top + rect.height / 2);
      return;
    }
    if (coverflowActive && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      snapTo(Math.round(positionRef.current) + direction, true);
    }
  }

  const interactionProps = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onDragStart: (event: DragEvent<HTMLDivElement>) => event.preventDefault()
  };

  if (!coverflowActive) {
    return (
      <div
        {...interactionProps}
        ref={viewportRef}
        className="mt-3 flex w-full min-w-0 flex-nowrap items-center justify-center gap-2 overflow-hidden py-2"
        style={{ touchAction: "pan-y" }}
        aria-label="일촬표 선택 카드"
      >
        {items.map((item) => (
          <CarouselCard
            key={item.id}
            item={item}
            disabled={disabled}
            style={getSimpleCardStyle(items.length)}
            onClick={handleCardClick}
            onContextMenu={handleContextMenu}
            onKeyDown={handleCardKeyDown}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      {...interactionProps}
      ref={viewportRef}
      className="relative mt-2 h-[clamp(16rem,70vw,20rem)] w-full min-w-0 cursor-grab overflow-hidden [perspective:1200px] data-[dragging=true]:cursor-grabbing"
      style={{ touchAction: "pan-y" }}
      role="region"
      aria-roledescription="순환 캐러셀"
      aria-label="일촬표 선택 카드"
    >
      <div className="absolute inset-0 [transform-style:preserve-3d]">
        {items.map((item, index) => (
          <CarouselCard
            key={item.id}
            ref={(element) => {
              if (element) cardRefs.current.set(item.id, element);
              else cardRefs.current.delete(item.id);
            }}
            item={item}
            disabled={disabled}
            active={index === activeIndex}
            className="absolute left-1/2 top-1/2 w-[clamp(9.25rem,42vw,12.75rem)] will-change-transform motion-reduce:transition-none"
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={handleCardClick}
            onContextMenu={handleContextMenu}
            onKeyDown={handleCardKeyDown}
          />
        ))}
      </div>
    </div>
  );
}

type CarouselCardProps = {
  item: DailyPlanCarouselItem;
  disabled: boolean;
  active?: boolean;
  className?: string;
  style?: CSSProperties;
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
  style,
  tabIndex,
  onClick,
  onContextMenu,
  onKeyDown
}, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-carousel-item-id={item.id}
      data-plan-id={item.planId}
      disabled={disabled}
      aria-label={item.kind === "new" ? "새 일촬표 만들기" : `${item.label} 일촬표 열기`}
      aria-current={active ? "true" : undefined}
      tabIndex={tabIndex}
      className={`${className} flex aspect-[3/4] shrink-0 select-none items-center justify-center overflow-hidden rounded-[3px] border bg-white px-3 text-center outline-none transition-[border-color,background-color] hover:border-field-primary hover:bg-field-light focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
        item.kind === "new"
          ? "border-field-primary text-5xl font-light leading-none text-field-primary"
          : "border-field-border text-lg font-black leading-[1.35] text-field-primary md:text-xl"
      }`}
      style={style}
      title={item.kind === "plan" ? item.label : undefined}
      onClick={(event) => onClick(event, item)}
      onContextMenu={(event) => {
        if (item.kind === "new") {
          event.preventDefault();
          return;
        }
        onContextMenu(event, item);
      }}
      onKeyDown={(event) => onKeyDown(event, item)}
    >
      <span className="block max-w-full truncate">{item.kind === "new" ? "+" : item.label}</span>
    </button>
  );
});

function getCardSpacing(viewportWidth: number) {
  const estimatedCardWidth = Math.min(204, Math.max(148, viewportWidth * 0.42));
  return Math.min(estimatedCardWidth * 0.76, Math.max(92, viewportWidth * 0.235));
}

function wrappedDistance(value: number, count: number) {
  let result = value;
  const half = count / 2;
  while (result > half) result -= count;
  while (result < -half) result += count;
  return result;
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function getSimpleCardStyle(count: number): CSSProperties {
  if (count <= 1) return { width: "min(12.75rem, 58vw)" };
  if (count === 2) return { width: "min(12.75rem, calc((100% - 0.5rem) / 2))" };
  return { width: "min(12.75rem, calc((100% - 1rem) / 3))" };
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export type SpinnerTargetState = "outside" | "magnet" | "inside";

export type SpinnerTargetMeasurement = {
  state: SpinnerTargetState;
  overlapRatio: number;
  centerDistance: number;
  bubbleRadius: number;
  targetRadius: number;
};

type DragSpinnerOptions = {
  itemCount: number;
  onCommit: (index: number) => void;
  onReject?: () => void;
  measureTarget?: (index: number) => SpinnerTargetMeasurement;
  activationKey?: string | number | boolean | null;
  activationThresholdDegrees?: number;
  settleDelayMs?: number;
  snapDurationMs?: number;
  bounceDurationMs?: number;
};

type SnapOptions = {
  commit?: boolean;
};

export const SPINNER_ACTIVATION_THRESHOLD_DEGREES = 12;
export const SPINNER_TARGET_OVERLAP_THRESHOLD = 0.5;
export const SPINNER_BOUNCE_MARGIN_DEGREES = 4;

export function normalizeSpinnerAngle(angle: number) {
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

export function getSpinnerItemAngle(index: number, itemCount: number) {
  return itemCount > 0 ? (index * 360) / itemCount : 0;
}

function emptyTargetMeasurement(): SpinnerTargetMeasurement {
  return {
    state: "outside",
    overlapRatio: 0,
    centerDistance: Number.POSITIVE_INFINITY,
    bubbleRadius: 0,
    targetRadius: 0
  };
}

function circleIntersectionArea(firstRadius: number, secondRadius: number, distance: number) {
  if (distance >= firstRadius + secondRadius) return 0;
  if (distance <= Math.abs(firstRadius - secondRadius)) {
    return Math.PI * Math.min(firstRadius, secondRadius) ** 2;
  }

  const firstCosine = (distance ** 2 + firstRadius ** 2 - secondRadius ** 2)
    / (2 * distance * firstRadius);
  const secondCosine = (distance ** 2 + secondRadius ** 2 - firstRadius ** 2)
    / (2 * distance * secondRadius);
  const firstAngle = Math.acos(Math.min(1, Math.max(-1, firstCosine)));
  const secondAngle = Math.acos(Math.min(1, Math.max(-1, secondCosine)));
  const lensArea = 0.5 * Math.sqrt(
    Math.max(
      0,
      (-distance + firstRadius + secondRadius)
      * (distance + firstRadius - secondRadius)
      * (distance - firstRadius + secondRadius)
      * (distance + firstRadius + secondRadius)
    )
  );

  return firstRadius ** 2 * firstAngle + secondRadius ** 2 * secondAngle - lensArea;
}

/** 화면에 그려진 두 원의 실제 겹침을 기준으로 클릭/자석 스냅 가능 상태를 판정합니다. */
export function getBubbleTargetMeasurement(
  bubble: Element | null | undefined,
  target: Element | null | undefined
): SpinnerTargetMeasurement {
  if (!bubble || !target) {
    return emptyTargetMeasurement();
  }

  const bubbleBounds = bubble.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  const bubbleLayoutWidth = "offsetWidth" in bubble && typeof bubble.offsetWidth === "number"
    ? bubble.offsetWidth
    : bubbleBounds.width;
  const bubbleLayoutHeight = "offsetHeight" in bubble && typeof bubble.offsetHeight === "number"
    ? bubble.offsetHeight
    : bubbleBounds.height;
  const targetLayoutWidth = "offsetWidth" in target && typeof target.offsetWidth === "number"
    ? target.offsetWidth
    : targetBounds.width;
  const targetLayoutHeight = "offsetHeight" in target && typeof target.offsetHeight === "number"
    ? target.offsetHeight
    : targetBounds.height;
  const bubbleRadius = Math.min(bubbleLayoutWidth, bubbleLayoutHeight) / 2;
  const targetRadius = Math.min(targetLayoutWidth, targetLayoutHeight) / 2;
  if (bubbleRadius <= 0 || targetRadius <= 0) {
    return emptyTargetMeasurement();
  }

  const bubbleCenterX = bubbleBounds.left + bubbleBounds.width / 2;
  const bubbleCenterY = bubbleBounds.top + bubbleBounds.height / 2;
  const targetCenterX = targetBounds.left + targetBounds.width / 2;
  const targetCenterY = targetBounds.top + targetBounds.height / 2;
  const centerDistance = Math.hypot(
    bubbleCenterX - targetCenterX,
    bubbleCenterY - targetCenterY
  );
  const overlapArea = circleIntersectionArea(bubbleRadius, targetRadius, centerDistance);
  const overlapRatio = Math.min(1, overlapArea / (Math.PI * bubbleRadius ** 2));

  if (centerDistance + bubbleRadius <= targetRadius) {
    return { state: "inside", overlapRatio, centerDistance, bubbleRadius, targetRadius };
  }
  if (overlapRatio >= SPINNER_TARGET_OVERLAP_THRESHOLD) {
    return { state: "magnet", overlapRatio, centerDistance, bubbleRadius, targetRadius };
  }
  return { state: "outside", overlapRatio, centerDistance, bubbleRadius, targetRadius };
}

export function getSpinnerActivationIndex(
  rotation: number,
  itemCount: number,
  thresholdDegrees = SPINNER_ACTIVATION_THRESHOLD_DEGREES
) {
  if (itemCount <= 0) return null;

  let activationIndex: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < itemCount; index += 1) {
    const distance = Math.abs(
      normalizeSpinnerAngle(getSpinnerItemAngle(index, itemCount) + rotation)
    );
    if (distance <= thresholdDegrees && distance < nearestDistance) {
      activationIndex = index;
      nearestDistance = distance;
    }
  }
  return activationIndex;
}

function getNearestItemIndex(rotation: number, itemCount: number) {
  if (itemCount <= 1) return 0;

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < itemCount; index += 1) {
    const distance = Math.abs(normalizeSpinnerAngle(getSpinnerItemAngle(index, itemCount) + rotation));
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

function getSpinnerBounceRotation(
  rotation: number,
  itemCount: number,
  index: number,
  measurement: SpinnerTargetMeasurement
) {
  const signedAngle = normalizeSpinnerAngle(getSpinnerItemAngle(index, itemCount) + rotation);
  const currentAngle = Math.abs(signedAngle);
  const direction = signedAngle < 0 ? -1 : 1;
  const halfAngleSine = Math.sin((currentAngle * Math.PI / 180) / 2);

  if (
    currentAngle <= 0
    || halfAngleSine <= 0
    || !Number.isFinite(measurement.centerDistance)
    || measurement.bubbleRadius <= 0
    || measurement.targetRadius <= 0
  ) {
    return rotation + direction * 12;
  }

  const orbitRadius = measurement.centerDistance / (2 * halfAngleSine);
  const clearCenterDistance = measurement.bubbleRadius + measurement.targetRadius;
  const clearRatio = Math.min(1, clearCenterDistance / (2 * orbitRadius));
  const clearAngle = 2 * Math.asin(clearRatio) * (180 / Math.PI);
  const targetAngle = Math.min(
    90,
    Math.max(currentAngle + SPINNER_BOUNCE_MARGIN_DEGREES, clearAngle + SPINNER_BOUNCE_MARGIN_DEGREES)
  );

  return rotation + direction * (targetAngle - currentAngle);
}

/** 휠 없이 pointer drag로 회전하며 3시 실행 구역 안에서만 스냅하는 공용 spinner 동작입니다. */
export function useDragSpinner({
  itemCount,
  onCommit,
  onReject,
  measureTarget,
  activationKey = null,
  activationThresholdDegrees = SPINNER_ACTIVATION_THRESHOLD_DEGREES,
  settleDelayMs = 220,
  snapDurationMs = 260,
  bounceDurationMs = 280
}: DragSpinnerOptions) {
  const [rotation, setRotation] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activationIndex, setActivationIndex] = useState<number | null>(itemCount > 0 ? 0 : null);
  const [activationState, setActivationState] = useState<SpinnerTargetState>(itemCount > 0 ? "inside" : "outside");
  const [isDragging, setIsDragging] = useState(false);
  const rotationRef = useRef(0);
  const activeIndexRef = useRef(0);
  const onCommitRef = useRef(onCommit);
  const onRejectRef = useRef(onReject);
  const measureTargetRef = useRef(measureTarget);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAnimatingRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    lastAngle: number;
    moved: boolean;
    captured: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    onRejectRef.current = onReject;
  }, [onReject]);

  useLayoutEffect(() => {
    measureTargetRef.current = measureTarget;
  }, [measureTarget]);

  const cancelPending = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
    settleTimerRef.current = null;
    animationTimerRef.current = null;
    isAnimatingRef.current = false;
  }, []);

  const updateRotation = useCallback((nextRotation: number, nextItemCount = itemCount) => {
    rotationRef.current = nextRotation;
    setRotation(nextRotation);
    const nextActiveIndex = getNearestItemIndex(nextRotation, nextItemCount);
    activeIndexRef.current = nextActiveIndex;
    setActiveIndex(nextActiveIndex);
  }, [itemCount]);

  const commitIndex = useCallback((index: number) => {
    onCommitRef.current(index);
    return true;
  }, []);

  const measureActivation = useCallback(() => {
    const measure = measureTargetRef.current;
    if (!measure) {
      const index = getSpinnerActivationIndex(
        rotationRef.current,
        itemCount,
        activationThresholdDegrees
      );
      return {
        index,
        state: index === null ? "outside" as const : "inside" as const,
        rejectedIndex: null,
        rejectedMeasurement: null
      };
    }

    let bestIndex: number | null = null;
    let bestMeasurement: SpinnerTargetMeasurement | null = null;
    let rejectedIndex: number | null = null;
    let rejectedMeasurement: SpinnerTargetMeasurement | null = null;
    for (let index = 0; index < itemCount; index += 1) {
      const measurement = measure(index);
      if (measurement.state === "outside") {
        if (
          measurement.overlapRatio > 0
          && (!rejectedMeasurement || measurement.overlapRatio > rejectedMeasurement.overlapRatio)
        ) {
          rejectedIndex = index;
          rejectedMeasurement = measurement;
        }
        continue;
      }
      const stateRank = measurement.state === "inside" ? 2 : 1;
      const bestStateRank = bestMeasurement?.state === "inside" ? 2 : bestMeasurement ? 1 : 0;
      if (
        !bestMeasurement
        || stateRank > bestStateRank
        || (stateRank === bestStateRank && measurement.overlapRatio > bestMeasurement.overlapRatio)
      ) {
        bestIndex = index;
        bestMeasurement = measurement;
      }
    }
    return {
      index: bestIndex,
      state: bestMeasurement?.state ?? "outside",
      rejectedIndex,
      rejectedMeasurement
    };
  }, [activationThresholdDegrees, itemCount]);

  const refreshActivation = useCallback(() => {
    const next = measureActivation();
    setActivationIndex(next.index);
    setActivationState(next.state);
    return next;
  }, [measureActivation]);

  const snapToIndex = useCallback((requestedIndex: number, options: SnapOptions = {}) => {
    cancelPending();
    if (itemCount <= 0) return;

    const index = Math.max(0, Math.min(requestedIndex, itemCount - 1));
    const snappedRotation = rotationRef.current
      - normalizeSpinnerAngle(getSpinnerItemAngle(index, itemCount) + rotationRef.current);
    updateRotation(snappedRotation);
    activeIndexRef.current = index;
    setActiveIndex(index);
    setActivationIndex(index);
    setActivationState("inside");

    if (options.commit === false) return;
    isAnimatingRef.current = true;
    animationTimerRef.current = setTimeout(() => {
      animationTimerRef.current = null;
      isAnimatingRef.current = false;
      commitIndex(index);
    }, snapDurationMs);
  }, [cancelPending, commitIndex, itemCount, snapDurationMs, updateRotation]);

  const activateIndex = useCallback((requestedIndex: number) => {
    if (isAnimatingRef.current) return false;
    cancelPending();
    const activation = measureActivation();
    if (activation.index === null || activation.index !== requestedIndex) {
      onRejectRef.current?.();
      return false;
    }
    if (activation.state === "magnet") {
      snapToIndex(activation.index, { commit: false });
    }
    return commitIndex(activation.index);
  }, [cancelPending, commitIndex, measureActivation, snapToIndex]);

  const bounceOut = useCallback((index: number, measurement: SpinnerTargetMeasurement) => {
    cancelPending();
    if (itemCount <= 0) return;

    updateRotation(getSpinnerBounceRotation(
      rotationRef.current,
      itemCount,
      index,
      measurement
    ));
    setActivationIndex(null);
    setActivationState("outside");
    isAnimatingRef.current = true;
    animationTimerRef.current = setTimeout(() => {
      animationTimerRef.current = null;
      isAnimatingRef.current = false;
      onRejectRef.current?.();
    }, bounceDurationMs);
  }, [bounceDurationMs, cancelPending, itemCount, updateRotation]);

  const scheduleSettle = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      const activation = measureActivation();
      if (activation.index === null) {
        setActivationIndex(null);
        setActivationState("outside");
        if (activation.rejectedIndex !== null && activation.rejectedMeasurement) {
          bounceOut(activation.rejectedIndex, activation.rejectedMeasurement);
          return;
        }
        onRejectRef.current?.();
        return;
      }
      snapToIndex(activation.index);
    }, settleDelayMs);
  }, [bounceOut, measureActivation, settleDelayMs, snapToIndex]);

  useEffect(() => {
    cancelPending();
    if (itemCount <= 0) {
      updateRotation(0, 0);
      return;
    }
    const safeIndex = Math.min(activeIndexRef.current, itemCount - 1);
    const snappedRotation = rotationRef.current
      - normalizeSpinnerAngle(getSpinnerItemAngle(safeIndex, itemCount) + rotationRef.current);
    updateRotation(snappedRotation, itemCount);
  }, [cancelPending, itemCount, updateRotation]);

  useEffect(() => cancelPending, [cancelPending]);

  useLayoutEffect(() => {
    if (!isAnimatingRef.current) refreshActivation();
  }, [activationKey, refreshActivation, rotation]);

  function getPointerAngle(event: ReactPointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    return Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (itemCount <= 0 || (event.button !== 0 && event.pointerType === "mouse")) return;
    const interruptedAnimation = isAnimatingRef.current;
    cancelPending();
    dragStateRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      lastAngle: getPointerAngle(event),
      moved: false,
      captured: false
    };
    suppressClickRef.current = interruptedAnimation;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const dragDistance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY
    );
    const dragThreshold = dragState.pointerType === "mouse" ? 5 : 10;
    if (!dragState.moved && dragDistance < dragThreshold) return;

    if (!dragState.captured) {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragState.captured = true;
    }
    dragState.moved = true;
    suppressClickRef.current = true;
    setIsDragging(true);

    const nextPointerAngle = getPointerAngle(event);
    const delta = normalizeSpinnerAngle(nextPointerAngle - dragState.lastAngle);
    if (Math.abs(delta) < 0.15) return;

    dragState.lastAngle = nextPointerAngle;
    updateRotation(rotationRef.current + delta);
  }

  function finishPointer(event: ReactPointerEvent<HTMLElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (dragState.captured && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setIsDragging(false);

    if (dragState.moved) {
      scheduleSettle();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }

  function consumeSuppressedClick() {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }

  return {
    rotation,
    activeIndex,
    activationIndex,
    activationState,
    isDragging,
    cancelPending,
    snapToIndex,
    activateIndex,
    consumeSuppressedClick,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishPointer,
      onPointerCancel: finishPointer
    }
  };
}

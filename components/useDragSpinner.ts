"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export type SpinnerTargetState = "outside" | "magnet" | "inside";
export type SpinnerMotionState =
  | "idle"
  | "dragging"
  | "inertia"
  | "snapping"
  | "bouncing"
  | "activating";

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
  onRotationFrame?: (rotation: number) => void;
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
export const SPINNER_INERTIA_FRICTION = 0.92;
export const SPINNER_INERTIA_MIN_START_VELOCITY = 0.035;
export const SPINNER_INERTIA_STOP_VELOCITY = 0.012;
export const SPINNER_INERTIA_MAX_VELOCITY = 0.32;
export const SPINNER_INERTIA_SAMPLE_WINDOW_MS = 120;
export const SPINNER_INERTIA_MAX_DURATION_MS = 700;
export const SPINNER_TARGET_DAMPING_START_RATIO = 0.3;
export const SPINNER_TARGET_PROXIMITY_FRICTION = 0.84;

type SpinnerMovementSample = {
  rotation: number;
  time: number;
};

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

function clampSpinnerVelocity(velocity: number) {
  return Math.max(
    -SPINNER_INERTIA_MAX_VELOCITY,
    Math.min(SPINNER_INERTIA_MAX_VELOCITY, velocity)
  );
}

function getRecentSpinnerVelocity(samples: SpinnerMovementSample[]) {
  const lastSample = samples.at(-1);
  if (!lastSample || samples.length < 2) return 0;

  const firstSample = samples.find(
    (sample) => sample.time >= lastSample.time - SPINNER_INERTIA_SAMPLE_WINDOW_MS
  ) ?? samples[0];
  const elapsedMs = lastSample.time - firstSample.time;
  if (elapsedMs < 8) return 0;

  return clampSpinnerVelocity(
    (lastSample.rotation - firstSample.rotation) / elapsedMs
  );
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
  onRotationFrame,
  activationKey = null,
  activationThresholdDegrees = SPINNER_ACTIVATION_THRESHOLD_DEGREES,
  settleDelayMs = 220,
  snapDurationMs = 260,
  bounceDurationMs = 280
}: DragSpinnerOptions) {
  const [renderedRotation, setRenderedRotation] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activationIndex, setActivationIndex] = useState<number | null>(itemCount > 0 ? 0 : null);
  const [activationState, setActivationState] = useState<SpinnerTargetState>(itemCount > 0 ? "inside" : "outside");
  const [isDragging, setIsDragging] = useState(false);
  const [isInertiaActive, setIsInertiaActive] = useState(false);
  const [motionState, setMotionStateValue] = useState<SpinnerMotionState>("idle");
  const rotationRef = useRef(0);
  const activeIndexRef = useRef(0);
  const onCommitRef = useRef(onCommit);
  const onRejectRef = useRef(onReject);
  const measureTargetRef = useRef(measureTarget);
  const onRotationFrameRef = useRef(onRotationFrame);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotationFrameRef = useRef<number | null>(null);
  const inertiaFrameRef = useRef<number | null>(null);
  const magnetFrameRef = useRef<number | null>(null);
  const clickReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAnimatingRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    pointerType: string;
    captureTarget: Element;
    centerX: number;
    centerY: number;
    startX: number;
    startY: number;
    lastAngle: number;
    samples: SpinnerMovementSample[];
    moved: boolean;
    captured: boolean;
  } | null>(null);
  const pointerSessionCleanupRef = useRef<(() => void) | null>(null);
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

  useLayoutEffect(() => {
    onRotationFrameRef.current = onRotationFrame;
  }, [onRotationFrame]);

  const setMotionState = useCallback((nextState: SpinnerMotionState) => {
    setMotionStateValue(nextState);
  }, []);

  const cancelPending = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
    if (rotationFrameRef.current !== null) window.cancelAnimationFrame(rotationFrameRef.current);
    if (inertiaFrameRef.current !== null) window.cancelAnimationFrame(inertiaFrameRef.current);
    if (magnetFrameRef.current !== null) window.cancelAnimationFrame(magnetFrameRef.current);
    if (clickReleaseTimerRef.current) clearTimeout(clickReleaseTimerRef.current);
    settleTimerRef.current = null;
    animationTimerRef.current = null;
    rotationFrameRef.current = null;
    inertiaFrameRef.current = null;
    magnetFrameRef.current = null;
    clickReleaseTimerRef.current = null;
    isAnimatingRef.current = false;
    setIsInertiaActive(false);
    setMotionState("idle");
  }, [setMotionState]);

  const applyRotationFrame = useCallback((
    nextRotation: number,
    nextItemCount = itemCount,
    updateActiveIndex = true
  ) => {
    rotationRef.current = nextRotation;
    onRotationFrameRef.current?.(nextRotation);
    if (!updateActiveIndex) return;
    const nextActiveIndex = getNearestItemIndex(nextRotation, nextItemCount);
    if (activeIndexRef.current !== nextActiveIndex) {
      activeIndexRef.current = nextActiveIndex;
      setActiveIndex(nextActiveIndex);
    }
  }, [itemCount]);

  const updateRotation = useCallback((nextRotation: number, nextItemCount = itemCount) => {
    applyRotationFrame(nextRotation, nextItemCount);
    setRenderedRotation(nextRotation);
  }, [applyRotationFrame, itemCount]);

  const scheduleRotation = useCallback((nextRotation: number) => {
    rotationRef.current = nextRotation;
    if (rotationFrameRef.current !== null) return;
    rotationFrameRef.current = window.requestAnimationFrame(() => {
      rotationFrameRef.current = null;
      applyRotationFrame(rotationRef.current);
    });
  }, [applyRotationFrame]);

  const flushRotationFrame = useCallback(() => {
    if (rotationFrameRef.current === null) return;
    window.cancelAnimationFrame(rotationFrameRef.current);
    rotationFrameRef.current = null;
    applyRotationFrame(rotationRef.current);
  }, [applyRotationFrame]);

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

  const measureInertiaTarget = useCallback(() => {
    if (itemCount <= 0) {
      return { index: null, measurement: emptyTargetMeasurement() };
    }

    const index = getNearestItemIndex(rotationRef.current, itemCount);
    const measure = measureTargetRef.current;
    if (!measure) {
      const isInside = getSpinnerActivationIndex(
        rotationRef.current,
        itemCount,
        activationThresholdDegrees
      ) === index;
      return {
        index: isInside ? index : null,
        measurement: {
          ...emptyTargetMeasurement(),
          state: isInside ? "inside" as const : "outside" as const
        }
      };
    }

    const measurement = measure(index);
    return {
      index: measurement.state === "outside" ? null : index,
      measurement
    };
  }, [activationThresholdDegrees, itemCount]);

  const snapToIndex = useCallback((requestedIndex: number, options: SnapOptions = {}) => {
    cancelPending();
    if (itemCount <= 0) return;

    setMotionState("snapping");
    const index = Math.max(0, Math.min(requestedIndex, itemCount - 1));
    const snappedRotation = rotationRef.current
      - normalizeSpinnerAngle(getSpinnerItemAngle(index, itemCount) + rotationRef.current);
    updateRotation(snappedRotation);
    activeIndexRef.current = index;
    setActiveIndex(index);
    setActivationIndex(index);
    setActivationState("inside");

    if (options.commit === false) {
      setMotionState("idle");
      return;
    }
    isAnimatingRef.current = true;
    animationTimerRef.current = setTimeout(() => {
      animationTimerRef.current = null;
      setMotionState("activating");
      isAnimatingRef.current = false;
      commitIndex(index);
      setMotionState("idle");
    }, snapDurationMs);
  }, [cancelPending, commitIndex, itemCount, setMotionState, snapDurationMs, updateRotation]);

  const startMagnetSnap = useCallback((index: number) => {
    if (inertiaFrameRef.current !== null) {
      window.cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
    if (magnetFrameRef.current !== null) {
      window.cancelAnimationFrame(magnetFrameRef.current);
    }

    isAnimatingRef.current = true;
    setIsInertiaActive(false);
    setMotionState("snapping");
    setActivationIndex(index);
    setActivationState("magnet");

    // inertia의 transition-none 상태를 먼저 해제한 다음, 다음 paint에서
    // 기존 260ms ease-out transform transition으로 타겟 중심에 정렬합니다.
    magnetFrameRef.current = window.requestAnimationFrame(() => {
      magnetFrameRef.current = window.requestAnimationFrame(() => {
        magnetFrameRef.current = null;
        snapToIndex(index);
      });
    });
  }, [setMotionState, snapToIndex]);

  const activateIndex = useCallback((requestedIndex: number) => {
    if (isAnimatingRef.current) return false;
    cancelPending();
    const activation = measureActivation();
    if (activation.index === null || activation.index !== requestedIndex) {
      onRejectRef.current?.();
      return false;
    }
    if (activation.state === "magnet") {
      startMagnetSnap(activation.index);
      return true;
    }
    return commitIndex(activation.index);
  }, [cancelPending, commitIndex, measureActivation, startMagnetSnap]);

  const bounceOut = useCallback((index: number, measurement: SpinnerTargetMeasurement) => {
    cancelPending();
    if (itemCount <= 0) return;

    updateRotation(getSpinnerBounceRotation(
      rotationRef.current,
      itemCount,
      index,
      measurement
    ));
    setMotionState("bouncing");
    setActivationIndex(null);
    setActivationState("outside");
    isAnimatingRef.current = true;
    animationTimerRef.current = setTimeout(() => {
      animationTimerRef.current = null;
      isAnimatingRef.current = false;
      setMotionState("idle");
      onRejectRef.current?.();
    }, bounceDurationMs);
  }, [bounceDurationMs, cancelPending, itemCount, setMotionState, updateRotation]);

  const scheduleSettle = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    isAnimatingRef.current = true;
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
        isAnimatingRef.current = false;
        setMotionState("idle");
        onRejectRef.current?.();
        return;
      }
      snapToIndex(activation.index);
    }, settleDelayMs);
  }, [bounceOut, measureActivation, setMotionState, settleDelayMs, snapToIndex]);

  const startInertia = useCallback((requestedVelocity: number) => {
    const startingTarget = measureInertiaTarget();
    if (startingTarget.index !== null) {
      startMagnetSnap(startingTarget.index);
      return;
    }

    const initialVelocity = clampSpinnerVelocity(requestedVelocity);
    if (Math.abs(initialVelocity) < SPINNER_INERTIA_MIN_START_VELOCITY) {
      updateRotation(rotationRef.current);
      scheduleSettle();
      return;
    }

    if (inertiaFrameRef.current !== null) {
      window.cancelAnimationFrame(inertiaFrameRef.current);
    }
    isAnimatingRef.current = true;
    setIsInertiaActive(true);
    setMotionState("inertia");

    let velocity = initialVelocity;
    let startedAt = 0;
    let previousFrameAt = 0;
    const tick = (frameTime: number) => {
      if (startedAt === 0) {
        startedAt = frameTime;
        previousFrameAt = frameTime;
      }
      const elapsedSinceFrame = Math.min(32, Math.max(1, frameTime - previousFrameAt));
      previousFrameAt = frameTime;
      applyRotationFrame(rotationRef.current + velocity * elapsedSinceFrame, itemCount, false);
      const inertiaTarget = measureInertiaTarget();
      if (inertiaTarget.index !== null) {
        startMagnetSnap(inertiaTarget.index);
        return;
      }

      const overlapRatio = inertiaTarget.measurement.overlapRatio;
      const dampingProgress = Math.min(
        1,
        Math.max(
          0,
          (overlapRatio - SPINNER_TARGET_DAMPING_START_RATIO)
            / (SPINNER_TARGET_OVERLAP_THRESHOLD - SPINNER_TARGET_DAMPING_START_RATIO)
        )
      );
      const frameFriction = SPINNER_INERTIA_FRICTION
        - (SPINNER_INERTIA_FRICTION - SPINNER_TARGET_PROXIMITY_FRICTION) * dampingProgress;
      velocity *= Math.pow(
        frameFriction,
        elapsedSinceFrame / (1000 / 60)
      );

      const didReachTimeLimit = frameTime - startedAt >= SPINNER_INERTIA_MAX_DURATION_MS;
      if (Math.abs(velocity) <= SPINNER_INERTIA_STOP_VELOCITY || didReachTimeLimit) {
        inertiaFrameRef.current = null;
        setIsInertiaActive(false);
        isAnimatingRef.current = false;
        setMotionState("idle");
        updateRotation(rotationRef.current);
        scheduleSettle();
        return;
      }
      inertiaFrameRef.current = window.requestAnimationFrame(tick);
    };

    inertiaFrameRef.current = window.requestAnimationFrame(tick);
  }, [
    applyRotationFrame,
    itemCount,
    measureInertiaTarget,
    scheduleSettle,
    setMotionState,
    startMagnetSnap,
    updateRotation
  ]);

  const resetInteraction = useCallback(() => {
    cancelPending();
    pointerSessionCleanupRef.current?.();
    pointerSessionCleanupRef.current = null;
    const dragState = dragStateRef.current;
    dragStateRef.current = null;
    if (
      dragState?.captured
      && dragState.captureTarget.hasPointerCapture(dragState.pointerId)
    ) {
      try {
        dragState.captureTarget.releasePointerCapture(dragState.pointerId);
      } catch {
        // 브라우저가 capture를 먼저 해제했어도 내부 상태는 계속 초기화합니다.
      }
    }
    suppressClickRef.current = false;
    setIsDragging(false);
    setIsInertiaActive(false);
    setMotionState("idle");
  }, [cancelPending, setMotionState]);

  useEffect(() => {
    resetInteraction();
    if (itemCount <= 0) {
      updateRotation(0, 0);
      return;
    }
    const safeIndex = Math.min(activeIndexRef.current, itemCount - 1);
    const snappedRotation = rotationRef.current
      - normalizeSpinnerAngle(getSpinnerItemAngle(safeIndex, itemCount) + rotationRef.current);
    updateRotation(snappedRotation, itemCount);
  }, [itemCount, resetInteraction, updateRotation]);

  useEffect(() => () => {
    resetInteraction();
    if (rotationFrameRef.current !== null) window.cancelAnimationFrame(rotationFrameRef.current);
  }, [resetInteraction]);

  useEffect(() => {
    function resetInterruptedGesture() {
      resetInteraction();
    }

    function resetWhenHidden() {
      if (document.visibilityState === "hidden") resetInteraction();
    }

    window.addEventListener("blur", resetInterruptedGesture);
    window.addEventListener("pagehide", resetInterruptedGesture);
    document.addEventListener("visibilitychange", resetWhenHidden);
    return () => {
      window.removeEventListener("blur", resetInterruptedGesture);
      window.removeEventListener("pagehide", resetInterruptedGesture);
      document.removeEventListener("visibilitychange", resetWhenHidden);
    };
  }, [resetInteraction]);

  useLayoutEffect(() => {
    if (!isAnimatingRef.current) refreshActivation();
  }, [activationKey, refreshActivation, renderedRotation]);

  function getPointerAngle(clientX: number, clientY: number, centerX: number, centerY: number) {
    return Math.atan2(clientY - centerY, clientX - centerX) * (180 / Math.PI);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (itemCount <= 0 || (event.button !== 0 && event.pointerType === "mouse")) return;
    if (dragStateRef.current) return;

    const interruptedAnimation = isAnimatingRef.current;
    flushRotationFrame();
    cancelPending();
    const bounds = event.currentTarget.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const captureTarget = event.target instanceof Element ? event.target : event.currentTarget;
    let captured = false;
    try {
      captureTarget.setPointerCapture(event.pointerId);
      captured = captureTarget.hasPointerCapture(event.pointerId);
    } catch {
      // iOS 구버전처럼 capture가 불안정한 환경도 window 추적으로 drag를 이어갑니다.
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      captureTarget,
      centerX,
      centerY,
      startX: event.clientX,
      startY: event.clientY,
      lastAngle: getPointerAngle(event.clientX, event.clientY, centerX, centerY),
      samples: [{
        rotation: rotationRef.current,
        time: event.timeStamp
      }],
      moved: false,
      captured
    };
    suppressClickRef.current = interruptedAnimation;
    setIsDragging(true);
    setMotionState("dragging");

    function preventActiveTouchScroll(touchEvent: TouchEvent) {
      if (dragStateRef.current?.pointerId === event.pointerId) {
        touchEvent.preventDefault();
      }
    }

    function handleWindowPointerMove(pointerEvent: PointerEvent) {
      onPointerMove(pointerEvent);
    }

    function handleWindowPointerUp(pointerEvent: PointerEvent) {
      finishPointer(pointerEvent);
    }

    function handleWindowPointerCancel(pointerEvent: PointerEvent) {
      finishPointer(pointerEvent, true);
    }

    const cleanupPointerSession = () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
      if (event.pointerType !== "mouse") {
        window.removeEventListener("touchmove", preventActiveTouchScroll);
      }
      if (pointerSessionCleanupRef.current === cleanupPointerSession) {
        pointerSessionCleanupRef.current = null;
      }
    };

    pointerSessionCleanupRef.current = cleanupPointerSession;
    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);
    if (event.pointerType !== "mouse") {
      window.addEventListener("touchmove", preventActiveTouchScroll, { passive: false });
    }
  }

  function onPointerMove(event: PointerEvent) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (event.cancelable && dragState.pointerType !== "mouse") event.preventDefault();

    const dragDistance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY
    );
    const dragThreshold = dragState.pointerType === "mouse" ? 5 : 10;
    if (!dragState.moved && dragDistance < dragThreshold) return;

    if (!dragState.moved) {
      dragState.moved = true;
      suppressClickRef.current = true;
    }

    const nextPointerAngle = getPointerAngle(
      event.clientX,
      event.clientY,
      dragState.centerX,
      dragState.centerY
    );
    const delta = normalizeSpinnerAngle(nextPointerAngle - dragState.lastAngle);
    if (Math.abs(delta) < 0.15) return;

    dragState.lastAngle = nextPointerAngle;
    const nextRotation = rotationRef.current + delta;
    const sampleTime = event.timeStamp;
    dragState.samples = [
      ...dragState.samples.filter(
        (sample) => sample.time >= sampleTime - SPINNER_INERTIA_SAMPLE_WINDOW_MS
      ),
      { rotation: nextRotation, time: sampleTime }
    ].slice(-5);
    scheduleRotation(nextRotation);
  }

  function releaseSuppressedClickSoon() {
    if (clickReleaseTimerRef.current) clearTimeout(clickReleaseTimerRef.current);
    clickReleaseTimerRef.current = setTimeout(() => {
      clickReleaseTimerRef.current = null;
      suppressClickRef.current = false;
    }, 0);
  }

  function finishPointer(event: PointerEvent, cancelled = false) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    pointerSessionCleanupRef.current?.();
    pointerSessionCleanupRef.current = null;
    dragStateRef.current = null;
    if (dragState.captured && dragState.captureTarget.hasPointerCapture(event.pointerId)) {
      try {
        dragState.captureTarget.releasePointerCapture(event.pointerId);
      } catch {
        // 브라우저가 pointerup 직전에 capture를 해제했어도 종료 흐름은 유지합니다.
      }
    }
    setIsDragging(false);
    setMotionState("idle");

    if (dragState.moved && !cancelled) {
      flushRotationFrame();
      startInertia(getRecentSpinnerVelocity([
        ...dragState.samples,
        { rotation: rotationRef.current, time: event.timeStamp }
      ].slice(-5)));
      releaseSuppressedClickSoon();
      return;
    }

    if (cancelled) {
      cancelPending();
      suppressClickRef.current = true;
      releaseSuppressedClickSoon();
    }
  }

  function consumeSuppressedClick() {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }

  return {
    rotation: rotationRef.current,
    activeIndex,
    activationIndex,
    activationState,
    motionState,
    isDragging,
    isInertiaActive,
    isMoving: isDragging || isInertiaActive,
    cancelPending,
    snapToIndex,
    activateIndex,
    consumeSuppressedClick,
    resetInteraction,
    pointerHandlers: {
      onPointerDown,
      onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => {
        const dragState = dragStateRef.current;
        if (dragState?.pointerId === event.pointerId) {
          // capture가 예기치 않게 풀려도 window 추적으로 손을 뗄 때까지 drag를 유지합니다.
          dragState.captured = false;
        }
      }
    }
  };
}

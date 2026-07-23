"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type DragSpinnerOptions = {
  itemCount: number;
  onCommit: (index: number) => void;
  settleDelayMs?: number;
  snapDurationMs?: number;
};

type SnapOptions = {
  commit?: boolean;
};

export function normalizeSpinnerAngle(angle: number) {
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

export function getSpinnerItemAngle(index: number, itemCount: number) {
  return itemCount > 0 ? (index * 360) / itemCount : 0;
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

/** 휠 이벤트 없이 pointer drag로만 회전하고 3시 방향에 스냅하는 공용 spinner 동작입니다. */
export function useDragSpinner({
  itemCount,
  onCommit,
  settleDelayMs = 180,
  snapDurationMs = 260
}: DragSpinnerOptions) {
  const [rotation, setRotation] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const rotationRef = useRef(0);
  const activeIndexRef = useRef(0);
  const onCommitRef = useRef(onCommit);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastAngle: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  const cancelPending = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    settleTimerRef.current = null;
    snapTimerRef.current = null;
  }, []);

  const updateRotation = useCallback((nextRotation: number, nextItemCount = itemCount) => {
    rotationRef.current = nextRotation;
    setRotation(nextRotation);
    const nextActiveIndex = getNearestItemIndex(nextRotation, nextItemCount);
    activeIndexRef.current = nextActiveIndex;
    setActiveIndex(nextActiveIndex);
  }, [itemCount]);

  const snapToIndex = useCallback((requestedIndex: number, options: SnapOptions = {}) => {
    cancelPending();
    if (itemCount <= 0) return;

    const index = Math.max(0, Math.min(requestedIndex, itemCount - 1));
    const snappedRotation = rotationRef.current
      - normalizeSpinnerAngle(getSpinnerItemAngle(index, itemCount) + rotationRef.current);
    updateRotation(snappedRotation);
    activeIndexRef.current = index;
    setActiveIndex(index);

    if (options.commit === false) return;
    snapTimerRef.current = setTimeout(() => {
      onCommitRef.current(index);
    }, snapDurationMs);
  }, [cancelPending, itemCount, snapDurationMs, updateRotation]);

  const scheduleSettle = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      snapToIndex(getNearestItemIndex(rotationRef.current, itemCount));
    }, settleDelayMs);
  }, [itemCount, settleDelayMs, snapToIndex]);

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

  function getPointerAngle(event: ReactPointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    return Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (itemCount <= 0 || (event.button !== 0 && event.pointerType === "mouse")) return;
    cancelPending();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastAngle: getPointerAngle(event),
      moved: false
    };
    suppressClickRef.current = false;
    setIsDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const dragDistance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY
    );
    if (!dragState.moved && dragDistance < 6) return;

    const nextPointerAngle = getPointerAngle(event);
    const delta = normalizeSpinnerAngle(nextPointerAngle - dragState.lastAngle);
    if (Math.abs(delta) < 0.15) return;

    dragState.lastAngle = nextPointerAngle;
    dragState.moved = true;
    suppressClickRef.current = true;
    updateRotation(rotationRef.current + delta);
  }

  function finishPointer(event: ReactPointerEvent<HTMLElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
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
    isDragging,
    cancelPending,
    snapToIndex,
    consumeSuppressedClick,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishPointer,
      onPointerCancel: finishPointer
    }
  };
}

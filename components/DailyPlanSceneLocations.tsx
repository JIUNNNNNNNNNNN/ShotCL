"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DailyPlanSceneLocationSelection } from "@/lib/dailyPlan/sceneLocations";

export type DailyPlanSceneLocationAssignment = {
  locationId: string;
  label: string;
};

type DailyPlanSceneLocationsProps = {
  options: DailyPlanSceneLocationSelection[];
  selected: DailyPlanSceneLocationSelection[];
  locationId: string;
  assignments: Record<string, DailyPlanSceneLocationAssignment>;
  onChange: (next: DailyPlanSceneLocationSelection[]) => void;
  onOpenChange?: (open: boolean) => void;
};

type FixedPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

const VIEWPORT_GAP_PX = 14;

/**
 * 촬영지 카드 한 장에 연결할 씬리스트 대장소를 고르는 controlled picker입니다.
 * 선택 확정 전에는 내부 draft만 바꾸므로 기존 일촬표 저장 정책을 침범하지 않습니다.
 */
export function DailyPlanSceneLocations({
  options,
  selected,
  locationId,
  assignments,
  onChange,
  onOpenChange
}: DailyPlanSceneLocationsProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerDraft, setPickerDraft] = useState<DailyPlanSceneLocationSelection[]>([]);
  const [pickerPosition, setPickerPosition] = useState<FixedPosition | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pickerButtonRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const pickerOptions = useMemo(() => {
    const knownKeys = new Set(options.map((option) => option.key));
    return [
      ...options,
      ...selected.filter((selection) => !knownKeys.has(selection.key))
    ];
  }, [options, selected]);

  const selectedLabel = selected.map((item) => item.name).filter(Boolean).join(" / ");
  const selectedKeys = useMemo(
    () => new Set(pickerDraft.map((item) => item.key)),
    [pickerDraft]
  );

  useEffect(() => {
    onOpenChange?.(isPickerOpen);
  }, [isPickerOpen, onOpenChange]);

  const updatePickerPosition = useCallback(() => {
    const trigger = pickerButtonRef.current;
    if (!trigger) return;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.min(360, viewportWidth - VIEWPORT_GAP_PX * 2);
    const maxHeight = Math.min(430, viewportHeight - VIEWPORT_GAP_PX * 2);
    const renderedHeight = pickerRef.current?.getBoundingClientRect().height;
    const panelHeight = Math.min(
      renderedHeight && renderedHeight > 0 ? renderedHeight : maxHeight,
      maxHeight
    );
    const left = clamp(
      triggerRect.left,
      viewportLeft + VIEWPORT_GAP_PX,
      viewportLeft + viewportWidth - width - VIEWPORT_GAP_PX
    );
    const belowTop = triggerRect.bottom + 6;
    const top = belowTop + panelHeight <= viewportTop + viewportHeight - VIEWPORT_GAP_PX
      ? belowTop
      : Math.max(viewportTop + VIEWPORT_GAP_PX, triggerRect.top - panelHeight - 6);
    setPickerPosition({ left, top, width, maxHeight });
  }, []);

  useEffect(() => {
    if (!isPickerOpen) return;
    updatePickerPosition();
    const handleViewportChange = () => updatePickerPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, [isPickerOpen, updatePickerPosition]);

  useEffect(() => {
    if (!isPickerOpen) return;

    function handleOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || pickerRef.current?.contains(target)) return;
      setIsPickerOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsPickerOpen(false);
    }

    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isPickerOpen]);

  function openPicker() {
    setPickerDraft(selected);
    setIsPickerOpen(true);
    window.requestAnimationFrame(updatePickerPosition);
  }

  function togglePickerOption(option: DailyPlanSceneLocationSelection) {
    const assignment = assignments[option.key];
    const isSelected = pickerDraft.some((item) => item.key === option.key);
    if (!isSelected && assignment && assignment.locationId !== locationId) return;

    setPickerDraft((current) => {
      const exists = current.some((item) => item.key === option.key);
      return exists
        ? current.filter((item) => item.key !== option.key)
        : [...current, option];
    });
  }

  return (
    <div ref={rootRef} className="min-w-0" data-testid="daily-plan-scene-locations">
      <button
        ref={pickerButtonRef}
        type="button"
        data-location-reorder-press
        className="flex min-h-9 w-full min-w-0 items-center justify-center border border-field-border bg-field-input px-2.5 text-center text-xs font-normal text-field-text transition-colors hover:border-field-divider hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary/25"
        aria-expanded={isPickerOpen}
        aria-haspopup="dialog"
        title={selectedLabel || "장소명 선택"}
        onClick={openPicker}
      >
        <span className={`min-w-0 flex-1 break-words text-center leading-4 [overflow-wrap:anywhere] ${selectedLabel ? "" : "text-field-muted"}`}>
          {selectedLabel || "장소명 선택"}
        </span>
      </button>

      {isPickerOpen && pickerPosition ? createPortal(
        <div
          ref={pickerRef}
          role="dialog"
          aria-label="씬리스트 대장소 선택"
          className="fixed z-[120] flex flex-col overflow-hidden border border-field-border bg-field-elevated"
          style={{
            left: pickerPosition.left,
            top: pickerPosition.top,
            width: pickerPosition.width,
            maxHeight: pickerPosition.maxHeight
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {pickerOptions.length > 0 ? (
              <div className="grid gap-1">
                {pickerOptions.map((option) => {
                  const isSelected = selectedKeys.has(option.key);
                  const isMissing = !options.some((item) => item.key === option.key);
                  const assignment = assignments[option.key];
                  const isAssignedElsewhere = Boolean(
                    assignment && assignment.locationId !== locationId && !isSelected
                  );
                  const status = isAssignedElsewhere
                    ? assignment?.label || "다른 촬영장소에 연결됨"
                    : isMissing
                      ? "씬리스트에 없음"
                      : isSelected
                        ? "선택됨"
                        : "";

                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={isAssignedElsewhere}
                      className={`grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border px-3 text-center text-xs font-normal transition-colors disabled:cursor-not-allowed ${
                        isSelected
                          ? "neon-selected text-field-text"
                          : isAssignedElsewhere
                            ? "border-field-border bg-field-disabled text-field-panel"
                            : "border-field-border bg-field-input text-field-text hover:bg-field-hover"
                      }`}
                      onClick={() => togglePickerOption(option)}
                    >
                      <span className="break-words text-center leading-4 [overflow-wrap:anywhere]">{option.name}</span>
                      {status ? (
                        <span className="max-w-28 break-words text-center text-[10px] leading-4 text-field-muted [overflow-wrap:anywhere]" title={status}>
                          {status}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="px-2 py-5 text-center text-xs font-normal text-field-muted">
                선택할 대장소가 없습니다.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1 border-t border-field-border p-2">
            <button
              type="button"
              className="min-h-9 border border-field-border bg-field-input text-xs font-bold text-field-subtle transition-colors hover:bg-field-hover hover:text-field-text"
              onClick={() => setIsPickerOpen(false)}
            >
              취소
            </button>
            <button
              type="button"
              className="min-h-9 border border-field-primary bg-field-primary text-xs font-bold text-field-accent-foreground transition-colors hover:bg-field-secondary"
              onClick={() => {
                onChange(pickerDraft);
                setIsPickerOpen(false);
              }}
            >
              완료
            </button>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

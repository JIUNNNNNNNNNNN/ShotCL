"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import type { DailyPlanSceneLocationSelection } from "@/lib/dailyPlan/sceneLocations";

type DailyPlanSceneLocationsProps = {
  options: DailyPlanSceneLocationSelection[];
  selected: DailyPlanSceneLocationSelection[];
  onChange: (next: DailyPlanSceneLocationSelection[]) => void;
};

type FixedPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight?: number;
};

type DragSession = {
  pointerId: number;
  key: string;
  startX: number;
  startY: number;
  row: HTMLDivElement;
  timer: number | null;
  activated: boolean;
  originalOrder: DailyPlanSceneLocationSelection[];
};

const LONG_PRESS_MS = 575;
const MOVE_TOLERANCE_PX = 9;
const VIEWPORT_GAP_PX = 14;

export function DailyPlanSceneLocations({ options, selected, onChange }: DailyPlanSceneLocationsProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerDraft, setPickerDraft] = useState<DailyPlanSceneLocationSelection[]>([]);
  const [pickerPosition, setPickerPosition] = useState<FixedPosition | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<FixedPosition | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pickerButtonRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedListRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragOrderRef = useRef(selected);
  const previousBodyUserSelectRef = useRef("");
  const suppressClickUntilRef = useRef(0);

  useEffect(() => {
    if (!dragSessionRef.current?.activated) dragOrderRef.current = selected;
  }, [selected]);

  const pickerOptions = useMemo(() => {
    const knownKeys = new Set(options.map((option) => option.key));
    return [
      ...options,
      ...selected.filter((selection) => !knownKeys.has(selection.key))
    ];
  }, [options, selected]);

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
    const panelHeight = Math.min(renderedHeight && renderedHeight > 0 ? renderedHeight : maxHeight, maxHeight);
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

  const updateMenuPosition = useCallback((key: string) => {
    const trigger = menuTriggerRefs.current.get(key);
    if (!trigger) return;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const triggerRect = trigger.getBoundingClientRect();
    const width = 168;
    const height = 50;
    const left = clamp(
      triggerRect.right - width,
      viewportLeft + VIEWPORT_GAP_PX,
      viewportLeft + viewportWidth - width - VIEWPORT_GAP_PX
    );
    const belowTop = triggerRect.bottom + 6;
    const top = belowTop + height <= viewportTop + viewportHeight - VIEWPORT_GAP_PX
      ? belowTop
      : Math.max(viewportTop + VIEWPORT_GAP_PX, triggerRect.top - height - 6);
    setMenuPosition({ left, top, width });
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
    if (!menuKey) return;
    updateMenuPosition(menuKey);
    const handleViewportChange = () => updateMenuPosition(menuKey);
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
  }, [menuKey, updateMenuPosition]);

  useEffect(() => {
    function handleOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || pickerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsPickerOpen(false);
      setMenuKey(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsPickerOpen(false);
      setMenuKey(null);
    }

    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const finishDragSession = useCallback((pointerId?: number) => {
    const session = dragSessionRef.current;
    if (!session || (pointerId !== undefined && session.pointerId !== pointerId)) return;
    if (session.timer !== null) window.clearTimeout(session.timer);
    if (session.row.hasPointerCapture?.(session.pointerId)) {
      try {
        session.row.releasePointerCapture(session.pointerId);
      } catch {
        // capture가 이미 해제된 경우에는 정리만 계속합니다.
      }
    }
    session.row.style.touchAction = "pan-y";
    if (session.activated) {
      document.body.style.userSelect = previousBodyUserSelectRef.current;
      suppressClickUntilRef.current = Date.now() + 700;
    }
    dragSessionRef.current = null;
    setDraggingKey(null);
  }, []);

  useEffect(() => () => finishDragSession(), [finishDragSession]);

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
    const listRect = selectedListRef.current?.getBoundingClientRect();
    const isInsideList = Boolean(listRect)
      && event.clientX >= listRect!.left
      && event.clientX <= listRect!.right
      && event.clientY >= listRect!.top
      && event.clientY <= listRect!.bottom;
    if (!isInsideList) return;
    const order = dragOrderRef.current;
    const sourceIndex = order.findIndex((item) => item.key === session.key);
    if (sourceIndex < 0) return;
    let targetIndex = sourceIndex;
    let closestDistance = Number.POSITIVE_INFINITY;
    order.forEach((item, index) => {
      const row = rowRefs.current.get(item.key);
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
    function handlePointerEnd(event: PointerEvent) {
      const session = dragSessionRef.current;
      if (session?.activated && session.pointerId === event.pointerId) {
        const listRect = selectedListRef.current?.getBoundingClientRect();
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
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [finishDragSession, onChange, trackPointer]);

  function openPicker() {
    finishDragSession();
    setMenuKey(null);
    setPickerDraft(selected);
    setIsPickerOpen(true);
    window.requestAnimationFrame(updatePickerPosition);
  }

  function togglePickerOption(option: DailyPlanSceneLocationSelection) {
    setPickerDraft((current) => {
      const isSelected = current.some((item) => item.key === option.key);
      return isSelected
        ? current.filter((item) => item.key !== option.key)
        : [...current, option];
    });
  }

  function beginLongPress(event: React.PointerEvent<HTMLDivElement>, key: string) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0) || menuKey) return;
    if ((event.target as HTMLElement).closest("button, input, textarea, select, a, [data-no-location-reorder]")) return;
    finishDragSession();
    const row = event.currentTarget;
    row.style.touchAction = "pan-y";
    const session: DragSession = {
      pointerId: event.pointerId,
      key,
      startX: event.clientX,
      startY: event.clientY,
      row,
      timer: null,
      activated: false,
      originalOrder: selected
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
        // 일부 구형 브라우저에서는 전역 pointer 추적으로 계속 처리합니다.
      }
      dragOrderRef.current = selected;
      window.getSelection()?.removeAllRanges();
      setDraggingKey(key);
    }, LONG_PRESS_MS);
    dragSessionRef.current = session;
  }

  function openItemMenu(event: React.PointerEvent<HTMLButtonElement>, key: string) {
    event.preventDefault();
    event.stopPropagation();
    finishDragSession();
    setIsPickerOpen(false);
    setMenuKey((current) => current === key ? null : key);
    window.requestAnimationFrame(() => updateMenuPosition(key));
  }

  const selectedKeys = new Set(pickerDraft.map((item) => item.key));

  return (
    <div ref={rootRef} className="grid gap-1.5" data-testid="daily-plan-scene-locations">
      <button
        ref={pickerButtonRef}
        type="button"
        className="min-h-9 w-full rounded-[3px] border border-field-primary bg-field-light px-3 text-left text-xs font-black text-field-primary hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
        aria-expanded={isPickerOpen}
        aria-haspopup="dialog"
        onClick={openPicker}
      >
        씬리스트에서 장소 선택
      </button>

      {selected.length > 0 ? (
        <div ref={selectedListRef} className="grid gap-1" aria-label="선택된 씬 대장소 순서">
          {selected.map((location, index) => (
            <div
              key={location.key}
              ref={(node) => {
                if (node) rowRefs.current.set(location.key, node);
                else rowRefs.current.delete(location.key);
              }}
              className={`relative flex min-h-9 select-none items-center border bg-white pl-3 pr-10 text-xs font-bold transition-colors ${
                draggingKey === location.key
                  ? "z-10 border-field-primary bg-field-light shadow-md"
                  : "border-field-border"
              } rounded-[3px]`}
              style={{ touchAction: "pan-y", WebkitTouchCallout: "none" }}
              onPointerDown={(event) => beginLongPress(event, location.key)}
              onContextMenu={(event) => event.preventDefault()}
              onClick={(event) => {
                if (Date.now() < suppressClickUntilRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              aria-label={`${index + 1}번째 선택 장소 ${location.name}. 길게 눌러 순서 변경`}
            >
              <span className="min-w-0 flex-1 truncate">{location.name}</span>
              <button
                ref={(node) => {
                  if (node) menuTriggerRefs.current.set(location.key, node);
                  else menuTriggerRefs.current.delete(location.key);
                }}
                type="button"
                data-no-location-reorder
                aria-label={`${location.name} 관리 메뉴`}
                aria-expanded={menuKey === location.key}
                className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[3px] border border-field-border bg-white text-field-muted hover:border-field-primary hover:text-field-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                onPointerDown={(event) => openItemMenu(event, location.key)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {isPickerOpen && pickerPosition ? createPortal(
        <div
          ref={pickerRef}
          role="dialog"
          aria-label="씬리스트 대장소 선택"
          className="fixed z-[120] flex flex-col overflow-hidden rounded-[3px] border border-field-border bg-white shadow-xl"
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
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={isSelected}
                      className={`grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[2px] border px-3 text-left text-xs font-bold ${
                        isSelected
                          ? "border-field-primary bg-field-light text-field-primary"
                          : "border-field-border bg-white text-field-text hover:border-field-primary"
                      }`}
                      onClick={() => togglePickerOption(option)}
                    >
                      <span className="truncate">{option.name}</span>
                      <span className="text-[10px] text-field-muted">
                        {isMissing ? "씬리스트에 없음" : isSelected ? "선택됨" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="px-2 py-5 text-center text-xs font-bold text-field-muted">선택할 대장소가 없습니다.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1 border-t border-field-border p-2">
            <button
              type="button"
              className="min-h-9 rounded-[2px] border border-field-border bg-white text-xs font-bold text-field-muted hover:border-field-primary hover:text-field-primary"
              onClick={() => setIsPickerOpen(false)}
            >
              취소
            </button>
            <button
              type="button"
              className="min-h-9 rounded-[2px] border border-field-primary bg-field-primary text-xs font-black text-white hover:opacity-90"
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

      {menuKey && menuPosition ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="선택 장소 관리"
          className="fixed z-[130] grid rounded-[3px] border border-field-border bg-white p-1.5 shadow-xl"
          style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }}
        >
          <button
            type="button"
            role="menuitem"
            className="min-h-9 rounded-[2px] px-2 text-left text-xs font-bold text-field-danger hover:bg-red-50"
            onClick={() => {
              onChange(selected.filter((item) => item.key !== menuKey));
              setMenuKey(null);
            }}
          >
            선택 목록에서 제거
          </button>
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

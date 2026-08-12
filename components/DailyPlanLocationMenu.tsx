"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

type DailyPlanLocationMenuProps = {
  label: string;
  isPrimary: boolean;
  isDetailExpanded: boolean;
  canAdd: boolean;
  isOpen: boolean;
  onSetPrimary: () => void;
  onToggleDetail: () => void;
  onAdd: () => void;
  onDelete: () => void;
  onOpenChange: (open: boolean) => void;
};

const VIEWPORT_GAP = 14;
const MENU_WIDTH = 176;

/** 상위 overflow와 무관하게 viewport 안에 표시되는 촬영주소 관리 메뉴입니다. */
export function DailyPlanLocationMenu({
  label,
  isPrimary,
  isDetailExpanded,
  canAdd,
  isOpen,
  onSetPrimary,
  onToggleDetail,
  onAdd,
  onDelete,
  onOpenChange
}: DailyPlanLocationMenuProps) {
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const triggerRect = trigger.getBoundingClientRect();
    const estimatedHeight = canAdd ? 170 : 132;
    const renderedHeight = menuRef.current?.getBoundingClientRect().height;
    const menuHeight = renderedHeight && renderedHeight > 0 ? renderedHeight : estimatedHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const openLeft = triggerRect.left - MENU_WIDTH - 6;
    const openRight = triggerRect.right + 6;
    const left = openLeft >= viewportLeft + VIEWPORT_GAP
      ? openLeft
      : openRight + MENU_WIDTH <= viewportRight - VIEWPORT_GAP
        ? openRight
        : clamp(
            triggerRect.right - MENU_WIDTH,
            viewportLeft + VIEWPORT_GAP,
            viewportRight - MENU_WIDTH - VIEWPORT_GAP
          );
    const belowTop = triggerRect.bottom + 6;
    const top = belowTop + menuHeight <= viewportTop + viewportHeight - VIEWPORT_GAP
      ? belowTop
      : Math.max(viewportTop + VIEWPORT_GAP, triggerRect.top - menuHeight - 6);
    setPosition({ left, top });
  }, [canAdd]);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const handleViewportChange = () => updatePosition();
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
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    function handleOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-daily-plan-location-menu-trigger]")) return;
      onOpenChange(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      onOpenChange(false);
    }
    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onOpenChange]);

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-no-location-reorder
        data-daily-plan-location-menu-trigger
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center justify-self-end border hover:border-field-subtle hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary ${
          isPrimary ? "border-field-primary/80 bg-field-primary/10 text-field-primary" : "border-field-divider bg-field-panel text-field-muted hover:text-field-text"
        }`}
        aria-label={`${label} 관리 메뉴`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={isPrimary ? "집합장소 · 관리 메뉴" : "촬영장소 관리 메뉴"}
        onClick={() => {
          if (isOpen) {
            onOpenChange(false);
            return;
          }
          onOpenChange(true);
          window.requestAnimationFrame(updatePosition);
        }}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>

      {isOpen ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${label} 관리`}
          className="fixed z-[130] grid gap-1 border border-field-divider bg-field-elevated p-1.5 text-field-text"
          style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
        >
          <>
              <button
                type="button"
                role="menuitem"
                aria-pressed={isPrimary}
                className="min-h-8 border border-transparent px-2 text-left text-xs font-bold text-field-text hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary aria-[pressed=true]:border-field-primary/70 aria-[pressed=true]:bg-field-primary/10 aria-[pressed=true]:text-field-primary"
                onClick={() => run(onSetPrimary)}
              >
                {isPrimary ? "집합장소" : "집합장소 지정"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="min-h-8 px-2 text-left text-xs font-bold text-field-text hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                onClick={() => run(onToggleDetail)}
              >
                {isDetailExpanded ? "장소/주소 보기" : "상세 메모 입력"}
              </button>
              {canAdd ? (
                <button
                  type="button"
                  role="menuitem"
                  className="min-h-8 px-2 text-left text-xs font-bold text-field-text hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                  onClick={() => run(onAdd)}
                >
                  촬영장소 추가
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="min-h-8 px-2 text-left text-xs font-bold text-field-danger hover:bg-field-danger hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-danger"
                onClick={() => run(onDelete)}
              >
                촬영장소 삭제
              </button>
            </>
        </div>,
        document.body
      ) : null}
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

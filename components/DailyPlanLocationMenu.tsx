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
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const triggerRect = trigger.getBoundingClientRect();
    const estimatedHeight = isDeleteConfirming ? 116 : canAdd ? 170 : 132;
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
  }, [canAdd, isDeleteConfirming]);

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
      setIsDeleteConfirming(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (isDeleteConfirming) {
        setIsDeleteConfirming(false);
        return;
      }
      onOpenChange(false);
    }
    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isDeleteConfirming, isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen || !isDeleteConfirming) return;
    window.requestAnimationFrame(() => cancelDeleteRef.current?.focus());
  }, [isDeleteConfirming, isOpen]);

  function run(action: () => void) {
    onOpenChange(false);
    setIsDeleteConfirming(false);
    action();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-no-location-reorder
        data-daily-plan-location-menu-trigger
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center justify-self-end rounded-[3px] border text-field-muted hover:border-field-primary hover:text-field-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary ${
          isPrimary ? "border-field-primary bg-field-light text-field-primary" : "border-field-border bg-white"
        }`}
        aria-label={`${label} 관리 메뉴`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={isPrimary ? "집합장소 · 관리 메뉴" : "촬영장소 관리 메뉴"}
        onClick={() => {
          if (isOpen) {
            onOpenChange(false);
            setIsDeleteConfirming(false);
            return;
          }
          setIsDeleteConfirming(false);
          onOpenChange(true);
          window.requestAnimationFrame(updatePosition);
        }}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>

      {isOpen ? createPortal(
        <div
          ref={menuRef}
          role={isDeleteConfirming ? "alertdialog" : "menu"}
          aria-label={isDeleteConfirming ? `${label} 삭제 확인` : `${label} 관리`}
          className="fixed z-[130] grid gap-1 rounded-[3px] border border-field-border bg-white p-1.5 shadow-xl"
          style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
        >
          {isDeleteConfirming ? (
            <div className="grid gap-2 p-1">
              <p className="text-xs font-bold leading-[1.45] text-field-text">
                {label}을 삭제할까요?
              </p>
              <div className="grid grid-cols-2 gap-1">
                <button
                  ref={cancelDeleteRef}
                  type="button"
                  className="min-h-8 rounded-[2px] border border-field-border bg-white px-2 text-xs font-bold text-field-primary hover:bg-field-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                  onClick={() => {
                    setIsDeleteConfirming(false);
                    window.requestAnimationFrame(updatePosition);
                  }}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="min-h-8 rounded-[2px] border border-field-danger bg-field-danger px-2 text-xs font-black text-white hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-danger"
                  onClick={() => run(onDelete)}
                >
                  삭제
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                aria-pressed={isPrimary}
                className="min-h-8 rounded-[2px] px-2 text-left text-xs font-bold text-field-primary hover:bg-field-light"
                onClick={() => run(onSetPrimary)}
              >
                {isPrimary ? "집합장소" : "집합장소 지정"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="min-h-8 rounded-[2px] px-2 text-left text-xs font-bold text-field-primary hover:bg-field-light"
                onClick={() => run(onToggleDetail)}
              >
                {isDetailExpanded ? "장소/주소 보기" : "상세 메모 입력"}
              </button>
              {canAdd ? (
                <button
                  type="button"
                  role="menuitem"
                  className="min-h-8 rounded-[2px] px-2 text-left text-xs font-bold text-field-primary hover:bg-field-light"
                  onClick={() => run(onAdd)}
                >
                  촬영장소 추가
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="min-h-8 rounded-[2px] px-2 text-left text-xs font-bold text-field-danger hover:bg-red-50"
                onClick={() => {
                  setIsDeleteConfirming(true);
                  window.requestAnimationFrame(updatePosition);
                }}
              >
                촬영장소 삭제
              </button>
            </>
          )}
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

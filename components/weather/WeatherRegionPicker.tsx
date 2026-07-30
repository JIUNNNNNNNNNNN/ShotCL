"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";

import {
  resolveKoreanWeatherRegion,
  type KoreanWeatherRegion
} from "@/lib/koreanWeatherRegions";

import { KoreaWeatherRegionMap } from "./KoreaWeatherRegionMap";

type WeatherRegionPickerProps = {
  value: string;
  onChange: (region: KoreanWeatherRegion | null) => void;
  readOnly?: boolean;
};

type PopoverPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
};

const POPOVER_GAP = 6;
const MOBILE_VIEWPORT_PADDING = 12;
const DESKTOP_VIEWPORT_PADDING = 16;
const DESKTOP_POPOVER_WIDTH = 400;
const MAX_POPOVER_HEIGHT = 520;

function getPopoverPosition(trigger: HTMLButtonElement): PopoverPosition {
  const visualViewport = window.visualViewport;
  const viewportLeft = visualViewport?.offsetLeft ?? 0;
  const viewportTop = visualViewport?.offsetTop ?? 0;
  const viewportWidth = visualViewport?.width ?? window.innerWidth;
  const viewportHeight = visualViewport?.height ?? window.innerHeight;
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;
  const viewportPadding = viewportWidth < 640
    ? MOBILE_VIEWPORT_PADDING
    : DESKTOP_VIEWPORT_PADDING;
  const width = Math.max(
    0,
    Math.min(DESKTOP_POPOVER_WIDTH, viewportWidth - viewportPadding * 2)
  );
  const baseMaxHeight = Math.max(
    0,
    Math.min(
      viewportWidth < 640 ? viewportHeight * 0.75 : MAX_POPOVER_HEIGHT,
      viewportHeight - viewportPadding * 2
    )
  );
  const triggerRect = trigger.getBoundingClientRect();
  const preferredHeight = Math.min(470, baseMaxHeight);
  const availableBelow = viewportBottom - triggerRect.bottom - POPOVER_GAP - viewportPadding;
  const availableAbove = triggerRect.top - viewportTop - POPOVER_GAP - viewportPadding;
  const placement = availableBelow >= preferredHeight
    ? "bottom"
    : availableAbove >= Math.min(240, preferredHeight)
      ? "top"
      : availableBelow >= availableAbove
        ? "bottom"
        : "top";
  const availableOnPlacement = placement === "bottom" ? availableBelow : availableAbove;
  const maxHeight = Math.max(0, Math.min(baseMaxHeight, availableOnPlacement));
  const measuredHeight = Math.min(preferredHeight, maxHeight);
  const desiredTop = placement === "bottom"
    ? triggerRect.bottom + POPOVER_GAP
    : triggerRect.top - POPOVER_GAP - measuredHeight;
  const top = Math.max(
    viewportTop + viewportPadding,
    Math.min(desiredTop, viewportBottom - measuredHeight - viewportPadding)
  );
  const left = Math.max(
    viewportLeft + viewportPadding,
    Math.min(triggerRect.left, viewportRight - width - viewportPadding)
  );

  return { left, top, width, maxHeight, placement };
}

/** 날씨 기준 지역을 고르는 compact anchored popover입니다. */
export function WeatherRegionPicker({
  value,
  onChange,
  readOnly = false
}: WeatherRegionPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition>({
    left: MOBILE_VIEWPORT_PADDING,
    top: MOBILE_VIEWPORT_PADDING,
    width: 400,
    maxHeight: MAX_POPOVER_HEIGHT,
    placement: "bottom"
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const selected = resolveKoreanWeatherRegion(value);

  const closePopover = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || !trigger.isConnected) {
      closePopover(false);
      return;
    }
    const triggerRect = trigger.getBoundingClientRect();
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight);
    if (triggerRect.bottom < viewportTop || triggerRect.top > viewportBottom) {
      closePopover(true);
      return;
    }
    setPosition(getPopoverPosition(trigger));
  }, [closePopover]);

  useEffect(() => {
    if (!isOpen) return;

    const frame = requestAnimationFrame(() => {
      updatePosition();
      const panel = panelRef.current;
      const focusTarget = readOnly
        ? panel?.querySelector<HTMLElement>("[data-weather-region-close]")
        : (
            panel?.querySelector<HTMLElement>('[data-selected="true"][tabindex="0"]')
            ?? panel?.querySelector<HTMLElement>(".korea-weather-map-region[tabindex=\"0\"]")
          );
      focusTarget?.focus({ preventScroll: true });
    });

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      closePopover(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePopover(true);
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [closePopover, isOpen, readOnly, updatePosition]);

  const selectRegion = (regionValue: string) => {
    if (readOnly) return;
    const region = resolveKoreanWeatherRegion(regionValue);
    if (!region) return;
    onChange(region);
    closePopover(true);
  };

  const openOrClose = () => {
    if (isOpen) {
      closePopover(false);
      return;
    }
    const trigger = triggerRef.current;
    if (trigger) setPosition(getPopoverPosition(trigger));
    setIsOpen(true);
  };

  const mapHeight = Math.max(220, Math.min(410, position.maxHeight - 58));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="grid min-h-11 w-full grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-[3px] border border-field-border bg-white px-3 py-2 text-left transition-colors hover:border-field-primary hover:bg-field-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f] focus-visible:ring-offset-2"
        onClick={openOrClose}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={panelId}
        aria-label={`날씨 기준 지역 ${selected?.label ?? "지역 선택"}`}
      >
        <span className="text-xs font-black text-field-primary">날씨 기준 지역</span>
        <span className="truncate text-sm font-black text-field-text">
          {selected?.label ?? "지역 선택"}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-field-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-modal="false"
              aria-labelledby={titleId}
              className="fixed z-[90] flex flex-col overflow-hidden rounded-[3px] border border-field-border bg-field-bg shadow-xl"
              style={{
                left: position.left,
                top: position.top,
                width: position.width,
                maxWidth: "calc(100vw - 24px)",
                maxHeight: position.maxHeight
              }}
              data-placement={position.placement}
              data-weather-region-popover
            >
              <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-field-border bg-white px-3 py-1.5">
                <p id={titleId} className="min-w-0 text-xs font-black text-field-primary">
                  날씨 지역 선택
                  {selected ? (
                    <span className="ml-1.5 text-field-muted">— 현재: {selected.label}</span>
                  ) : null}
                </p>
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] border border-field-border bg-white text-field-muted hover:border-field-primary hover:bg-field-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b95f]"
                  onClick={() => closePopover(true)}
                  aria-label="날씨 지역 선택 닫기"
                  data-weather-region-close
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="min-h-0 overflow-y-auto px-3 py-2">
                <div className="mx-auto w-full" style={{ height: mapHeight }}>
                  <KoreaWeatherRegionMap
                    value={selected?.label ?? ""}
                    onSelect={readOnly ? undefined : selectRegion}
                    readOnly={readOnly}
                    ariaLabel={readOnly
                      ? "대한민국 날씨 기준 지역 확인"
                      : "대한민국 날씨 기준 지역 선택"}
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export type { WeatherRegionPickerProps };

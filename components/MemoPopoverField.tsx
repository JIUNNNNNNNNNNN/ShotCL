"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type MemoPopoverFieldProps = {
  value: string;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
};

const triggerClassName =
  "min-h-[38px] w-full min-w-0 rounded-md border border-field-border bg-white px-2 py-1.5 text-center text-[13px] font-bold text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-light";

/** 일촬표 내용 카드와 스텝 특이사항이 함께 쓰는 작은 live-update 편집 카드입니다. */
export function MemoPopoverField({ value, placeholder, ariaLabel, onChange }: MemoPopoverFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 300 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftValueRef = useRef(value);

  useEffect(() => {
    if (!isOpen) {
      setDraftValue(value);
      draftValueRef.current = value;
    }
  }, [isOpen, value]);

  useEffect(() => () => {
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
  }, []);

  function flushDraft(nextDraft = draftValueRef.current) {
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
    changeTimerRef.current = null;
    if (nextDraft !== value) onChange(nextDraft);
  }

  function closePopover() {
    flushDraft();
    setIsOpen(false);
  }

  function updatePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const estimatedHeight = 150;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = rect.bottom + estimatedHeight <= window.innerHeight - 12
      ? rect.bottom + 6
      : Math.max(12, rect.top - estimatedHeight - 6);
    setPosition({ left, top, width });
  }

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePopover();
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closePopover();
    }

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${triggerClassName} block max-w-full overflow-hidden whitespace-nowrap !text-left`}
        onClick={() => {
          setDraftValue(value);
          draftValueRef.current = value;
          setIsOpen((current) => !current);
        }}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        title={value || placeholder}
      >
        <span className={`block overflow-hidden text-ellipsis whitespace-nowrap ${value ? "text-field-text" : "text-center text-field-muted"}`}>
          {value || placeholder}
        </span>
      </button>
      {isOpen && typeof document !== "undefined" ? createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={ariaLabel}
          className="fixed z-[80] rounded-sm border border-field-border bg-white p-2 shadow-xl"
          style={position}
          data-memo-popover
        >
          <div className="flex justify-end">
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded text-field-muted hover:bg-field-soft"
              onClick={closePopover}
              aria-label={`${ariaLabel} 닫기`}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <textarea
            autoFocus
            rows={4}
            className="w-full resize-y border-0 bg-white p-1.5 pt-0 text-left text-[13px] font-bold leading-relaxed text-field-text outline-none"
            value={draftValue}
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              draftValueRef.current = nextValue;
              setDraftValue(nextValue);
              if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
              changeTimerRef.current = setTimeout(() => onChange(nextValue), 180);
            }}
            onBlur={(event) => flushDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              event.preventDefault();
              const trigger = triggerRef.current;
              flushDraft(event.currentTarget.value);
              setIsOpen(false);
              window.setTimeout(() => focusAdjacentElement(trigger, event.shiftKey ? -1 : 1));
            }}
            placeholder="여기에 입력"
            aria-label={`${ariaLabel} 입력`}
          />
        </div>,
        document.body
      ) : null}
    </>
  );
}

function focusAdjacentElement(source: HTMLElement | null, direction: -1 | 1) {
  if (!source) return;
  const focusable = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.offsetParent !== null && !element.closest("[data-memo-popover]"));
  const currentIndex = focusable.indexOf(source);
  focusable[currentIndex + direction]?.focus();
}

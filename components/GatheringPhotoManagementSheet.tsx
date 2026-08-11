"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Trash2 } from "lucide-react";
import { useContextualGuideBlocker } from "@/components/guides/ContextualGuideProvider";
import styles from "./GatheringPhotoManagementSheet.module.css";

const CLOSE_MS = 140;

type GatheringPhotoManagementSheetProps = {
  open: boolean;
  disabled?: boolean;
  returnFocusRef: { current: HTMLElement | null };
  onChangePhoto: () => void;
  onDeletePhoto: () => void;
  onCancel: () => void;
};

type SheetPhase = "closed" | "open" | "closing";

export function GatheringPhotoManagementSheet({
  open,
  disabled = false,
  returnFocusRef,
  onChangePhoto,
  onDeletePhoto,
  onCancel
}: GatheringPhotoManagementSheetProps) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<SheetPhase>("closed");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const changeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const titleId = useId();
  const rendered = phase !== "closed";

  useContextualGuideBlocker("progress-gathering-photo-management", open || rendered);

  useEffect(() => setMounted(true), []);

  const restoreTriggerFocus = useCallback(() => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      const fallback = document.querySelector<HTMLButtonElement>(".project-shell__action-toggle");
      const focusTarget = isValidReturnTarget(target) ? target : fallback;
      focusTarget?.focus({ preventScroll: true });
    });
  }, [returnFocusRef]);

  const finishClosing = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setPhase("closed");
    if (shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false;
      restoreTriggerFocus();
    }
  }, [restoreTriggerFocus]);

  useEffect(() => {
    if (open && !disabled) {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      shouldRestoreFocusRef.current = false;
      setPhase("open");
      return;
    }
    if (!rendered) return;
    setPhase("closing");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishClosing();
      return;
    }
    closeTimerRef.current = window.setTimeout(finishClosing, CLOSE_MS);
  }, [disabled, finishClosing, open, rendered]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!rendered) return undefined;
    const mainContent = document.getElementById("project-main-content");
    const previousBodyOverflow = document.body.style.overflow;
    const previousMainOverflowY = mainContent?.style.overflowY ?? "";
    const previousMainOverscrollBehavior = mainContent?.style.overscrollBehavior ?? "";
    document.body.style.overflow = "hidden";
    if (mainContent) {
      mainContent.style.overflowY = "hidden";
      mainContent.style.overscrollBehavior = "contain";
    }
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (mainContent) {
        mainContent.style.overflowY = previousMainOverflowY;
        mainContent.style.overscrollBehavior = previousMainOverscrollBehavior;
      }
    };
  }, [rendered]);

  const requestCancel = useCallback(() => {
    if (disabled) return;
    shouldRestoreFocusRef.current = true;
    onCancel();
  }, [disabled, onCancel]);

  useEffect(() => {
    if (phase !== "open") return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      changeButtonRef.current?.focus({ preventScroll: true });
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable(dialog!);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog!.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (!dialog!.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [phase, requestCancel]);

  function runAction(action: () => void) {
    if (disabled) return;
    shouldRestoreFocusRef.current = false;
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setPhase("closed");
    action();
  }

  if (!mounted || !rendered) return null;
  return createPortal(
    <div
      ref={dialogRef}
      className={styles.overlay}
      data-contextual-guide-overlay
      data-project-shell-portal
      data-closing={phase === "closing" ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-hidden={phase === "closing" || undefined}
      inert={phase === "closing" || undefined}
      tabIndex={-1}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestCancel();
      }}
    >
      <section className={styles.sheet}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>집합장소 사진 관리</h2>
        </header>
        <div className={styles.actions}>
          <button
            ref={changeButtonRef}
            type="button"
            className={styles.action}
            disabled={disabled}
            onClick={() => runAction(onChangePhoto)}
          >
            <Camera className={styles.actionIcon} aria-hidden />
            <span className={styles.actionLabel}>사진 변경</span>
            <span aria-hidden />
          </button>
          <button
            type="button"
            className={`${styles.action} ${styles.danger}`}
            disabled={disabled}
            onClick={() => runAction(onDeletePhoto)}
          >
            <Trash2 className={styles.actionIcon} aria-hidden />
            <span className={styles.actionLabel}>사진 삭제</span>
            <span aria-hidden />
          </button>
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.cancel} disabled={disabled} onClick={requestCancel}>
            취소
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

function getFocusable(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(
    "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
  )).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

function isValidReturnTarget(element: HTMLElement | null) {
  return Boolean(
    element
    && element !== document.body
    && element !== document.documentElement
    && element.isConnected
    && !element.closest("[inert]")
    && element.matches("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")
  );
}
